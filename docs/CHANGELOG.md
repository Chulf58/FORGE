## [2026-04-20] Wire model routing end-to-end

- Added `extractFamily()` function to `mcp/lib/router.js` to derive short family names (sonnet/opus/haiku) from Anthropic model IDs
- Extended `recommendModel()` to return a `family` field in all three code paths (capability-cost success, error, and default fallback)
- Updated 5 skill files (apply, implement, debug, plan, refactor) to dispatch Anthropic agents with `model=<family>` instead of full `modelId`
- Extended null fallback in skill files to cover both MCP unavailability and `family === null` cases

---

## [2026-04-19] Rename templates/ to scaffolds/

- Renamed `templates/` directory to `scaffolds/` throughout the plugin
- Updated all references in documentation, agent definitions, hooks, and configuration files
- Improves terminology consistency: "scaffolds" more accurately describes project initialization templates

---

## [2026-04-19] Add gitIntegration to ALLOWED_CONFIG_KEYS

- Expanded `forge_update_config` to accept `gitIntegration` configuration objects
- Added `"gitIntegration"` to `ALLOWED_CONFIG_KEYS` array in `mcp/server.js`

---

## [2026-04-19] Hello World slash command

- Added `/forge:hello` slash command that responds with "Hello, World!"
- Command file: `commands/forge/hello.md`

---

## [2026-04-19] Fix forge-worktree.js pre-merge dirty-check to exclude pipeline artifacts

- Updated pre-merge dirty-file detection in `bin/forge-worktree.js` to filter `.worktrees/` and `.pipeline/` entries before blocking merges
- Prevents false merge blocks when pipeline state files exist in main repo (normal during concurrent pipeline runs)
- Dirty-check now reports only user-modified sources, making merge hygiene rules actionable

---

## [2026-04-19] LEAN-lite gate for debug and refactor pipelines

- Ported LEAN-lite reviewer-skip gate from implement skill to debug and refactor skills — gates operate post-debug-agent and post-refactor-agent respectively
- For refactor, `reviewer-style` always runs even when gate skips other reviewers (style consistency required for refactors)
- Updated `CLAUDE.md` to document the expanded scope and note plan pipeline deferral for future adaptation

---

## [2026-04-19] Stuck-loop detection in subagent dispatch

- Added stuck-loop detection to `hooks/subagent-start.js` — warns on 2nd dispatch of same agent type within a run, blocks on 3rd+ with exit(2)
- Prevents runaway retry loops from burning tokens when agents fail to progress
- Detection is by `agent_type` (e.g., `coder`, `reviewer-safety`), counting only prior dispatches before the new entry is recorded

---

## [2026-04-19] Worktree merge conflict handling

- Added pre-merge dirty-check to `merge()` in `bin/forge-worktree.js` — rejects the merge with a structured JSON error if the main repo has uncommitted changes, listing the dirty files
- Implemented two-pass merge strategy: pass 1 attempts a plain `git merge`; on conflict, collects conflicting file names, aborts, then retries with `-X theirs` (worktree-side precedence) as pass 2
- On successful auto-resolve, the JSON result now includes `autoResolved: true` and `strategy: "theirs"`; on total failure, `conflictFiles` is surfaced in both the error output and `run.json`

---

## [2026-04-19] Enforcement hardening — 8 hook & MCP findings fixed

- **workflow-guard.js:** `isPipelineActive()` now checks run registry terminal status instead of wall-clock age; advisory path (`includeAgents: false`) separates from apply-gate enforcement path (agents are now gated on apply)
- **routing-enforcement.js:** Replaced hardcoded `PIPELINE_AGENTS` Set with dynamic agent scan from `agents/*.md`; enforces on all agents when scan fails (fail-open direction)
- **approval-token.js:** Keyword detection now uses word-boundary regex (`\b...\b`) instead of substring indexOf; eliminates false positives from "pushback", "recommit", "commitment"
- **gate-enforcement.js:** TRIVIAL/SPRINT bypass now reads `mode` from `run-active.json` first, falls back to project.json `pipelineMode`
- **lean-risk-classify.mjs:** `extractFilePaths()` extended with 3 supplementary patterns (level-4 headings, bold paths, list items); results deduplicated with Set
- **config-store.js:** Cache now validates mtime on each hit; external edits (hand-editing, bootstrap hook) are detected and trigger re-read; `statSync` per cache hit is cheap
- **mcp/server.js:** 401/403 auth errors no longer call `markQuotaExhausted`; only 429/quota marks provider exhausted; auth errors return immediately with descriptive message

---

## [2026-04-19] Git guard and approval-token for bash-guard

- Added hard-block for destructive git operations (`--force`, `--no-verify`, `--amend`, `reset --hard`, etc.) — no override possible
- Added soft-block for `git commit` and `git push` unless an active pipeline run or user approval token is present
- Implemented `hooks/approval-token.js` to scan user messages for git keywords and write 120-second approval tokens
- Updated `hooks/bash-guard.js` with git guard logic: hard-block patterns, soft-block subcommands, token/pipeline run checks
- Extended `docs/gotchas/GENERAL.md` with Git guard section documenting both tiers and the approval-token mechanism

---

## [2026-04-19] refactor(reviewer): fix boundary prompt — align plan-stage detection and skip gate

