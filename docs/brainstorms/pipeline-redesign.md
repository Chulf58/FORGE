# Pipeline Redesign: Conductor-Driven Agent Selection

Status: Design phase (2026-04-30)

## Problem

The current pipeline mode system (SPRINT/LEAN/STANDARD/FULL) is static per-project, not per-task. A config rename and a security-critical hook change get the same treatment. The mode label barely influences actual behavior — the dispatch script and risk classifier make the real decisions, but they have blind spots:

- Plan-stage reviewers fire in LEAN when they shouldn't (65k tokens wasted on r-ead2878d)
- Plan-stage keyword lists are too broad ("token", "hook", "tool", "module" match almost everything)
- SPRINT has no distinct path in the dispatch script — falls through to LEAN behavior
- Mode only matters at extremes: FULL = all reviewers, everything else = classifier decides
- The "floor" concept (can escalate but not go below) is a prompt instruction, not enforced mechanically

## Target Model

### Core principle
The conductor picks the agent team per-run, per-stage. The classifier is mandatory — the conductor can't create a run without calling it first. Overrides are allowed but auditable.

### Three stages, one runId (replaces current pipeline types)

```
Stage 1 (plan):     planner + [optional: researcher, gotcha-checker, reviewers]
Stage 2 (code):     coder → test (script) → [optional: reviewers] → documenter
Stage 3 (commit):   conductor does commit+merge directly (no apply worker)
```

One `r-xxxxxx` persists across all three stages. `/forge:plan` creates it, `/forge:implement` advances it to code stage, commit runs in the conductor. No more separate runs chained by `parentRunId`.

The apply skill as a separate stage dies. The coder already writes source files directly. The documenter splits: LLM agent runs pre-commit in code stage (CHANGELOG, ARCHITECTURE, DECISIONS, solution capture), lifecycle script runs post-commit (plan removal, board cleanup, module logging).

### What changes

| Current | New |
|---------|-----|
| Static per-project `pipelineMode` | Per-run agent team, chosen by conductor |
| 4 mode labels (SPRINT/LEAN/STANDARD/FULL) | No modes — team selection IS the mode |
| Dispatch script decides reviewers | Conductor decides, classifier advises |
| Skills hardcode agent sequences | Skills become thin wrappers or disappear |
| Apply is a separate pipeline stage | Commit is conductor-owned (already shipping via r-4f3f2683) |
| Worker reads skill SKILL.md | Skills read agent list from `stages` field in run schema |

### What stays
- `[force-review]` escape hatch for operator override
- Risk classifier rules (path-based + content-based) — now mandatory with `classificationId` enforcement
- Gates (plan gate, code gate, commit) — still human checkpoints
- Worker sessions for autonomous execution

### Classifier + enforcement

#### `forge_classify_risk` MCP tool (zero LLM tokens)

**Input:**
```json
{
  "feature": "string — feature description",
  "filePaths": ["string[] — affected file paths"],
  "content": "string? — plan content or diff for code-block scanning",
  "forceReview": "boolean? — [force-review] token present"
}
```

Called once per feature, before the plan stage. No `stage` parameter — the output covers both plan and code stages.

**Output:**
```json
{
  "classificationId": "cls-a1b2c3",
  "suggestedReviewers": ["reviewer-safety"],
  "suggestedAgents": ["completeness-checker"],
  "triggeredRules": ["shell-spawn:hooks/bash-guard.js", "hook-path:hooks/"],
  "riskLevel": "low | moderate | high",
  "reason": "hook-script path + shell spawn detected",
  "planStageReview": false
}
```

**Logic:** Unifies the two current classification paths into one call:
- Wraps `classifyHandoff` / `classifyDiff` from `lean-risk-classify.mjs` for content scanning, and replaces keyword scanning from `reviewer-dispatch.mjs` for path-based rules
- Maps triggered rules to specific reviewers (same mapping table as current `reviewer-dispatch.mjs`)
- `planStageReview`: whether plan-stage reviewers are warranted (high-risk signals only)
- `riskLevel`: no rules = `low`, path/content rules = `moderate`, `forceReview` or fallback = `high`
- `suggestedAgents`: adds `completeness-checker` (>5 tasks), `implementation-architect` (complexity signals)
- Result is cached server-side, keyed by `classificationId`

#### `forge_create_run` enforcement

`forge_create_run` gains a `classificationId` parameter. The MCP server validates:

