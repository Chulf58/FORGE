## [2026-04-14] Dashboard Contract + Sidecar + Gate Actions + Merge-Blocked State

### Merge-blocked run handling — report-only first slice
- `Run` schema gained optional nullable `mergeBlocked: { reason, detectedAt }` field (commit `e1214ab`); defaults to `null` on all runs, non-breaking; does NOT change the run's `status` (stays `completed` — the pipeline succeeded; merge-back is a post-pipeline step)
- `bin/forge-worktree.js` merge() failure path now persists `mergeBlocked` + `updatedAt` on the run.json before exiting (commit `e1214ab`); best-effort direct file write (CommonJS boundary); `conflictedFiles` deliberately omitted in slice 1
- `mcp/lib/dashboard-state.js` surfaces `mergeBlocked` in both `activeRuns` and `recentCompleted` entries; `recentCompleted` now hydrates from `getRun` to extract the field (bounded by limit, max 5 extra reads per poll) (commit `e1214ab`)
- Sidecar dashboard HTML renders `mergeBlocked` as an orange `merge blocked` badge + reason text in both active-runs and recent-completions sections (commit `d3f4565`); `renderMergeBlocked(mb)` helper reused in both sections; no-op for `null` (non-blocked runs unchanged)

### Dashboard phase 2 — auto-refresh, relative times, gate actions
- Live auto-refresh: client-side `setInterval(refreshDashboard, 5000)` re-fetches and re-renders all four sections; "Last updated" timestamp on each tick; error self-healing (banner appears on failure, clears on recovery); "Refresh now" button calls `refreshDashboard()` directly (commit `1c0a312`)
- Relative-time rendering: `relTime(iso)` helper in the inline `<script>`; gates show "updated 3 hr ago" instead of raw ISO; recent completions likewise; re-evaluates on each 5s tick; defensive on missing/invalid/future timestamps (commit `ba36f37`)
- Gate approve/discard actions: `POST /api/gate-action` endpoint validates `{ runId, action }`, loads the run, checks `gate-pending` status (400/404/409 for bad input/missing/wrong status); `handleGateAction` mirrors `/forge:approve` and `/forge:discard` skill transitions — approve stamps gate file + `updateRun` to completed, discard deletes gate file + `updateRun` to discarded; worktree-scoped gate files handled; client-side buttons in each gate row with disabled-during-flight and immediate `refreshDashboard()` on success (commit `fa6f9f5`)
- Regression test: `scripts/dashboard-gate-action-test.mjs` seeds a gate-pending fixture, spawns real sidecar, asserts approve 200+ok, post-action state transition (gate gone, run completed), re-approve 409, unknown 404, missing runId 400, bad action 400; auto-discovered by runner; bundle at 7/7 (commit `9dca636`)

### Dashboard state MCP contract + sidecar HTTP surface
- New MCP tool `forge_dashboard_state` (commit `6e2581f`): read-only, zero-input; returns four-group snapshot — `activeRuns[]` (non-terminal, hydrated with `stageLabel`, `gateState`, `worktreePath`, `currentUnit`), `gatesAwaiting[]` (actionable pending gates), `recentCompleted[]` (bounded ≤5 terminal tail), `boardSummary` (counts + top-priority open TODOs bounded ≤5)
- `/forge:dashboard` skill rewritten to consume the MCP tool as sole data source (commit `2d9d8d3`); explicit `.pipeline/*` direct-read prohibition; truthful wording rules
- State-builder extracted to `mcp/lib/dashboard-state.js` — shared by both the MCP tool and the HTTP sidecar, guaranteeing identical payloads (commit `8e36703`)
- Minimal local HTTP sidecar at `scripts/dashboard-server.mjs`: Node built-in `http` only, zero deps; `GET /` serves self-contained HTML, `GET /api/dashboard-state` returns JSON; loopback-only (`127.0.0.1`), default port 7878, `npm run dashboard` invocation (commit `8e36703`)
- HTML renders four sections with status badges + monospace run IDs + optional `wt=`/`in-flight:` suffixes
- Regression tests: `mcp/dashboard-state-shape-test.mjs` (MCP path, full shape assertion against five-run fixture, commit `6e2581f`); `scripts/dashboard-server-endpoint-test.mjs` (HTTP path, spawns real server against fixture, asserts HTTP 200 + JSON + four keys + board counts, commit `954c824`)
- Test runner extended: `scripts/run-tests.mjs` now discovers `scripts/*-test.mjs` alongside hooks and mcp (commit `954c824`)

### Board: merge-blocked run handling task
- New high-priority board task `merge-blocked-run-handling` (commit `448d59c`): captures the gap between current safe-fail behavior (`bin/forge-worktree.js merge()` aborts + preserves + exits non-zero) and the missing first-class user surface
- First-slice scope defined: report-only, registry-backed — persist `mergeBlocked` on the run, surface through status/resume/dashboard, offer `/forge:merge` for manual retry
- Explicitly defers auto-resolution, wave scheduling (`dependency-analysis-waves`), and forensics (`worktree-crash-recovery`)

