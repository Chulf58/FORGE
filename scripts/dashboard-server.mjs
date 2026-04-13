#!/usr/bin/env node
// Tiny read-only FORGE dashboard sidecar.
//
// One local HTTP server, bound to 127.0.0.1, serving:
//   GET  /                      → the dashboard HTML page
//   GET  /api/dashboard-state   → JSON from buildDashboardState()
//
// Zero new runtime dependencies — Node's built-in `http` only. Reuses the
// exact same state-builder the MCP tool does (mcp/lib/dashboard-state.js),
// so the sidecar and `forge_dashboard_state` return identical payloads.
//
// Run:   node scripts/dashboard-server.mjs
// Or:    npm run dashboard
// Port:  7878 default; override with FORGE_DASHBOARD_PORT env var.
// Project root: process.cwd() by default; override with CLAUDE_PROJECT_DIR.
//
// Refresh by page reload only. No WebSocket, no polling, no file watcher,
// no actions. Explicitly out of scope for this slice.

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildDashboardState } from "../mcp/lib/dashboard-state.js";

const PORT = Number(process.env.FORGE_DASHBOARD_PORT) || 7878;
const HOST = "127.0.0.1";

function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function notFound(res) {
  json(res, 404, { error: "not found" });
}

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>FORGE dashboard</title>
<style>
  body { font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #222; background: #fafafa; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
  section { background: #fff; border: 1px solid #e4e4e4; border-radius: 6px; padding: 12px 16px; margin-bottom: 14px; }
  section h2 { font-size: 14px; margin: 0 0 8px; }
  .empty { color: #888; font-style: italic; }
  .row { display: flex; gap: 8px; padding: 6px 0; border-top: 1px solid #f0f0f0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  .row:first-child { border-top: 0; }
  .runid { color: #555; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; background: #eef; color: #336; }
  .badge.status-running        { background: #e8f5e9; color: #2e7d32; }
  .badge.status-gate-pending   { background: #fff3e0; color: #ef6c00; }
  .badge.status-completed      { background: #eceff1; color: #546e7a; }
  .badge.status-failed         { background: #ffebee; color: #c62828; }
  .badge.status-discarded      { background: #f3e5f5; color: #6a1b9a; }
  .badge.priority-high         { background: #ffe0e0; color: #b71c1c; }
  .badge.priority-medium       { background: #fff8e1; color: #ef6c00; }
  .badge.priority-low          { background: #e8f5e9; color: #2e7d32; }
  .muted { color: #888; }
  .error { background: #ffebee; border-color: #c62828; color: #b71c1c; padding: 12px; border-radius: 6px; }
  button { font: inherit; padding: 4px 10px; border: 1px solid #ccc; background: #f5f5f5; border-radius: 4px; cursor: pointer; }
  button:hover { background: #eee; }
</style>
</head>
<body>
<h1>FORGE dashboard</h1>
<div class="meta">
  Read-only snapshot from <code>forge_dashboard_state</code>.
  <span id="loaded"></span>
  <button onclick="location.reload()">Refresh</button>
</div>

<section>
  <h2>Active runs <span class="muted" id="ar-count"></span></h2>
  <div id="activeRuns"></div>
</section>

<section>
  <h2>Gates awaiting approval <span class="muted" id="ga-count"></span></h2>
  <div id="gatesAwaiting"></div>
</section>

<section>
  <h2>Recent completions <span class="muted" id="rc-count"></span></h2>
  <div id="recentCompleted"></div>
</section>

<section>
  <h2>Board</h2>
  <div id="boardSummary"></div>
</section>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>\"']/g, (c) =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function badge(kind, value) {
  return '<span class="badge ' + kind + '-' + esc(value) + '">' + esc(value) + '</span>';
}

function renderEmpty(host, label) {
  host.innerHTML = '<div class="empty">' + label + '</div>';
}

function renderActiveRuns(arr) {
  $("ar-count").textContent = "(" + arr.length + ")";
  if (!arr.length) { renderEmpty($("activeRuns"), "No active runs."); return; }
  $("activeRuns").innerHTML = arr.map(r => {
    const stage = r.stageLabel || r.currentStep || "starting";
    const wt = r.worktreePath ? ' <span class="muted">· wt=' + esc(r.worktreePath) + '</span>' : '';
    const inflight = r.currentUnit && r.currentUnit.agent
      ? ' <span class="muted">· in-flight: ' + esc(r.currentUnit.agent) + '</span>'
      : '';
    return '<div class="row">' +
      '<span class="runid">' + esc(r.runId) + '</span>' +
      '<span>' + esc(r.pipelineType) + '</span>' +
      badge("status", r.status) +
      '<span>at ' + esc(stage) + '</span>' +
      '<span>· ' + esc(r.feature) + '</span>' +
      wt + inflight +
      '</div>';
  }).join("");
}

function renderGates(arr) {
  $("ga-count").textContent = "(" + arr.length + ")";
  if (!arr.length) { renderEmpty($("gatesAwaiting"), "No gates pending."); return; }
  $("gatesAwaiting").innerHTML = arr.map(g => {
    const gate = g.gateState && g.gateState.gate ? g.gateState.gate : "gate?";
    return '<div class="row">' +
      '<span class="runid">' + esc(g.runId) + '</span>' +
      badge("status", "gate-pending") +
      '<span>' + esc(gate) + '</span>' +
      '<span>· ' + esc(g.feature) + '</span>' +
      (g.updatedAt ? ' <span class="muted">· updated ' + esc(g.updatedAt) + '</span>' : '') +
      '</div>';
  }).join("") +
    '<div class="row muted">Act with /forge:approve or /forge:discard (resume the run first if needed).</div>';
}

function renderRecent(arr) {
  $("rc-count").textContent = "(" + arr.length + ")";
  if (!arr.length) { renderEmpty($("recentCompleted"), "No recent completions."); return; }
  $("recentCompleted").innerHTML = arr.map(e =>
    '<div class="row">' +
      '<span class="runid">' + esc(e.runId) + '</span>' +
      '<span>' + esc(e.pipelineType) + '</span>' +
      badge("status", e.status) +
      '<span>· ' + esc(e.feature) + '</span>' +
      (e.updatedAt ? ' <span class="muted">· ' + esc(e.updatedAt) + '</span>' : '') +
    '</div>'
  ).join("");
}

function renderBoard(b) {
  if (!b) { renderEmpty($("boardSummary"), "Board unreadable."); return; }
  let html = '<div class="row">' +
    '<span>' + b.todoCount + ' open TODO(s)</span>' +
    '<span>(' + b.blockedTodoCount + ' blocked)</span>' +
    '<span>· ' + b.plannedCount + ' planned</span>' +
    '</div>';
  if (Array.isArray(b.topPriorityTodos) && b.topPriorityTodos.length) {
    html += '<div class="row muted">Top priorities:</div>';
    html += b.topPriorityTodos.map(t =>
      '<div class="row">' +
        badge("priority", t.priority || "medium") +
        '<span>' + esc(t.text) + '</span>' +
      '</div>'
    ).join("");
  }
  $("boardSummary").innerHTML = html;
}

fetch("/api/dashboard-state")
  .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(state => {
    $("loaded").textContent = "Loaded " + new Date().toLocaleTimeString();
    renderActiveRuns(state.activeRuns || []);
    renderGates(state.gatesAwaiting || []);
    renderRecent(state.recentCompleted || []);
    renderBoard(state.boardSummary);
  })
  .catch(err => {
    document.body.insertAdjacentHTML("afterbegin",
      '<div class="error"><strong>Failed to load state:</strong> ' + esc(err.message) + '</div>');
  });
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = req.url || "/";
  if (req.method !== "GET") {
    return json(res, 405, { error: "method not allowed" });
  }

  if (url === "/" || url === "/index.html") {
    return html(res, 200, HTML_PAGE);
  }

  if (url === "/api/dashboard-state") {
    try {
      const projectDir = resolveProjectDir();
      if (!existsSync(join(projectDir, ".pipeline"))) {
        return json(res, 409, {
          error: "Project not initialized",
          detail: "No .pipeline/ at " + projectDir + ". Run /forge:init first.",
        });
      }
      const state = buildDashboardState(projectDir);
      return json(res, 200, state);
    } catch (err) {
      return json(res, 500, { error: "state-build failed", detail: String(err && err.message || err) });
    }
  }

  return notFound(res);
});

server.listen(PORT, HOST, () => {
  const projectDir = resolveProjectDir();
  console.log("[forge-dashboard] listening on http://" + HOST + ":" + PORT);
  console.log("[forge-dashboard] project: " + projectDir);
  console.log("[forge-dashboard] refresh the page to reload state. Ctrl+C to stop.");
});