1. **No classificationId → reject** (for `implement`, `debug`, `refactor` only). Other pipeline types (`plan`, `research`, `explore`, `ideate`) don't require it. Prevents silently skipping classification for code-producing runs.
2. **classificationId present → server looks up cached classification.** Compares `suggestedReviewers` against the `stages` agent list:
   - All suggested reviewers present → pass, run created normally
   - Missing reviewers → run still created, but stamped with `reviewerOverrides` field:
     ```json
     { "reviewerOverrides": [
       { "reviewer": "reviewer-safety", "action": "skipped", "reason": "user-approved" }
     ]}
     ```
3. **`forceReview` in classification → all 5 reviewers required.** No override possible.

This means the conductor:
- **Can't skip the classifier** (no ID = no run)
- **Can skip reviewers** (user explicitly approved) but the override is auditable in `run.json`
- **Can add reviewers** beyond what the classifier suggested (always allowed)

`minReviewers` floor becomes redundant — classifier + enforcement replaces it.

#### How `stages` is built

`stages` contains ALL agents (baseline + variable) — one list, no ambiguity. The conductor builds it:

1. Classifier returns `suggestedReviewers` and `suggestedAgents` (variable agents only)
2. Conductor starts with baseline agents for the pipeline type:
   - `implement`: coder, coder-scout, documenter
   - `debug`: debug, documenter
   - `refactor`: refactor, documenter
   - `plan`: planner
3. Conductor merges classifier suggestions into the baseline
4. Conductor presents the full list to user (user can add/remove)
5. `forge_create_run` receives the complete `stages` and validates classifier suggestions are present

The skill reads `stages` and runs exactly what's listed — no implicit agents, no merging.

#### Conductor presentation (always shown)

```
Task: Fix gate-sync path traversal bug
Classifier: reviewer-safety + reviewer-boundary (hook-script path, shell spawn)
             Risk: moderate | Rules: shell-spawn, hook-path

Plan stage:  planner (no plan-stage reviewers)
Code stage:  coder + reviewer-safety + reviewer-boundary
Commit:      conductor (direct)

Approve?
```

User can accept, add reviewers, or remove reviewers (override recorded).

### Run schema changes

#### Current schema (`packages/forge-core/src/runs/schemas.js`)

```js
Run = {
  runId, sessionId, projectRoot, worktreePath, branchName,
  pipelineType: 'plan' | 'implement' | 'apply' | 'debug' | 'refactor' | 'research' | 'explore' | 'ideate',
  mode: 'SPRINT' | 'LEAN' | 'STANDARD' | 'FULL',
  feature, status, createdAt, updatedAt,
  currentStep,       // free-form string ("planner", "coder", "gate2", "done", ...)
  gateState,         // { gate, status, feature, createdAt, approvedAt } | null
  agents,            // RunAgent[] — execution log appended by subagent-start hook
  artifacts,         // { plan, handoff, scout } — path strings
  mergeBlocked,      // { reason, detectedAt } | null
  failureReason,     // string | null
  parentRunId,       // "r-..." | null
}
```

#### New fields (Wave 1 — all optional, existing runs unchanged)

```js
// Added to Run schema
stages: z.record(z.object({
  agents: z.array(z.string()).default([]),
  status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
})).nullable().default(null),

classificationId: z.string().nullable().default(null),

reviewerOverrides: z.array(z.object({
  reviewer: z.string(),
  action: z.enum(['skipped', 'added']),
  reason: z.string(),
})).default([]),
```

All nullable/defaulted — old run.json files parse without error. No migration script needed.

#### Example run.json (new model)

```json
{
  "runId": "r-abc123",
  "pipelineType": "implement",
  "mode": "LEAN",
  "classificationId": "cls-a1b2c3",
  "stages": {
    "plan":   { "agents": ["planner"], "status": "completed" },
    "code":   { "agents": ["coder", "reviewer-safety"], "status": "running" },
    "commit": { "agents": [], "status": "pending" }
  },
  "reviewerOverrides": [],
  "currentStep": "coder"
}
```

#### Coexistence rules (Wave 2)

| Field | Behaviour during Wave 2 |
|-------|------------------------|
| `pipelineType` | Kept — still drives workflow pattern (resolved: separate types stay) |
| `mode` | Written but not authoritative — `stages` is truth. Hooks still read it. |
| `currentStep` | Written alongside `stages[].status` for hook/observer compat |
| `stages` | Skills populate it, worker reads it, conductor presents it |
| `classificationId` | Required by `forge_create_run` |
| `reviewerOverrides` | Populated when user drops classifier-suggested reviewers |
| `agents` | Kept — subagent-start hook still appends execution log entries |
| `artifacts` | Kept — evaluate in Wave 3 whether redundant with `stages` |