## [2026-04-13] Visibility, Targeting, Windows Compatibility

### Failure recovery — report-only first slice
- `pipeline-failure-recovery` first slice closed on the board (commit `e1ec1f3`); scope is explicitly report-only — no restart/retry logic, no state mutation beyond the narrow terminal-marker cleanup described below, no cross-session locking
- **currentUnit marker:** `hooks/subagent-start.js` writes `run-active.json.currentUnit = { agent, startedAt }` on FORGE-allowlisted agent starts (namespace-stripped); `hooks/subagent-stop.js` clears it on matching stops. Commit `59d0346`
- **`/forge:resume` stale-lock notice:** `forge_resume_run` in `mcp/server.js` reads the prior `run-active.json.currentUnit` before overwriting and surfaces it in the response payload; `skills/resume/SKILL.md` renders one extra `Note:` line when the field is present. Commit `59d0346`
- **SessionStart stale-lock notice:** `hooks/ctx-session-start.js` emits a one-line `FORGE notice:` via `hookSpecificOutput.additionalContext` when `run-active.json.currentUnit` is set on session entry. Commit `277023a`
- **Terminal-marker truthfulness cleanup (both surfaces):** SessionStart clears `currentUnit` in-place when the referenced run is `completed` / `failed` / `discarded` (commit `903c339`); `forge_resume_run` suppresses the marker from its response in the same case (commit `953d70f`). Defensive: unknown / unreadable / missing-status runs preserve the marker
- **Regression coverage + runner ergonomics:** `mcp/resume-terminal-suppression-test.mjs` (commit `a0ad246`) spawns the real MCP server over stdio and asserts `currentUnit === null` after a terminal prior run; `hooks/ctx-session-start-terminal-cleanup-test.js` (commit `78de15c`) asserts both no-notice and disk-cleared on SessionStart; `scripts/run-tests.mjs` (commit `dd5c425`) discovers and runs `hooks/*-test.js` + `mcp/*-test.mjs` sequentially with per-test PASS/FAIL summary and non-zero exit on failure; `hooks/apply-context-inject-test.js` hardened to `process.exit(1)` on assertion failure (commit `edf7a03`); root `package.json` wires `npm test` to the runner (commit `1f99b32`); root `/package-lock.json` ignore added without affecting tracked nested lockfiles (commit `e8fba82`)
- **Deferred (not in this slice):** synthesized recovery briefings from file/tool-call state; automatic restart/retry at the interrupted step (covered by sibling board task `pipeline-stage-restart`); worktree crash recovery with surviving-call forensics (covered by sibling board task `worktree-crash-recovery`); native `--resume` / `--continue` orchestration (user-side session management, not FORGE code)

### Plugin e2e validation closed (Diesel Priser full pass)
- `.pipeline/board.json`: `plugin-e2e-validation` flipped to `done: true` with `doneAt` stamped
- Accepted runtime evidence: `/forge:plan` PASS → Gate 1 PASS → `/forge:implement` PASS → Gate 2 PASS → `/forge:apply` PASS after commit `3cb6da8`; implementer wrote inside `.worktrees/<runId>/`; documenter cleanup ran; worktree commit succeeded; run closed with `status=completed, currentStep=done`
- Merge-back soft-failed only because the main tree was already dirty (pre-existing uncommitted changes) — non-blocking per apply-skill `"log and continue"` contract; not an apply-path regression
- Commit `44b71a2`

### Worktree-aware ctx-pre-tool path matching
- `hooks/ctx-pre-tool.js`: allowedPaths matching now relativizes the target file against `run-active.json.worktreePath` when the file is inside the active worktree, and falls back to `process.cwd()` otherwise
- Unblocks `/forge:apply` writes under `.worktrees/<runId>/…` against patterns like `src/**` without broadening any role's allowedPaths
- Root cause (Diesel Priser e2e): valid worktree paths were being relativized against the main project root, producing `.worktrees/<runId>/src/…` which never matched role patterns
- Two small helpers added: `readActiveWorktreePath(projectDir)` (sync read of `.pipeline/run-active.json`, null on any failure) and `isInside(absFilePath, worktreeAbs)` (case-insensitive, slash-normalized containment check)
- Pattern-match logic, role manifest, read-only and empty-allowedPaths branches, and the deny envelope are untouched
- Out-of-bounds files inside the worktree (e.g. `<wt>/secrets/config.json`) still deny — the fix changes the comparison origin, not the allowed surface
- Commit `3cb6da8`

