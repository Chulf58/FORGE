#!/usr/bin/env node
// FORGE TUI — in-terminal dashboard.
//
// Read-only first slice. Renders 4 sections (active runs, gates awaiting,
// recent completions, board) with live refresh and mouse scroll. Exits on
// `q` or Ctrl+C. No action wiring yet — gate/merge actions land in a
// follow-up slice.
//
// Run:  node scripts/forge-tui.mjs
// Or:   via /forge:dashboard skill (launched inline by Bash from the skill)
//
// Data source: buildDashboardState() from mcp/lib/dashboard-state.js.
// Project dir: process.env.CLAUDE_PROJECT_DIR || process.cwd().

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardState } from "../mcp/lib/dashboard-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

// blessed is CommonJS; load it via createRequire from ESM.
const require = createRequire(import.meta.url);
const blessed = require(join(PLUGIN_ROOT, "mcp", "node_modules", "blessed"));

const REFRESH_MS = 5000;

function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + " min ago";
  if (sec < 86400) return Math.floor(sec / 3600) + " hr ago";
  return Math.floor(sec / 86400) + " d ago";
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function renderActiveRuns(arr) {
  if (!arr.length) return "{grey-fg}No active runs.{/}";
  return arr.map(r => {
    const stage = r.stageLabel || "starting";
    const wt = r.worktreePath ? " {grey-fg}wt={/}" + r.worktreePath.split(/[\\/]/).pop() : "";
    return `{cyan-fg}${r.runId}{/} {yellow-fg}${r.pipelineType}{/} {white-fg}${truncate(r.feature, 50)}{/} {grey-fg}· ${r.status} · at ${stage}{/}${wt}`;
  }).join("\n");
}

function renderGates(arr) {
  if (!arr.length) return "{grey-fg}No gates pending.{/}";
  return arr.map(g => {
    const gate = g.gateState && g.gateState.gate ? g.gateState.gate : "gate?";
    const since = g.gateState && g.gateState.createdAt ? relTime(g.gateState.createdAt) : "";
    return `{cyan-fg}${g.runId}{/} {magenta-fg}${gate}{/} {white-fg}${truncate(g.feature, 50)}{/} {grey-fg}· pending ${since}{/}`;
  }).join("\n");
}

function renderRecent(arr) {
  if (!arr.length) return "{grey-fg}No recent completions.{/}";
  return arr.map(r => {
    const t = r.updatedAt ? " {grey-fg}· " + relTime(r.updatedAt) + "{/}" : "";
    const mb = r.mergeBlocked ? " {red-fg}[merge blocked]{/}" : "";
    return `{cyan-fg}${r.runId}{/} {yellow-fg}${r.pipelineType}{/} {white-fg}${truncate(r.feature, 50)}{/} {grey-fg}· ${r.status}{/}${mb}${t}`;
  }).join("\n");
}

function renderBoard(b) {
  if (!b) return "{grey-fg}Board unreadable.{/}";
  const lines = [`{white-fg}${b.todoCount}{/} {grey-fg}open TODO(s) (${b.blockedTodoCount} blocked) · ${b.plannedCount} planned{/}`];
  if (Array.isArray(b.topPriorityTodos) && b.topPriorityTodos.length) {
    lines.push("");
    lines.push("{grey-fg}Top priorities:{/}");
    for (const t of b.topPriorityTodos) {
      const color = t.priority === "high" ? "red-fg" : t.priority === "low" ? "green-fg" : "yellow-fg";
      lines.push(`  {${color}}[${t.priority}]{/} ${truncate(t.text, 70)}`);
    }
  }
  return lines.join("\n");
}

async function fetchState() {
  const projectDir = resolveProjectDir();
  if (!existsSync(join(projectDir, ".pipeline"))) {
    return { error: "Project not initialized at " + projectDir + ". Run /forge:init first." };
  }
  try {
    return { ok: true, state: await buildDashboardState(projectDir), projectDir };
  } catch (err) {
    return { error: "Failed to build state: " + (err && err.message || err) };
  }
}

async function main() {
  const screen = blessed.screen({
    smartCSR: true,
    title: "FORGE dashboard",
    mouse: true,
    fullUnicode: true,
  });

  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, right: 0, height: 1,
    tags: true,
    content: " {bold}FORGE dashboard{/bold} {grey-fg}· loading…{/}",
    style: { fg: "white" },
  });

  const activeBox = blessed.box({
    parent: screen,
    label: " Active runs ",
    top: 1, left: 0, width: "50%", height: "50%-1",
    border: { type: "line" },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    style: { border: { fg: "cyan" } },
  });

  const gatesBox = blessed.box({
    parent: screen,
    label: " Gates awaiting approval ",
    top: 1, left: "50%", right: 0, height: "50%-1",
    border: { type: "line" },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    style: { border: { fg: "magenta" } },
  });

  const recentBox = blessed.box({
    parent: screen,
    label: " Recent completions ",
    top: "50%", left: 0, width: "50%", bottom: 1,
    border: { type: "line" },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    style: { border: { fg: "yellow" } },
  });

  const boardBox = blessed.box({
    parent: screen,
    label: " Board ",
    top: "50%", left: "50%", right: 0, bottom: 1,
    border: { type: "line" },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    style: { border: { fg: "green" } },
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0, left: 0, right: 0, height: 1,
    tags: true,
    content: " {grey-fg}q: quit · mouse scroll enabled · refreshes every 5s{/}",
  });

  async function refresh() {
    const result = await fetchState();
    if (result.error) {
      header.setContent(" {bold}FORGE dashboard{/bold} {red-fg}· " + result.error + "{/}");
      activeBox.setContent("");
      gatesBox.setContent("");
      recentBox.setContent("");
      boardBox.setContent("");
      screen.render();
      return;
    }
    const state = result.state;
    const projectName = state.project && state.project.name ? state.project.name : result.projectDir;
    header.setContent(` {bold}FORGE{/bold} {cyan-fg}${projectName}{/} {grey-fg}· updated ${new Date().toLocaleTimeString()}{/}`);
    activeBox.setLabel(" Active runs (" + (state.activeRuns || []).length + ") ");
    activeBox.setContent(renderActiveRuns(state.activeRuns || []));
    gatesBox.setLabel(" Gates awaiting approval (" + (state.gatesAwaiting || []).length + ") ");
    gatesBox.setContent(renderGates(state.gatesAwaiting || []));
    recentBox.setLabel(" Recent completions (" + (state.recentCompleted || []).length + ") ");
    recentBox.setContent(renderRecent(state.recentCompleted || []));
    boardBox.setContent(renderBoard(state.boardSummary));
    screen.render();
  }

  screen.key(["q", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  await refresh();
  const timer = setInterval(refresh, REFRESH_MS);

  screen.on("destroy", () => clearInterval(timer));
}

main();
