# Handoff: Failure recovery first slice + regression runner + e2e closure

## Overview

This session delivered two bounded feature arcs plus the tooling to lock them in:

1. **ctx-pre-tool worktree fix** — unblocked `/forge:apply` writes inside run worktrees, closing the final Diesel Priser e2e blocker. Board entry `plugin-e2e-validation` closed with full-pipeline PASS evidence.
2. **`pipeline-failure-recovery` first slice (report-only)** — five layered primitives surfacing in-flight agent state on resume and session start, with paired narrow regression tests, a lightweight runner, and a canonical `npm test` entry. Board entry `pipeline-failure-recovery` closed with explicit deferred-scope list.

Both arcs land on `main` with the tree clean. All four script-style regression tests pass via `npm test`.

## Session commits (in order)

| Commit | Subject |
|---|---|
| `3cb6da8` | fix(hooks): make ctx-pre-tool path checks worktree-aware |
| `731deb1` | docs(session): handoff + CHANGELOG for ctx-pre-tool worktree fix *(intermediate, superseded)* |
| `44b71a2` | chore(board): close plugin-e2e-validation after Diesel Priser apply pass |
| `ba18272` | docs(session): end-of-session handoff + CHANGELOG for board closure *(intermediate, superseded)* |
| `59d0346` | feat(recovery): surface in-flight agent marker on resume |
| `277023a` | feat(recovery): show stale in-flight agent notice on session start |
| `903c339` | fix(recovery): clear stale in-flight marker for terminal runs on session start |
| `953d70f` | fix(recovery): suppress terminal stale-lock marker on resume |
| `a0ad246` | test(recovery): cover terminal stale-lock suppression on resume |
| `78de15c` | test(recovery): cover terminal stale-lock cleanup on session start |
| `dd5c425` | chore(test): add lightweight runner for script-style regression tests |
| `edf7a03` | test(hooks): make apply-context-inject test fail on assertion errors |
| `1f99b32` | chore(test): add npm test entry for script-style regression runner |
| `e8fba82` | chore(gitignore): ignore root npm artifacts for test runner workflow |
| `e1ec1f3` | chore(board): close pipeline-failure-recovery first slice |
| `716b0c1` | docs(changelog): record failure recovery first-slice closure |

## What shipped

### ctx-pre-tool worktree fix (`3cb6da8`)
- `readActiveWorktreePath(projectDir)` — sync read of `.pipeline/run-active.json`, `null` on any failure.
- `isInside(absFilePath, worktreeAbs)` — case-insensitive, slash-normalized containment check (Windows-safe).
- Allowed-paths branch now relativizes the target against `worktreePath` when (a) the marker is set, (b) the file path is absolute, (c) `isInside` is true — otherwise falls back to `process.cwd()`. Pattern matching, role manifest, and deny envelope untouched.
- Verified with four cases: worktree-src-positive (allow), main-root-src-positive (allow, unchanged), out-of-bounds-deny, out-of-bounds-inside-worktree-deny (still denied — fix changes origin, not allowed surface).

### Plugin e2e validation closure (`44b71a2`)
- `.pipeline/board.json`: `plugin-e2e-validation` → `done: true` with `doneAt`.
- Records full-pipeline PASS from Diesel Priser: `/forge:plan` → Gate 1 → `/forge:implement` → Gate 2 → `/forge:apply` (after `3cb6da8`). Implementer wrote inside worktree; documenter cleanup ran; worktree commit succeeded; run closed `status=completed, currentStep=done`.
- Merge-back soft-failed due to pre-existing dirty main tree — classified per apply-skill `"log and continue"` contract, not a regression.

### Failure recovery — report-only primitives

#### currentUnit marker (`59d0346`)
- `hooks/subagent-start.js`: on FORGE-allowlisted agent launch, sets `data.currentUnit = { agent, startedAt }` alongside the existing `agents[]` push. Agent name is namespace-stripped (`forge:planner` → `planner`).
- `hooks/subagent-stop.js`: on matching FORGE agent stop, sets `data.currentUnit = null` alongside the existing entry patch.
- Single-slot marker (not an array) — intentional: Claude Code subagent dispatch is sequential within a conversation. If nested/parallel agents become real, convert to an array keyed by `agent_id`.