### Run resume (`/forge:resume`)
- New skill `skills/resume/SKILL.md` and backing MCP tool `forge_resume_run({ runId })` in `mcp/server.js`
- `/forge:resume <runId>` re-enters a paused or in-progress run; `/forge:resume` with no argument lists resumable runs (`running`, `gate-pending`, `created`) sorted by `updatedAt` desc
- Restores steering only — overwrites `.pipeline/run-active.json` with `{ startedAt, runId, pipelineType, mode, feature, agents: [], worktreePath? }`. Does NOT mutate the run's own `status`, `currentStep`, `gateState`, or `agents`, and does NOT invoke any pipeline skill autonomously
- Refuses cleanly on unknown runId, terminal status (`completed`/`failed`/`discarded`), wrong project (`run.projectRoot` mismatch), or bound worktree missing on disk
- Wording rules baked into the skill: uses "paused at", "previously at", "in this conversation"; never "background", "another session", "auto-resume", "scheduling"

### Pipeline skill visibility
- Removed `context: fork` from 6 core pipeline skills (plan, implement, apply, debug, refactor, chat)
- Pipelines now run in main conversation — agent reasoning, tool calls, reviewer verdicts visible live
- Maintenance skills (ideate, refresh, refresh-docs) keep fork context

### Canonical feature preservation
- `mcp/server.js` `forge_update_run`: overrides `gateState.feature` with stored `run.feature` (catches skill paraphrasing)
- `hooks/gate-sync.js`: uses `run.feature` for gateState updates in both pending and approved paths; repairs gate-pending.json drift
- `forge_create_run` apply path: binds worktree by gate2-approved gateState (no fuzzy feature matching)

### Gate runId targeting
- `gate-pending.json` schema gained `runId` field — single deterministic current-gate pointer
- `forge_set_gate` accepts optional `runId` parameter, persists it
- `gate-sync.js` prefers runId for O(1) targeting; falls back to feature-match for legacy files; repairs missing runId
- approve/discard skills read runId first
- 4 pipeline skills (plan/implement/debug/refactor) include runId in Write instructions

### Active-run contamination filter
- `hooks/subagent-start.js` and `subagent-stop.js` filter by FORGE agent allowlist (derived from `agents/*.md`)
- Built-in subagents (general-purpose, Explore, claude-code-guide) silently skipped
- Tolerates `forge:` namespace prefix
- Symmetric stop-hook filter prevents spurious warnings

### createWorktree.js Windows compatibility
- Replaced `git rev-parse --git-dir` PATH check with filesystem `.git` existence check
- Added `getGitExecutable()`: tries PATH, falls back to Program Files\Git and LOCALAPPDATA\Programs\Git locations
- Switched from `execSync` (shell quoting bugs) to `execFileSync` (direct process spawn)
- Truthful error reporting on `git worktree add` failures

### FORGE banner (one-time per session)
- `forge-banner.txt` shared text file at plugin root
- SessionStart hook writes `.pipeline/forge-banner-pending` flag
- First PostToolUse picks up flag, injects banner via `additionalContext`, deletes flag
- Banner appears on first response of fresh session and after `/clear`; never spams
- PostCompact path removed (was producing raw JSON in compaction logs)

### Statusline rollout
- `bin/forge-status.js` rewritten: registry-driven derivation, pipeline stage mapping, gate1/gate2 distinction, multi-pipeline fanout with overflow
- `/forge:init` STEP 1e generates `.claude/forge-status.cmd` wrapper using `process.execPath` (avoids bare-node PATH dependency and cmd.exe double-quoted-token bug)
- Stdin timeout (500ms) prevents hangs
- Migration: detects old bare-node forms in existing settings.json and upgrades to wrapper
- Registry is authoritative over `run-active.json` — completed runs no longer render as active

### Apply skill worktree wiring
- STEP 2b: resolve worktree, persist worktreePath to run-active.json
- STEP 3: prepend worktree path instructions for implementer/documenter
- STEP 8: mandatory worktree commit before merge (`git -C <wtPath>`)
- STEP 9: merge-back via `node bin/forge-worktree.js merge <runId>`

### Worktree path isolation
- `hooks/workflow-guard.js` blocks source writes outside resolved worktree during worktree-backed apply (exit 2)

### Worktree merge safety
- `bin/forge-worktree.js merge()` detects conflicts, aborts cleanly, preserves worktree on failure
- Pre-merge commit only when `git status --porcelain` shows real changes (no --allow-empty)

### PostCompact hook closed as silent no-op
- `hooks/ctx-post-compact.js` converted to silent no-op after live testing in Claude Code v2.1.104 proved no PostCompact stdout shape (bare text, `hookSpecificOutput` envelope, top-level `systemMessage`/`additionalContext` with `suppressOutput`) can both inject context and stay out of `/compact`'s visible completion line
- `/compact` output is now clean — no raw JSON, no validator error, no rules block printed
- Runtime truth recorded in `docs/gotchas/GENERAL.md` (new "PostCompact hook — do not use for context reinjection" section); `docs/RESEARCH/context-reinjection.md` annotated with top-of-file correction so the older theoretical claims no longer mislead

