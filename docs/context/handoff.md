# Handoff: Dashboard contract + sidecar + merge-blocked board task

## Overview

This session delivered the first complete dashboard arc — from data contract through skill consumer through HTTP sidecar — plus a board gap fix for merge-conflict handling. Five material commits on the dashboard path, one board addition, and supporting test/runner work.

## Session commits (in order)

| Commit | Subject |
|---|---|
| `448d59c` | chore(board): add merge-blocked run handling task |
| `6e2581f` | feat(dashboard): add forge_dashboard_state MCP contract |
| `2d9d8d3` | feat(dashboard): route /forge:dashboard through forge_dashboard_state |
| `8e36703` | feat(dashboard): add minimal read-only sidecar dashboard |
| `954c824` | test(dashboard): cover sidecar dashboard-state endpoint |

*(Prior session commits `3cb6da8`–`716b0c1` are documented in the previous handoff and CHANGELOG.)*

## What shipped

### Board: merge-blocked run handling (`448d59c`)
- New high-priority task `merge-blocked-run-handling` added to `.pipeline/board.json`.
- Captures the gap: `bin/forge-worktree.js merge()` safe-fails on conflict but nothing surfaces the stranded run to the user.
- First-slice scope defined (report-only, registry-backed): persist `mergeBlocked` field on the run, surface through status/resume/dashboard, offer a `/forge:merge` skill for manual retry.
- Explicitly defers auto-resolution, wave scheduling (`dependency-analysis-waves`), and forensics (`worktree-crash-recovery`).

### Dashboard MCP contract (`6e2581f`)
- New MCP tool `forge_dashboard_state` — zero-input, read-only, `readOnlyHint: true`.
- Returns four top-level groups:
  - `activeRuns[]` — non-terminal runs hydrated from registry, with `stageLabel`, `gateState`, `worktreePath`, `currentUnit` (populated only for the run matching `run-active.json`).
  - `gatesAwaiting[]` — actionable pending gates (subset of activeRuns).
  - `recentCompleted[]` — bounded (≤5) terminal runs sorted by `updatedAt` desc.
  - `boardSummary` — `todoCount`, `plannedCount`, `blockedTodoCount`, `topPriorityTodos[]` (bounded ≤5, sorted by priority rank, text truncated at 200 chars).
- Regression test: `mcp/dashboard-state-shape-test.mjs` — spawns the real MCP server over stdio, seeds five runs + board, asserts the full shape (order, counts, currentUnit presence/absence, sort, bounding).

### Skill migration (`2d9d8d3`)
- `skills/dashboard/SKILL.md` rewritten to consume `forge_dashboard_state` as the sole data source.
- Explicit `Do **not** read .pipeline/* directly` rule.
- Four rendered sections (Active runs, Gates awaiting approval, Recent completions, Board) each driven by the corresponding group from the tool.
- Wording rules enforce truthful framing: "read-only snapshot", no "background" or "live" claims.

### Sidecar HTTP dashboard (`8e36703`)
- **`mcp/lib/dashboard-state.js`** (new) — extracted `buildDashboardState(projectDir)` as a pure shared helper. Reused by both the MCP tool handler (collapsed to three lines) and the HTTP sidecar.
- **`scripts/dashboard-server.mjs`** (new) — tiny local HTTP server using only Node's built-in `http`. Routes: `GET /` (self-contained HTML + inline CSS + one `<script>` fetch), `GET /api/dashboard-state` (JSON from `buildDashboardState`). Binds `127.0.0.1` only, default port 7878, override via `FORGE_DASHBOARD_PORT`. Zero external dependencies.
- **`package.json`** — added `"dashboard": "node scripts/dashboard-server.mjs"` so `npm run dashboard` is the canonical invocation.
- HTML renders four sections with status badges, monospace run IDs, optional `wt=` and `in-flight:` suffixes. Refresh by page reload only. No WebSocket, no polling, no actions.

### Endpoint regression test (`954c824`)
- `scripts/dashboard-server-endpoint-test.mjs` — spawns the real server against a seeded fixture, fetches `/api/dashboard-state`, asserts HTTP 200 + JSON content-type + four top-level keys + correct types + board counts from fixture.
- `scripts/run-tests.mjs` extended: added `{ dir: 'scripts', suffix: '-test.mjs' }` to discovery so `scripts/*-test.mjs` files are auto-discovered. Bundle grew from 5 to 6 tests; all passing.

## Core contracts (preserve in any future change)

1. **`buildDashboardState(projectDir)`** is the single source of truth for dashboard rendering. Both the MCP tool and the HTTP sidecar call it. Any new field or group must land here once; both consumers inherit it.
2. **Four-group response shape** (`activeRuns`, `gatesAwaiting`, `recentCompleted`, `boardSummary`) is locked by two independent regression tests — `mcp/dashboard-state-shape-test.mjs` (MCP path) and `scripts/dashboard-server-endpoint-test.mjs` (HTTP path). Renaming or removing a key will fail both.
3. **Loopback-only binding** — the sidecar binds `127.0.0.1`. Do not change to `0.0.0.0` without a corresponding auth/TLS security slice.
4. **No auto-refresh** — the HTML page fetches once on load. Any auto-refresh (setInterval, meta-refresh, SSE, WebSocket) belongs to a separate slice with its own design.
5. **`merge-blocked-run-handling`** is a board task, not a shipped feature. The dashboard will eventually surface `mergeBlocked` runs, but the field does not exist on runs yet.

## Verification summary

- `npm test` → `6/6 passed` (all existing + both new tests green).
- Live sidecar verification: server booted on port 7879, `GET /api/dashboard-state` returned HTTP 200 / JSON / four keys with live data (43 open TODOs, 3 active runs, 5 top priorities); `GET /` returned 200 / HTML with all four section IDs + client-side fetch call; `GET /nonsense` returned 404.
- `node --check` on all modified/new JS/MJS files returned OK at each step.

## Deferred / known debt

- **`PIPELINE_STAGE_LABELS` appears in three places** (`bin/forge-status.js` CommonJS, `mcp/server.js` ESM, `mcp/lib/dashboard-state.js` ESM). The CommonJS/ESM boundary forces one copy; the two ESM copies should consolidate to `mcp/lib/stage-labels.js` in a near-term refactor.
- **`TERMINAL_STATUSES` appears in three places** (`hooks/ctx-session-start.js` CommonJS, `mcp/server.js` forge_resume_run, `mcp/lib/dashboard-state.js`). Same consolidation opportunity.
- **No test for the HTML page rendering** — the endpoint test covers the JSON shape; the HTML page content is verified by reading code, not by browser automation. Add only if rendering drift becomes an observed issue.
- **Port collision** not gracefully handled — server crashes if port is in use. Override with `FORGE_DASHBOARD_PORT`.
- **Server lifecycle is manual** — no daemon mode, no pidfile. Process-management wiring belongs to a later slice.
- **Auto-refresh, actions, WebSocket, SSE** — all explicitly out of scope for this session.
- **`merge-blocked-run-handling`** first-slice implementation — captured on board, not yet started.

## Next recommended slice

Add auto-refresh to the sidecar dashboard — a small `setInterval` fetch in the client-side `<script>` that re-renders the four sections every N seconds (e.g. 5s), with a visible "last refreshed" timestamp. No server change required (the endpoint is already idempotent). One file edit (`scripts/dashboard-server.mjs`, HTML template only), no WebSocket, no SSE — just periodic polling from the browser.