- Replaced fragile string-match plan-stage condition with clean `[plan-stage review]` marker check (matching sibling reviewers)
- Added skip gate for source-file reads: boundary now skips when only prompt/template/docs/config files are modified
- Fixes silent exhaustion of `maxTurns` budget during plan reviews and unnecessary file reads on docs-only refactors

---

## [2026-04-19] fix(hooks): stale run-active.json pointer pollution

### Motivation
Two gaps caused `run-active.json` to persist stale content after a pipeline run finished:
1. `hooks/subagent-start.js` would append to the `agents` array of a terminal run (status `completed`/`failed`/`discarded`), re-animating it and setting a fresh `currentUnit`.
2. `hooks/ctx-session-start.js` cleared `currentUnit` by null-writing back to disk rather than deleting the file, leaving a zero-identity stub that passes the missing-file guard in `subagent-start.js`.

### Fix
- **`hooks/subagent-start.js`** — added `TERMINAL_STATUSES` and `readRunStatus` helper (identical logic to the existing copy in `ctx-session-start.js`). Inserted a terminal-run guard between the `isForgeAgent` check and the agents-push: if the run referenced by `run-active.json` is terminal, the hook logs a stderr note and exits without writing. Fail-open: unreadable or missing registry → proceed as before.
- **`hooks/ctx-session-start.js`** — in `emitStaleUnitNoticeIfAny`, replaced the `writeFileSync` (null-write) in the terminal branch with `fs.unlinkSync(runActivePath)`. The surrounding try/catch is kept; failure falls through silently.

### Rationale: deletion over null-write
Deleting the file is the correct teardown: (a) `subagent-start.js` already exits silently when the file is absent (lines 74-81), so absence is a safe terminal state; (b) null-writing preserves the `runId` identity field, allowing `subagent-start.js` to read and re-append to a finished run on the next agent dispatch.

### Files changed
- `hooks/subagent-start.js` — added helper + terminal-run guard
- `hooks/ctx-session-start.js` — delete-on-terminal in `emitStaleUnitNoticeIfAny`
- `docs/gotchas/GENERAL.md` — added `## run-active.json lifecycle contract` section

---

## [2026-04-18] gate-enforcement: mechanical gate backstop for coder/implementer dispatch

### Motivation
On 2026-04-18, the main conversational Claude collapsed Gate #2 on two live slices
(observer-launcher, forge-config-migration) — reviewer verdicts and implementer dispatch
happened in the same turn with no human-in-loop pause. Memory entry `feedback_gate_approval.md`
was updated with stronger framing, but the user requested mechanical enforcement.

### Mechanism
- New `hooks/gate-enforcement.js` (PreToolUse, matches "Agent") blocks Agent dispatches for
  `coder` (requires gate1 approved) and `implementer` (requires gate2 approved).
- Reads `.pipeline/gate-pending.json`; blocks on missing file, wrong gate stage, or non-approved status.
- Bypasses enforcement for `pipelineMode: TRIVIAL` and `SPRINT` (no gates in those modes).
- Fails open on stdin parse errors; fails open on malformed project.json (unknown mode → enforce).
- All other subagent types pass through unconditionally.
- Registered in `hooks/hooks.json` as a second "Agent" PreToolUse matcher alongside `routing-enforcement.js`.

### Files changed
- `hooks/gate-enforcement.js` — new file (~130 lines)
- `hooks/hooks.json` — added gate-enforcement entry under PreToolUse → Agent
- `docs/gotchas/GENERAL.md` — added "Gate enforcement (mechanical, PreToolUse)" section

### Known limitation
The hook enforces existence of the approval record, not the discipline of presenting-and-waiting.
That behavioral guarantee remains in memory + agent prompts.

---

## [2026-04-18] forge-config-migration: diff-aware auto-migration on SessionStart (Part A + Part B)

### Root cause (Part A — one-shot fix, already applied)
- `bootstrapForgeConfig()` in `hooks/mcp-deps-install.js` had `if (existsSync(targetPath)) return;` which blocked all updates after first session.
- Live config had retired `gemini-2.0-flash`, was missing 5 newer Gemini models, and had legacy `preferred`/`fallback` entries in `agentModelMap` instead of the current `requiredCapabilities`-only shape.
- Router silently routed to stale/suboptimal models because the live catalog was out of date.
- Part A: one-shot manual overwrite of the live config with the current default to unblock routing immediately.

### Mechanism (Part B — this slice)
- Added `"schemaVersion": 1` as the first top-level key in `forge-config.default.json`.
- Added `migrateForgeConfig(pluginRoot)` to `hooks/mcp-deps-install.js`; called from `main()` immediately after `bootstrapForgeConfig()`.
- On every SessionStart: reads both configs, compares `schemaVersion`, and if they differ performs a diff-merge:
  - **Providers**: updates `name`/`type`/`notes`/`priority` from default; preserves `enabled`/`envVar` from live; preserves user-added providers.
  - **Models**: replaces all fields from default for known models; preserves user-added models.
  - **agentModelMap**: replaces entries entirely from default (drops legacy `preferred`/`fallback` shape, adopts `requiredCapabilities`/`allowedVendors` shape); preserves user-added agents.
  - **quotaTracking**: preserved from live if present, else taken from default.
  - **schemaVersion**: updated to default's value after merge.