## [2026-04-12] Structural Worktree Enforcement, Init Hygiene, Merge Safety

### Structural worktree binding for apply runs
- `mcp/server.js`: `forge_create_run` with pipelineType "apply" now auto-resolves the worktree from approved gate2 feature match and writes `worktreePath` into `run-active.json` — zero prompt dependency
- Feature matching uses normalize + bidirectional containment against implement runs

### Structural commit-before-merge in merge script
- `bin/forge-worktree.js`: `merge()` now runs `git -C <wtPath> status --porcelain` before merge — commits real changes only, no `--allow-empty`
- If no changes exist, commit is skipped silently
- If commit fails (pre-commit hooks), logs and continues

### Worktree path isolation enforcement
- `hooks/workflow-guard.js`: during worktree-backed apply, source writes outside the resolved worktree path are now blocked with exit 2
- Uses `run-active.json.worktreePath` (set structurally by forge_create_run)

### Safe merge failure handling
- `bin/forge-worktree.js`: `merge()` now detects merge conflicts, runs `git merge --abort`, preserves worktree/branch, exits non-zero with actionable JSON error
- Cleanup (worktree remove + branch delete) only runs after confirmed successful merge

### Init: stale hook cleanup
- `skills/init/SKILL.md`: STEP 1b removes 5 known FORGE-scaffolded hook files from `.claude/hooks/`
- Removes empty `.claude/hooks/` directory after cleanup

### Init: .gitignore for FORGE local state
- `skills/init/SKILL.md`: STEP 1c ensures `.pipeline/` and `.worktrees/` are in `.gitignore`
- Runs in the always-run section (works for both new and existing projects)

### Init: tracked-state detection and remediation guidance
- `skills/init/SKILL.md`: STEP 1d detects already-tracked `.pipeline/` and `.worktrees/` via `git ls-files`
- Prints WARNING with exact `git rm -r --cached` remediation commands — does NOT execute them

### Template cleanup
- Deleted 12 stale hook files from all 3 templates (code, instructional, power-automate)
- Cleared all 3 template `settings.json` to `{}` (no local hook registrations)
- Removed 3 empty `.claude/hooks/` directories from templates

### createWorktree.js investigation
- Confirmed: `createWorktree.js` path logic works correctly on Windows with space-containing paths
- "Not a git repository" failure was environmental (pre-git-init), not a code bug
- Nested `.pipeline/.pipeline/` and `docs/docs/` are committed project artifacts, not createWorktree bugs

## [2026-04-12] Apply Hardening, Worktree Merge, Era 20, Codex Investigation

### Handoff-to-gate feature matching
- `hooks/workflow-guard.js`: apply-time source writes now require handoff `# Handoff: <name>` to match `gate-pending.json.feature`
- Word-based matching with filler removal and simple stemming (not character substring)
- Four distinct deny reasons: gate unapproved, gate missing, handoff missing, feature mismatch

### Worktree merge-back wiring
- `skills/apply/SKILL.md`: added STEP 8 — calls `node bin/forge-worktree.js merge <runId>` after documenter/auto-PR
- On success: merge + worktree removal + branch deletion
- On failure: log with `[worktree]` prefix, leave worktree intact, continue

### FORGE-OVERVIEW Era 20
- Added Era 20: "Lifecycle Enforcement: from prompt trust to structural truth"
- Updated counts (29 agents, 19 skills, 13 hooks, 22 MCP tools)
- Updated "What's planned next" with current priorities

### FORGE-REFERENCE refresh
- Enforcement summary: 4 new rows (apply gate, orphaned run recovery, run marker init, gate timestamp)
- workflow-guard: updated to reflect dual behavior (hard block + advisory)
- Run registry: added rebuildIndex, updated createRun/listRuns descriptions
- Fixed false worktree merge-back statement to match code truth

### OpenAI Codex investigation
- Codex CLI (Microsoft Store) is a standalone interactive agent, not an API endpoint — cannot be used as FORGE pipeline agent
- `forge_call_external` → OpenAI Responses API adapter verified working (auth + request format correct)
- Blocked on user's OpenAI API billing (429 quota error) — ready when billing is sorted
- `forge-config.default.json` model name `codex-mini-latest` is stale — needs update when API access confirmed

## [2026-04-12] Lifecycle Enforcement & Truthfulness Sweep

### Gate timestamp truthfulness
- `mcp/server.js`: `forge_set_gate(approved)` now preserves the original pending `createdAt` instead of overwriting with approval time
- Run registry sync uses run's existing `gateState.createdAt` instead of `run.createdAt`

### run-active.json initialization
- `mcp/server.js`: `forge_create_run` now writes `run-active.json` with `{ startedAt, runId, pipelineType, mode, feature, agents: [] }`
- Restores `workflow-guard.js` (`isPipelineActive`) and `forge-status.js` to functional state

