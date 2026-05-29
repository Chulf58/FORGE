# FORGE — Technical Reference

> **Generated:** 2026-05-28 (plugin v0.6.0)
> **Do not edit by hand** — regenerated from source-of-truth files via the recipe in `docs/FORGE-OVERVIEW-RECIPE.md`. The companion narrative document is `docs/FORGE-OVERVIEW.md`.

**Counts (verified this regeneration):**
- 25 agents (`agents/*.md`)
- 33 skills (`skills/*/SKILL.md`)
- 29 registered hook scripts (`hooks/hooks.json` across 10 event types) + `hook-utils.js` shared utility
- 40 MCP tools (`mcp/server.js` + 6 domain modules under `mcp/lib/tools/`)
- 16 functional modules (`.pipeline/modules.json`)

---

## Section 1 — Pipeline Architecture & Modes

### Pipeline types

| Type | Entry skill | Stage sequence | Gate |
|------|-------------|----------------|------|
| `plan` | `/forge:plan` | grill-intent → planner → gotcha-checker → grill-plan → reviewer-dispatch → REVISE loop | Gate #1 |
| `implement` | `/forge:implement` | coder-scout → coder (per phase) → completeness-checker → reviewer-dispatch → REVISE loop | Gate #2 |
| `apply` | `/forge:apply` | documenter → learnings-extractor → compound-refresh → post-apply lifecycle | Commit gate |
| `debug` | `/forge:debug` | Step 0 bug-intent → debug agent → fix plan | (none) |
| `refactor` | `/forge:refactor` | refactor agent | (none) |
| `research` | `/forge:research` | researcher (background worker) | (none) |
| `explore` | `/forge:explore` | researcher (in-session subagent) | (none) |
| `ideate` | `/forge:ideate` | critic | (none) |

### Pipeline modes

| Mode | Trigger | Effect |
|------|---------|--------|
| supervised | default (`deployMode: "manual"`) | Conductor + user walk through gates; gate1 + gate2 each require explicit `approve` keyword |
| autonomous | `deployMode: "auto"` in `.pipeline/project.json` | Conductor runs through gates without prompting (reserved for trusted operators) |
| direct-edit | conductor session, small change | Skip pipeline entirely — conductor edits files directly |

### Run lifecycle

States: `created` → `running` → `gate-pending` → (`running` | `loop-guard-pending` | `waiting-for-escalation`)* → terminal (`completed` | `failed` | `discarded`).

Run records live in `.pipeline/runs/<runId>/run.json` (full record) + `.pipeline/runs/<runId>/run-active.json` (per-run active pointer). Index at `.pipeline/runs/index.json`.

`orchestratorState` is a sibling field on `run.json` used by the deterministic orchestrator to persist `planReviseCount`, `implementReviseCount`, and `phase` across gate transitions.

### Count-based triage

Reviewer-triage runs when ≥3 reviewers are dispatched regardless of mode. Below that threshold, reviewers run directly without a triage step.

---

## Section 2 — The Gate System

| Gate | Triggers | User sees | Actions |
|------|----------|-----------|---------|
| Gate #1 | After Phase E (reviewer dialogue) resolves | `docs/PLAN.md` summary | `/forge:approve` (proceed to implement) or `/forge:discard` (cancel) |
| Gate #2 | After implement completes + reviewers approve | `docs/context/handoff.md` summary | `/forge:approve` (apply) or `/forge:discard` (cancel) |
| Commit gate | After apply commits in worktree | Spot-check apply commit + main repo state | `/forge:approve` to merge into main |

### Gate state representation

`.pipeline/gate-pending.json` (worktree-local for plan/implement; main repo for commit gate):

```json
{
  "runId": "r-a1b2c3d4",
  "gate": "gate1" | "gate2" | "commit",
  "feature": "<feature name>",
  "status": "pending" | "approved" | "discarded",
  "createdAt": "2026-05-28T10:00:00.000Z",
  "blockedBy": { "reviewer": "...", "reason": "..." }
}
```

`forge_check_gate({ runId })` reads from per-run state. `forge_set_gate({ runId, status })` writes — guarded by `hooks/approval-token.js` which requires the `approve` keyword in the user's CURRENT message.

### Approval token mechanism

`hooks/approval-token.js` (UserPromptSubmit) detects literal `approve` (full word) in user input, writes `.pipeline/action-approved.json` at the resolved project root. MCP tools (`forge_set_gate`) check that file before allowing non-`pending` status writes. The token is consumed/deleted on the next user prompt without an action keyword.

Monorepo-aware project root resolution (`hooks/hook-utils.js:findMonorepoRoot` + `mcp/lib/tools/shared.js:resolveProjectDir`) ensures hook writes and MCP reads target the same `.pipeline/` directory.

### Gate-precondition env toggles (opt-in, default off)

`mcp/lib/tools/run-gate.js` exports `checkGatePreconditions` which gates `forge_set_gate({status:'pending'})` writes when the corresponding env var is set to the literal string `'on'`:

| Env var | Gate | Blocks write when |
|---------|------|-------------------|
| `FORGE_GATE_PRECONDITION_GATE1=on` | gate1 | no reviewer-output files AND no `reviewer-*` agent in trail |
| `FORGE_GATE_PRECONDITION_GATE2=on` | gate2 | no `handoff.md` AND no coder/debug/refactor completed AND no reviewer-output files |
| `FORGE_GATE_PRECONDITION_COMMIT=on` | commit | no `documenter` agent AND no `feat(forge):` commit since `runData.createdAt` |

Non-`'pending'` writes bypass precondition checks.

---

## Section 3 — Wave / Phase Execution

### Phase Execution Loop (implement skill Step 2c)

When `docs/PLAN.md` contains H2-H4 headings matching `^#{2,4} Phase \d`, the worker enters the Phase Execution Loop:

1. Detect phase headings, build ordered list of `{ index, label, taskLines }`
2. `forge_update_run({ phases: [...] })` — structural commitment to the loop (HARD PRECONDITION before any coder dispatch)
3. Per phase: mark running → optional test-author wave → coder-scout → coder (scoped via `[phase-scope: <label>]` prepend) → test stage → reviewer dispatch → REVISE loop → verdict handling
4. APPROVED: per-file `git add <file>` + commit in worktree, write reset-pill at `<worktreePath>/.pipeline/worker-reset/<runId>` to refresh the 60-min safety-valve timer
5. BLOCK: gate2-pending with `blockedBy`, exit worker
6. REVISE unresolved after 2 passes: `status: failed`, exit

`[phase-scope: <label>]` is a machine-detectable marker. `agents/coder.md` HARD PRECONDITION refuses to write files when the marker is missing and PLAN.md has phase headings. Wave / partition framing (e.g. "Wave K of N") is explicitly FORBIDDEN per phase-scoping discipline.

### Test stage (between coder and completeness-checker)

Determine test command from `.pipeline/project.json` (`testCommand`) or fall back to `node scripts/run-tests.mjs`. Max 2 retries on failure; coder re-invoked with `[test-failure-fix]` and test output (truncated 10KB).

### test-author wave

When current phase has `*-test.{js,mjs}` task lines, `test-author` agent writes failing test files first (red bar verified before coder runs). Coder receives `[test-author-output: .pipeline/context/test-author-output.json]` signal — does NOT see test-author's session content (isolation prevents Red+Green collapse).

### Deterministic orchestrator (opt-in)

`mcp/lib/orchestrator/` provides state-machine alternatives to prose-following LLM worker dispatch:

- `plan-stage.mjs` — `runPlanStageOrchestrator` (planner → gotcha-checker+researcher → reviewer loop with REVISE cap → gate1). Activated by `FORGE_ORCHESTRATOR_PLAN=on`.
- `implement-stage.mjs` — `runImplementStageOrchestrator` (coder-scout → coder → completeness-checker → reviewer loop → gate2; exit-and-resume defer-gate pattern). Activated by `FORGE_ORCHESTRATOR_IMPLEMENT=on`.
- `agent-dispatch.mjs` — stateless SDK `query()` wrapper; loads `agents/<type>.md` for model + systemPrompt; respects `maxTurns` frontmatter.
- `knowledge-inject.mjs` — `buildInjectedKnowledge` — Gap-1 auto-inject: tokenizes feature name, calls `searchConstraints`, formats matched gotcha sections as injectable prompt block for coder-scout/coder/completeness-checker prompts.

When flags are off, the LLM-prose worker path (`mcp/forge-worker.mjs`) is used.

---

## Section 4 — Every Agent — Roles and Models

### Plan-stage agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `planner` | claude-sonnet-4-6 | 25 | Breaks a feature into a numbered task plan. Writes `docs/PLAN.md`. HARD FORMAT GATE on Verify lines (precondition + oracle + observable). |
| `gotcha-checker` | claude-sonnet-4-6 | 15 | Checks plans against known pitfalls. Validates against project conventions. |
| `implementation-architect` | claude-sonnet-4-6 | 15 | Narrows broad plans to the next smallest safe implementation slice. Writes `docs/context/slice-brief.md`. |
| `technical-skeptic` | claude-opus-4-7 | 10 | Cross-model plan critic — Opus reviews Sonnet plan. Checks approach soundness, tests, over/under-engineering. |
| `plan-extractor` | claude-sonnet-4-6 | 15 | Post-gate1 sweep of brainstorm + PLAN.md for knowledge candidates. Writes proposals to JSON file; conductor confirms. |

### Implement-stage agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `coder-scout` | claude-haiku-4-5-20251001 | 8 | Identifies source files the coder needs. Writes `docs/context/scout.json`. Script fallback: `node scripts/coder-scout.mjs`. |
| `coder` | claude-sonnet-4-6 | 25 | Writes source files directly. Produces `docs/context/handoff.md`. HARD PRECONDITION refuses non-phase-scoped prompts. |
| `test-author` | claude-haiku-4-5-20251001 | — | Writes failing test files for TDD wave-split. Isolated from coder context. |
| `completeness-checker` | claude-haiku-4-5-20251001 | 5 | Verifies handoff covers all plan tasks. Script fallback: `node scripts/completeness-check.mjs`. |

### Review-stage agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `reviewer-safety` | claude-haiku-4-5-20251001 | 15 | Security/safety check (injection, secrets, OWASP). |
| `reviewer-boundary` | claude-haiku-4-5-20251001 | 15 | Architecture boundaries, type contracts, module isolation. |
| `reviewer-logic` | claude-haiku-4-5-20251001 | 15 | State mutations, async flows, conditional chains, data transforms. |
| `reviewer-performance` | claude-haiku-4-5-20251001 | 15 | Blocking I/O, memory leaks, unscalable patterns. |
| `reviewer-tests` | claude-haiku-4-5-20251001 | 1 | Diff-aware test-weakening reviewer (test files + suppression keywords). |

### Apply-stage agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `documenter` | claude-haiku-4-5-20251001 | 10 | Updates CHANGELOG, ARCHITECTURE, modules.json after implementation. |
| `learnings-extractor` | claude-haiku-4-5-20251001 | 5 | Outcome-keyed learning recorder; reads handoff + reviewer verdicts. |
| `compound-refresh` | claude-haiku-4-5-20251001 | 10 | Knowledge store maintenance. Auto-dispatched post-documenter (non-blocking). |

### Debug / refactor agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `debug` | claude-sonnet-4-6 | 25 | Diagnoses bugs, traces root causes, writes fix plans. |
| `refactor` | claude-sonnet-4-6 | 25 | Restructures existing code for clarity or performance. |

### On-demand agents