**Dual-write rule:** Every `stages[x].status` update also writes the equivalent `currentStep` string. Hooks that read `currentStep` keep working without modification. Wave 3 flips the direction.

#### Index entry changes

`RunIndexEntry` gains `classificationId` (optional) so `forge_list_runs` can filter by classification. No other index changes needed.

### Worker integration

#### Current model

`forge-worker.mjs` is already a generic harness — it doesn't hardcode agent sequences. It:

1. Reads `worker-task.json` for `runId`, `feature`, `pipelineType`
2. Builds a prompt that invokes the matching skill: `/forge:<pipelineType>`
3. Launches one Claude SDK session — the LLM inside reads the skill markdown and drives the agent sequence
4. Polls for gates, handles approve/discard/timeout

The worker is the harness. The skill is the prompt. The LLM interprets the skill and calls Agent tool to dispatch each agent.

#### Key principle: conductor dictates, worker executes

The conductor owns ALL decisions: mode, agent team, reviewer selection. The worker is a pure executor — it reads `stages` from `run.json` and runs the agents listed there. No mode assessment, no approval prompts, no escalation logic in the worker.

Current problem: skills have a "Step 2 — decide mode, present, wait for approval" that blocks headless workers. This is fixed in Wave 2 — skills lose their mode assessment and approval steps. Until then, workaround: bake the mode and pre-approval into the feature text at dispatch time.

#### What changes (and what doesn't)

The worker harness (`forge-worker.mjs`) stays essentially the same — it still launches one SDK session per run, still polls for gates, still handles timeouts.

What changes is the **skills the LLM reads**. Instead of hardcoded agent lists, skills read the `stages` field from `run.json` to get their agent list. The skill still encodes procedural knowledge (worktree creation, gate file paths, revision loops, error handling) — this stays as a prompt because it needs LLM judgment, not mechanical execution.

**Why not have the worker read `stages` directly?** The worker launches a single SDK session — it doesn't spawn agents individually. For the worker to execute agents from `stages` without skills, it would need to either launch separate SDK sessions per agent (loses conversation context) or build the skill dynamically as a prompt string (essentially rebuilding the skill). Neither is simpler than keeping skills as the procedural wrapper.

#### Summary

| Component | Before | After |
|-----------|--------|-------|
| `forge-worker.mjs` | Reads `pipelineType`, invokes `/forge:<type>` | Same — no change |
| Skills (worker-side) | Hardcoded agent sequences | Read `stages` from run.json for agent list |
| Skills (conductor-side) | Create run + hardcoded sequences | Call `forge_classify_risk` → present team → create run with `stages` |
| Procedural knowledge | In skills | Still in skills — needs LLM judgment |
| Agent list | In skills | In `stages` field on run.json |

### Skills rewrite inventory

26 total skills. Impact by category:

| Category | Skills | Wave | What changes |
|----------|--------|------|-------------|
| Major rewrite | plan, implement, debug, refactor, apply | Wave 2 | Agent lists come from `stages` instead of being hardcoded. Skills still encode procedural knowledge (worktree creation, gate paths, revision loops, error handling). Reviewer dispatch logic removed — classifier handles it. |
| Already updated | approve | Done | Commit+merge moved to conductor (r-4f3f2683) |
| Minor updates | chat, spawn, resume, discard | Wave 2-3 | Mode/type references updated. `chat` updated for new model in Wave 3. |
| No changes | status, dashboard, config, todo, planned, note, health, overview, refresh, refresh-docs, help, init, explore, ideate, research, supervise | — | No pipeline logic, no mode references |

**Net effect:** The 5 pipeline skills lose their hardcoded agent lists and reviewer dispatch logic. Procedural knowledge (worktree creation, gate paths, revision loops, error handling) stays in skills. The conductor-side shrinks significantly (classify → present → create run), but the worker-side skills remain substantial. Worker harness doesn't change.

## Risks to Mitigate

### Hook audit

| Hook | Fields read | Migration impact |
|------|------------|-----------------|
| **gate-enforcement** | `pipelineType`, `mode` | Wave 2: dual-read (`stages` or fall back to `mode`). Wave 3: drop `mode` read. |
| **gate-sync** | `pipelineType` (infers from gate name), `currentStep`, `gateState` | Wave 2: write `stages[].status` alongside `currentStep`. Wave 3: switch to `stages` writes only. |
| **workflow-guard** | `pipelineType` (checks for `apply`) | No change — `pipelineType` kept. |
| **subagent-start** | `currentStep` (writes it) | Wave 2: also write `stages[].status`. Wave 3: switch to `stages` only. |
| **observer-context-inject** | `pipelineType`, `mode`, `gateState` (display) | Wave 2: prefer `stages` for display when present. Wave 3: drop `mode` display. |
| **worker-task-inject** | `pipelineType`, `currentStep` (template) | Wave 2: include `stages` in worker prompt. Wave 3: worker reads `stages` only. |
| **worker-done-inject** | `pipelineType` (checks `research`) | No change — `pipelineType` kept. |
| **apply-context-inject** | `pipelineType` (filters `implement` runs) | No change — `pipelineType` kept. |