### Orphaned run index recovery
- New `packages/forge-core/src/runs/rebuildIndex.js` — scans `r-*/run.json` files and reconstructs `index.json`
- `listRuns.js` calls `rebuildIndex` lazily when index is missing/empty but run directories exist
- Exported from `packages/forge-core/src/runs/index.js`

### /forge:debug lifecycle participation
- `skills/debug/SKILL.md` rewritten from 11-line prose to 38-line structured lifecycle skill
- Mandatory `forge_create_run` (pipelineType: "debug"), step tracking, explicit gate2 write

### /forge:refactor lifecycle participation
- `skills/refactor/SKILL.md` rewritten from 13-line prose to 40-line structured lifecycle skill
- Preserves mandatory `reviewer-style` inclusion for refactors

### Command-to-skill migration commit (fbc54f3)
- 17 old `commands/forge/*.md` deletions + 19 `skills/*/SKILL.md` additions committed
- Fixed runtime skill shadowing — Claude Code loader was reading stale committed commands

### /forge:init legacy cleanup
- `skills/init/SKILL.md` rewritten from 3-line prose to 28-line structured skill
- STEP 1 unconditionally removes stale `.claude/commands/forge/` before init-state check

### /forge:apply gate enforcement
- `skills/apply/SKILL.md`: STEP 1b prompt-level gate2 check (defense-in-depth)
- `hooks/workflow-guard.js`: structural gate2 enforcement — blocks source file writes during apply unless `gate-pending.json` shows gate2 approved (exit 2, hard block, unconditional)

### FORGE-REFERENCE.md regeneration
- Full 817-line regeneration from all source files (29 agents, 19 skills, 13 hooks, 22 MCP tools)

### Retroactive CHANGELOG entry
- Documented the prior session's uncommitted work (commands→skills migration, MCP server, forge-core, hooks, templates)

## [2026-04-12] Worktree Enforcement, Apply Routing, Implementation-Architect Agent

### Worktree auto-creation at Gate #2
- `hooks/gate-sync.js` now auto-creates a worktree when gate2 pending fires for an implement run with no worktree
- Copies coder's handoff.md into the worktree automatically (via existing `createWorktree` docs/ copy)
- Non-fatal on failure — logs and continues without blocking the pipeline
- Tests 8-9 added to `hooks/gate-sync-test.js`

### Apply-phase worktree context injection
- New `hooks/apply-context-inject.js` — SubagentStart hook for implementer/documenter agents
- Finds most recent implement run with a worktree, injects `additionalContext` with worktree path
- Verifies worktree directory exists on disk before injecting (stale path protection)
- Falls back silently when no worktree exists (SPRINT/DIRECT mode)
- 6 test cases in `hooks/apply-context-inject-test.js`

### Implementation-architect agent
- New `agents/implementation-architect.md` — conditional specialist that narrows broad plans to the next smallest safe slice
- Writes `docs/context/slice-brief.md` with in-scope, out-of-scope, dependency order, success criteria
- Hard constraints: max 5 files per slice, system must work after each slice, shared state changes isolated
- NOT always-on — only invoked when plan is large, cross-cutting, or migration-heavy

### Implement skill routing
- `skills/implement/SKILL.md` Step 2b added — three-condition checklist (8+ tasks, 3+ directories, risky keywords) conditionally invokes implementation-architect before coder
- Coder (`agents/coder.md`) now reads `slice-brief.md` when present and scopes to its in-scope items

### Documentation
- `CLAUDE.md` updated with implementation-architect in contextual agents table and pipeline types table

## [2026-04-12] Commands → Skills Migration + MCP Server + forge-core Package (retroactive)

*End-of-session was missed for this work. Retroactive entry based on diff.*

### Commands → Skills migration
- All 16 slash commands deleted from `commands/forge/` (apply, approve, chat, config, dashboard, debug, discard, health, ideate, implement, init, plan, planned, refactor, refresh, status, todo)
- Replaced by 18 proper skill definitions under `skills/*/SKILL.md` — same functionality, new structure with YAML frontmatter (name, description, argument-hint, context, allowed-tools, model)
- New `skills/overview/SKILL.md` and `skills/chat/SKILL.md` added
- Only `commands/forge/hello.md` retained (test command)

### MCP server creation
- `mcp/server.js` — full MCP server with 17 registered tools (forge_ prefix, Zod schemas)
- `mcp/server-minimal.js` — lightweight fallback
- `mcp/lib/config-store.js` — forge-config.json read/write with plugin data dir resolution
- `mcp/lib/router.js` — pure model recommendation function
- `mcp/lib/openai-adapter.js` — OpenAI Responses API adapter for multi-engine routing
- `mcp/lib/usage-store.js` — per-provider usage tracking (request count, tokens, quota)
- `mcp/package.json` — ESM package, separate from plugin root CommonJS
- `.mcp.json` — declares server for Claude Code auto-start

