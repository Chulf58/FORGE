---
name: forge:dashboard
description: "Show all FORGE runs and board state at a glance. Use when: user asks 'what's running', wants a control-plane overview, checks pending gates, or wants to see recent completions + top TODOs."
allowed-tools: "Read Glob Bash"
---

Show a compact registry-backed snapshot of the current FORGE state, and ensure the live web dashboard is reachable.

## Step 0 — Launch the sidecar dashboard

Before rendering the text dashboard, ensure the sidecar web dashboard is running and open it in the browser.

### 0a — Check reachability

Run via Bash:

```bash
node -e "fetch('http://127.0.0.1:7878/api/dashboard-state').then(r => { if (r.ok) console.log('SIDECAR_UP'); else console.log('SIDECAR_DOWN'); }).catch(() => console.log('SIDECAR_DOWN'))"
```

### 0b — Launch if not running

If the output is `SIDECAR_DOWN`, spawn the sidecar as a detached background process via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-server.mjs" &
```

Wait 1 second for the server to start, then re-check reachability using the same probe from 0a. If it is still down after the retry, log `[forge:dashboard] Sidecar failed to start — showing text dashboard only.` and continue to the text dashboard. Do not block or retry further.

### 0c — Open in browser

If the sidecar is up (either already running or just launched), open it in the default browser via Bash:

```bash
start http://127.0.0.1:7878
```

On macOS use `open`, on Linux use `xdg-open`. Detect via: if the Bash environment is Windows (default for this project), use `start`.

### 0d — Continue to text dashboard

After the sidecar launch attempt (whether it succeeded or not), always continue to the text dashboard rendering below. The sidecar is a supplement, not a replacement.

## Data source

Call the MCP tool `forge_dashboard_state` with no arguments. It returns a single object with four top-level groups, all read directly from `.pipeline/runs/` and `.pipeline/board.json` — no background worker, no live push, no HTTP:

- `activeRuns`: non-terminal runs (`running`, `gate-pending`, `created`), each with `{ runId, pipelineType, mode, feature, status, currentStep, stageLabel, gateState, worktreePath, currentUnit, updatedAt }`. The `currentUnit` field is populated only on the row whose `runId` matches `run-active.json`; it names the FORGE agent in flight when the prior session ended mid-agent.
- `gatesAwaiting`: subset of `activeRuns` whose `gateState.status === "pending"`, slimmed to `{ runId, pipelineType, feature, gateState, updatedAt }`.
- `recentCompleted`: bounded list (≤5) of terminal runs (`completed`/`failed`/`discarded`) sorted by `updatedAt` desc, each `{ runId, pipelineType, feature, status, updatedAt }`.
- `boardSummary`: `{ todoCount, plannedCount, blockedTodoCount, topPriorityTodos }` — `topPriorityTodos` is a bounded list (≤5) of open high-priority items, each `{ id, priority, text }`.

Do **not** read `.pipeline/*` directly — the MCP tool is the single source of truth for dashboard rendering. If the tool returns an error (e.g. project not initialized), surface the error verbatim with `[forge:dashboard] ` prefix and stop.

## Output format

Render four sections in this order. Omit any section whose source array is empty. If all four are empty *and* `boardSummary.todoCount + plannedCount === 0`, print exactly `No active FORGE runs and an empty board. Run /forge:plan to begin.` and stop.

### 1. Active runs (always rendered when non-empty)

Header line: `Active runs (<activeRuns.length>):`

Then one line per entry:

```
  <runId> · <pipelineType> · <feature (truncate to ~50 chars)> · <status> · at <stageLabel ?? currentStep ?? "starting">
```

Append these suffixes when the corresponding fields are present:
- ` · wt=<worktreePath-basename>` when `worktreePath` is non-null
- ` · in-flight: <currentUnit.agent>` when `currentUnit` is non-null (reflects a prior session that ended mid-agent)

### 2. Gates awaiting approval (only if `gatesAwaiting` non-empty)

Header line: `Gates awaiting approval (<gatesAwaiting.length>):`

Then one line per entry:

```
  <runId> · <gateState.gate> · <feature> · pending since <relative time from gateState.createdAt>
```

After the list, a single action line:
```
  Act with /forge:approve or /forge:discard (re-invoke /forge:resume <runId> first if needed).
```

### 3. Recent completions (only if `recentCompleted` non-empty)

Header line: `Recent completions (<recentCompleted.length>):`

One line per entry:

```
  <runId> · <pipelineType> · <feature> · <status> · <relative time from updatedAt>
```

### 4. Board

Always render this section last:

```
Board: <todoCount> open TODO(s) (<blockedTodoCount> blocked), <plannedCount> planned
```

If `topPriorityTodos` is non-empty, append a `Top priorities:` sub-header and one line per entry:
```
  - [<priority>] <text (truncate to ~80 chars)>
```

## Wording rules

- **Use:** "active runs", "pending since", "previously at", "in-flight" (for `currentUnit`), "registry-backed", "read-only snapshot".
- **Avoid:** "running in background", "working in another session", "sessions actively executing", "live updates", "streaming", "push" — the dashboard is a point-in-time read, not a live feed.
- Render whatever the tool returns as-is; do not invent state, do not guess progress, do not imply autonomous advancement between renders.

## Relative time helper

Compute relative times client-side from the ISO `updatedAt` / `createdAt` string against the current clock: `just now` (<60s), `<N> minute(s) ago` (<60m), `<N> hour(s) ago` (<24h), `<N> day(s) ago` otherwise. Do not invent times; if the source field is missing, drop the trailing ` · <relative time>` clause.
