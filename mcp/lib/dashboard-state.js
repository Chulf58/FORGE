// dashboard-state.js — Pure state-builder for the FORGE dashboard contract.
//
// Both consumers share this function:
//   - `forge_dashboard_state` MCP tool (mcp/server.js)
//   - the local HTTP sidecar at scripts/dashboard-server.mjs
//
// No side effects, no network, no persistent state — just read the registry
// + board + run-active files and return the four-group snapshot.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getRun, listRuns, getRunActivePath } from "../../packages/forge-core/src/runs/index.js";

import { stageLabelFromStages } from "./stage-labels.js";

const HARD_TERMINAL_STATUSES = new Set(["failed", "discarded", "completed"]);
const RECENT_COMPLETED_LIMIT = 5;
const TOP_TODOS_LIMIT = 5;

/**
 * Scan an agents array for the most recent BLOCK outcome and count REVISE outcomes.
 * Returns { reviewer, reviseCount } when a BLOCK exists, or null.
 * `reviewer` is the agentType with the `forge:` prefix stripped.
 * Pure function — no I/O, no external dependencies.
 */
export function extractLatestBlock(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return null;
  const blocker = [...agents].reverse().find(a => a.outcome === 'BLOCK');
  if (!blocker) return null;
  const reviewer = (blocker.agentType || '').startsWith('forge:')
    ? blocker.agentType.slice('forge:'.length)
    : (blocker.agentType || '');
  const reviseCount = agents.filter(a => a.outcome === 'REVISE').length;
  return { reviewer, reviseCount };
}

function isTerminal(entry) {
  return HARD_TERMINAL_STATUSES.has(entry.status);
}

function readActiveUnit(pipelineDir) {
  try {
    const raw = readFileSync(join(pipelineDir, "run-active.json"), "utf8");
    const data = JSON.parse(raw);
    const runId = data && typeof data.runId === "string" ? data.runId : null;
    const cu = data && data.currentUnit;
    const currentUnit =
      cu && typeof cu === "object" && typeof cu.agent === "string" && cu.agent
        ? cu
        : null;
    return { runId, currentUnit };
  } catch (_) {
    return { runId: null, currentUnit: null };
  }
}