- Writes a timestamped `.bak` file before overwriting the live config.
- Logs one-line `[forge-mcp-migration]` summary to stderr with add/remove/update counts per section.
- Fully fail-open: any error (I/O, JSON parse, backup failure) leaves the live config untouched.
- Idempotent: if `schemaVersion` already matches default's, exits silently with no I/O.

### Files changed
- `forge-config.default.json` — added `"schemaVersion": 1` as first key
- `hooks/mcp-deps-install.js` — added `migrateForgeConfig()` function (~130 lines) + one-line call in `main()`

### Not in this slice
- `mcp/lib/config-store.js` — migration is a hook-layer concern; config-store cache semantics unchanged
- `forge config migrate` CLI command — explicitly out of scope
- Tests — hooks are not unit-tested in this repo

## [2026-04-18] Anti-speculation Stage 1: UserPromptSubmit injection

### Files shipped
- `hooks/anti-speculation-inject.js` — NEW hook script (Node.js). Fires on UserPromptSubmit; injects a fixed ~100-token rule via `hookSpecificOutput.additionalContext` without dynamic data interpolation. Fully defensive error handling; exits 0 on all paths.
- `hooks/hooks.json` — EDIT. Registered new UserPromptSubmit section between SessionStart and PostToolUse. Now 7 hook event sections total.
- `CLAUDE.md` — EDIT. Prepended a new H1 anti-speculation block (5 lines) at file start, pushing existing `# FORGE Plugin — Project Instructions` down. Defensive placement: long CLAUDE.md files cause rules to be lost; top-of-file placement reinforces compliance.
- `~/.claude/projects/C--Users-cuj-forge-plugin/memory/feedback_no_speculative_tool_comparisons.md` — EDIT. Appended `## Incidents (2026-04-18)` section with two concrete live incidents as teaching examples: "parallel sessions fabrication" and "unverified cross-agent claim". (User-scope memory, not a repo file — path kept for traceability.)

### Context: mitigation not prevention
- Research confirmed no mechanical output filter exists in the Claude Code harness to prevent unsubstantiated claims. This is Stage 1 mitigation: continuous rule reinforcement via hook injection.
- Token cost: ~80-100 tokens per user turn, <0.5% of typical session context.
- Four remaining stages queued (Stage 2: NL-claim auditor extension; Stage 3: CLAUDE.md compaction; Stage 4: auditor-driven updates). Separate high-priority TODO `7158d0cf` surfaced during routing: stale `forge-config.json` catalog entries need reconciliation.

### Not in this slice
- `.pipeline/modules.json` — deliberately skipped (keyFiles is curated, not an exhaustive hook registry; registry drift is a separate concern).
- Mechanical claim filtering or output sanitization (belongs in Claude Code runtime, out of scope for plugin).
- Agent prompt changes or new agent categories (Stage 2+ territory).

## [2026-04-18] Observer launcher: bin/forge-observer.cmd shim

### Launcher shim for observer invocation
- `hooks/mcp-deps-install.js` SessionStart hook now generates `bin/forge-observer.cmd` on every session, with the absolute Node path baked in. Mirrors the existing pattern used for the MCP server launcher.
- `bin/forge-observer.cmd` seed file added to the repository so the shim works on a fresh clone before the hook fires. Falls back to bare `node` if the hook hasn't run yet (pre-generation).
- Windows batch shim accepts no arguments (observer runs with local `.pipeline/` state, no CLI args).
- User can now invoke the observer with one stable path: `bin/forge-observer.cmd` or bare `node scripts/forge-observer.mjs`. Manual: `cd` to the target project first so the observer reads the correct `.pipeline/` state.

### Documentation updates
- `docs/FORGE-REFERENCE.md` bin scripts table updated with new `bin/forge-observer.cmd` row.
- `scripts/forge-observer.mjs` entry extended with "How to launch" note: use `bin/forge-observer.cmd` (Windows) or `node scripts/forge-observer.mjs` directly (cross-platform).
- Observer is still the primary TUI dashboard surface; no changes to observer functionality or UI.

### Not in this slice
- `wt.exe` auto-split terminal window (separate task `95aeb42f`, future slice).
- PATH modification or shell alias generation (out of scope for this phase).
- Deprecation of existing `bin/forge.cmd` launcher (unchanged, backwards-compatible).

## [2026-04-18] Session-scoped quota state: stale quotaExhausted flags no longer poison routing

### Root cause
- Router's `isModelQuotaExhausted` checked provider-level `quotaExhausted` flag even when per-model flags were false. One 429 error in any session marked the provider exhausted; `resetAt` was written as `null` and never consulted. Quota state never auto-cleared, permanently disabling the provider across every future session.

### Fix
- New SessionStart hook `hooks/usage-clear-quota-flags.js` clears every `providers[*].quotaExhausted` and `providers[*].models[*].quotaExhausted` flag in `.pipeline/usage.json` at each session start. Session-scopes quota exhaustion state.
- `hooks/hooks.json` updated to register the new hook (now 5 SessionStart hooks total).
- Write is conditional on at least one flag actually changing, so `updatedAt` timestamp doesn't drift on no-op sessions.
- Counters (`requestCount`, `tokenCount`, `lastUsed`, `resetAt`) are fully preserved — no data loss.