### forge-core package
- `packages/forge-core/src/runs/` — run registry with Zod-validated schemas
- createRun, getRun, listRuns, updateRun, createWorktree — full CRUD for pipeline runs
- schemas.js — single source of truth for Run, RunStatus, GateState, RunAgent, RunIndex
- storage.js — JSON read/write helpers with directory creation
- Smoke tests for both runs and worktree creation

### Script relocation
- `forge-status.js` moved from root to `bin/forge-status.js`
- `forge-worktree.js` moved from root to `bin/forge-worktree.js`

### Plugin manifest
- Version bumped 0.1.0 → 0.2.0
- Added repository, license (MIT), keywords fields

### Agent updates
- All 27 agents modified: updated descriptions, model fields, maxTurns, effort values
- Planner: added wave assignment, approach summary, tier signals, module assignment
- Coder: added scout.json enforcement, revision mode, pre-flight checklist
- Reviewer-triage: added triage-excerpts output directory
- Implementer-triage: expanded wave-aware dispatch
- Documenter: expanded solution capture, module wiring, todo closure logic

### New hooks
- `hooks/bash-guard.js` — PreToolUse hook blocking dangerous bash commands
- `hooks/ctx-stop.js` — Stop hook for advisory pipeline checks (incomplete agents, pending gates, unapplied handoffs)
- `hooks/ctx-post-compact.js` — PostCompact hook for context reinjection after compression
- `hooks/gate-sync.js` — PostToolUse hook syncing gate file writes to run registry

### Template cleanup
- Stripped Electron/Svelte-specific gotchas from `templates/code/docs/gotchas/`
- Deleted `skills/electron-ipc.md`, `skills/electron-security.md`, `skills/svelte5-components.md`, `skills/svelte5-reactivity.md` from code template
- Updated SKILLS.md in code template to be stack-agnostic
- Updated tool-call-auditor and workflow-guard hooks across all templates

### Research docs
- 10 new research docs under `docs/RESEARCH/`: enforcement patterns, model routing, MCP server scaffold, subagent hooks, plugin directory hooks, approval enforcement, compound distribution, GSD distribution, context reinjection

### Configuration
- `forge-config.default.json` — default model routing config (Anthropic + placeholder external providers)
- `forge-rules.md` — 35-line curated rules for PostCompact reinjection

### Board
- `.pipeline/board.json` expanded significantly with new TODO/PLANNED items from all pipeline work

## [2026-04-11] Hello World Slash Command

- Added `/forge:hello` test command that responds with "Hello, World!"
- Demonstrates minimal slash command structure for plugin testing

## [2026-04-11] Session Summary: 13 Features + 3 Enforcement Mechanisms + 9 Ideator Fixes

**Massive buildout day:** Model routing layer (MCP 6 tools + 4 lib modules), subagent lifecycle hooks, worktree scripts reorganized, all 28 agents upgraded (maxTurns, effort, descriptions), blockedBy task support, test execution in apply, git integration, bash guard enforcement, context reinjection on compaction, stop hook for advisory checks, and 9 targeted ideator fixes. Plugin now has 17 MCP tools, 7 hook event types, 28 fully-described agents, and framework for multi-model routing. See below for detailed entries per feature.

---

## [2026-04-11] Git Integration for Apply Pipeline

- **Opt-in git workflow** in `/forge:apply`: branch creation before implementer, auto-commit after tests, auto-PR after documenter. All gated by `gitIntegration` config in project.json.
- **Safety first:** all git steps log and continue on failure, never block. Forbidden: force push, amend, no-verify, reset, clean, stash.
- **Slug sanitization:** feature name → lowercase, hyphens, stripped unsafe chars, 50-char cap.
- **PR via gh CLI:** checks gh is installed, pushes branch first, skips gracefully if anything fails.
- **Documented** in GENERAL.md with config shape and defaults.
- **LEAN pipeline** with reviewer + reviewer-logic. 3 reviewer warnings addressed in implementation.

## [2026-04-11] Stop Hook — Advisory Pipeline Checks

- **Stop hook `hooks/ctx-stop.js`** — fires when Claude finishes responding. Checks 3 conditions: incomplete pipeline agents, pending gate, unapplied handoff. Outputs advisory reminder via additionalContext. Never blocks (exit 0 always).
- **30-minute staleness guard** on all checks — prevents perpetual false positives from abandoned runs or old handoff content.
- **hooks.json updated** with Stop entry.

## [2026-04-11] Context Reinjection on Compaction

- **PostCompact hook `hooks/ctx-post-compact.js`** — fires after mid-session context compression, re-injects critical FORGE rules via `additionalContext` stdout JSON.
- **`forge-rules.md`** — 35-line curated rules file: tool selection, approach-first, pipeline mode, gate approval, token conservation. Only unbreakable laws.
- **hooks.json updated** with PostCompact entry. Degrades gracefully if CLAUDE_PLUGIN_ROOT not set.