#### `/forge:resume` stale-lock surface (`59d0346`)
- `forge_resume_run` reads the prior `run-active.json` BEFORE overwriting, extracts `currentUnit` if present, returns it as `staleUnit` in the response payload. The new `run-active.json` starts with no marker (consumed on read).
- `skills/resume/SKILL.md` gained a new point-5 under Step 3 that renders exactly: `Note: the previous session ended while <currentUnit.agent> was in flight.` — only when `currentUnit` is a non-null object with a non-empty `agent` string. Wording rules unchanged (no automating language).

#### SessionStart stale-lock notice (`277023a`)
- `hooks/ctx-session-start.js` gained `emitStaleUnitNoticeIfAny(projectDir)`. On SessionStart, reads `.pipeline/run-active.json`, and if `currentUnit` is shape-valid, emits one `FORGE notice: the previous session ended while <agent> was in flight.` line via `hookSpecificOutput.additionalContext` (same envelope `hooks/apply-context-inject.js` uses for SubagentStart). No new hook file, no change to `hooks/hooks.json`.

#### Terminal-marker truthfulness cleanup (`903c339`, `953d70f`)
- **SessionStart side** (`903c339`): if `currentUnit` exists AND the referenced run's registry status is `completed` / `failed` / `discarded`, `ctx-session-start.js` sets `data.currentUnit = null`, writes the full object back, and emits no notice. Unknown / unreadable / missing-status runs preserve the marker (defensive — never silently drop what we can't verify).
- **Resume side** (`953d70f`): symmetric suppression in `forge_resume_run`. If the prior marker's referenced run is terminal (via `getRun` lookup), `staleUnit = null` is returned in the response payload. Preservation on throw / null / missing `runId`.
- Shared terminal set: `new Set(["completed", "failed", "discarded"])`. Duplicated between the hook (CommonJS) and the server (ESM) — intentional, three-item set across a module-system boundary; extraction would cost more than it saves.

#### Regression coverage + runner ergonomics
- `mcp/resume-terminal-suppression-test.mjs` (`a0ad246`): spawns the real MCP server over stdio via `StdioClientTransport`, seeds a terminal prior run + non-terminal resume target, calls `forge_resume_run`, asserts `currentUnit === null`. Real integration test, not a logic replica.
- `hooks/ctx-session-start-terminal-cleanup-test.js` (`78de15c`): spawns `hooks/ctx-session-start.js` against a terminal-run fixture, asserts (a) stdout contains no `FORGE notice:` / `hookSpecificOutput` envelope AND (b) `run-active.json.currentUnit === null` on disk, with `runId` preservation as a read-modify-write sanity.
- `scripts/run-tests.mjs` (`dd5c425`): convention-based discovery (`hooks/*-test.js` + `mcp/*-test.mjs`), sequential execution with `stdio: 'inherit'`, per-test PASS/FAIL summary, non-zero exit on any child failure.
- `hooks/apply-context-inject-test.js` (`edf7a03`): replaced `console.assert` (which never exits non-zero in Node) with a local `assert(cond, msg)` helper that increments `__failures` and triggers `process.exit(1)` at end-of-run. Preserves the existing per-subtest output.
- `package.json` at repo root (`1f99b32`): minimal — `private: true`, description containing an explicit "do not add `\"type\"` field here" warning (would silently break hook CommonJS interpretation), single `scripts.test: "node scripts/run-tests.mjs"`.
- `.gitignore` (`e8fba82`): added `/package-lock.json` (leading-slash-anchored so tracked `mcp/package-lock.json` and `packages/forge-core/package-lock.json` stay tracked). Root `node_modules/` was already covered by the existing bare `node_modules` rule.

### Board + changelog closure

