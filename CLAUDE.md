# FORGE Pipeline — Runtime Instructions

These rules govern how FORGE operates in any project where the plugin is installed.

## Conductor sessions

If `.pipeline/.worker-session` does NOT exist in the project root, this is a **conductor session**. Conductor sessions orchestrate pipelines and manage workflow.

(`.pipeline/.worker-session` is the durable marker — written by `hooks/worker-task-inject.js` at SessionStart and persisted for the worker's lifetime. The transient task file `.pipeline/worker-task-<runId>.json` is consumed and deleted by `worker-task-inject.js` immediately after injection, so it is NOT a reliable discriminator after the first prompt.)

**Conductor rules (mandatory — override default behavior):**
- Do NOT use the Agent tool for ad-hoc work. No Explore, no general-purpose, no claude-code-guide — no ad-hoc subagents.
- **Pipeline skills are exempt:** `/forge:plan`, `/forge:implement`, `/forge:debug`, `/forge:refactor`, `/forge:research`, `/forge:explore` invoke agents as in-session subagents. This is expected and allowed — the skill handles run creation, model routing, and agent dispatch.
- For quick lookups (1-2 tool calls): use Read/Grep/Glob directly — no worker needed.
- **Inline gate approval (gate1/gate2):** when the user says "approve", execute inline — no `/forge:approve` skill needed. ("approve" is the only gate-approval trigger keyword by design — the friction is intentional.)
  1. `forge_list_runs({ status: "gate-pending" })` — if multiple, pick most recently updated. Then `forge_check_gate({ runId })` — extract `gate`, `feature`.
  2. `forge_set_gate({ gate, feature, status: "approved", runId })`
  3. `forge_update_run({ runId, gateState: { ...existing, status: "approved", approvedAt: <now ISO> } })` — do NOT set `status: "completed"`. The run stays `gate-pending` with an approved gateState until commit+merge.
  4. If `gate` is `"gate1"`: read `run.stages.implement.agents` from the run object fetched in step 1, then call `forge_advance_stage({ runId, targetStage: "implement", agents: run.stages.implement.agents })`. Print: "Gate 1 approved — implement worker spawned. Use /forge:approve when Gate #2 is ready."
  5. Print next step: gate1 → already printed above, gate2 → "Worker resumes automatically — the commit will be bundled when it is ready"
  6. If `gate` is `"commit"`: execute MERGE inline (mirrors `skills/approve/SKILL.md` Step 4 — that doc is canonical). The worker has already committed in the worktree via apply Step 3c (closes TODO `38bca814`). The conductor only merges; it never stages or commits. Summary:
     - When `worktreePath` is non-null: optionally check `git -C <worktreePath> status --porcelain` and log a warning for any uncommitted files (means worker's apply commit failed — do NOT auto-stage and ship potentially BLOCKED work). Then run `node bin/forge-worktree.js merge <runId>`. On failure, log and instruct manual resolution — never force-merge.
     - When `worktreePath` is null: skip merge (apply commit was in main root already).
     - Auto-PR (only when `.pipeline/project.json` `gitIntegration.autoPR` is true): `git push -u origin HEAD` then `gh pr create --title "feat(forge): <safe-feature>" --body "Applied via FORGE pipeline"`.
     - After merge (or no-merge for null worktree): `forge_update_run({ runId, status: "completed" })`. When `worktreePath` is non-null, also mark the source implement/debug/refactor run (extracted from the worktree path's last segment) as `status: "completed"`. Print: `Commit approved for '<feature>'. Merged.`
     - Forbidden ops: `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`.
- **After gate2 approval:** the existing worker resumes automatically and handles apply (documenter, lifecycle, commit gate). NEVER invoke `/forge:apply` unless the worker is confirmed dead (`status: "failed"` or `"discarded"`). The apply skill is manual recovery only.
- **Commit gates** are inline-approvable using the same keywords on line 15 — the conductor calls `forge_set_gate` (with `gate: "commit"`) and then executes the merge inline per step 6 above (the worker already committed in apply Step 3c). The `/forge:approve` skill remains the canonical implementation (`skills/approve/SKILL.md` Step 4) and a manual fallback for direct invocation; both paths must produce the same outcome.
- **Approach-first protocol (MANDATORY):** Before ANY direct file edit, present the approach to the user — what will change, which files, why — and wait for explicit approval. Only the literal word "approve" counts as authorization. The conductor narrating intent ("let me fix", "I'll update") is NOT self-authorization. This applies even for obvious one-line fixes, even in auto mode.

Worker sessions load `CLAUDE-WORKER.md` via the `worker-task-inject.js` hook at SessionStart.

## Pipeline types and agent sets

Pipeline **types** (the slash command) determine which agents run. Reviewer dispatch is driven by risk surface — see `scripts/reviewer-dispatch.mjs`.

| Type | Command | Agent set | Gate |
|------|---------|-----------|------|
| Plan feature | `/forge:plan` | planner, researcher, gotcha-checker, script-dispatched reviewers | #1 |
| Implement feature | `/forge:implement` | coder, script-dispatched reviewers | #2 |
| Implement feature (scoped) | `/forge:implement` | implementation-architect, coder, script-dispatched reviewers | #2 |
| Apply feature | `/forge:apply` | documenter | none |
| Debug | `/forge:debug` | debug, coder, script-dispatched reviewers | #2 |
| Apply debug | `/forge:apply` | documenter | none |
| Refactor | `/forge:refactor` | refactor, coder, script-dispatched reviewers | #2 |
| Apply refactor | `/forge:apply` | documenter | none |
| Research | `forge_create_run` with `spawnWorker: true` | researcher (worker session) | none |
| Architect | (direct) | architect, reviewer-logic | #1 |
| Ideate | `/forge:ideate` | critic | none |

### Run stages

Each run has a `stages` map — the conductor sets it at run creation, workers read it to dispatch agents.

```json
"stages": { "<stage>": { "agents": ["planner"], "status": "pending" } }
```

| Field | Description |
|-------|-------------|
| Stage key | Pipeline phase: `plan`, `implement`, `review`, `apply`, `debug`, `refactor`, `research` |
| `agents` | Which agents the worker should dispatch for this stage |
| `status` | Progress: `pending` → `running` → `completed` \| `skipped` (cannot roll back from completed/skipped) |

`stages` is `null` until populated. Pass it to `forge_create_run` to set the initial value; use `forge_update_run` to advance status. Stage updates merge into the map — existing keys preserved, new keys added, provided keys overwritten. The dashboard derives its activity label from the first stage with `status === "running"`.

Workers call `forge_get_run`, extract `stages.<stage>.agents`, and dispatch exactly those agents — never a hardcoded list.

### Pre-run classification (forge_classify_risk)

Before calling `forge_create_run`, the conductor calls `forge_classify_risk` to assess the planned change:

```
forge_classify_risk({ feature, filePaths, forceReview? })
  → { classificationId, riskLevel, advisories, planStageReview, reviewers }
```

| Output | Use |
|--------|-----|
| `classificationId` | Pass to `forge_create_run` → stored on `run.classificationId` for audit trail |
| `riskLevel` + `advisories` | Show to user before starting the pipeline |
| `planStageReview` | Whether reviewers should run at plan stage |
| `reviewers` | Advisory suggested reviewers (shown to user; plan pipeline uses this) |

The conductor uses the classification result to populate `stages.<stage>.agents` when creating the run. This is the link between classification and worker dispatch: conductor classifies → sets `stages` → worker reads `stages.<stage>.agents` and executes.

**Mandatory present-and-wait (applies to all four pipeline skills):**

After displaying the classification result and before calling `forge_create_run`, the conductor MUST:

1. Present the full resolved agent team — core pipeline agents for the pipeline type plus `reviewers` from the `forge_classify_risk` output.
2. Display a formatted agent list so the user can see who will run.
3. Pause with the canonical phrase: **"Waiting for approval — type 'go' or 'approve' to proceed, or describe changes to the team"**
4. Call `forge_create_run` only after the user responds affirmatively ("go", "approve", "yes", or equivalent).

This applies to `/forge:plan`, `/forge:implement`, `/forge:debug`, and `/forge:refactor`. The user may request changes to the team before approving — adjust the agent list and re-present before proceeding.

**Two distinct classifiers — do not conflate:**

| Classifier | When | Authority |
|-----------|------|-----------|
| `forge_classify_risk` | Pre-run, before worktree exists | Advisory — shown to user, stored as `classificationId` |
| `scripts/lean-risk-classify.mjs` | Post-handoff, after coder/refactor/debug writes `handoff.md` | Authoritative — drives actual reviewer dispatch |

## Task approach protocol

When starting work on any task from the backlog or TODO list:

### Step 1 — Read the task
Read the full task details from `.pipeline/board.json`.

### Step 2 — Assess the task
Understand what the task involves: which files, what complexity, what risk.

### Step 3 — Decide the agent team
Based on the assessment, determine which agents are needed. The pipeline type follows from this.

**Reviewer dispatch** — `scripts/reviewer-dispatch.mjs` determines which reviewers to invoke. It replaces the reviewer-triage agent. The script maps risk-surface rules to specific reviewers deterministically — no LLM needed.

**Risk surface** — the classifier (`scripts/lean-risk-classify.mjs`) scans handoff code blocks for these patterns and the dispatch script maps each to the appropriate reviewer:

| Risk pattern | Reviewer |
|---|---|
| Shell / `child_process` / process spawning | `reviewer-safety` |
| `fs` writes or deletes outside `.pipeline/` | `reviewer-safety` |
| Auth / crypto / secret / credential handling | `reviewer-safety` |
| Security-sensitive path / env-var resolution | `reviewer-safety` |
| Network boundaries (HTTP, fetch, servers) | `reviewer-safety` + `reviewer-boundary` |
| New MCP tools, hook scripts, commands | `reviewer-safety` + `reviewer-boundary` |
| Schema / contract changes | `reviewer-boundary` |
| Signal format changes | `reviewer-boundary` |
| Merge / apply / worktree boundary code | `reviewer-safety` + `reviewer-boundary` |

When the classifier cannot confirm safety (missing verification, blockers present, unclean) but no specific rules trigger, the script falls back to `reviewer-safety` + `reviewer-boundary`.

For plan-stage dispatch, the script keyword-scans active task lines and maps to reviewers (safety, boundary, logic, performance) based on domain keywords.

**Contextual agents** — dispatched based on pipeline type and risk surface: `implementation-architect` (scoped implement), `researcher` (plan + research pipelines), `gotcha-checker` (plan pipeline), `reviewer-logic` (architect pipeline; logic risk surface), `reviewer-performance` (performance risk surface), `reviewer-style` (refactor pipeline; style surface).

### Step 4 — The agent team determines the pipeline

| Agent team | Pipeline |
|------------|----------|
| No reviewers needed | direct (single file, low risk) |
| Reviewers needed + new feature | `/forge:plan` then `/forge:implement` |
| Reviewers needed + broken behaviour | `/forge:debug` |
| Reviewers needed + cleanup | `/forge:refactor` |

### Step 5 — Present and wait for approval

Before doing anything, present the full agent team and pipeline with reasoning. Wait for explicit user approval before starting.

## Model routing

Before each agent invocation, resolve which model and execution path to use:

1. Call `forge_get_model_recommendation` with the agent name.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop — do not proceed to the agent.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.

## Tool efficiency

Use dedicated tools over Bash: `Read` not `cat`, `Glob` not `find`, `Grep` not `grep`, `Edit` not `sed`. Prefer `forge_*` MCP tools for pipeline state; fall back to direct file reads if MCP unavailable. `hooks/bash-guard.js` enforces this as a backstop.

**No subagents for file reads.** Use `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research or protecting context from large outputs.