### Verification
- Hook tested locally; Gemini provider-level `quotaExhausted` flag flipped from `true` to `false` on session start, unblocking free-tier Gemini Flash routing.
- Usage history counters remain intact; only exhaustion state cleared.
- Bug discovered live when routing fell back to Anthropic haiku for a research task where free-tier Gemini was actually available.

## [2026-04-18] Observer promoted to Ink; blessed prototype retired; reviewer rename closed

### Observer: Ink primary, blessed retired
- Promoted `scripts/forge-observer-ink-spike.mjs` → `scripts/forge-observer.mjs` as the primary terminal dashboard surface. Smoke test follows (`scripts/forge-observer-smoke-test.mjs`). Log prefix `[forge-observer-ink-spike]` collapsed to `[forge-observer]`. Header comment reframed from evaluation spike to primary observer; mouse-experiment language dropped (any left-click refreshes; `Shift`+click-drag remains the user-side selection gesture).
- Deleted blessed prototype + its smoke test: `scripts/forge-observer-proto.mjs`, `scripts/forge-observer-proto-smoke-test.mjs`. Two-codebase drift tax removed; future TUI feature work (clickable gates, token usage, specs panel, signal timeline) lands in Ink only.
- Repointed doc references in `docs/FORGE-OVERVIEW.md` (observer section) and `docs/FORGE-REFERENCE.md` (scripts table). `docs/DECISIONS.md` unchanged — the 2026-04-15 observer-primary pivot stands.

### Reviewer rename (1b92130b — closed in two waves)
- **Wave 1 (session 1, on-disk):** `bin/forge-status.js` — replaced 4 stale `'reviewer'` step-map keys with `'reviewer-boundary'` to match the other specialist reviewers and the existing convention in `mcp/lib/dashboard-state.js`. Agent file `agents/reviewer.md` was already gone; `agents/reviewer-boundary.md` was already present. All live skills, hooks, agents, and configs grep-clean for bare `reviewer` — `bin/forge-status.js` was the last on-disk straggler. The first catch-up reviewer attempt this session failed: Claude Code's live agent registry still advertised `forge:reviewer` because the plugin registry was loaded at session-start before the rename.
- **Wave 2 (session 2, registry refresh + catch-up review):** Session restart forced a fresh plugin/agent registry read. `forge:reviewer-boundary` now present; `forge:reviewer` gone. Re-dispatched reviewer-safety + reviewer-boundary on the Slice A diff — both APPROVED with zero blockers and zero warnings. Task 1b92130b closed.

## [2026-04-18] Vendor-agnostic capability-cost routing + model management

### Router redesign
- `d401a12` Removed the invented `tool-use` capability — it was a fake routing flag used as a proxy for Anthropic-only. Execution mechanics belong in the skill layer, not the routing config.
- `5442635` Default provider scope switched from `['anthropic']` to all enabled providers. `allowedVendors` is now an explicit force-override (e.g. supervisor → openai) rather than an "override-the-Anthropic-default" mechanism.
- `e5ae8c9` Sort rule: fewest total capabilities primary, cheapest cost tier secondary, alphabetical id tertiary. A task requiring `[analysis]` can never land on a model that also carries reasoning + agentic just because they share a cost tier. Over-capable free-tier models are reached only as a last resort.
- `9498b2f` Module-level config cache in `mcp/lib/config-store.js`. Routing config loads once per session; `writeForgeConfig` invalidates automatically. New `invalidateConfigCache()` export.
- `aca711b` Per-model quota tracking in `usage-store.js`. `markModelQuotaExhausted(projectDir, providerId, modelId)` + `isModelQuotaExhausted(usage, providerId, modelId)`. One exhausted model no longer poisons sibling models on the same provider (e.g. `gemini-2.5-pro` 429 no longer blocks `gemini-2.5-flash`). Old-format usage.json still respected for backward compat.
- `fe4c822` Removed deprecated `gemini-2.0-flash` from the catalog — its quota was 0 and alphabetical tiebreak was silently selecting it first.
- `f4aa3d2` Added `pricing: { input, output, cached }` (USD per 1M tokens) to every model in the catalog. Metadata-only for now; router still sorts by `costTier` bucket.

### Enforcement + skill alignment
- `11a2cf3` All 5 pipeline skills (`plan`, `implement`, `debug`, `refactor`, `apply`) switched from optional to mandatory routing: call `forge_get_model_recommendation`, branch on `providerId`, use `Agent` for Anthropic or `forge_call_external` for non-Anthropic. Mirrors the supervisor skill's already-committed pattern.
- `35c1cf0` New PreToolUse hook `hooks/routing-enforcement.js` blocks Agent spawns for the 29 FORGE pipeline agents unless `forge_get_model_recommendation` was called in the current session. New `hooks/routing-log-clear.js` SessionStart hook clears the dispatch log so prior-session entries cannot authorize new-session spawns. MCP writes entries to `.pipeline/session-dispatch-log.json` on successful recommendations.
- `5549d10` Corrected the stale supervisor routing footnote in `skills/supervise/SKILL.md` — now accurately describes `allowedVendors: ["openai"]` as an intentional force-override with no silent Gemini fallback.