function readJsonSafe(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Build the dashboard state snapshot for a FORGE-initialized project.
 * Returns { activeRuns, gatesAwaiting, recentCompleted, boardSummary }.
 * Never throws — missing files and parse failures degrade to empty groups.
 */
function deriveActionNeeded(run) {
  if (run.mergeBlocked) return "resolve merge conflict";
  const gs = run.gateState;
  if (!gs) return null;
  if (gs.status === "pending") return "/forge:approve (" + gs.gate + ")";
  if (gs.status === "approved" && gs.gate === "gate2") return "/forge:apply";
  return null;
}

/**
 * Read the per-run active file for a single runId.
 * Returns the parsed data, or null when the file is absent or unreadable.
 * Safe — never throws.
 */
function readPerRunActive(projectDir, runId) {
  try {
    const perRunPath = getRunActivePath(projectDir, runId);
    if (!existsSync(perRunPath)) return null;
    const raw = readFileSync(perRunPath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

export async function buildDashboardState(projectDir) {
  const pipelineDir = join(projectDir, ".pipeline");

  // 1) Active unit marker — singleton identifies which run is currently steered.
  const { runId: activeRunId, currentUnit: activeUnit } = readActiveUnit(pipelineDir);

  // 2) Enumerate runs from the registry (with listRuns' lazy-heal).
  let allEntries = [];
  try {
    allEntries = listRuns(projectDir, {});
  } catch (_) {
    allEntries = [];
  }

  // 3) activeRuns — non-terminal runs (running or gate-pending).
  //    Collect candidates first so we can fan-out per-run file reads in parallel.
  const candidates = [];
  for (const entry of allEntries) {
    if (entry.status !== "running" && entry.status !== "gate-pending") continue;
    let full = null;
    try {
      full = getRun(projectDir, entry.runId);
    } catch (_) {
      full = null;
    }
    const src = full || entry;
    if (isTerminal(src)) continue;
    candidates.push(src);
  }

  // Read all per-run active files in parallel (AC-10).
  const perRunActiveResults = await Promise.all(
    candidates.map(src => Promise.resolve(readPerRunActive(projectDir, src.runId))),
  );

  const activeRuns = candidates.map((src, i) => {
    const perRunData = perRunActiveResults[i];

    // Derive currentUnit: prefer per-run active file's currentUnit when present;
    // fall back to singleton comparison for runs without a per-run file (legacy).
    let currentUnit;
    if (perRunData && perRunData.currentUnit) {
      const cu = perRunData.currentUnit;
      currentUnit = cu && typeof cu === 'object' && typeof cu.agent === 'string' && cu.agent
        ? cu
        : null;
    } else {
      // Legacy fallback: only the run matching singleton's runId can have a currentUnit.
      currentUnit = src.runId === activeRunId ? activeUnit : null;
    }

    return {
      runId: src.runId,
      pipelineType: src.pipelineType,
      feature: src.feature || "",
      status: src.status,
      stageLabel: stageLabelFromStages(src.stages),
      gateState: src.gateState || null,
      worktreePath: src.worktreePath || null,
      currentUnit,
      mergeBlocked: src.mergeBlocked || null,
      updatedAt: src.updatedAt || null,
      actionNeeded: deriveActionNeeded(src),
      latestBlock: extractLatestBlock(src.agents || []),
    };
  });
  activeRuns.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  // 4) gatesAwaiting — actionable pending gates from the active set.
  const gatesAwaiting = activeRuns
    .filter(r => r.status === "gate-pending" && r.gateState && r.gateState.status === "pending")
    .map(r => ({
      runId: r.runId,
      pipelineType: r.pipelineType,
      feature: r.feature,
      gateState: r.gateState,
      updatedAt: r.updatedAt,
    }));

  // 5) recentCompleted — truly terminal runs only.
  //    Excludes completed runs that still need a next pipeline step.
  //    Unacknowledged research runs bypass the recency limit so they
  //    stay visible until the user explicitly acknowledges them.
  const activeRunIds = new Set(activeRuns.map(r => r.runId));
  const terminalEntries = allEntries
    .filter(e => {
      if (activeRunIds.has(e.runId)) return false;
      return HARD_TERMINAL_STATUSES.has(e.status) || e.status === "completed";
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  const REVIEWABLE_TYPES = new Set(["research", "ideate"]);
  const unackResearchIds = new Set();
  for (const e of terminalEntries) {
    if (REVIEWABLE_TYPES.has(e.pipelineType) && e.status === "completed") {
      try {
        const full = getRun(projectDir, e.runId);
        if (full && !full.acknowledged) unackResearchIds.add(e.runId);
      } catch (_) {}
    }
  }

  const capped = terminalEntries
    .filter(e => !unackResearchIds.has(e.runId))
    .slice(0, RECENT_COMPLETED_LIMIT);
  const unackResearch = terminalEntries
    .filter(e => unackResearchIds.has(e.runId));

  const recentCompleted = [...unackResearch, ...capped]
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map(e => {
      let mergeBlocked = null;
      try {
        const full = getRun(projectDir, e.runId);
        if (full && full.mergeBlocked) mergeBlocked = full.mergeBlocked;
      } catch (_) {}
      return {
        runId: e.runId,
        pipelineType: e.pipelineType,
        feature: e.feature || "",
        status: e.status,
        mergeBlocked,
        updatedAt: e.updatedAt || null,
      };
    });

  // 6) boardSummary — compact counts + top-priority open TODOs.
  const boardSummary = {
    todoCount: 0,
    plannedCount: 0,
    blockedTodoCount: 0,
    topPriorityTodos: [],
  };
  const boardPath = join(pipelineDir, "board.json");
  const boardRead = readJsonSafe(boardPath);
  if (boardRead.ok && boardRead.data && typeof boardRead.data === "object") {
    const board = boardRead.data;
    const todos = Array.isArray(board.todos) ? board.todos : [];
    const planned = Array.isArray(board.planned) ? board.planned : [];
    const openTodos = todos.filter(t => t && t.done !== true);
    boardSummary.todoCount = openTodos.length;
    boardSummary.plannedCount = planned.length;
    boardSummary.blockedTodoCount = openTodos.filter(
      t => Array.isArray(t.blockedBy) && t.blockedBy.length > 0
    ).length;
    const priorityRank = { high: 0, medium: 1, low: 2 };
    boardSummary.topPriorityTodos = openTodos
      .slice()
      .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9))
      .slice(0, TOP_TODOS_LIMIT)
      .map(t => ({
        id: t.id || null,
        priority: t.priority || null,
        text: typeof t.text === "string" ? t.text.slice(0, 200) : "",
      }));
  }

  return { activeRuns, gatesAwaiting, recentCompleted, boardSummary };
}