| Agent | Model | maxTurns | Description |
|-------|-------|----------|-------------|
| `architect` | claude-sonnet-4-6 | 60 | Audits project structure, writes ARCHITECTURE.md + modules.json + GENERAL.md. |
| `researcher` | claude-haiku-4-5-20251001 | 25 | Investigates technical unknowns, writes findings to `docs/RESEARCH/`. Always available; exempt from loop-guard dispatch cap. |
| `critic` | claude-opus-4-6 | 25 | Adversarial codebase analysis. Looks for improvement opportunities. |
| `red-team` | claude-sonnet-4-6 | 25 | Security vulnerability analysis (trust boundaries, privilege escalation). |
| `skills-generator` | claude-haiku-4-5-20251001 | 10 | Generates per-capability gotcha skill files for a tech stack. |
| `supervisor` | claude-sonnet-4-6 | 1 | Produces narrow implementation briefs via Gemini (`forge_call_external`); NOT a Claude subagent. Routes to OpenAI only per config. |

### Effort tiers

| Tier | maxTurns range | Examples |
|------|-----------------|----------|
| Heavy | 20-60 | architect (60), planner / coder / refactor / debug / critic / red-team (25), researcher (25) |
| Medium | 8-20 | gotcha-checker (15), implementation-architect (15), technical-skeptic (10), plan-extractor (15), compound-refresh (10), documenter (10), skills-generator (10), coder-scout (8) |
| Light | 1-5 | completeness-checker (5), learnings-extractor (5), supervisor (1), reviewer-tests (1) |

---

## Section 5 — The Signal Protocol

### Plan / implement signals

| Signal | Format | Emitter | Purpose |
|--------|--------|---------|---------|
| `[reviewer-verdict]` | Trailer JSON line | reviewer-* | Verdict letter: `APPROVED`, `REVISE`, `BLOCK`. Fields: `verdict`, `reviewer`, `model`, `reasons[]` |
| `[phase-scope: <label>]` | Coder prompt prefix | implement skill | Scopes coder dispatch to one phase |
| `[scope-error]` | stderr / stdout | coder | Refuse-on-violation when phase-scope missing |
| `[test-author-output: <path>]` | Coder prompt prefix | implement skill | Points coder at test-author JSON artefact |
| `[test-failure-fix]` | Coder prompt prefix | implement skill | Re-invoke coder with test output to fix |
| `[revision-mode: N]` | Coder prompt prefix | implement skill | Revision pass N (1 or 2) |
| `[failed-criteria: AC-X,...]` | Coder prompt prefix | implement skill | AC-IDs that failed reviewer |
| `[needs-researcher]: <question>` | Reviewer output | reviewer-* | Requests researcher dispatch before next coder revision |
| `[questions]` | Block | debug, planner | Interactive Q&A surface |

### Status / outcome signals

| Signal | Where | Purpose |
|--------|-------|---------|
| `[suggest]` | coder | Optional follow-up suggestions in handoff |
| `[wave-split]` | implement skill | Wave-partitioning diagnostic |
| `[covers]`, `[covers-gap]` | covers-verify.mjs | Test coverage diagnostic (informational, non-blocking) |
| `[wiring]`, `[wiring-gap]` | wiring-verify.mjs | Export consumer diagnostic |
| `[auditor-recurring]` | audit-tool-calls.mjs | Tool-call anti-pattern surfaced for agent-optimizer |
| `[timer-reset]` | forge-worker.mjs | 60-min safety-valve reset diagnostic |

### Reviewer verdict JSON fields

```json
{
  "verdict": "APPROVED" | "REVISE" | "BLOCK",
  "reviewer": "reviewer-safety",
  "model": "claude-haiku-4-5-20251001",
  "reasons": ["..."]
}
```

All 5 reviewer agents emit `"model"` in their verdict (enables A/B analysis after model upgrades).

---

## Section 6 — How a Pipeline Run Executes

### Architecture: skills are Markdown orchestrator prompts

Skills (`skills/*/SKILL.md`) are NOT external runners — they are Markdown files Claude Code interprets as system prompts. When user types `/forge:plan`, Claude Code loads `skills/plan/SKILL.md` content into the conversation and follows its step-by-step instructions. The conductor (this Claude Code session) executes Steps 1 (dispatch worker / classify risk), then the worker process or in-session subagents execute Steps 2+.

Workers run via `mcp/forge-worker.mjs` (autonomous subprocess) when `spawnWorker: true` is set during `forge_create_run`. For in-session pipelines (`spawnWorker: false`), the conductor session executes ALL steps.

When `FORGE_ORCHESTRATOR_PLAN=on` or `FORGE_ORCHESTRATOR_IMPLEMENT=on`, the worker delegates to the deterministic state machines in `mcp/lib/orchestrator/` instead of following LLM prose.

### `/forge:plan` walkthrough (in-session, supervised mode)

1. Conductor invokes `forge_classify_risk` → presents agent team → waits for `approve`
2. Conductor invokes `forge_create_run` (`pipelineType: plan`, `spawnWorker: false`)
3. **Phase A** — `Skill(grill-intent)` interviews user, writes `docs/briefs/<slug>.md`
4. **Phase B** — Conductor dispatches `planner` + `gotcha-checker` (+ `researcher` if `### Research needed`) + `implementation-architect` (if scoping check trips) + `technical-skeptic`
5. **Phase C** — `Skill(grill-plan)` walks user through PLAN.md, applies inline edits, appends `## Walkthrough deltas`
6. **Phase D** — Conductor runs `scripts/reviewer-dispatch.mjs --stage=plan`, dispatches resulting reviewers in parallel with `run_in_background:true`
7. **Phase E** — Per-finding dialogue: REVISE findings presented to user (accept / modify / dismiss), planner re-invoked if any accepted/modified, max 2 revision passes
8. **Gate #1** — Write `gate-pending.json`, dispatch `plan-extractor` for knowledge candidates, auto-accept all proposals via `forge_add_learning`, present plan summary, wait for `approve` or `discard`

### `/forge:implement` walkthrough