**Summary:** 5 hooks need Wave 2 dual-write/dual-read changes. 3 hooks only use `pipelineType` (which we're keeping) — no changes needed. No hook is blocked.

### 1. Conductor skips reviewers it shouldn't
Risk: Conductor (LLM) decides "no reviewers needed" for risky code.
Mitigation: `classificationId` enforcement in `forge_create_run`. Conductor can't create a run without calling the classifier first. Overrides are auditable via `reviewerOverrides` field in run.json.

### 2. Backward compatibility during migration
Risk: Existing skills, hooks, and worker scripts break during transition.
Mitigation: Wave-based migration. Wave 1: add `stages` field to run schema alongside existing fields. Wave 2: skills read from `stages` when present. Wave 3: remove old fields and mode references.

### 3. Worker prompt construction
Risk: If procedural knowledge leaves skills, the worker prompt has no orchestration logic.
Mitigation: Procedural knowledge stays in skills. The worker harness (`forge-worker.mjs`) is unchanged — it launches a Claude SDK session that reads the skill. Skills shrink (agent list comes from `stages`) but still encode worktree creation, gate file paths, revision loops, and error handling.

### 4. Gate file locations
Risk: Worktree vs main-root gate file resolution depends on pipeline type and stage. New schema must preserve this.
Mitigation: Gate file path is stored on the run's stage entry. Worker and conductor both read from run schema, not computed.

### 5. Observer TUI compatibility
Risk: Observer reads run.json for status, currentStep, gateState. New schema changes what it reads.
Mitigation: Keep existing run.json fields for observer compatibility. `stages` is additive. Observer migration is a separate wave.

### 6. Hook compatibility
Risk: Hooks (bash-guard, workflow-guard, gate-sync, subagent-start/stop) read run-active.json and run.json. They key on `pipelineType` and `currentStep`.
Mitigation: Map new stage/agent status back to `currentStep` strings hooks expect. Audit all hooks for field dependencies before migrating.

### 7. Token cost of conductor team selection
Risk: Conductor spending tokens on classification/presentation adds overhead per-run.
Mitigation: Classification is a Node.js script call (zero LLM tokens). Presentation is 2-3 lines. Net savings from skipping unnecessary reviewers far exceed the overhead.

### 8. Plan-stage review value
Risk: Dropping plan-stage reviewers entirely means bad plans reach implementation.
Mitigation: The plan gate (#1) is a human checkpoint. User reads the plan before approving. Plan-stage review was marginal value for most tasks — the real review happens on code.

## Migration Waves

Principle: **Wave 1 adds, Wave 2 migrates, Wave 3 removes.** At any point between waves, the system works — old and new paths coexist.

### Surface area (33 production files reference `pipelineType`, `pipelineMode`, or `currentStep`)

- **Hooks (8):** workflow-guard, worker-task-inject, subagent-start, gate-enforcement, apply-context-inject, gate-sync, observer-context-inject, worker-done-inject
- **MCP (4):** forge-worker.mjs, dashboard-state.js, server.js, stage-labels.js
- **Skills (16):** all skill SKILL.md files
- **Packages/forge-core (3):** schemas.js, createRun.js, listRuns.js
- **Scripts (3):** forge-observer.mjs, integrity-check.mjs, dashboard-server.mjs

### Wave 1 — Additive (nothing breaks)

1. Add `stages` field to run schema in `packages/forge-core/src/runs/schemas.js` (optional, alongside existing fields)
2. `forge_create_run` accepts `stages` and writes it to run.json
3. `forge_update_run` can update individual stage entries
4. Build `forge_classify_risk` as a new MCP tool (wraps existing `lean-risk-classify.mjs`, returns advisory JSON)
5. Commit+merge in conductor — already shipped (r-4f3f2683)
6. Extend `post-apply-lifecycle.mjs` with 3 new jobs: plan.md section removal, board cleanup, module touch logging

### Wave 2 — Single runId lifecycle, skills read `stages`

1. **Single runId across phases** — one `r-xxxxxx` persists from plan through code through commit. `/forge:implement` resumes the plan run instead of creating a new one. `/forge:apply` resumes the code run. No more `parentRunId` chaining for the main lifecycle (kept for debug/refactor spawned from a failed run).
2. Extend `forge_resume_run` (or new `forge_advance_stage` tool) to advance a run from one stage to the next, spawning a new worker session for the next stage.
3. Skills pass `stages` to `forge_create_run` instead of relying on hardcoded agent sequences
4. Conductor calls `forge_classify_risk` before team presentation, always shows result to user
5. Skills inside worker sessions read agent list from `stages` field instead of hardcoding sequences
6. `reviewer-dispatch.mjs` still runs but is called by the worker executor, not each skill
7. Documenter agent scope reduced to LLM-only steps (CHANGELOG, ARCHITECTURE, DECISIONS, solution capture)
8. **Test stage** added to code phase — zero LLM tokens, runs `testCommand` from project.json (or auto-discovers via `run-tests.mjs`). Placed after coder, before reviewers. On failure: coder re-invoked with test output (max 2 retries). After 2 failures: surfaced at Gate #2 as warning, user decides.
9. Old fields (`mode`, `pipelineType`, `currentStep`) still written for backward compat with hooks/observer

### Wave 3 — Cleanup

1. Remove `pipelineMode` from `.pipeline/project.json` — classifier + `classificationId` enforcement replaces it
2. Remove mode references from hooks (workflow-guard, subagent-start, gate-enforcement, etc.)
3. Remove hardcoded agent sequences from skills — skills become thin run-creation wrappers
4. Remove `reviewer-dispatch.mjs` plan-stage keyword scanning (classifier handles it)
5. Migrate observer/dashboard to read from `stages` field instead of `currentStep`
6. Update `/forge:chat` for new model
7. Remove old `mode` and `pipelineMode` fields from run schema

## Documenter Split: Agent + Script

### Decision
Split the documenter into two parts: a focused LLM agent (pre-commit) and an extended lifecycle script (post-commit).

### Pre-commit: Documenter agent (LLM, runs in worker session)
Runs in the code stage after coder + reviewers, before the commit gate. Scope limited to work that needs language understanding:

- **CHANGELOG entry** — 1-3 bullet summary of what changed
- **ARCHITECTURE update** — only when `archUpdate: true` (rarely fires)
- **DECISIONS entry** — only when `decision: true` (rarely fires)
- **Solution capture** — distill reusable patterns to `docs/solutions/`

Agent gets simpler, faster, fewer turns. No pipeline state manipulation.

### Post-commit: Extended lifecycle script (zero LLM tokens, run by conductor)
Extends existing `scripts/post-apply-lifecycle.mjs` which already handles 5 mechanical jobs. Three new jobs added:

Existing jobs (already in script):
- Archive reviewer output
- Delete inter-agent sidecars
- TESTING.md archival (>400 lines)
- CHANGELOG.md archival (>200 lines)
- Research file deletion

New jobs:
- **Plan.md section removal** — find `### Feature:` heading matching feature name, delete range
- **Board cleanup** — remove matched `planned[]` item, close matching `todos[]` entries
- **Module touch logging** — match handoff file paths against `modules.json` paths

### Why this split is correct
1. **Ownership boundary:** Agent writes committed docs. Script cleans pipeline state. No overlap.
2. **Timing fix:** Plan removal and board cleanup currently happen BEFORE commit (in documenter). If commit fails, the plan section is already gone. Post-commit is the correct timing.
3. **Token savings:** Documenter agent drops from ~10 turns to ~4. Mechanical steps cost zero LLM tokens.
4. **Script already exists:** `post-apply-lifecycle.mjs` handles 5 jobs. Adding 3 more is incremental.

### How it connects to the conductor-owned commit flow
```
Code stage (worker):
  coder → test (script) → reviewers → documenter-agent (LLM, docs only) → commit gate

Commit (conductor, after /forge:approve):
  1. git add + commit in worktree
  2. git merge worktree → main
  3. node scripts/post-apply-lifecycle.mjs "<feature>" (extended, includes plan/board/module cleanup)
  4. forge_update_run → done
```

## Test Stage (zero LLM tokens)

### Placement
After coder writes code, before reviewers. Part of the code stage — not a separate stage.

```
coder → test → reviewers → documenter → commit gate
```

### How it works
1. Worker checks for test command: `testCommand` from `.pipeline/project.json`, OR auto-discovers `scripts/run-tests.mjs` in the project root.
2. If neither exists: skip test step silently, proceed to reviewers.
3. If test command exists: run via Bash with `timeout: 120000` (2 minutes).
4. On success (exit 0): log `[test] passed` and proceed to reviewers.
5. On failure (non-zero exit): re-invoke coder with full test output as context, prefixed with `[test-failure-fix]`. Same revision loop as reviewer REVISE — max 2 retries.
6. After 2 test failures: surface at Gate #2 as a warning (not a blocker). User decides whether to approve or discard. Tests failing does NOT block the gate — the user might know better.

### Why before reviewers (not after)
No point reviewing code that doesn't pass tests. Running tests first catches obvious breakage cheaply (zero tokens). Reviewers then focus on design, safety, and correctness — not syntax errors or missing imports.

### Auto-discovery
Projects that set `testCommand` in project.json use it. Projects without `testCommand` but with `scripts/run-tests.mjs` (like the FORGE plugin itself) auto-discover it. Projects with neither skip the step entirely. No configuration required for test-less projects.

## Full Flow: End-to-End

### 1. User describes work
User says: "Fix the gate-sync path traversal bug" or picks a task from the board.

### 2. Conductor classifies (zero LLM tokens)
Conductor calls `forge_classify_risk` (Node.js script via MCP tool) with:
- Feature description
- Affected file paths (from task or user input)

Script returns classification:
```json
{
  "classificationId": "cls-a1b2c3",
  "suggestedReviewers": ["reviewer-safety", "reviewer-boundary"],
  "triggeredRules": ["hook-path:hooks/", "shell-spawn:hooks/bash-guard.js"],
  "riskLevel": "moderate",
  "reason": "hook-script path + security keyword",
  "planStageReview": false
}
```

### 3. Conductor presents team and waits for approval
```
Task: Fix gate-sync path traversal bug
Classifier: reviewer-safety + reviewer-boundary (hook-script, security keyword)

Plan stage:  planner (no plan-stage reviewers)
Code stage:  coder + reviewer-safety + reviewer-boundary
Commit:      conductor (direct)

Approve?
```
User can accept, add/remove agents, or override entirely.

### 4. Plan stage (worker session)
Conductor calls `forge_create_run` with ALL stages for the full lifecycle:
```json
{
  "pipelineType": "plan",
  "classificationId": "cls-a1b2c3",
  "stages": {
    "plan":   { "agents": ["planner"], "status": "pending" },
    "code":   { "agents": ["coder", "reviewer-safety", "reviewer-boundary", "documenter"], "status": "pending" },
    "commit": { "agents": [], "status": "pending" }
  }
}
```
One runId (e.g. `r-a1b2c3d4`) is created and persists across ALL stages. Worker spawns (no worktree — plan runs in main project root), runs planner. Planner writes `docs/PLAN.md`.
Worker writes gate #1 and exits. Run status: `gate-pending`, stages.plan.status: `gate-pending`.

**Conductor presents plan to user. User approves or discards.**

### 5. Code stage (same runId, new worker session)
Conductor calls `forge_advance_stage` (or extended `forge_resume_run`) with the **same runId**:
```json
{
  "runId": "r-a1b2c3d4",
  "stage": "code",
  "spawnWorker": true
}
```
No new run created — the existing run advances. Worker spawns (creates worktree, linked to this run), executes agents in order:

```
coder-scout (script, optional)
    ↓
coder (writes source files + handoff.md)
    ↓
test (script, zero LLM — runs testCommand or run-tests.mjs)
    ↓ [if fail: coder re-invoked with test output, max 2 retries]
    ↓
reviewer-safety → reviewer-boundary (parallel)
    ↓
[if REVISE: coder revision loop, max 2]
    ↓
documenter-agent (CHANGELOG, ARCHITECTURE, DECISIONS, solution capture)
    ↓
commit gate — worker writes gate and EXITS
```

Run stays `r-a1b2c3d4` throughout. stages.code.status tracks progress.

**Conductor presents summary to user. User approves or discards.**

### 6. Commit (same runId, conductor session — no worker)
After user approves the commit gate, conductor runs directly (still `r-a1b2c3d4`):

```
1. git -C <worktree> add <files>     (stage individually)
2. git -C <worktree> commit           (feat(forge): <feature>)
3. node bin/forge-worktree.js merge   (merge worktree → main)
4. node scripts/post-apply-lifecycle.mjs "<feature>"
   - Archive reviewer output
   - Delete sidecars
   - Remove plan section from PLAN.md
   - Close board todos + remove planned item
   - Log module touches
   - Archival (changelog/testing overflow)
   - Delete research file
5. forge_update_run → done
```

### Variations

**Debug flow:** Same 3 stages, but code stage uses `debug` agent instead of `coder`:
```
Plan stage:  skipped (bug description IS the plan)
Code stage:  debug + reviewer-safety
Commit:      conductor
```

**Refactor flow:**
```
Plan stage:  planner (optional — user may skip for small refactors)
Code stage:  refactor + reviewer-style
Commit:      conductor
```

**Direct edit (no worker):**
```
Conductor edits files directly
Conductor commits
Conductor runs post-apply-lifecycle.mjs
```
No agents, no gates. For zero-risk changes (docs, config, renames).

**Research (no commit):**
```
researcher agent runs, writes to docs/RESEARCH/
No code stage. No commit stage.
```

### What Dies

| Thing | Why |
|-------|-----|
| Pipeline modes (SPRINT/LEAN/STANDARD/FULL) | Team selection IS the mode |
| `pipelineMode` in project.json | Replaced by classifier + `classificationId` enforcement |
| Apply skill / apply pipeline type | Conductor owns commit; documenter moves to code stage |
| `reviewer-dispatch.mjs` as decision-maker | Becomes `forge_classify_risk` advisory tool |
| Plan-stage keyword reviewer dispatch | Conductor decides; default is no plan-stage reviewers |
| Skills as agent sequence orchestrators | Skills become thin run-creation wrappers |
| `post-apply-lifecycle.mjs` running in worker | Moves to conductor, post-commit |

### What Survives

| Thing | Role |
|-------|------|
| Risk classifier rules (path + content patterns) | Advisory input to conductor |
| `[force-review]` token | Operator override — all reviewers |
| Gates (plan, code, commit) | Human checkpoints |
| Worker sessions | Execute agent teams autonomously |
| `forge-worker.mjs` | Harness unchanged — launches SDK session, skill reads `stages` for agent list |
| All 31 agent .md files | Unchanged — agents don't know about modes or pipelines |
| Observer TUI | Reads run.json — `stages` field is additive |
| All hooks | Continue to fire — audit for field dependencies during migration |

## Full Agent Map

### Pre-pipeline (conductor session, interactive)

| Agent | Trigger | Notes |
|-------|---------|-------|
| brainstormer | Vague input (no acceptance criteria, no file paths, <200 words) | Runs in conductor — needs interactive Q&A. Writes requirements doc to `docs/brainstorms/` |
| researcher | User asks exploratory question, or conductor needs external context | Optional pre-pipeline; also available in plan stage (worker) |

### Plan stage (worker session)

| Agent | Trigger | Notes |
|-------|---------|-------|
| **planner** | Always (baseline) | Reads brainstorm doc if exists, writes `docs/PLAN.md` |
| gotcha-checker | `docs/gotchas/GENERAL.md` exists and >10 lines | Checks plan against known project pitfalls |
| researcher | Plan has `### Research needed` section | Investigates unknowns, writes to `docs/RESEARCH/` |
| reviewer-safety | Classifier: shell/fs/auth/crypto/network/hook paths | Plan-stage review only when classifier signals risk |
| reviewer-boundary | Classifier: schema/contract/signal/MCP tool/merge paths | Plan-stage review only when classifier signals risk |
| reviewer-logic | Classifier: complex state, async, conditional chains | Plan-stage review — rare, high-complexity only |
| reviewer-performance | Classifier: hot path, blocking I/O, memory patterns | Plan-stage review — rare |

### Code stage (worker session)

| Agent | Trigger | Notes |
|-------|---------|-------|
| **coder** / **debug** / **refactor** | Always — one of the three is baseline core | Which one depends on pipeline type (implement/debug/refactor) |
| implementation-architect | >8 active tasks OR >3 top-level directories OR risky keywords | Narrows scope to smallest safe slice before coder runs |
| coder-scout | Always (script, not LLM) | Maps files the coder needs. Skipped in SPRINT |
| completeness-checker | >5 active tasks (script, not LLM) | Verifies handoff covers all plan tasks |
| reviewer-safety | Classifier signals | Same rules as plan stage — shell/fs/auth/network/hook |
| reviewer-boundary | Classifier signals | Schema/contract/signal/merge boundaries |
| reviewer-logic | Classifier signals OR complex state changes | Conditional chains, async flows, data transforms |
| reviewer-style | >3 files changed OR new public API | Naming conventions, formatting, consistency |
| reviewer-performance | Classifier signals OR hot-path changes | Blocking I/O, memory leaks, unscalable patterns |
| **documenter** | Always (baseline) — LLM steps only | CHANGELOG, ARCHITECTURE, DECISIONS, solution capture |

### Post-commit (script, zero LLM tokens)

No agents. `post-apply-lifecycle.mjs` runs mechanically:
- Archive reviewer output, delete sidecars
- Plan.md section removal, board cleanup, module touch logging
- CHANGELOG/TESTING archival, research file deletion

### Standalone (not part of the 3-stage pipeline)

| Agent | When used |
|-------|-----------|
| architect | `/forge:init` or explicit architecture audit |
| critic | `/forge:ideate` — adversarial analysis |
| red-team | Explicit security audit request |
| compound-refresh | Knowledge store maintenance (manual) |
| skills-generator | Generate gotcha files for new tech stacks |
| supervisor | Produces implementation briefs (Gemini via `forge_call_external`) |

### Classifier Signals → Agent Additions

| Signal | Plan stage adds | Code stage adds |
|--------|----------------|-----------------|
| Shell / child_process / spawn | reviewer-safety | reviewer-safety |
| fs writes/deletes outside .pipeline/ | reviewer-safety | reviewer-safety |
| Auth / crypto / secret handling | reviewer-safety | reviewer-safety |
| Network (HTTP, fetch, servers) | reviewer-safety + boundary | reviewer-safety + boundary |
| New MCP tools / hook scripts | reviewer-safety + boundary | reviewer-safety + boundary |
| Schema / contract changes | reviewer-boundary | reviewer-boundary |
| Signal format changes | reviewer-boundary | reviewer-boundary |
| Merge / worktree boundary code | reviewer-safety + boundary | reviewer-safety + boundary |
| Complex state / async patterns | reviewer-logic | reviewer-logic |
| Hot path / blocking I/O | reviewer-performance | reviewer-performance |
| >3 files changed | — | reviewer-style |
| `[force-review]` token | all 5 reviewers | all 5 reviewers |
| Classifier enforcement (mandatory) | per triggered rules | per triggered rules |

## Knowledge Integration (forge_knowledge)

The `forge_knowledge` flywheel maps cleanly to the conductor-driven model with no structural changes needed.

### Read side — consuming knowledge

| Stage | Agent | Tool | What it reads |
|-------|-------|------|---------------|
| Plan | planner | `forge_get_patterns` | Reusable patterns relevant to the feature area |
| Plan | gotcha-checker | `forge_get_constraints` | Known constraints and pitfalls for affected modules |
| Code | coder / debug / refactor | `forge_get_patterns` | Implementation patterns for the specific files being changed |

### Write side — producing knowledge

| Stage | Agent/Script | Tool | What it writes |
|-------|-------------|------|----------------|
| Code | coder / debug | `forge_add_learning` | New patterns discovered during implementation |
| Code (pre-commit) | documenter agent | file write | Solution docs to `docs/solutions/` |
| Post-commit | lifecycle script | — | Module touch logging (which modules were changed) |

### Conductor integration

During team presentation (Step 3 in the full flow), the conductor can surface `forge_get_patterns` matches:

```
Task: Fix gate-sync path traversal bug
Classifier: reviewer-safety + reviewer-boundary (hook-script, security keyword)
Knowledge: 2 patterns match — "hook path resolution" (from r-abc123), "gate file validation" (from r-def456)

Plan stage:  planner (no plan-stage reviewers)
Code stage:  coder + reviewer-safety + reviewer-boundary
Commit:      conductor (direct)

Approve?
```

This gives the user visibility into what the system already knows about this kind of work, without adding agents or tokens.

## Open Questions

1. ~~Does documenter survive as a separate agent, or does it fold into a post-commit script?~~ **Resolved:** Split — agent for docs, script for cleanup.
2. ~~Should the conductor present the classifier recommendation automatically, or only when it differs from the conductor's choice?~~ **Resolved:** Always show. Classifier output is 1-2 lines, zero LLM tokens. Hiding it when conductor agrees removes the user's ability to spot false negatives.
3. ~~How does `/forge:chat` (natural language intent) interact with conductor team selection?~~ **Deferred:** Keep `/forge:chat` as-is. Update during migration when the new model is concrete enough to know what needs changing.
4. ~~Should we keep separate plan/implement/debug/refactor pipeline types, or unify into a single "run" type with different agent teams?~~ **Resolved:** Keep separate types. Each encodes workflow differences (worktree creation, plan skip, commit ownership) that would become messy conditionals in a unified type. The `stages` field is additive — it tells the worker which agents, the type tells it which workflow pattern.