### Docs + verification
- `a7496c7` GENERAL.md aligned with vendor-agnostic routing model.
- `89eb80e` New credential-gated smoke test `mcp/dispatch-smoke-test.mjs`: exercises `researcher-triage` → Gemini Flash end-to-end with a real HTTP call. First proof of the non-Anthropic dispatch chain. Verified green today.

### Model management (operator-facing)
- `39e74c0` Two new MCP tools: `forge_add_model` and `forge_update_model`. Strict validation of capability allowlist, pricing shape, provider existence, id uniqueness. New `mcp/lib/model-validation.js` holds the pure validators and composite add/update helpers. 90 new assertions in `mcp/model-mgmt-test.mjs`.
- `29873ea` GENERAL.md documentation for the two tools: required vs optional fields, rejection list, worked examples for natural-language invocation.

### Test suite
- 156 → 246 tests. Zero failing. New suites: `mcp/usage-store-test.mjs` (23), `hooks/routing-enforcement-test.js` (14), `mcp/model-mgmt-test.mjs` (90). Existing router/adapter/hook tests unchanged.

### Live verification
- `mcp/dispatch-smoke-test.mjs` executed today against real Gemini endpoint: router picked `gemini-2.5-flash`, real HTTP call succeeded (1252 input / 135 output tokens), response contained parseable `[brief-for: N]` markers for both fixture questions. Mechanical dispatch chain is proven.

### Not done (flagged for future slices)
- `forge_remove_model` — deferred; deletion still requires hand-editing `config.models`.
- Live `/forge:plan` pipeline run — tests the skill-layer dispatch discipline, not just the mechanical chain. Ready when needed.
- Per-token pricing as router cost signal — currently `pricing` is metadata only; router still uses `costTier` bucket. Would let `gpt-4.1` ($10 blended) beat `claude-sonnet-4-6` ($18) in the same medium tier. Low-priority polish.

## [2026-04-17c] Knowledge integration layer complete

### Consumer agents wired to solutions store
- `agents/debug.md` Step 0.5: emits `[solution-hit] docs/solutions/<file>.md — <summary>` when match found; now also writes `[promote-gotcha]` flag when solution is universal
- `agents/researcher.md`: new Step 1 per-question checks `docs/solutions/` before any codebase/web search; emits `[solution-hit]`; writes `[promote-gotcha]` when universal
- `docs/gotchas/GENERAL.md`: `[solution-hit]` and `[promote-gotcha]` signals documented in protocol table

### compound-refresh promotion candidates
- `agents/compound-refresh.md`: scans `docs/RESEARCH/` and `docs/context/` for `[solution-hit]` frequency (2+ hits = candidate); scans `docs/solutions/` for explicit `[promote-gotcha]` flags; reports `[promote?]` section in every run; never auto-promotes
- Smoke tested: all three grep paths verified manually with real solution file and mock signals

### First solution doc
- `docs/solutions/openai-responses-api-token-fields.md`: OpenAI Responses API uses `input_tokens`/`output_tokens` not `prompt_tokens`/`completion_tokens`; includes `[promote-gotcha]` as example

## [2026-04-17b] Multi-vendor model routing complete

### Tier-locked multi-vendor router
- All 11 models now carry `reasoningTier: "haiku"|"sonnet"|"opus"` and providers carry `priority` (openai:1, gemini:2, anthropic:3).
- `agentModelMap` entries support `allowedTiers` (ordered whitelist — hard constraint, no silent escalation or degradation) and `allowedVendors` (restricts external routing).
- Router extended: tier preference beats provider priority; provider priority tiebreaks within same tier; config errors surfaced explicitly when preferred/fallback violates `allowedTiers`; legacy `requiredCapabilities` path preserved.
- `gpt-5.4` (opus) and `gpt-4.1` (sonnet) added to model catalog.
- Supervisor entry migrated: `preferred: "gpt-5.4"`, `fallback: "gemini-2.5-flash"`, `allowedTiers: ["opus", "sonnet"]`, `allowedVendors: ["openai", "gemini"]`. OpenAI stays `enabled: false` until API key is set; router falls back to Gemini automatically.

### OpenAI adapter hardened
- `reasoningEffort` option added; forwarded as `reasoning: { effort }` only when explicitly set — backward-compatible.
- 429 retry: honors `Retry-After` header; falls back to 10s fixed delay when absent; retries once if delay ≤ 60s.
- Token field bug fixed: `prompt_tokens`/`completion_tokens` → `input_tokens`/`output_tokens` (Responses API field names).
- `reasoningTokens` exposed in return value from `output_tokens_details.reasoning_tokens`.
- `forge_call_external` MCP tool now accepts optional `reasoningEffort` and passes it through to OpenAI.

### Supervise skill de-hardcoded
- `/forge:supervise` now calls `forge_get_model_recommendation` for the `supervisor` agent and dispatches to whatever provider/model the router returns.
- Surfaces routing errors explicitly if no valid model is found within `allowedTiers`.
- Prefix in rendered brief now shows the actual model used (e.g. `Supervisor brief (via gpt-5.4):`).
- `reasoningEffort: "medium"` passed to all calls; meaningful for OpenAI, ignored by Gemini.