1. Conductor invokes `forge_classify_risk` → presents agent team → waits for `approve`
2. Conductor invokes `forge_create_run` (`pipelineType: implement`, `spawnWorker: true`)
3. Worker spawns, reads `worker-task.json`, runs Steps 1b onward
4. Worker resolves worktree (reuse from plan stage or create), reads PLAN.md
5. **Step 2c — Phase detection**: if H2-H4 `Phase N` headings exist, `forge_update_run({ phases: [...] })` and enter Phase Execution Loop
6. Per phase: scoping check → test-author (if tests in phase) → coder-scout → coder with `[phase-scope:` → test stage → reviewer dispatch → REVISE loop
7. APPROVED: per-file `git add <file>` + commit + reset-pill
8. **Gate #2** — Write `gate-pending.json`, present handoff, wait for `approve` or `discard`

### `/forge:apply` walkthrough

1. Worker resumed after Gate #2 approval
2. Documenter dispatch (updates CHANGELOG, ARCHITECTURE, modules.json)
3. Learnings-extractor sweeps handoff + reviewer outputs into knowledge base
4. Compound-refresh auto-dispatched (non-blocking, archives stale solutions)
5. Post-apply lifecycle (`scripts/post-apply-lifecycle.mjs`): PLAN.md stale-section cleanup, changelog splice, etc.
6. Commit gate opens; merge inline on `approve`

### Data flow

| File | Producer | Consumers |
|------|----------|-----------|
| `docs/briefs/<slug>.md` | grill-intent | planner, planner-revision-loop |
| `docs/PLAN.md` | planner | grill-plan, reviewers, coder, completeness-checker, documenter |
| `docs/context/scout.json` | coder-scout | coder |
| `docs/context/handoff.md` | coder | reviewers, completeness-checker, learnings-extractor, documenter |
| `docs/context/slice-brief.md` | implementation-architect | coder |
| `docs/context/git-diff.txt` | implement skill | reviewer-dispatch, reviewers |
| `.pipeline/context/reviewer-output/<reviewer>.md` | reviewers | implement skill (verdict handling) |
| `.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md` | implement skill | audit trail |
| `.pipeline/runs/<runId>/run.json` | MCP tools | observer, conductor, worker |

### Self-improvement feedback loop

`scripts/audit-tool-calls.mjs` detects anti-patterns (repeated-reads >3×, blind-write, tool-storm >20 calls/turn, role-violation). Findings with `[auditor-recurring]` flow to agent-optimizer proposals. Proposals go through Gate #2 before implementer applies them to agent files.

---

## Section 7 — Hook Technical Protocol

### Input protocol (stdin)

Claude Code writes a JSON payload to the hook's stdin. Payload shape varies by event:

| Event | Key payload fields |
|-------|--------------------|
| SessionStart | `cwd`, optional `hookSpecificOutput.startup` |
| UserPromptSubmit | `cwd`, `prompt`, `transcript_path` |
| PreToolUse | `tool_name`, `tool_input`, `cwd`, `agent_name` (Agent only) |
| PostToolUse | `tool_name`, `tool_input`, `tool_response`, `cwd` |
| SubagentStart | `tool_input.subagent_type`, `tool_input.prompt`, `cwd` |
| SubagentStop | `tool_input.subagent_type`, `tool_response`, `cwd` |
| Stop | `cwd`, `transcript_path` |
| PostCompact | `cwd`, `transcript_path` |
| SessionEnd | `cwd`, `transcript_path` |
| FileChanged | `cwd`, `file_path` |

### Output protocol

- **stdout JSON**: structured output (e.g. `{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }`). Required for SessionStart additionalContext injection.
- **stderr**: user-visible text (shown in terminal).
- **exit 0**: success
- **exit 2**: block tool call (PreToolUse only)
- **other**: warning, not blocking

### Safe stdin pattern

```js
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let raw = '';
rl.on('line', (line) => { raw += line; });
const timeout = setTimeout(() => { rl.close(); }, STDIN_TIMEOUT_MS);
rl.on('close', () => { clearTimeout(timeout); main(raw); });
```

Shared utilities in `hooks/hook-utils.js`: `resolveProjectDir(payload)` validates and normalizes cwd; `findMonorepoRoot(cwd)` resolves monorepo-aware project root; `STDIN_TIMEOUT_SHORT` (1500ms) and `STDIN_TIMEOUT_LONG` (10000ms) constants.

### Worked example: bash-guard (blocking)

`hooks/bash-guard.js` reads PreToolUse Bash payload, inspects `tool_input.command` for `git commit` / `git push`. If found AND no `commit` keyword in current user input AND no `.pipeline/action-approved.json` token, writes user-visible error to stderr and `process.exit(2)` to block.

### Worked example: ctx-stop (advisory)

