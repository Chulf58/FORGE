#!/usr/bin/env node
// FORGE dashboard sidecar.
//
// Local HTTP server, bound to 127.0.0.1, serving:
//   GET  /                      → the dashboard HTML page (auto-refreshes)
//   GET  /api/dashboard-state   → JSON from buildDashboardState()
//   POST /api/gate-action       → approve or discard a pending gate
//   POST /api/merge-action      → retry merge-back for a merge-blocked run
//
// Zero new runtime dependencies — Node's built-in `http` only. Reuses the
// exact same state-builder the MCP tool does (mcp/lib/dashboard-state.js),
// so the sidecar and `forge_dashboard_state` return identical payloads.
//
// Run:   node scripts/dashboard-server.mjs
// Or:    npm run dashboard
// Port:  7878 default; override with FORGE_DASHBOARD_PORT env var.
// Project root: process.cwd() by default; override with CLAUDE_PROJECT_DIR.

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildDashboardState } from "../mcp/lib/dashboard-state.js";
import { getRun, updateRun } from "../packages/forge-core/src/runs/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const MERGE_SCRIPT = resolve(PLUGIN_ROOT, "bin", "forge-worktree.js");

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

// -- Gate action handler ------------------------------------------------------
// Approve or discard a pending gate by runId. Mirrors the same state
// transitions the /forge:approve and /forge:discard skills perform, using
// the same forge-core updateRun() so the registry stays truthful.

function handleGateAction(projectDir, run, action) {
  const now = new Date().toISOString();
  const gate = run.gateState && run.gateState.gate;
  if (!gate) throw new Error("run has no gate to act on");

  // Resolve gate file location — worktree-scoped if the run has a worktreePath.
  const gateRoot = run.worktreePath || projectDir;
  const gatePath = join(gateRoot, ".pipeline", "gate-pending.json");

  if (action === "approve") {
    // Update the gate file on disk (preserve fields, stamp approved).
    if (existsSync(gatePath)) {
      try {
        const raw = readFileSync(gatePath, "utf8");
        const gateFile = JSON.parse(raw);
        gateFile.status = "approved";
        gateFile.approvedAt = now;
        writeFileSync(gatePath, JSON.stringify(gateFile, null, 2) + "\n", "utf8");
      } catch (_) {
        // gate file unreadable — continue, the run update is the authoritative state
      }
    }
    // Update the run registry.
    const gateCreatedAt = (run.gateState && run.gateState.createdAt) || now;
    updateRun(projectDir, run.runId, {
      status: "completed",
      currentStep: gate + "-approved",
      gateState: {
        gate,
        status: "approved",
        feature: run.feature,
        createdAt: gateCreatedAt,
        approvedAt: now,
      },
    });
    const next = gate === "gate1"
      ? "Run /forge:implement to start implementation."
      : "Run /forge:apply to apply the changes.";
    return { ok: true, message: gate + " approved. " + next };
  }

  if (action === "discard") {
    // Delete the gate file.
    if (existsSync(gatePath)) {
      try { unlinkSync(gatePath); } catch (_) {}
    }
    // Update the run registry.
    updateRun(projectDir, run.runId, {
      status: "discarded",
      currentStep: "discarded",
    });
    return { ok: true, message: "Gate discarded." };
  }

  throw new Error("unknown action: " + action);
}

// -- Merge-retry action handler -----------------------------------------------
// Re-attempts merge-back for a run that has mergeBlocked set. Calls the
// existing bin/forge-worktree.js merge <runId> in the project directory.
// On success: clears mergeBlocked via updateRun.
// On failure: refreshes mergeBlocked with a new detectedAt + reason.

