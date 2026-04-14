# Handoff: UX, discoverability, dashboard, merge-blocked handling, and board triage

## Overview

This session delivered UX/discoverability improvements, dashboard enhancements (in-session launch, welcome panel follow-up, merge-blocked discard), board schema normalization, concluded three investigations (startup briefing, session-data, /ping consistency), and triaged the board from 42 to 37 open tasks.

## Session commits (in order)

| Commit | Subject |
|---|---|
| `fdc0b6c` | fix(commands): stop FORGE config from shadowing native /config |
| `59039ee` | fix(commands): namespace all FORGE skill names |
| `f7cdf2c` | feat(help): add /forge:help discoverability surface |
| `73457a2` | docs(handoff): record banner investigation and help surface work |
| `b203ce1` | feat(dashboard): add welcome/help panel to sidecar UI |
| `9d9f24b` | docs(handoff): update session docs with dashboard welcome panel |
| `1b06d72` | fix(board): normalize legacy open-task fields |
| `f951e8b` | docs: refresh overview and technical reference |
| `afdd331` | docs: update handoff for board normalization and refresh |
| `6a0f3da` | chore(config): set pipeline mode to lean |
| `b085050` | feat(dashboard): auto-open sidecar in browser (npm run dashboard path) |
| `60e8e01` | feat(dashboard): launch sidecar from forge:dashboard |
| `c45b384` | chore(dashboard): align launch instructions with runtime validation |
| `08ff36a` | feat(dashboard): surface top-priority todo in welcome panel |
| `81f9346` | fix(help): update dashboard guidance for in-session launch |
| `cbc9c07` | feat(worktree): add targeted delete command |
| `3b1bb1e` | feat(dashboard): add discard action for merge-blocked runs |
| `4b05904` | docs: update handoff for dashboard and merge follow-ups |
| `0107fc8` | chore(board): close stale tasks and refine dashboard scope |
| `a3d7b4d` | chore(board): close landed utility and compound tasks |
| `2a7b95c` | chore(board): close landed chat intent task |

## What shipped

### Command-collision deconfliction (`fdc0b6c`, `59039ee`)

Blanket `forge:` prefix on all 20 FORGE skill `name:` fields. Fixed confirmed `/config` collision.

### `/forge:help` discoverability surface (`f7cdf2c`)

Compact quick reference: header, commands, state-aware hints, pointers.

### Dashboard welcome/help panel (`b203ce1`, `08ff36a`)

Welcome panel shows when idle. Follow-up: surfaces `topPriorityTodos[0].text` as a concrete next-step instead of generic count.

### Dashboard in-session launch (`60e8e01`, `c45b384`)

`/forge:dashboard` now probes sidecar reachability, spawns it if down, opens the browser, then renders text dashboard. Runtime-validated: sidecar reachable within 1 second.

### Stale dashboard guidance fix (`81f9346`)

Replaced `npm run dashboard` references in `/forge:help` and `/forge:status` with `/forge:dashboard`.

### Targeted worktree delete (`cbc9c07`)

`forge-worktree.js delete <slug>` — removes one specific worktree and branch without merging, without affecting others.

### Merge-blocked discard action (`3b1bb1e`)

Dashboard "Discard" button alongside "Retry merge" for merge-blocked runs. Calls `forge-worktree.js delete`, clears `mergeBlocked`, sets run to `discarded`. Regression test covers discard 200, post-discard state transition, re-discard 409.

### Board schema normalization (`1b06d72`)

Backfilled `done: false` and `addedAt: 0` on 17 legacy tasks. Cleared dangling `blockedBy` reference.

## Investigations concluded (no code shipped)

### Startup banner — parked

Full isolation test proved welcome screen suppression is a Claude Code runtime behavior when `--plugin-dir` is used, not caused by any FORGE hook.

### Session-data / startup briefing — skipped

File-based indirection (`session-data.md`) does not introduce a materially different mechanism from the existing `additionalContext` injection. The model already has the data; the gap is visible terminal chrome, which no hook can control.

### /ping consistency — no action needed

`/ping` is a bare diagnostic command with no collision risk. The naming policy explicitly exempts bare commands with no collision. No rename or relocation warranted.

## Core contracts (preserve in any future change)

1. **Skill `name:` fields always use `forge:` prefix.**
2. **Commands in `commands/forge/` are auto-namespaced by folder structure.**
3. **Bare commands outside `commands/forge/` are acceptable only when no native collision exists.**
4. **`/forge:help` uses `forge_dashboard_state` only.**
5. **Dashboard welcome panel uses existing state only.**
6. **`/forge:dashboard` owns the sidecar launch lifecycle.** No other skill or hook spawns the sidecar.
7. **Merge-blocked actions: retry OR discard.** Both via `POST /api/merge-action`. Retry re-runs merge. Discard calls `forge-worktree.js delete` + sets run to `discarded`.

## Board triage (42 → 37 open tasks)

Closed 5 stale tasks across 3 board-edit commits:
- `knowledge-compound-refresh` — `/forge:refresh` skill + `compound-refresh` agent fully implement the scope
- `ideate-command` — `/forge:ideate` skill + `ideator` agent fully implement the scope
- `move-utils-to-bin` — `bin/forge-status.js` and `bin/forge-worktree.js` already in place
- `plugin-knowledge-compound` — duplicate of closed `knowledge-compound-step`; documenter + compound-refresh cover it
- `plugin-intent-classification` — `/forge:chat` skill handles intent detection via Claude reasoning as the task itself describes

Refined 1 task:
- `forge-web-dashboard` — narrowed from "build a dashboard" to "WebSocket/SSE upgrade + health signal rendering" (the sidecar is shipped)

Left open as genuinely unimplemented: `worktree-dashboard` (per-session agent progress, wave status, cost tracking — distinct from the shipped sidecar).

## Deferred

- Monitor Anthropic's command additions for native collision risk
- Conflict-file surfacing in merge-blocked reason (deferred — risky git commands in conflicted state)
- Confirmation dialog on merge discard (add if user requests)
- `/ping` version string staleness (consider reading from `plugin.json`)
- Broader board triage of remaining 37 tasks — the obvious stale items are now closed; remaining tasks appear genuinely open

## Next recommended slice

Diesel Priser e2e validation, TERMINAL_STATUSES/PIPELINE_STAGE_LABELS consolidation refactor, or `add-plugin-settings` (settings.json with default permissions).
