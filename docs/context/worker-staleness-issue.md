# Worker Liveness Detection — Issue Report & Proposed Fix

## What is FORGE?

FORGE is a plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI tool for AI-assisted software engineering. Claude Code lets a user chat with an AI model (Claude) that can read files, edit code, run shell commands, etc.

FORGE adds **pipeline orchestration** on top of Claude Code. Instead of one AI session doing everything, FORGE splits work into specialized agents (planner, coder, reviewer, etc.) and runs them in sequence.

### Architecture: Conductor + Workers

```
┌─────────────────────────────────────┐
│  CONDUCTOR (user's terminal)        │
│  - User types commands              │
│  - Dispatches workers               │
│  - Approves gates                   │
│  - Commits & merges results         │
└──────┬──────────┬───────────────────┘
       │          │
       ▼          ▼
┌────────────┐ ┌────────────┐
│  WORKER 1  │ │  WORKER 2  │   ... up to N workers
│  (plan)    │ │  (implement)│
│  own term  │ │  own term   │
│  own branch│ │  own branch │
└────────────┘ └────────────┘
```

- **Conductor**: The user's main Claude Code session. Orchestrates pipelines, presents results, manages approvals. Never does agent work directly.
- **Workers**: Autonomous Claude Code processes spawned into separate terminal tabs. Each runs a pipeline (plan, implement, debug, etc.) independently. Workers can run in parallel on isolated git worktrees.

### How Workers Are Spawned

When the conductor calls `forge_create_run` with `spawnWorker: true`, the MCP server (`mcp/server.js:1595-1640`) does:

1. Writes a task file: `.pipeline/worker-task-<runId>.json` containing `{ runId, feature, pipelineType }` (`server.js:1600-1607`)
2. Spawns a Node.js child process running `mcp/forge-worker.mjs` (`server.js:1617-1621`):
   ```js
   child = nodeSpawn(process.execPath, [workerScriptPath], {
     cwd: workDir,
     detached: process.platform !== "win32",
     windowsHide: true,
     stdio: ["ignore", logFd, logFd],  // stdout+stderr → log file
   });
   ```
3. Writes a PID file: `.pipeline/worker-pids/<runId>.json` with `{ runId, pid, startedAt }` (`server.js:1623-1626`)
4. The child process auto-cleans the PID file on exit (`server.js:1632-1635`)

The worker process (`forge-worker.mjs`) starts a full Claude Code session via the `@anthropic-ai/claude-agent-sdk` (`forge-worker.mjs:148-165`). It streams messages from the AI model and writes every message to a log file at `.pipeline/worker-logs/<runId>.log` (`forge-worker.mjs:169-170`):

```js
for await (const msg of stream) {
  writeLog(JSON.stringify(msg));   // every SDK message → log file
  ...
}
```

The worker runs with `maxTurns: 200` and a 30-minute timeout (`forge-worker.mjs:54`). When it hits a gate (approval checkpoint), it detects `status: "gate-pending"` in the run registry and exits (`forge-worker.mjs:196-206`). The conductor then handles the approval.

### How the Observer Works

The **TUI observer** (`scripts/forge-observer.mjs`) is a terminal dashboard that the user runs in a split pane alongside their conductor session. It shows all active pipeline runs as cards with status indicators.

The observer polls the filesystem every 2 seconds (`forge-observer.mjs:38, 1284`):

```js
const REFRESH_MS = 2000;
setInterval(() => { refresh(); draw(); }, REFRESH_MS);
```

Each refresh reads:
- `.pipeline/runs/*/run.json` — run status, gate state
- `.pipeline/run-active.json` — which run is currently executing
- `.pipeline/heartbeats/<runId>.json` — liveness timestamps (the subject of this issue)

### The Hook System

Claude Code supports **hooks** — shell commands that execute at lifecycle events (SessionStart, PostToolUse, PreToolUse, etc.). Hooks are registered in `hooks/hooks.json`. FORGE uses hooks extensively for context injection, workflow guards, and telemetry.

Hooks receive a JSON payload on stdin with context about the event (tool name, session info, working directory). They can return JSON on stdout to inject messages back into the conversation.

The full hook registration is at `hooks/hooks.json`. Relevant to this issue:

- `PostToolUse` with matcher `"*"`: `hooks/worker-heartbeat.js` (async) — fires after every tool call in every session (`hooks.json:130-138`)

---

## The Problem

### What exists today

A `PostToolUse` hook (`hooks/worker-heartbeat.js`) writes a heartbeat timestamp after every tool call:

**`hooks/worker-heartbeat.js:46-53`:**
```js
const hbDir = path.join(mainDir, '.pipeline', 'heartbeats');
fs.mkdirSync(hbDir, { recursive: true });
const hbFile = path.join(hbDir, runId + '.json');
const tmpFile = hbFile + '.tmp';
fs.writeFileSync(tmpFile, JSON.stringify({ runId, timestamp: Date.now() }) + '\n', 'utf8');
fs.renameSync(tmpFile, hbFile);
```

The observer checks this timestamp. If it's older than `HEARTBEAT_STALE_MS` (currently 300 seconds, was 120 seconds until today), the run is marked "LOST":

**`scripts/forge-observer.mjs:255-267`:**
```js
function isLost(run) {
  if (run.status !== 'running') return false;
  const hb = heartbeats[run.runId];
  if (!hb) {
    const ref = run.updatedAt ? Date.parse(run.updatedAt) : 0;
    if (!ref) return false;
    return (Date.now() - ref) > HEARTBEAT_STALE_MS;
  }
  return (Date.now() - hb) > HEARTBEAT_STALE_MS;
}
```

When LOST, the observer shows (`forge-observer.mjs:630`):
```
Worker: ? LOST — heartbeat stale, press R to resume
```

### Issue 1: False-positive LOST state (flickering)

**The heartbeat only fires on tool calls.** Between tool calls, the Claude model performs inference ("thinking") — generating internal reasoning tokens before deciding what tool to call next. This thinking phase produces no tool calls, so no heartbeat is written.

Normal thinking duration: 30–120 seconds. For complex reasoning: up to 3–5 minutes.

With the previous 120s threshold, workers flickered to LOST during routine thinking phases multiple times per pipeline. With the new 300s threshold, it's less frequent but still happens on complex tasks.

**The result:** Every active worker periodically shows as "LOST" in the observer even though it is healthy and working normally. The user cannot distinguish genuine death from normal thinking.

### Issue 2: "Press R to resume" is broken

The resume handler (`forge-observer.mjs:1173-1195`) hard-depends on Windows Terminal:

```js
function resumeWorker() {
  // ...
  try {
    execSync('where wt.exe', { stdio: 'ignore', timeout: 2000 });
  } catch (_) {
    flash('wt.exe not found');
    return;                    // <-- dead end, no fallback
  }
  // If wt.exe found, spawns: wt.exe -w 0 nt -d <path> -- claude --resume <name>
  const child = spawn('wt.exe', [
    '-w', '0', 'nt',
    '-d', wtPath,
    '--title', (run.feature || run.runId).slice(0, 60),
    '--', 'claude', '--resume', workerName,
  ], { detached: true, stdio: 'ignore' });
}
```

If `wt.exe` is not on PATH (VS Code terminal, ConEmu, macOS, Linux), pressing R shows "wt.exe not found" and does nothing. No fallback is offered — the user doesn't even get told what command they should run manually.

### Issue 3: No proactive death notification

When a worker actually dies (context limit exceeded, crash, network interruption — happens ~10% of the time):

1. The Node.js child process exits. The `child.on("exit")` handler in `server.js:1632-1635` cleans up the PID file and log fd — but does NOT update the run's status in the registry.
2. The run stays in `status: "running"` indefinitely in `.pipeline/runs/<runId>/run.json`.
3. The heartbeat file stops updating. After 300 seconds, `isLost()` returns true.
4. The observer marks the card as LOST — but this is passive. The user must be actively looking at the observer to notice.
5. The conductor session (where the user is typing) receives no notification whatsoever.

**Typical discovery time: 15–20 minutes after the worker died.** The user only finds out when they ask the conductor "what's the status?" or glance at the observer.

---

## Available Signals (What We Can Use)

