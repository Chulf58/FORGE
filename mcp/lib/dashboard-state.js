// dashboard-state.js — Pure state-builder for the FORGE dashboard contract.
//
// Both consumers share this function:
//   - `forge_dashboard_state` MCP tool (mcp/server.js)
//   - the local HTTP sidecar at scripts/dashboard-server.mjs
//
// No side effects, no network, no persistent state — just read the registry
// + board + run-active files and return the four-group snapshot.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRun, listRuns } from "../../packages/forge-core/src/runs/index.js";

import { stageLabelFor } from "./stage-labels.js";

const HARD_TERMINAL_STATUSES = new Set(["failed", "discarded"]);
const RECENT_COMPLETED_LIMIT = 5;
const TOP_TODOS_LIMIT = 5;

const NEXT_STEP_MAP = {
  plan:      { gate: "gate1", next: "/forge:implement" },
  implement: { gate: "gate2", next: "/forge:apply" },
  debug:     { gate: "gate2", next: "/forge:apply" },
  refactor:  { gate: "gate2", next: "/forge:apply" },
};

function needsNextStep(run) {
  if (run.status !== "completed") return null;
  const mapping = NEXT_STEP_MAP[run.pipelineType];
  if (!mapping) return null;
  const gs = run.gateState;
  if (gs && gs.gate === mapping.gate && gs.status === "approved") return mapping.next;
  return null;
}

function isTerminal(entry) {
  if (HARD_TERMINAL_STATUSES.has(entry.status)) return true;
  if (entry.status !== "completed") return false;
  return !needsNextStep(entry);
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
export function buildDashboardState(projectDir) {
  const pipelineDir = join(projectDir, ".pipeline");

  // 1) Active unit marker — only the currently-steered run carries one.
  const { runId: activeRunId, currentUnit: activeUnit } = readActiveUnit(pipelineDir);

  // 2) Enumerate runs from the registry (with listRuns' lazy-heal).
  let allEntries = [];
  try {
    allEntries = listRuns(projectDir, {});
  } catch (_) {
    allEntries = [];
  }

  // 3) activeRuns — non-terminal, hydrated from run.json where present.
  //    "completed" runs with an approved gate that needs a next step are NOT
  //    terminal — they require user attention. But only if no later pipeline
  //    stage already exists for the same feature.
  // Only the latest run per feature can need attention.
  const latestByFeature = new Map();
  for (const e of allEntries) {
    const key = (e.feature || "").toLowerCase();
    const prev = latestByFeature.get(key);
    if (!prev || (e.updatedAt || "") > (prev.updatedAt || "")) {
      latestByFeature.set(key, e);
    }
  }

  const activeRuns = [];
  for (const entry of allEntries) {
    if (HARD_TERMINAL_STATUSES.has(entry.status)) continue;
    if (entry.status !== "running" && entry.status !== "gate-pending" && entry.status !== "completed") continue;
    let full = null;
    try {
      full = getRun(projectDir, entry.runId);
    } catch (_) {
      full = null;
    }
    const src = full || entry;
    if (isTerminal(src)) continue;
    const nextStep = needsNextStep(src);
    if (nextStep) {
      const key = (src.feature || "").toLowerCase();
      const latest = latestByFeature.get(key);
      if (!latest || latest.runId !== src.runId) continue;
    }
    activeRuns.push({
      runId: src.runId,
      pipelineType: src.pipelineType,
      mode: src.mode || null,
      feature: src.feature || "",
      status: src.status,
      currentStep: src.currentStep || null,
      stageLabel: stageLabelFor(src.pipelineType, src.currentStep),
      gateState: src.gateState || null,
      worktreePath: src.worktreePath || null,
      currentUnit: src.runId === activeRunId ? activeUnit : null,
      mergeBlocked: src.mergeBlocked || null,
      updatedAt: src.updatedAt || entry.updatedAt || null,
      actionNeeded: nextStep,
    });
  }
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
  const activeRunIds = new Set(activeRuns.map(r => r.runId));
  const recentCompleted = allEntries
    .filter(e => {
      if (activeRunIds.has(e.runId)) return false;
      return HARD_TERMINAL_STATUSES.has(e.status) || e.status === "completed";
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, RECENT_COMPLETED_LIMIT)
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