### README updated
- Added "Your first feature" walkthrough section (full plan→approve→implement→approve→apply cycle).
- Added "How it runs" section (trust/transparency: agents, hooks, MCP server, local-only state, routing tracks).

## [2026-04-17] Supervisor fallback concept abandoned

### Supervisor is flash-only
- `gemini-2.5-flash-lite` quality proven insufficient for supervisor reasoning during a live design brief — output was shallow, generic, and invented a nonexistent `mcp/lib/search_solutions.js` module instead of using plain `Grep`. Confirms prior characterization of flash-lite as Haiku-tier.
- Removed "fallback when 2.5-flash quota runs out" wording from `gemini-2.5-flash-lite` notes in `forge-config.default.json`; now explicitly marked NOT for supervisor.
- Removed "secondary fallback" wording from `gemini-3.1-flash-lite-preview` notes; now explicitly marked NOT for supervisor.
- Both models remain catalogued for other possible uses (classification, smoke tests) — the fallback *semantics* are gone, not the models.
- Runtime behavior: on 503 from `gemini-2.5-flash`, surface the error and stop. Do not silently degrade to a smaller model.

## [2026-04-16c] Gemini hardening, per-model tracking, Opus 4.7

### Gemini adapter hardening
- Auto-retry on HTTP 503 with 2s delay in `mcp/lib/gemini-adapter.js` (commit `3ceb720`). Single retry, only on 503. Proven needed by repeated transient 503s during supervisor calls.

### Per-model token tracking
- `recordUsage()` in `mcp/lib/usage-store.js` now accepts optional `modelId` parameter. Tracks per-model `requestCount`, `tokenCount`, `lastUsed` within each provider entry (commit `6f7a8b6`). `forge_call_external` passes `modelId` to `recordUsage`.

### Claude Opus 4.7
- New Anthropic flagship (released 2026-04-16). Model ID `claude-opus-4-7`. Step-change in agentic coding, 1M context, Jan 2026 knowledge cutoff. Added to `forge-config.default.json`, all `agentModelMap` fallbacks updated from opus-4-6 to opus-4-7, supervisor prompt updated (commit `cbb84fc`).

### Board
- Added: `aee130ac` — tier-based model routing (agents declare haiku/sonnet/opus tier, router picks best model at runtime)

## [2026-04-16b] Multi-model supervisor smoke test and hardening

### Gemini model inventory
- Tested all text-capable Gemini models on free tier via `forge_call_external`. 3 working (`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite-preview`), rest quota-exhausted or unavailable. Added full inventory to `forge-config.default.json` (commit `3864c77`).
- Swapped supervisor preferred model from `gemini-2.0-flash` (deprecated/exhausted) to `gemini-2.5-flash`.
- Added missing `implementation-architect` to `agentModelMap`; removed `supervisor` (routes via Gemini, not frontmatter).

### Supervisor prompt hardening
- Added FORGE architecture ground-truth section to `agents/supervisor.md`: file paths, agent model constraints, Anthropic vs external provider tracks. Eliminates hallucinated paths and impossible proposals from earlier briefs.
- Strengthened per-response review: mandatory adversarial **Challenges** field, checks for unrequested changes, verification validity, silent side effects. Tested — supervisor caught incomplete RESULT reporting on first adversarial pass.

### Supervisor loop validated
- End-to-end loop working: collect project state → call Gemini via `forge_call_external` → render brief → user approves → dev Claude executes → feed result back for adversarial review.
- Confirmed 503 errors are transient Google-side overload (not quota) — `gemini-2.5-flash-lite` available as fallback.

## [2026-04-16] Observer-Primary Architecture; Ink Spike; Launcher; Option A+B

### Architecture pivot: observer-primary
- Observer becomes the primary FORGE TUI surface; wrapper demoted to experimental (decision in `docs/DECISIONS.md` 2026-04-15 entry, commit `abe2664`). Verified pattern from `alex-radaev/claude-panel`: SessionStart hook calls `wt.exe -w 0 sp -V --size 0.35 -- <observer>` to auto-split the terminal. ~15-line hook vs ~500 lines of wrapper PTY/xterm/mouse complexity.
- New high-priority task `95aeb42f` queued: implement the `wt.exe` SessionStart hook for one-command UX.