function handleMergeRetry(projectDir, run) {
  const runId = run.runId;
  try {
    execFileSync(process.execPath, [MERGE_SCRIPT, "merge", runId], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Merge succeeded — clear the marker.
    updateRun(projectDir, runId, { mergeBlocked: null });
    return { ok: true, message: "Merge succeeded. Worktree merged and cleaned up." };
  } catch (e) {
    // Merge still failing — refresh the marker with a new timestamp.
    const now = new Date().toISOString();
    const stderrText = e.stderr ? String(e.stderr).trim() : "";
    let reason = "Merge retry failed — conflicts or diverged branches still present.";
    // Try to extract the hint from the script's stderr JSON.
    try {
      const errJson = JSON.parse(stderrText);
      if (errJson.error) reason = errJson.error;
    } catch (_) {}
    try {
      updateRun(projectDir, runId, {
        mergeBlocked: { reason, detectedAt: now },
      });
    } catch (_) {
      // Best-effort — if we can't update the marker, the response still
      // tells the user the retry failed.
    }
    return { ok: false, message: reason };
  }
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
  button { font: inherit; padding: 4px 10px; border: 1px solid #ccc; background: #f5f5f5; border-radius: 4px; cursor: pointer; font-size: 12px; }
  button:hover { background: #eee; }
  button:disabled { opacity: 0.5; cursor: default; }
  .badge.merge-blocked { background: #fff3e0; color: #e65100; font-weight: 600; }
  .merge-reason { font-size: 12px; color: #bf360c; margin-left: 8px; }
  .btn-retry { background: #fff3e0; border-color: #ffcc80; color: #e65100; }
  .btn-retry:hover { background: #ffe0b2; }
  .btn-approve { background: #e8f5e9; border-color: #a5d6a7; color: #2e7d32; }
  .btn-approve:hover { background: #c8e6c9; }
  .btn-discard { background: #ffebee; border-color: #ef9a9a; color: #c62828; }
  .btn-discard:hover { background: #ffcdd2; }
  .action-msg { font-size: 12px; margin-left: 8px; }
  .action-msg.ok { color: #2e7d32; }
  .action-msg.err { color: #c62828; }
  #welcome { border-color: #c8e6c9; background: #f1f8f1; }
  #welcome h2 { font-size: 15px; margin: 0 0 10px; color: #2e7d32; }
  #welcome .cmd-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 8px 0 12px; }
  #welcome .cmd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; padding: 3px 0; }
  #welcome .cmd-name { color: #1565c0; }
  #welcome .cmd-desc { color: #555; }
  #welcome .hint { font-size: 12px; color: #444; margin: 4px 0; }
  #welcome .hint::before { content: "\\2192  "; color: #2e7d32; }
  #welcome .dash-caps { font-size: 12px; color: #666; margin-top: 10px; border-top: 1px solid #dcedc8; padding-top: 8px; }
</style>
</head>
<body>
<h1>FORGE dashboard</h1>
<div class="meta">
  Read-only snapshot from <code>forge_dashboard_state</code> · auto-refreshing every 5 s.
  <span id="loaded"></span>
  <button onclick="refreshDashboard()">Refresh now</button>
</div>

<section id="welcome" style="display:none"></section>

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

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 0)    return "just now";
  if (sec < 60)   return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + " min ago";
  if (sec < 86400) return Math.floor(sec / 3600) + " hr ago";
  return Math.floor(sec / 86400) + " d ago";
}

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
      renderMergeBlocked(r.mergeBlocked, r.runId) +
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
    const rid = esc(g.runId);
    return '<div class="row">' +
      '<span class="runid">' + rid + '</span>' +
      badge("status", "gate-pending") +
      '<span>' + esc(gate) + '</span>' +
      '<span>· ' + esc(g.feature) + '</span>' +
      (g.updatedAt ? ' <span class="muted">· updated ' + relTime(g.updatedAt) + '</span>' : '') +
      ' <button class="btn-approve" onclick="gateAction(\\'' + rid + '\\', \\'approve\\')">Approve</button>' +
      ' <button class="btn-discard" onclick="gateAction(\\'' + rid + '\\', \\'discard\\')">Discard</button>' +
      '</div>';
  }).join("");
}

function renderMergeBlocked(mb, runId) {
  if (!mb || typeof mb !== "object") return "";
  const rid = esc(runId || "");
  return ' <span class="badge merge-blocked">merge blocked</span>' +
    (mb.reason ? '<span class="merge-reason">' + esc(mb.reason) + '</span>' : '') +
    (rid ? ' <button class="btn-retry" onclick="mergeAction(\\'' + rid + '\\')">Retry merge</button>' : '');
}

function renderRecent(arr) {
  $("rc-count").textContent = "(" + arr.length + ")";
  if (!arr.length) { renderEmpty($("recentCompleted"), "No recent completions."); return; }
  $("recentCompleted").innerHTML = arr.map(e =>
    '<div class="row">' +
      '<span class="runid">' + esc(e.runId) + '</span>' +
      '<span>' + esc(e.pipelineType) + '</span>' +
      badge("status", e.status) +
      renderMergeBlocked(e.mergeBlocked, e.runId) +
      '<span>· ' + esc(e.feature) + '</span>' +
      (e.updatedAt ? ' <span class="muted">· ' + relTime(e.updatedAt) + '</span>' : '') +
    '</div>'
  ).join("");
}

function renderWelcome(state) {
  const el = $("welcome");
  const ar = state.activeRuns || [];
  const ga = state.gatesAwaiting || [];
  // Show the welcome panel when idle (no active runs, no pending gates).
  const idle = ar.length === 0 && ga.length === 0;
  if (!idle) { el.style.display = "none"; return; }
  el.style.display = "";
  const b = state.boardSummary || {};
  // Build contextual hints.
  let hints = "";
  if (b.todoCount > 0) {
    hints += '<div class="hint">You have ' + b.todoCount + ' open TODO(s) \\u2014 pick one and run /forge:plan</div>';
  } else {
    hints += '<div class="hint">Run /forge:plan to plan a feature, or /forge:todo to add tasks</div>';
  }
  el.innerHTML =
    '<h2>FORGE \\u2014 Quick Start</h2>' +
    '<div class="cmd-grid">' +
      '<div class="cmd"><span class="cmd-name">/forge:plan</span> <span class="cmd-desc">Plan a feature</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:status</span> <span class="cmd-desc">Project snapshot</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:implement</span> <span class="cmd-desc">Code from plan</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:dashboard</span> <span class="cmd-desc">This view, in CLI</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:apply</span> <span class="cmd-desc">Apply reviewed code</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:todo</span> <span class="cmd-desc">Manage backlog</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:debug</span> <span class="cmd-desc">Diagnose a bug</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:resume</span> <span class="cmd-desc">Resume paused run</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:refactor</span> <span class="cmd-desc">Restructure code</span></div>' +
      '<div class="cmd"><span class="cmd-name">/forge:config</span> <span class="cmd-desc">Pipeline settings</span></div>' +
    '</div>' +
    hints +
    '<div class="dash-caps">This dashboard can approve/discard gates and retry merge-blocked runs when they appear.</div>';
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

function mergeAction(runId) {
  document.querySelectorAll(".btn-retry").forEach(b => b.disabled = true);
  fetch("/api/merge-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, action: "retry" }),
  })
    .then(r => r.json().then(j => ({ status: r.status, body: j })))
    .then(({ status, body }) => {
      if (status === 200 && body.ok) {
        refreshDashboard();
      } else {
        alert("Merge retry failed: " + (body.message || body.error || "unknown error"));
        refreshDashboard();
      }
    })
    .catch(err => {
      alert("Merge retry failed: " + err.message);
      document.querySelectorAll(".btn-retry").forEach(b => b.disabled = false);
    });
}

function gateAction(runId, action) {
  // Disable all gate buttons while the request is in flight.
  document.querySelectorAll(".btn-approve, .btn-discard").forEach(b => b.disabled = true);
  fetch("/api/gate-action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, action }),
  })
    .then(r => r.json().then(j => ({ status: r.status, body: j })))
    .then(({ status, body }) => {
      if (status === 200 && body.ok) {
        // Success — refresh immediately so the gate disappears from the list.
        refreshDashboard();
      } else {
        const msg = body.error || body.detail || "unknown error";
        alert(action + " failed: " + msg);
        document.querySelectorAll(".btn-approve, .btn-discard").forEach(b => b.disabled = false);
      }
    })
    .catch(err => {
      alert(action + " failed: " + err.message);
      document.querySelectorAll(".btn-approve, .btn-discard").forEach(b => b.disabled = false);
    });
}

function refreshDashboard() {
  fetch("/api/dashboard-state")
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(state => {
      $("loaded").textContent = "Last updated " + new Date().toLocaleTimeString();
      renderWelcome(state);
      renderActiveRuns(state.activeRuns || []);
      renderGates(state.gatesAwaiting || []);
      renderRecent(state.recentCompleted || []);
      renderBoard(state.boardSummary);
      // Clear any prior fetch-error banner on successful refresh.
      const old = document.querySelector(".error");
      if (old) old.remove();
    })
    .catch(err => {
      $("loaded").textContent = "Fetch failed " + new Date().toLocaleTimeString();
      // Only insert the error banner once; subsequent failures update the
      // loaded text but don't stack banners.
      if (!document.querySelector(".error")) {
        document.body.insertAdjacentHTML("afterbegin",
          '<div class="error"><strong>Failed to load state:</strong> ' + esc(err.message) + '</div>');
      }
    });
}

// Initial fetch + fixed-interval polling (5 s). The interval keeps running
// on errors so the next successful fetch self-heals the UI. No WebSocket,
// no SSE, no server push — purely client-initiated read-only polling.
refreshDashboard();
setInterval(refreshDashboard, 5000);
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  if (req.method === "GET") {
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
  }

  if (req.method === "POST" && url === "/api/gate-action") {
    try {
      const body = await readBody(req);
      const { runId, action } = body || {};
      if (!runId || typeof runId !== "string") {
        return json(res, 400, { error: "missing or invalid runId" });
      }
      if (action !== "approve" && action !== "discard") {
        return json(res, 400, { error: "action must be 'approve' or 'discard'" });
      }
      const projectDir = resolveProjectDir();
      const run = getRun(projectDir, runId);
      if (!run) {
        return json(res, 404, { error: "run " + runId + " not found" });
      }
      if (run.status !== "gate-pending") {
        return json(res, 409, { error: "run " + runId + " is " + run.status + ", not gate-pending" });
      }
      const result = handleGateAction(projectDir, run, action);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { error: "gate-action failed", detail: String(err && err.message || err) });
    }
  }

  if (req.method === "POST" && url === "/api/merge-action") {
    try {
      const body = await readBody(req);
      const { runId, action } = body || {};
      if (!runId || typeof runId !== "string") {
        return json(res, 400, { error: "missing or invalid runId" });
      }
      if (action !== "retry") {
        return json(res, 400, { error: "action must be 'retry'" });
      }
      const projectDir = resolveProjectDir();
      const run = getRun(projectDir, runId);
      if (!run) {
        return json(res, 404, { error: "run " + runId + " not found" });
      }
      if (!run.mergeBlocked) {
        return json(res, 409, { error: "run " + runId + " is not merge-blocked" });
      }
      const result = handleMergeRetry(projectDir, run);
      const status = result.ok ? 200 : 409;
      return json(res, status, result);
    } catch (err) {
      return json(res, 500, { error: "merge-action failed", detail: String(err && err.message || err) });
    }
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "method not allowed" });
  }
  return notFound(res);
});

server.listen(PORT, HOST, () => {
  const projectDir = resolveProjectDir();
  const url = "http://" + HOST + ":" + PORT;
  console.log("[forge-dashboard] listening on " + url);
  console.log("[forge-dashboard] project: " + projectDir);
  console.log("[forge-dashboard] auto-refreshes every 5 s. Ctrl+C to stop.");

  // Auto-open the dashboard in the default browser. Fire-and-forget —
  // if the open command fails, the server continues running normally.
  const cmd = process.platform === "win32" ? "start"
    : process.platform === "darwin" ? "open"
    : "xdg-open";
  exec(cmd + " " + url, () => {});
});
