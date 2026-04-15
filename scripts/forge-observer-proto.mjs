#!/usr/bin/env node
// FORGE terminal observer prototype — standalone read-only dashboard.
//
// Purpose: show FORGE project state in a dedicated terminal process next to
// a natively-running Claude Code. Unlike forge-wrapper-proto.mjs, this
// observer does NOT wrap Claude — Claude runs untouched in its own pane
// with native copy/paste. The user opens a split in their terminal and
// runs this in the second pane.
//
// Run:  node scripts/forge-observer-proto.mjs
// Quit: q, Q, or Ctrl+C
//
// Environment:
//   CLAUDE_PROJECT_DIR — override which project the observer reads.
//                        Defaults to process.cwd().
//
// Architecture:
//   buildDashboardState (pure read of .pipeline/runs + board.json)
//     → renderDashboard (blessed markup, duplicated from wrapper prototype)
//       → full-screen blessed.box, refreshed on a 2s timer.
//
// Why mouse reporting stays OFF here: we want the host terminal to keep
// ownership of text selection so the user can copy dashboard lines with
// a normal click-drag. That is the whole reason the observer exists —
// the wrapper's SGR mouse reporting consumed the selection gesture.

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardState } from "../mcp/lib/dashboard-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let blessed;
try {
  blessed = require(join(PLUGIN_ROOT, "mcp", "node_modules", "blessed"));
} catch (err) {
  console.error("[forge-observer-proto] Failed to load blessed: " + err.message);
  console.error("[forge-observer-proto] Run `node hooks/mcp-deps-install.js` to install, or start a fresh Claude Code session.");
  process.exit(1);
}

// Non-TTY fallback — observer needs a real terminal to render.
if (!process.stdout.isTTY) {
  console.error("[forge-observer-proto] stdout is not a TTY — observer requires a real terminal.");
  process.exit(0);
}

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const screen = blessed.screen({
  smartCSR: true,
  title: "FORGE observer",
  fullUnicode: true,
  // Mouse OFF on purpose — terminal keeps ownership of text selection so
  // the user can copy dashboard lines with native click-drag.
  mouse: false,
  terminal: process.env.TERM || "xterm-256color",
});

// Full-screen dashboard pane with header border + scrollable body. Keys:
// true + vi: true gives arrow keys, PgUp/PgDn, hjkl, g/G for navigation
// out of the box.
const pane = blessed.box({
  parent: screen,
  top: 0, left: 0, right: 0, height: "100%-1",
  border: { type: "line" },
  label: " FORGE observer — " + PROJECT_DIR + " ",
  tags: true,
  content: "\n  {grey-fg}Loading…{/}",
  style: { bg: "black", border: { fg: "yellow" } },
  scrollable: true,
  alwaysScroll: true,
  keys: true,
  vi: true,
});

// Bottom status line — quit hint, scroll hint, refresh cadence.
const status = blessed.box({
  parent: screen,
  bottom: 0, left: 0, right: 0, height: 1,
  tags: true,
  content: " {white-fg}q{/} quit · {white-fg}↑↓ PgUp/PgDn{/} scroll · refresh 2s",
  style: { bg: "blue", fg: "white" },
});

// ---- dashboard rendering (duplicated from scripts/forge-wrapper-proto.mjs) ----
//
// The wrapper file runs side effects at module load (blessed.screen, node-pty
// spawn), so its helpers can't be imported without a refactor. Duplicating
// ~80 lines here is cheaper than that refactor for a prototype slice. Factor
// out to a shared module if both prototypes survive to productization.

const DASHBOARD_REFRESH_MS = 2000;
let dashboardTimer = null;

function escapeTags(s) {
  return String(s ?? "").replace(/\{/g, "(").replace(/\}/g, ")");
}