## [2026-04-11] Bash Guard Hook — First Enforcement Law

- **PreToolUse hook `hooks/bash-guard.js`** — blocks Bash commands that should use dedicated tools. Blocks: cat/head/tail (→Read), grep/rg (→Grep), find/ls (→Glob), sed/awk (→Edit), wc (→Read), echo with redirect (→Write). Allows: git, npm, node, process ops.
- **Exit code 2 enforcement** — agent must re-plan, cannot bypass. Stderr message tells which tool to use.
- **hooks.json updated** with PreToolUse Bash matcher.
- Inspired by GSD and Disciplined Process Plugin enforcement patterns (docs/RESEARCH/enforcement-patterns.md).

## [2026-04-11] Test Execution in Apply Pipeline

- **Opt-in test execution** after implementer in `/forge:apply`. Set `testCommand` in `.pipeline/project.json` (e.g. `"npm test"`). 60s timeout, emits `[suggest] debug` on failure — never auto-fixes.
- **`testCommand` added to `forge_update_config` allowlist** — configurable via MCP tool.
- **Duplicate board entry removed** from planned array.

## [2026-04-11] blockedBy Support for Board Tasks

- **New MCP tool `forge_set_blocked_by`** — set/clear blockedBy array on any board task, validates blocker IDs exist.
- **Extended `forge_read_board`** — new `blocked` filter (blocked/unblocked/all). MCP server now has 17 tools.
- **[task-block] signal** documented in GENERAL.md signal table.
- **Status skill** updated to show blocked task count.

## [2026-04-11] Agent Description Quality

- **Rewrote all 28 agent descriptions** with concrete trigger examples. Each description now has "Use when:" with 2-4 scenarios so Claude Code can better match agents to tasks. Descriptions quoted in YAML (contain colons).

## [2026-04-11] Agent Frontmatter Upgrade

- **Added `maxTurns` and `effort` to all 28 agents.** Three tiers: light (5 turns, low effort — triage/scout agents), medium (10 turns, medium — reviewers/utility), heavy (25 turns, high — coder/planner/implementer/researcher).

## [2026-04-11] Worktree Scripts to bin/

- **Moved** `forge-worktree.js` and `forge-status.js` to `bin/`. Both have `#!/usr/bin/env node` shebangs.
- **Updated references** in CLAUDE.md, ARCHITECTURE.md, GENERAL.md, modules.json.

## [2026-04-11] SubagentStart/SubagentStop Hooks

- **Subagent lifecycle tracking:** Two new hook scripts (`hooks/subagent-start.js`, `hooks/subagent-stop.js`) fire on Claude Code's SubagentStart/SubagentStop events. Track agent_id, agent_type, startedAt, completedAt, durationMs, and outcome in `.pipeline/run-active.json`.
- **Reviewer verdict extraction:** SubagentStop hook scans `last_assistant_message` for `[reviewer-verdict]` signals and extracts the verdict (APPROVED/BLOCK/REVISE) as the outcome.
- **hooks.json updated:** SubagentStart and SubagentStop entries added with `"matcher": "*"` to capture all subagents.
- **LEAN pipeline:** Plan + reviewer, no safety concerns (local file writes only).

## [2026-04-11] Intelligent Model Routing

- **Model routing layer added:** 4 new ESM lib modules in `mcp/lib/` — config-store (config resolution with CLAUDE_PLUGIN_DATA primary, .pipeline fallback), usage-store (per-project quota tracking), router (pure function recommendation engine with 4-priority fallback chain), openai-adapter (OpenAI Responses API via built-in fetch).
- **6 new MCP tools:** `forge_get_model_recommendation`, `forge_call_external`, `forge_read_usage`, `forge_reset_usage`, `forge_update_agent_model`, `forge_list_models`. MCP server now has 16 tools total.
- **forge-config.default.json:** Default config template with Anthropic + OpenAI providers, 4 model catalog entries, all 28 agents mapped with preferred/fallback models and required capabilities.
- **Config bootstrap hook:** SessionStart hook copies default config to CLAUDE_PLUGIN_DATA on first session.
- **OpenAI Codex integration:** External provider adapter for `codex-mini-latest` via `/v1/responses` endpoint. Budget-driven model selection (economy/standard/performance as soft preference). Quota exhaustion detection on 401/429 responses.
- **Full STANDARD pipeline:** Plan with researcher + gotcha-checker, 5 reviewers (FULL mode), coder, implementer.

## [2026-04-11] Electron Strip + Skills Migration + MCP Server