### Ink spike (Phase 2 TUI library evaluation)
- `scripts/forge-observer-ink-spike.mjs`: Ink 5.2.1 + React 18.3.1 port of the observer, pure `React.createElement` (no JSX, no build step). Reactive model genuinely cleaner for polling dashboard — state drives render, no manual `setContent + screen.render`. Mouse experiment wired (SGR + manual stdin listener alongside Ink's `useInput`); live test needed (commit `349a8b9`).
- `docs/RESEARCH/tui-library-evaluation.md` Phase 2 verdict appended: go conditional on live mouse test.
- **Paused** — user wants to activate multi-agent pipeline first. Remains highest priority.

### Launcher wiring
- `bin/forge.js` + `bin/forge.cmd`: stable launcher entry point delegating to wrapper (commit `4b9eee6`).
- Three PATH-resolution fixes for portable Node installs: absolute Node path baked into `.cmd` (commit `d09fc8c`), SessionStart hook auto-generates `.cmd` per-environment (commit `98a6856`), FORGE_CLAUDE_CMD set for Claude binary discovery (commit `3de7ea9`).
- `findClaude()` helper: wrapper + hook both discover Claude via `where`/`which` → common Windows install locations → env var → bare fallback (commit `ad2ee2a`).

### Option A: positive tool-choice guidance
- Root `CLAUDE.md` Tool Decision Table (3-column: Need to… / Use / Common mistake) replacing the old one-line negative rule (commit `0ac7379`).
- Mirrored to `templates/code/CLAUDE.md`, `templates/instructional/CLAUDE.md` (commit `e73b66f`), and new `templates/power-automate/CLAUDE.md` (commit `ee563aa`).
- Narrower stale rule in `templates/power-automate/docs/gotchas/GENERAL.md` replaced with pointer to new CLAUDE.md.

### Option B: ergonomic MCP tool extensions
- `forge_read_board`: new `filter` object (done, priority, tag — array-aware, any-of semantics) + `fields` projection. Legacy flat fields preserved; superseded when `filter` present. 9 regression tests (commit `950b986`).
- `forge_list_runs`: same pattern (status, pipelineType, mode — with lazy `getRun` hydration when mode or non-index fields requested). 10 regression tests (commit `1d18c4d`).

### Sidecar deprecation
- Removed 3 sidecar regression tests (commit `841d433`). Sidecar source stays on disk during transition.

### Supervisor instructions
- `docs/SUPERVISOR-INSTRUCTIONS.md` for ChatGPT web supervisor: upload kit, paste protocol, §5.5 per-turn review format, ceremony reduction rules (commit `102e629`, updated `43e804f`).

### Board changes
- Closed: `forge-web-dashboard` (#10), `3438a2be` (observer-primary decision).
- Added: `24fae760` (TUI library eval, blocking), `3438a2be` (wrapper-vs-observer, now closed), `95aeb42f` (wt.exe hook), `0b6959d2` (red-team security audit).
- Updated: `3b02cb81` retargeted from sidecar to wrapper TUI.

## [2026-04-15] Wrapper TUI Primary; Sidecar Legacy

### Wrapper prototype refinements
- Mouse wheel now scrolls the Claude pane instead of being translated to arrow keys by the terminal (commit `f12f85c`). Enables SGR mouse reporting (`\x1b[?1000h\x1b[?1002h\x1b[?1006h`), parses the CSI mouse sequences, routes wheel up/down to `term.scrollLines()`; non-wheel mouse events are swallowed so they don't leak to the PTY

### Direction change
- Wrapper TUI prototype (`scripts/forge-wrapper-proto.mjs`) is the new primary dashboard surface during the current transition phase — embeds Claude on the left and live FORGE dashboard on the right in a single terminal process
- Observer prototype (`scripts/forge-observer-proto.mjs`) is the secondary dashboard-only surface for users who want the dashboard in a separate terminal pane next to native `claude`
- HTTP sidecar (`scripts/dashboard-server.mjs`) is now legacy/fallback. Files and tests remain on disk; will be hard-deleted in a later cleanup slice once the wrapper path is fully validated
- Shift+click-drag is the accepted selection model for the TUI surfaces (Windows Terminal / standard alt-screen behavior)

### Unwiring
- Removed `"dashboard": "node scripts/dashboard-server.mjs"` from `package.json` scripts — the sidecar is no longer launched via `npm run dashboard`; it must be invoked directly if needed
- `/forge:dashboard` skill wording updated: renders the in-chat snapshot for the current session; points users to the wrapper prototype for the live terminal experience; removes the earlier Bash launch of `scripts/forge-tui.mjs` (which failed silently in Claude's tool harness due to no TTY)
- `docs/FORGE-OVERVIEW.md` and `docs/FORGE-REFERENCE.md` updated: primary terminal dashboard is the wrapper TUI; sidecar explicitly labelled legacy/fallback

### Pushed to origin
- `ffbe9df` — wrapper right pane now shows live dashboard data
- `633d465` — terminal observer prototype
- this commit — direction change

## [2026-04-14] Sidecar Project Identity and Mismatch Detection

### Project identity in sidecar
- `/api/dashboard-state` response now includes `project: { name, dir }` (commit `39bc92b`); reads from `.pipeline/project.json`, falls back to directory path
- Sidecar HTML `<h1>` and browser `<title>` show the served project name on every refresh; endpoint test updated with project identity assertions

### Sidecar mismatch detection
- `/forge:dashboard` now fetches the sidecar's project identity before reusing it (commit `64abbe6`); if mismatched, logs which project the sidecar is serving and skips the browser open — does not kill or restart the other sidecar
- Three-path logic: down → launch; matched → open; mismatched → warn + skip + text dashboard only

### Board maintenance
- Closed `marketplace-json` (commit `59035dd`)
- Added `68ec233a`: legacy Electron/JS clutter cleanup task
- Added `3b02cb81`: dashboard token usage visibility task (per-run, per-session, all-time per-project)

## [2026-04-14] Self-hosted Marketplace Distribution

### Marketplace distribution validated
- FORGE live on GitHub at `Chulf58/FORGE` (public); `marketplace.json` at `.claude-plugin/marketplace.json` with HTTPS URL source; `plugin.json` with repository URL; `README.md` with install instructions
- Install flow: `/plugin marketplace add Chulf58/FORGE` → `/plugin install forge@forge-tools` → close/reopen for MCP
- All components load: 29 agents, 21 skills, 13 hooks, 24 MCP tools (connected on session 2+)

### MCP bootstrap fixes (3 blockers)
- `CLAUDE_PLUGIN_ROOT` fallback to `__dirname` parent when env var not set (commit `6c022db`)
- Dependency install loop covers both `mcp/` and `packages/forge-core/` (commit `6c022db`)
- SessionStart hook writes `bin/forge-mcp-server.cmd` with absolute `process.execPath` baked in — solves bare `node` ENOENT on machines without Node in system PATH (commit `c147f59`)
- Two-session bootstrap: session 1 installs deps + writes launcher (MCP fails); session 2+ has full MCP

### Distribution portability
- `.mcp.json` made portable: `${CLAUDE_PLUGIN_ROOT}\\bin\\forge-mcp-server.cmd` (commit `f313193`, `c147f59`)
- npm bootstrap made PATH-independent: resolve `npm-cli.js` from Node installation (commit `65bb7ba`)
- Dev-only double-load warning documented in gotchas (commit `23e64b8`)

## [2026-04-14] UX and Discoverability

### Skill namespace migration
- Fixed confirmed collision: `/config` resolved to FORGE config instead of Claude Code's native `/config` (commit `fdc0b6c`); root cause was bare `name: config` in `skills/config/SKILL.md`
- Blanket `forge:` prefix applied to all 20 FORGE skill `name:` fields (commit `59039ee`); eliminates the entire class of silent command-shadowing bugs; zero UX change since the display layer already showed `forge:*` names
- Audited `commands/ping.md` and `commands/forge/hello.md` — no collision risk; no changes needed
- Policy established: all future FORGE skills must use `forge:` prefix in the `name:` field

### /forge:help discoverability surface
- New skill `/forge:help` (commit `f7cdf2c`): compact quick reference — header, grouped core commands, state-aware "right now" suggestions from `forge_dashboard_state`, and "where to look" pointers; no direct `.pipeline/*` reads; output capped at ~40 lines

### Dashboard welcome/help panel
- New welcome panel in sidecar dashboard (commit `b203ce1`): shows when idle (no active runs, no pending gates), hides when busy; 10 core commands in a two-column grid; contextual hint from TODO count; dashboard capability note; toggles on every 5s auto-refresh; no new backend fields

### Board schema normalization
- One-time backfill on 17 legacy tasks missing `done` and `addedAt` fields (commit `1b06d72`); stamped `done: false` and `addedAt: 0` (epoch = unknown date); cleared dangling `blockedBy` reference on `one-chat-capability-audit-post-launch`; no runtime behavior change

### Docs refresh
- Regenerated `docs/FORGE-OVERVIEW.md` and `docs/FORGE-REFERENCE.md` (commit `f951e8b`); skills 19→21, MCP tools 22→24, lib modules 4→5, board 45→25 open items; added `/forge:help`, `forge_dashboard_state`, `dashboard-state.js`, skill namespace policy, `mergeBlocked`/`currentUnit` schema fields, `scripts/dashboard-server.mjs`

### Dashboard in-session launch
- `/forge:dashboard` now probes sidecar reachability, spawns it as background process if down, opens browser, then renders text dashboard (commit `60e8e01`); runtime-validated: sidecar reachable within 1 second (commit `c45b384`)
- `npm run dashboard` path also auto-opens browser as secondary convenience (commit `b085050`)
- Stale `npm run dashboard` references in `/forge:help` and `/forge:status` replaced with `/forge:dashboard` (commit `81f9346`)

### Dashboard welcome panel follow-up
- Welcome panel now surfaces `topPriorityTodos[0].text` as a concrete next-step hint when available; falls back to generic count; falls back to "start fresh" when board is empty (commit `08ff36a`)

### Merge-blocked discard action
- `forge-worktree.js delete <slug>`: targeted single-worktree deletion without merging (commit `cbc9c07`)
- Dashboard "Discard" button alongside "Retry merge" for merge-blocked runs (commit `3b1bb1e`); calls `forge-worktree.js delete`, clears `mergeBlocked`, sets run to `discarded`; `POST /api/merge-action` now accepts both `action: "retry"` and `action: "discard"`
- Regression test updated: discard 200 ok, post-discard state (status=discarded, mergeBlocked=null), re-discard 409, bad action 400

### Board triage (42 → 37 open tasks)
- Closed 5 stale tasks: `knowledge-compound-refresh`, `ideate-command`, `move-utils-to-bin`, `plugin-knowledge-compound`, `plugin-intent-classification` (commits `0107fc8`, `a3d7b4d`, `2a7b95c`)
- Refined `forge-web-dashboard` scope to WebSocket/SSE + health signals only (commit `0107fc8`)
- Verified `worktree-dashboard` is genuinely open (per-session agent progress, wave status, cost not yet implemented)

### Startup banner investigation (no code shipped)
- Investigated Windows `CON` device as direct-console output path for SessionStart hooks
- Full isolation test: disabled all three SessionStart hooks one-by-one — native Claude welcome screen remained absent in all cases
- Conclusion: welcome screen suppression is a Claude Code runtime behavior when `--plugin-dir` is used, not caused by any FORGE hook; startup banner approach parked

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
