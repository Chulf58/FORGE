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

// Duplicated with mcp/server.js `PIPELINE_STAGE_LABELS` so this module has no
// dependency on server.js. If a third copy appears, extract to mcp/lib/.
const PIPELINE_STAGE_LABELS = {
  plan: {
    "started": "starting", "brainstormer-decision": "brainstorming",
    "planner": "planner", "researcher": "researcher", "gotcha-checker": "gotcha-check",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate1": "gate1",
  },
  implement: {
    "started": "starting", "setup": "setup",
    "implementation-architect": "scoping slice", "coder-scout": "scout", "coder": "coder",
    "completeness-checker": "completeness",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
  apply: {
    "started": "starting", "setup": "setup",
    "implementer-triage": "triage", "implementer": "implementer",
    "testing": "tests", "documenter": "documenter",
    "worktree-commit": "wt-commit", "merge-back": "merge-back", "done": "done",
  },
  debug: {
    "started": "starting", "debug": "tracing",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
  refactor: {
    "started": "starting", "refactor": "analyzing",
    "reviewer-triage": "reviewers", "reviewer-boundary": "reviewers", "gate2": "gate2",
  },
};

function stageLabelFor(pipelineType, currentStep) {
  if (!currentStep) return null;
  const map = PIPELINE_STAGE_LABELS[pipelineType];
  if (!map) return currentStep;
  return map[currentStep] || currentStep;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "discarded"]);
const RECENT_COMPLETED_LIMIT = 5;
const TOP_TODOS_LIMIT = 5;

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
  const activeRuns = [];
  for (const entry of allEntries) {
    if (TERMINAL_STATUSES.has(entry.status)) continue;
    let full = null;
    try {
      full = getRun(projectDir, entry.runId);
    } catch (_) {
      full = null;
    }
    const src = full || entry;
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

  // 5) recentCompleted — bounded terminal tail.
  const recentCompleted = allEntries
    .filter(e => TERMINAL_STATUSES.has(e.status))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, RECENT_COMPLETED_LIMIT)
    .map(e => {
      // Hydrate mergeBlocked from the full run.json — the index entry
      // doesn't carry it.
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