| Signal | Location | Updates during thinking? | Updates after death? | Exists today? |
|--------|----------|--------------------------|----------------------|---------------|
| Heartbeat file | `.pipeline/heartbeats/<runId>.json` | No — only on PostToolUse | No | Yes |
| Worker log file | `.pipeline/worker-logs/<runId>.log` | **Yes** — `writeLog(JSON.stringify(msg))` fires on every SDK stream message, including during inference | No | Yes |
| PID file | `.pipeline/worker-pids/<runId>.json` | N/A (static) | **Deleted on exit** by `child.on("exit")` handler | Yes |
| Process alive check | `process.kill(pid, 0)` or `tasklist` | N/A (live check) | Returns false | Not implemented |

The log file mtime is the most reliable liveness signal because `forge-worker.mjs:169-170` writes every streaming message:
```js
for await (const msg of stream) {
  writeLog(JSON.stringify(msg));   // fires during thinking, tool use, everything
}
```

---

## Proposed Fix

### Fix 1: Replace heartbeat with log-file mtime

In `scripts/forge-observer.mjs`, change `isLost()` to check the log file's modification time instead of the heartbeat file:

```js
function isLost(run) {
  if (run.status !== 'running') return false;
  const logFile = join(PROJECT_DIR, '.pipeline', 'worker-logs', run.runId + '.log');
  try {
    const mtime = statSync(logFile).mtimeMs;
    return (Date.now() - mtime) > HEARTBEAT_STALE_MS;
  } catch (_) {
    // No log file yet — fall back to updatedAt
    const ref = run.updatedAt ? Date.parse(run.updatedAt) : 0;
    if (!ref) return false;
    return (Date.now() - ref) > HEARTBEAT_STALE_MS;
  }
}
```

The `worker-heartbeat.js` hook can then be removed from `hooks/hooks.json:130-138`, eliminating the per-tool-call filesystem write overhead.

### Fix 2: Resume fallback

In `resumeWorker()`, when `wt.exe` is not found:

1. Check for the worker's PID file (`.pipeline/worker-pids/<runId>.json`)
2. If PID file exists AND process is alive → flash "Worker is still running (PID <N>)" — it's not actually dead, just between heartbeats
3. If PID file is missing (process exited) → print the manual resume command: `claude --resume worker-<runId>` and copy it to clipboard if possible

### Fix 3: Mark run as failed on process exit

In `mcp/server.js:1632-1635`, the `child.on("exit")` handler currently only cleans up files. Add a run status update:

```js
child.on("exit", (code) => {
  try { closeSync(logFd); } catch (_) {}
  try { unlinkSync(pidFile); } catch (_) {}
  // NEW: if run is still "running", mark it failed
  const runPath = join(projectDir, ".pipeline", "runs", started.runId, "run.json");
  try {
    const run = JSON.parse(readFileSync(runPath, "utf-8"));
    if (run.status === "running") {
      run.status = "failed";
      run.failureReason = "worker process exited with code " + code;
      run.updatedAt = new Date().toISOString();
      writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n", "utf-8");
    }
  } catch (_) {}
});
```

This ensures the observer immediately sees the run as failed (no 300s delay), and the conductor can query `forge_list_runs({ status: "failed" })` to detect dead workers proactively.

---

## Files Involved

| File | Role | Change needed |
|------|------|---------------|
| `scripts/forge-observer.mjs` | TUI dashboard | Replace heartbeat check with log-file mtime in `isLost()` (line 255). Fix `resumeWorker()` fallback (line 1173). |
| `hooks/worker-heartbeat.js` | PostToolUse heartbeat hook | Remove entirely (replaced by log-file mtime). |
| `hooks/hooks.json` | Hook registration | Remove lines 130-138 (worker-heartbeat registration). |
| `mcp/server.js` | MCP server, worker spawn | Add run-status update in `child.on("exit")` handler (line 1632). |
| `.pipeline/heartbeats/` | Heartbeat data directory | Can be deleted after migration. |

---

## Risk Assessment

- **Fix 1** (log-file mtime): Low risk. Read-only change in the observer. Removes a write-per-tool-call hook, which is a net reduction in I/O.
- **Fix 2** (resume fallback): Low risk. UI-only change in the observer.
- **Fix 3** (mark failed on exit): Medium risk. The `child.on("exit")` handler runs in the MCP server process. A bug here could corrupt `run.json`. Mitigation: wrap in try/catch (already shown), only update if status is still "running".