`hooks/ctx-stop.js` reads Stop payload, runs 5 inline checks (incomplete agents, pending gate, documenter-not-run, unapplied handoff, inline-capture: writes `.pipeline/inline-capture-pending.json` when fresh `handoff.md` detected). Never blocks (Stop hooks can't block anyway). Exit 0 always.

---

## Section 8 — Skills (User Commands)

### Pipeline skills (orchestrate agent dispatch)

| Skill | Agent sequence | Gate |
|-------|----------------|------|
| `/forge:plan` | grill-intent → planner → gotcha-checker → technical-skeptic → grill-plan → reviewers → REVISE | Gate #1 |
| `/forge:implement` | coder-scout → coder per phase → test-author per phase → reviewers per phase → completeness-checker | Gate #2 |
| `/forge:apply` | documenter → learnings-extractor → compound-refresh → post-apply lifecycle | Commit gate |
| `/forge:debug` | Step 0 bug-intent → debug agent | — |
| `/forge:refactor` | refactor | — |
| `/forge:research` | researcher (background worker) | — |
| `/forge:explore` | researcher (in-session subagent) | — |
| `/forge:ideate` | critic | — |
| `/forge:spawn` | (launches worker) | (depends on type) |
| `/forge:ship` | Gate #2 approve + apply + commit combined | (single-action) |

### Gate skills

| Skill | Action |
|-------|--------|
| `/forge:approve` | Approve pending Gate #1, Gate #2, or commit gate |
| `/forge:discard` | Discard pending gate; cancel run |
| `/forge:commit` | Deprecated — redirects to `/forge:approve` |
| `/forge:unblock` | Clear loop-guard-pending state, resume stuck worker |
| `/forge:resume` | Re-enter a paused or in-progress run by runId |

### Phase / interview skills

| Skill | Purpose |
|-------|---------|
| `/forge:grill-intent` | Phase A user-interview (Pocock loop) for plan pipeline; writes to `docs/briefs/<slug>.md` |
| `/forge:grill-plan` | Phase C plan-walkthrough before Gate #1 |
| `/forge:chat` | Conversational FORGE orchestrator (intent detection + routing) |
| `/forge:supervise` | Generate supervisor brief via best available model (`forge_call_external`) |

### Status / data skills

| Skill | Purpose |
|-------|---------|
| `/forge:status` | Project status + next-step hints |
| `/forge:dashboard` | All runs + board state at a glance |
| `/forge:health` | Project health signals |
| `/forge:planned` | Show planned items |
| `/forge:todo` | Manage TODO board |
| `/forge:note` | Add or browse knowledge notes |
| `/forge:learn` | Capture a learning (gotcha, solution, or decision) into the knowledge store |
| `/forge:overview` | Generate comprehensive plugin overview |
| `/forge:help` | Quick reference of commands |

### Setup / maintenance skills

| Skill | Purpose |
|-------|---------|
| `/forge:init` | Initialize new FORGE project |
| `/forge:config` | View or update project settings |
| `/forge:refresh` | Maintain `docs/solutions/` knowledge store |
| `/forge:refresh-docs` | Regenerate FORGE-OVERVIEW.md + FORGE-REFERENCE.md |
| `/forge:gotchas` | Preloaded skill (project conventions / pitfalls) |

---

## Section 9 — Hook Inventory

### Events wired in `hooks/hooks.json`

| Event | Hooks registered |
|-------|------------------|
| SessionStart | mcp-deps-install, ctx-session-start, forge-banner, routing-log-clear, usage-clear-quota-flags, conductor-inject, worker-task-inject, module-coverage-check, observer-autosplit |
| UserPromptSubmit | anti-speculation-inject, conductor-prompt-inject, approval-token, observer-context-inject, worker-done-inject |
| PreToolUse (Bash) | bash-guard |
| PreToolUse (Write/Edit/MultiEdit) | workflow-guard, ctx-pre-tool, tdd-guard |
| PreToolUse (Agent) | agent-loop-guard |
| PostToolUse (*) | ctx-post-tool |
| PostToolUse (Write/Edit) | gate-sync, doc-size-guard |
| Stop | ctx-stop |
| PostCompact | ctx-post-compact (deliberate no-op) |
| SessionEnd | session-end |
| FileChanged | file-changed |
| SubagentStart | subagent-start, apply-context-inject |
| SubagentStop | subagent-stop |

### Blocking vs advisory

| Hook | Event | Blocks? | Purpose |
|------|-------|---------|---------|
| `bash-guard` | PreToolUse Bash | YES | Guards `git commit`/`git push` without approval token |
| `workflow-guard` | PreToolUse Write/Edit | YES | Apply-gate + worktree boundary enforcement |
| `ctx-pre-tool` | PreToolUse Write/Edit | YES | Agent-roles-based write-target enforcement |
| `tdd-guard` | PreToolUse Write/Edit/MultiEdit | YES | Blocks source edits without paired test in hooks/, bin/, scripts/, mcp/ |
| `agent-loop-guard` | PreToolUse Agent | YES | Denies 3rd+ dispatch of same agent type per run |
| `mcp-deps-install` | SessionStart | NO | Self-heals plugin cache node_modules; writes launcher .cmd |
| `ctx-session-start` | SessionStart | NO | Cleans stale `.worker-session` marker; deletes terminal-run active files |
| `forge-banner` | SessionStart | NO | Prints FORGE banner |
| `routing-log-clear` | SessionStart | NO | Truncates routing log |
| `conductor-inject` | SessionStart | NO | Injects conductor context + solutions index summary |
| `worker-task-inject` | SessionStart | NO | Injects taskBrief + worker-only skill steps; deletes task file |
| `module-coverage-check` | SessionStart | NO | Module coverage diagnostic |
| `observer-autosplit` | SessionStart | NO | Auto-launches observer pane (Windows) |
| `usage-clear-quota-flags` | SessionStart | NO | Clears stale quota flags |
| `anti-speculation-inject` | UserPromptSubmit | NO | Injects anti-speculation rule reminder |
| `conductor-prompt-inject` | UserPromptSubmit | NO | Injects conductor rule reminder |
| `approval-token` | UserPromptSubmit | NO | Writes/deletes `.pipeline/action-approved.json` based on `approve`/`commit` keywords |
| `observer-context-inject` | UserPromptSubmit | NO | Injects observer-selected run context |
| `worker-done-inject` | UserPromptSubmit | NO | Injects worker-completion summary |
| `ctx-post-tool` | PostToolUse * | NO | Generic post-tool context tracking |
| `gate-sync` | PostToolUse Write/Edit | NO | Syncs run registry when gate-pending.json edited directly |
| `doc-size-guard` | PostToolUse Write/Edit | NO | Warns on oversize docs (PLAN >200, GENERAL >200, CHANGELOG >200, ARCHITECTURE >800) |
| `ctx-stop` | Stop | NO | Token usage logging; 5 inline checks including inline-capture detection |
| `ctx-post-compact` | PostCompact | NO | Deliberate no-op (no supported output shape) |
| `session-end` | SessionEnd | NO | Session-end cleanup |
| `file-changed` | FileChanged | NO | Generic file-changed event handler |
| `subagent-start` | SubagentStart | NO | Appends agent entry to run-active.json |
| `apply-context-inject` | SubagentStart | NO | Injects apply-stage context for documenter / learnings-extractor |
| `subagent-stop` | SubagentStop | NO | Verdict + truncation detection; clears currentUnit |

### Enforcement model

Hard-blocking hooks (exit 2) form the **only mechanically-enforced** rules. Everything else is advisory or context-injecting. See `docs/gotchas/GENERAL.md` "Mechanically enforced (hooks — do not duplicate here)" section for the canonical list.

**Note on `audit-trigger.js`:** This hook was retired in v0.6.0. `scripts/audit-tool-calls.mjs` is now invoked directly by skills where needed, not via a SubagentStop hook.

---

## Section 10 — MCP Server & Tools

### Server architecture

- Entry point: `mcp/server.js` — thin ESM shell (~48 lines)
- 40 tools across 6 domain modules under `mcp/lib/tools/`
- Separate `mcp/package.json` with `"type": "module"`; CommonJS hooks are isolated
- Launched via `bin/forge-mcp-server.cmd` → `bin/forge-mcp-bootstrap.cjs` (self-heals mcp/node_modules) → `mcp/server.js`
- Transport: `StdioServerTransport` from `@modelcontextprotocol/sdk`. NEVER `console.log()` — corrupts JSON-RPC. Use `console.error()`.
- `CLAUDE_PLUGIN_ROOT` is NOT available in MCP processes — use `CLAUDE_PLUGIN_DATA` or `process.cwd()`.

### Tool inventory by domain

| Module | Tool count | Tools |
|--------|------------|-------|
| `mcp/lib/tools/board.js` | 9 | forge_read_board, forge_read_project, forge_read_notes, forge_add_todo, forge_add_note, forge_update_task, forge_delete_note, forge_set_blocked_by, forge_get_linked |
| `mcp/lib/tools/run-gate.js` | 3 | forge_get_active_run, forge_check_gate, forge_set_gate |
| `mcp/lib/tools/modules.js` | 2 | forge_read_modules, forge_assign_module |
| `mcp/lib/tools/model-mgmt.js` | 8 | forge_list_models, forge_add_model, forge_update_model, forge_get_model_recommendation, forge_call_external, forge_read_usage, forge_reset_usage, forge_update_config |
| `mcp/lib/tools/run-lifecycle.js` | 12 | forge_create_run, forge_get_run, forge_list_runs, forge_update_run, forge_classify_risk, forge_resume_run, forge_advance_stage, forge_create_worktree, forge_dashboard_state, forge_kill_worker, forge_escalate, forge_respond_to_escalation |
| `mcp/lib/tools/knowledge.js` | 6 | forge_get_constraints, forge_get_patterns, forge_add_learning, forge_read_criteria, forge_write_criteria, forge_get_linked |

Total: 40. Verified by `mcp/server-registration-test.mjs` expected list.

### Tool registration pattern

```js
server.registerTool(
  'forge_get_run',
  {
    description: '...',
    inputSchema: { runId: runIdSchema },
  },
  async (input) => {
    try {
      // ... handler logic
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  },
);
```

### `forge_add_learning` — conflict handling

`mergeEvidenceOnConflict: true` param causes `appendEvidence` to merge new `sourceEvidence` into an existing entry instead of writing a duplicate. `detectConflict()` checks keyword overlap (≥50% incoming-denominator ratio) and tag overlap (≥2 matches) before write. Returns `{ conflict: true, slug, title }` when duplicate detected.

### `forge_respond_to_escalation` — two-way escalation

Workers call `forge_escalate` with `responseRequested: true`, enter `waiting-for-escalation`, resume on human `forge_respond_to_escalation` call. Escalation files: `<runId>-<escalationId>.json` (supports concurrent escalations per run). Timeout default 30 min (env: `FORGE_WORKER_ESCALATION_TIMEOUT_MS`).

### Support libraries (`mcp/lib/*.js`)

| Module | Purpose |
|--------|---------|
| `router.js` | Model routing engine — reads `agentModelMap` from config, returns recommendation |
| `config-store.js` | Live forge-config.json read/write; resolves `CLAUDE_PLUGIN_DATA` or `.pipeline/` |
| `usage-store.js` | Token-usage tracker (per-model, per-session) |
| `knowledge-store.js` | Gotchas + solutions data layer; `searchConstraints`, `searchPatterns`, `appendSolutionDoc`, `detectConflict` |
| `gotchas-index.mjs` | `searchGotchasIndex` — reads `docs/gotchas/index.json`; title/tags/keywords match; returns `kind:'gotcha'` |
| `decisions-index.mjs` | `buildDecisionsIndex` + `searchDecisionsIndex` — parses `docs/DECISIONS.md` h2 headings into anchor-tagged records; reads `docs/decisions-index.json` |
| `worker-pids.js` | Worker PID lifecycle + orphan sweep |
| `worker-paths.js` | Canonical paths for worker artefacts (reset-pill, etc.) |
| `worker-timeouts.js` | `WORKER_TIMEOUT_MS` (60min) + `GATE_POLL_TIMEOUT_DEFAULT_MS` (6h) |
| `stamp-orphan-agents.js` | Safety net for missing SubagentStop records |
| `dashboard-state.js` | Shared state builder for `forge_dashboard_state` MCP tool + dashboard-server.mjs |
| `gate-helpers.js` | Gate state read/write primitives |
| `context-paths.js` | Per-run context path resolution |
| `stage-labels.js` | Phase label normalization |
| `sanitize.js` | Input sanitization (newlines, control chars, shell embedding) |
| `model-validation.js` | Zod schemas for model definitions |
| Adapters | `gemini-adapter.js`, `openai-adapter.js` for external provider calls |
| Orchestrator | `orchestrator/agent-dispatch.mjs`, `orchestrator/plan-stage.mjs`, `orchestrator/implement-stage.mjs`, `orchestrator/knowledge-inject.mjs` |

---

## Section 11 — Model Routing

### Two-track routing

| Track | Mechanism | Used for |
|-------|-----------|----------|
| Anthropic | `agentModelMap` in `forge-config.json` + agent frontmatter `model:` | All Claude-based agents (planner, coder, reviewers, etc.) |
| External | `forge_call_external` MCP tool | Supervisor (OpenAI), other non-Anthropic models |

### Config resolution

`mcp/lib/config-store.js` resolves the live config path:
1. `CLAUDE_PLUGIN_DATA/forge-config.json` (primary)
2. `<mainProjectDir>/.pipeline/forge-config.json` (fallback)

Default config at plugin root: `forge-config.default.json`. SessionStart hook (`mcp-deps-install.js`) bootstraps the live config on first run; diff-merges defaults into live config when `schemaVersion` differs.

### `agentModelMap` shape

```json
"agentModelMap": {
  "planner": {
    "requiredCapabilities": ["code", "reasoning"],
    "allowedVendors": ["anthropic"]
  },
  "technical-skeptic": {
    "requiredCapabilities": ["code", "reasoning", "cross-model"],
    "allowedVendors": ["anthropic"],
    "preferModel": "claude-opus-4-7"
  }
}
```

`forge_get_model_recommendation({ agent })` reads `agentModelMap[agent]` and returns the best-matching model from `providers[].models[]`. Uses 4-priority fallback chain: preferred → required-capabilities + allowed-vendors → required-capabilities only → budget-default.

### Budget mode

Optional `budgetMode: "soft"` in config applies cost-preference at priority 3 only (after capability + vendor match). Never overrides hard constraints.

### Registered providers (from `forge-config.default.json`)

| Provider | Type | Default | Notes |
|----------|------|---------|-------|
| `anthropic` | anthropic | enabled | Agent frontmatter routes Anthropic; this entry tracks quota state only |
| `gemini` | gemini | enabled | Free tier; flash/lite models generous; pro requires billing. NOT for supervisor. |
| `openai` | openai | disabled | Enable via `OPENAI_API_KEY`. Supervisor routes here only. |

### API key handling

API keys ONLY via `envVar` references in provider config (`"envVar": "OPENAI_API_KEY"`). Never plaintext in config. Provider config carries `enabled` (user toggle) and `envVar` (key reference) as user-owned fields preserved across migration.

---

## Section 12 — Project Configuration (`.pipeline/project.json`)

| Field | Type | Purpose |
|-------|------|---------|
| `tester` | string | Tester / runner name (informational) |
| `testCommand` | string | Override test command (defaults to `node scripts/run-tests.mjs`) |
| `deployMode` | `"manual"` \| `"auto"` | Supervised vs autonomous gate handling |
| `tddGuard` | boolean | Per-project TDD guard opt-out (default true; false for non-code scaffolds) |
| `gitIntegration` | object | Opt-in git automation config |

### `gitIntegration` config

```json
"gitIntegration": {
  "enabled": false,
  "branchPrefix": "forge/",
  "autoCommit": false,
  "autoPR": false
}
```

All default false. Every git step logs `[git-integration]` prefix and continues on failure (best-effort).

**Forbidden git operations:** `--force`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash` (documented prose-only; not hook-enforced).

---

## Section 13 — Module Map

The 16 modules from `.pipeline/modules.json` (architect-refreshed 2026-05-28):

| Module | Key paths | Description |
|--------|-----------|-------------|
| Pipeline Agents | `agents/` | 25 agent definitions forming the multi-stage pipeline |
| Skills | `skills/` | 33 user-facing skills |
| Deterministic Orchestrator | `mcp/lib/orchestrator/` | State machines for plan/implement pipelines (opt-in via env flags) |
| MCP Server | `mcp/server.js`, `mcp/lib/` | 40 forge_* tools across 6 domain modules |
| Knowledge Base | `mcp/lib/knowledge-store.js`, `mcp/lib/gotchas-index.mjs`, `mcp/lib/decisions-index.mjs` | Gotchas, solutions, decisions — three retrieval paths |
| Run Registry | `packages/forge-core/` | Zod-validated lifecycle store |
| Hooks | `hooks/` | 29 registered hook scripts across 10 event types |
| Parallel Sessions | `bin/forge-worktree.js`, `mcp/forge-worker.mjs` | Git worktree isolation + autonomous worker |
| Observer & Dashboard | `scripts/forge-observer.mjs`, `scripts/forge-tui.mjs`, `scripts/dashboard-server.mjs` | Read-only terminal + HTTP dashboards |
| Project Scaffolds | `scaffolds/` | Bootstrap templates for /forge:init |
| LEAN Risk Gate | `scripts/lean-risk-classify.mjs`, `scripts/reviewer-dispatch.mjs` | Post-handoff classifier for reviewer dispatch |
| TDD & Coverage Tooling | `scripts/covers-*.mjs`, `scripts/wiring-verify.mjs` | @covers tags + test-coverage tracking |
| Audit & Observability | `scripts/audit-tool-calls.mjs`, `scripts/integrity-check.mjs` | Tool-call anti-pattern + integrity detection |
| Dev Tooling | `scripts/run-tests.mjs`, `scripts/validate-agents.mjs`, etc. | Plugin development scripts |
| Commands | `commands/` | Legacy slash commands (hello.md, doctor.md remain active) |

---

## Section 14 — Key Files Reference

### Plugin infrastructure

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest (name, version: 0.6.0, description) |
| `.mcp.json` | MCP server declaration |
| `hooks/hooks.json` | Hook event registrations |
| `bin/forge-mcp-server.cmd` | MCP server launcher (calls bootstrap) |
| `bin/forge-mcp-bootstrap.cjs` | Pure-CJS self-heal shim for mcp/node_modules |
| `bin/forge-worktree.js` | Worktree creation + CLAUDE.md injection into worktree |
| `bin/forge-status.js` | Status line script |
| `bin/forge.js` | User-facing launcher shim |
| `CLAUDE.md` | Conductor instructions (loaded into conductor sessions) |
| `forge-config.default.json` | Default model routing + provider config |

### Pipeline data (per project)

| File | Purpose |
|------|---------|
| `.pipeline/board.json` | TODOs + notes + project meta |
| `.pipeline/modules.json` | Module map (architect-written) |
| `.pipeline/project.json` | Per-project config (tester, deployMode, gitIntegration, tddGuard) |
| `.pipeline/forge-config.json` | Live model routing config (per-user, gitignored) |
| `.pipeline/runs/<runId>/run.json` | Run lifecycle record (includes `orchestratorState` field) |
| `.pipeline/runs/<runId>/run-active.json` | Per-run active pointer |
| `.pipeline/runs/index.json` | Run registry index |
| `.pipeline/runs/<runId>/loop-guard-blocked.json` | Sidecar for loop-guard-pending state |
| `.pipeline/gate-pending.json` | Per-run gate state |
| `.pipeline/worker-pids/<runId>.json` | Worker PID file |
| `.pipeline/heartbeats/<runId>.json` | Worker heartbeat |
| `.pipeline/worker-logs/<runId>.log` | Worker JSONL transcript |
| `.pipeline/usage.json` | Token usage tracker |
| `.pipeline/inline-capture-pending.json` | Written by ctx-stop when fresh handoff.md detected |
| `docs/PLAN.md` | Current plan (gitignored — lives only in worktree during run) |
| `docs/context/handoff.md` | Coder handoff for reviewers |
| `docs/context/scout.json` | Coder-scout output |
| `docs/context/slice-brief.md` | Implementation-architect slice brief |
| `docs/gotchas/GENERAL.md` | Project-specific gotchas (preloaded into agents) |
| `docs/gotchas/index.json` | Gotchas index (37+ records, queryable via searchGotchasIndex) |
| `docs/solutions/*.md` + `docs/solutions/index.json` | Solution patterns knowledge base |
| `docs/briefs/<slug>.md` | Phase A brainstorm / intent capture doc (written by grill-intent) |
| `docs/RESEARCH/*.md` | Researcher output |
| `docs/CHANGELOG.md` | Project changelog (documenter-written) |
| `docs/ARCHITECTURE.md` | Architecture overview (architect-written) |
| `docs/DECISIONS.md` | Architecture decision records |
| `docs/decisions-index.json` | Parsed decisions index (built by decisions-index.mjs) |

### Utility scripts (selected)

| Script | Purpose |
|--------|---------|
| `scripts/run-tests.mjs` | Regression test runner (autodiscovers *-test.{js,mjs} and *.test.{js,mjs}) |
| `scripts/reviewer-dispatch.mjs` | Risk-surface → reviewer mapping (authoritative for both plan + implement stages) |
| `scripts/lean-risk-classify.mjs` | Post-handoff risk classifier |
| `scripts/verify-output.mjs` | Mtime check on agent output files |
| `scripts/coder-scout.mjs` | Deterministic file-scope extractor |
| `scripts/completeness-check.mjs` | Deterministic completeness checker |
| `scripts/audit-tool-calls.mjs` | Tool-call anti-pattern detector |
| `scripts/post-apply-lifecycle.mjs` | Post-documenter cleanup jobs (resolves main repo root via git gitdir) |
| `scripts/wave-split.mjs` | TDD wave phase partitioner |
| `scripts/covers-verify.mjs` | @covers tag verification |
| `scripts/wiring-verify.mjs` | Zero-consumer export detection |
| `scripts/gotchas-coverage-verify.mjs` | Verifies every gotchas/index.json record is backed + queryable |
| `scripts/sanitize-slug.mjs` | Validates brief slugs before grill-intent writes |
| `scripts/splice-changelog.mjs` | Atomic changelog entry insertion |
| `scripts/integrity-check.mjs` | 11 deterministic pipeline integrity checks (replaces integrity-checker agent) |
| `scripts/lib/preflight.cjs` | Shared npm self-heal helper |
| `scripts/forge-observer.mjs` | Terminal-kit split-pane observer |
| `scripts/forge-tui.mjs` | Blessed-based inline dashboard |
| `scripts/dashboard-server.mjs` | Local HTTP dashboard server (port 7878) |
| `scripts/plan-revise-loop.mjs` | Simulates the REVISE retry loop |

---

## Section 15 — Documentation Structure

| Document | Tier | Audience |
|----------|------|----------|
| `docs/FORGE-OVERVIEW.md` | Narrative | Newcomers; tells the story of FORGE's evolution |
| `docs/FORGE-REFERENCE.md` (this doc) | Reference | Developers; complete technical inventory |
| `docs/FORGE-OVERVIEW-RECIPE.md` | Recipe | Maintainers; how to update overview + reference |
| `CLAUDE.md` | Runtime | Conductor sessions; behavioral rules. Workers receive a copy via worktree injection. |
| `docs/gotchas/GENERAL.md` | Reference | Pipeline agents; project-specific conventions |
| `docs/gotchas/index.json` | Index | 37+ gotcha records for deterministic retrieval |
| `docs/CHANGELOG.md` | History | Anyone; release log |
| `docs/ARCHITECTURE.md` | Reference | Newcomers; module-by-module architecture |
| `docs/DECISIONS.md` | History | Maintainers; killed ideas + permanent rejections |
| `docs/decisions-index.json` | Index | Parsed decisions for deterministic retrieval |
| `docs/solutions/*.md` | Knowledge | Agents (via forge_get_patterns); solution patterns |
| `docs/pipeline-evolution.html` | Slide deck | Presentations |

### Principle

Neither overview nor reference duplicates the other. The overview tells the story. The reference has the specs. Cross-references connect them.

---

## Sources read during this regeneration (2026-05-28)

- `.claude-plugin/plugin.json` — version 0.6.0
- `.mcp.json` — server entry point
- `hooks/hooks.json` — 10 event types, 29 registered hook scripts
- `agents/*.md` — 25 files, frontmatter extracted (name, description, model, maxTurns, effort)
- `skills/*/SKILL.md` — 33 files, frontmatter extracted (name, description)
- `.pipeline/modules.json` — 16 modules
- `.pipeline/board.json` — 24 open items
- `docs/CHANGELOG.md` — recent changes since v0.5.21
- `docs/FORGE-OVERVIEW-RECIPE.md` — regeneration recipe
- `CLAUDE.md` + `docs/gotchas/GENERAL.md` — runtime instructions and gotchas
- `forge-config.default.json` — model routing defaults
- Previous `docs/FORGE-REFERENCE.md` (2026-05-25, plugin v0.5.21) — for section structure reference