- `e1ec1f3` flipped `pipeline-failure-recovery` to `done: true`, updated text to preserve original framing + list all five shipped primitives with commit hashes + enumerate deferred scope, dropped the now-obsolete `needs-detail` tag.
- `716b0c1` added a `### Failure recovery — report-only first slice` subsection at the top of the `[2026-04-13]` block in `docs/CHANGELOG.md`, mirroring the board truth.

## Core contracts (preserve in any future change)

1. **Report-only scope.** This slice's primitives observe and surface state. No restart/retry logic, no autonomous progress, no cross-session locking, no mutation beyond the narrow `currentUnit = null` cleanup when a referenced run is verified terminal.
2. **Defensive preserve on ambiguity.** Unknown runs, unreadable registry files, parse failures, missing-status fields → keep the marker. Never silently drop a signal we can't verify.
3. **Single-slot marker.** `currentUnit` is one agent, not a list. Revisit only if nested/parallel subagent dispatch becomes real.
4. **Terminal statuses are `completed` / `failed` / `discarded`.** Sourced from `RunStatus` in `packages/forge-core/src/runs/schemas.js`. The three-item set appears twice (hook and server) by design; update both if the schema grows.
5. **ctx-pre-tool worktree trigger requires all three:** `worktreePath` set, absolute target path, `isInside` true. Any miss falls back to main-root behavior unchanged.
6. **Root `package.json` hosts `npm test` only.** No `"type"` field. Zero deps. Plugin distribution remains governed by `.claude-plugin/plugin.json`; MCP deps by `mcp/package.json`.

## Verification (live runs this session)

- `npm test` → `4/4 passed`, `NPM_TEST_EXIT=0`. Runner discovers:
  - `hooks/apply-context-inject-test.js`
  - `hooks/ctx-session-start-terminal-cleanup-test.js`
  - `hooks/gate-sync-test.js`
  - `mcp/resume-terminal-suppression-test.mjs`
- `git check-ignore` confirmed `/package-lock.json` anchors to repo root only; nested lockfiles unaffected.
- `node --check` on every modified `.js` / `.mjs` file returned OK at each step.
- Post-commit `git status` → clean on `main` after every slice.

## Deferred (explicitly out of scope for this session's arcs)

- Synthesized recovery briefings (file + tool-call state → human-readable "here's what happened").
- Automatic restart/retry at the interrupted step — sibling board task `pipeline-stage-restart`.
- Worktree crash recovery with surviving-call forensics — sibling board task `worktree-crash-recovery`.
- Native `--resume` / `--continue` orchestration — user-side session management, not FORGE code.
- Merge-back hard-success demonstration in Diesel Priser (blocked only by that checkout's pre-existing dirty tree, not an apply-path issue).
- CI wiring for `npm test` — the entry point is ready; actual CI wiring is a separate, future slice.

## Risks / notes worth carrying forward

- SessionStart now has a narrow **write** side-effect on `run-active.json` (previously read-only). Gated by verified-terminal status, preserves all other fields via read-modify-write-full-object, safe at session bootstrap (no FORGE agent in flight).
- `TERMINAL_STATUSES` set duplication (hook CommonJS + server ESM). If a third consumer arrives, extract.
- The three-hash chain for the "regression coverage + runner ergonomics" feature story means any single bullet rewrite risks losing commit-level traceability; keep bullets per-commit when editing.
- `console.assert` lesson: any future test file added to the bundle must `process.exit(1)` on failure, or the runner's non-zero-exit contract silently breaks for that file. Documented in the `edf7a03` commit body for future readers.
- The ctx-pre-tool worktree fix intentionally did NOT broaden `.pipeline/agent-roles.json` — role patterns stay project-relative. Resist any future "just add `.worktrees/**` to implementer" shortcut.

## Next recommended slice

Close out the recovery/tooling story with a lightweight CI hook: a GitHub Actions workflow (or equivalent) that runs `npm test` on push to `main` and on PRs. This is genuinely one file under `.github/workflows/` with no runtime surface, and it finally activates the non-zero-exit contract the runner + `npm test` entry + hardened assertion paths were all built to satisfy.