function fmtRel(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

function priorityColor(pri) {
  if (pri === "high") return "red-fg";
  if (pri === "medium") return "yellow-fg";
  return "grey-fg";
}

function renderDashboard(state) {
  const ar = state.activeRuns || [];
  const ga = state.gatesAwaiting || [];
  const rc = state.recentCompleted || [];
  const bs = state.boardSummary || {};
  const lines = [];

  lines.push("");
  lines.push("  {bold}{yellow-fg}FORGE{/}");
  lines.push("");

  lines.push("  {cyan-fg}Active runs{/} {grey-fg}(" + ar.length + "){/}");
  if (ar.length === 0) {
    lines.push("    {grey-fg}none{/}");
  } else {
    for (const r of ar.slice(0, 5)) {
      const id = escapeTags(r.runId).slice(0, 10);
      const stage = escapeTags(r.stageLabel || r.currentStep || "starting");
      lines.push("    " + id + " {grey-fg}·{/} " + escapeTags(r.pipelineType) + " {grey-fg}·{/} " + stage);
      const feat = escapeTags((r.feature || "").slice(0, 44));
      if (feat) lines.push("      {grey-fg}" + feat + "{/}");
    }
  }
  lines.push("");

  if (ga.length > 0) {
    lines.push("  {yellow-fg}Gates pending{/} {grey-fg}(" + ga.length + "){/}");
    for (const g of ga.slice(0, 5)) {
      const id = escapeTags(g.runId).slice(0, 10);
      const gate = escapeTags((g.gateState && g.gateState.gate) || "gate");
      lines.push("    " + id + " {grey-fg}·{/} " + gate);
      const feat = escapeTags((g.feature || "").slice(0, 44));
      if (feat) lines.push("      {grey-fg}" + feat + "{/}");
    }
    lines.push("");
  }

  if (rc.length > 0) {
    lines.push("  {grey-fg}Recent{/} {grey-fg}(" + rc.length + "){/}");
    for (const r of rc.slice(0, 3)) {
      const id = escapeTags(r.runId).slice(0, 10);
      const rel = fmtRel(r.updatedAt);
      const statusColor = r.status === "completed" ? "green-fg"
        : r.status === "failed" ? "red-fg" : "grey-fg";
      lines.push("    {" + statusColor + "}" + escapeTags(r.status) + "{/} " + id
        + (rel ? " {grey-fg}" + rel + "{/}" : ""));
    }
    lines.push("");
  }

  lines.push("  {cyan-fg}Board{/}");
  const todo = bs.todoCount || 0;
  const blocked = bs.blockedTodoCount || 0;
  const planned = bs.plannedCount || 0;
  lines.push("    " + todo + " open"
    + (blocked > 0 ? " ({red-fg}" + blocked + " blocked{/})" : "")
    + ", " + planned + " planned");
  const tops = Array.isArray(bs.topPriorityTodos) ? bs.topPriorityTodos : [];
  if (tops.length > 0) {
    lines.push("  {grey-fg}Top priorities:{/}");
    for (const t of tops.slice(0, 3)) {
      const pri = escapeTags(t.priority || "-");
      const txt = escapeTags((t.text || "").slice(0, 44));
      lines.push("    {" + priorityColor(t.priority) + "}[" + pri + "]{/} " + txt);
    }
  }

  return lines.join("\n");
}

function refreshDashboard() {
  try {
    const state = buildDashboardState(PROJECT_DIR);
    pane.setContent(renderDashboard(state));
  } catch (err) {
    pane.setContent("\n  {red-fg}dashboard error{/}\n  {grey-fg}"
      + escapeTags(err && err.message) + "{/}");
  }
  screen.render();
}

// Clean quit — stop the timer, destroy the screen (restores the main buffer
// + cursor), then exit. No PTY child to reap, no mouse reporting to unwind.
function quit(code) {
  if (dashboardTimer) { try { clearInterval(dashboardTimer); } catch (_) {} dashboardTimer = null; }
  try { screen.destroy(); } catch (_) {}
  process.exit(code);
}

screen.key(["q", "Q", "C-c"], () => quit(0));

// Paint once immediately so the user doesn't sit on "Loading…" for 2s.
refreshDashboard();
dashboardTimer = setInterval(refreshDashboard, DASHBOARD_REFRESH_MS);
if (typeof dashboardTimer.unref === "function") dashboardTimer.unref();

screen.render();