- **Electron strip complete:** 22 agents, 2 commands, 7 templates cleaned of all IPC/Svelte/Electron references. 4 Electron-specific skill files deleted. Banner hook fixed to detect .pipeline/ instead of .forge.
- **Skills migration:** 17 commands migrated from commands/forge/*.md to skills/<name>/SKILL.md. 8 pipeline skills use context: fork (92% token savings). commands/ directory removed. Plugin v0.2.0.
- **MCP server built:** Full STANDARD pipeline (plan→research→review→implement→apply). 5 tools: forge_read_board, forge_add_todo, forge_update_task, forge_read_project, forge_update_config. ESM server at mcp/server.js with Zod schemas and isError pattern. SessionStart hook for dependency installation.
- **Board rebuilt:** 55 open tasks. Added GSD-inspired items (cost tracking, stuck detection, atomic commits, crash recovery). Split parallel-sessions into 7 sub-tasks. 28 items tagged needs-detail for post-restructure fleshing out.
- **Research:** Claude Code native features, Compound Engineering, GSD architecture, real plugin examples, MCP SDK patterns.

## [2026-04-10] Plugin Identity Overhaul — Docs, Board, Architecture

- **CLAUDE.md rewritten:** Replaced Electron app description with plugin structure, file locations, pipeline type/mode tables, signal protocol, and session protocol.
- **GENERAL.md rewritten:** Replaced Electron/Svelte/IPC rules with Node.js hooks, markdown agents, JSON config, hook stdin/stdout protocol, and plugin-specific gotchas.
- **project.json updated:** Tech stacks changed from Electron/Svelte/TypeScript to Node.js/Markdown/JSON.
- **board.json cleaned:** Removed ~88 dead items (Electron UI, superseded by plugin migration, covered by MCP pin). Kept ~50 plugin-relevant items.
- **ARCHITECTURE.md rewritten:** Module map now reflects actual plugin layout (agents, commands, hooks, worktree, status line).
- **modules.json rewritten:** Module definitions reference plugin files instead of Electron source.
- **End-session notes recovered:** Plugin work changelog entries moved from Forge app to forge-plugin where they belong.

## [2026-04-10] Plugin Restructure + Strategic Architecture

- **Plugin restructured to correct format:** Moved agents from `.claude/agents/` to `agents/` (root), hooks to `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` paths, added `.claude-plugin/plugin.json` manifest. Deleted old `.claude/` directory.
- **Agent frontmatter fixed:** 6 agents had broken YAML (unquoted colons in descriptions). Fixed: agent-optimizer, architect, ideator, integrity-checker, skills-generator, tool-call-auditor.
- **plugin.json author fixed:** Changed from string to object (`{ "name": "FORGE" }`) per validator.
- **MCP multi-engine architecture pinned:** Local MCP server in plugin for multi-model agent routing. Provider adapters route to Anthropic/OpenAI/Google. Config via `forge-config.json` per project. Pinned for later implementation.
- **Distribution strategy:** Plugin marketplace with local path source. Install script clones repo, registers as marketplace, installs plugin. Team updates via `claude plugin update forge`.

## [2026-04-08] Plugin Testing, Multi-Session Design, Knowledge Enforcement

- **Plugin testing complete:** FORGE plugin ran full pipeline on Diesel priser successfully; fixed brainstormer routing, planner Q&A remnants, and gate-pending flow.
- **Parallel sessions system (Phase 1-3):** `/forge:chat` multi-session orchestrator detects new tasks and spawns background sessions; `forge-worktree.js` manages session lifecycle; `forge-status.js` displays progress and session indicators; `/forge:dashboard` on-demand view.
- **Knowledge enforcement:** Reviewer and reviewer-logic agents now search `docs/solutions/` before reviewing, blocking on known anti-patterns with citations. Documenter Step 8c prints a knowledge-captured box on completion.

## [2026-04-08] Plugin Phase 1 Complete + New Agents

- **FORGE plugin Phase 1 complete:** 15 commands, 26 agents; Windows colon-in-filename fixed via folder-based namespacing; install.bat and update.bat scripts added.
- **Ideator and Compound-Refresh agents (NEW):** Ideator performs adversarial codebase analysis (5 lenses: fragility, missing capabilities, tech debt, security, UX gaps), emits `[todo]` signals. Compound-Refresh maintains knowledge store (archives stale solution docs). Both backed by user-facing commands `/ideate` and `/refresh`.
- **Agent boundary tightening:** Architect now emits `[health]` only (documents); ideator challenges (emits `[todo]`). Clear task separation. Debug agent added Step 0.5 history search (solutions, signal-log, audit-log).

## [2026-04-08] FORGE Plugin v0.1 Built

- **Claude Code plugin skeleton:** 12 slash commands (chat, plan, implement, apply, debug, refactor, status, config, todo, approve, discard, init), 26 agents, 4 hooks, 6 project templates.
- **Plugin manifest and command routing:** Commands dispatch via `.claude-plugin/plugin.json`; ready for testing on active projects.
- **Windows compatibility fix:** Resolved colon-in-filename issue using folder-based namespacing instead.
