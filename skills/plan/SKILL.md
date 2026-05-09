---
name: forge:plan
description: "Run the FORGE plan feature pipeline. Use when: user wants to plan a new feature, asks 'plan this', or describes a feature to build."
argument-hint: "[feature description]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Assess input and optional brainstormer (conductor)

Read the feature request below. Check these signals:

**Input is detailed when ANY of these are true:**
- Input has numbered acceptance criteria (e.g. "(1) does X, (2) handles Y")
- Input names specific file paths
- Input has "Affected areas:" section
- Input specifies the technical approach
- Input is longer than 200 words with clear deliverables

**Input is vague when:**
- Input is short and lacks specifics
- Input describes a goal without concrete requirements
- Input uses exploratory language ("something like", "maybe", "make it")

### If input is detailed — dispatch worker directly

**Before creating the run**, call `forge_classify_risk` with:
- `feature`: the short feature summary derived from the user's input
- `filePaths`: `[]` (no files known at plan stage)
- `forceReview`: `true` if the input contains the literal token `[force-review]`, otherwise `false`

Present the classification result to the user:
```
Risk classification:
  Risk level:        <riskLevel>
  Triggered rules:   <advisories joined by ", " or "none">
  Plan-stage review: <planStageReview>
  Suggested reviewers: <reviewers joined by ", " or "none">
```

Present the resolved agent team to the user before proceeding:
```
Agent team for this run:
  Core agents:  planner, gotcha-checker[, researcher — if research needed]
  Reviewers:    <reviewers from forge_classify_risk, or "none">
```
Waiting for approval — type 'go' or 'approve' to proceed, or describe changes to the team

Call `forge_create_run` (only after user approves) with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"plan"`
- `feature`: a short summary derived from the user's input
- `spawnWorker`: `true`
- `useWorktree`: `true`
- `classificationId`: the `classificationId` value from the `forge_classify_risk` result
- `stages`: `{ "plan": { "agents": ["planner"], "status": "pending" } }`

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Gate #1 will pause the worker. Use /forge:approve when ready."

Exit — do not proceed to further steps.

### If input is vague — brainstorm in-session first

The brainstormer MUST run in the conductor session because it needs interactive Q&A with the user. Workers cannot relay questions back.

1. Use `forge_get_model_recommendation` with agent name `brainstormer` to get the model.
2. Invoke the **brainstormer** agent in-session via `Agent(subagent_type="brainstormer", model=<family>)`. It emits `[questions]` for the user to answer, then writes a requirements doc to `docs/brainstorms/`.
3. After the brainstormer completes and the requirements doc exists, **call `forge_classify_risk`** with:
   - `feature`: a short summary derived from the brainstorm doc
   - `filePaths`: `[]`
   - `forceReview`: `true` if the original user input contained `[force-review]`, otherwise `false`

   Present the classification result to the user:
   ```
   Risk classification:
     Risk level:        <riskLevel>
     Triggered rules:   <advisories joined by ", " or "none">
     Plan-stage review: <planStageReview>
     Suggested reviewers: <reviewers joined by ", " or "none">
   ```

   Present the resolved agent team to the user before proceeding:
   ```
   Agent team for this run:
     Core agents:  planner, gotcha-checker[, researcher — if research needed]
     Reviewers:    <reviewers from forge_classify_risk, or "none">
   ```
   Waiting for approval — type 'go' or 'approve' to proceed, or describe changes to the team

4. Dispatch the worker (only after user approves):

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"plan"`
- `feature`: a short summary derived from the brainstorm doc
- `spawnWorker`: `true`
- `useWorktree`: `true`
- `classificationId`: the `classificationId` value from the `forge_classify_risk` result
- `stages`: `{ "plan": { "agents": ["planner"], "status": "pending" } }`

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Gate #1 will pause the worker. Use /forge:approve when ready."

Exit — do not proceed to further steps.

<!-- Step 2 below is executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 2 — Run planner pipeline (worker)

**Before dispatching agents:**

1. Call `forge_get_run` with the `runId` from the run creation. Extract `stages.plan.agents` — this is the list of agents to dispatch for the plan stage.
2. Dispatch exactly the agents listed in `stages.plan.agents`.

**Agent execution:**

1. **Planner:** reads brainstorm doc (if exists), GENERAL.md, codebase. Writes `docs/PLAN.md`. The planner does NOT ask questions. The worker's cwd is the run's worktree (`<worktreePath>`) — `docs/PLAN.md` resolves relative to the worktree, not the main project root.

1b. **Commit PLAN.md to the worktree branch:** After the planner finishes, commit the plan so the worktree branch has a real commit at gate1 time (not just uncommitted edits). Run via Bash: `git -C <worktreePath> add docs/PLAN.md && git -C <worktreePath> commit -m "plan(forge): <feature> [<runId>]"`. If git fails or there's nothing new to commit, log `[plan] commit skipped: <reason>` and continue. This step exists to preserve a clean multi-commit branch (plan → phases → apply) and to make parallel-plan PLAN.md merges 3-way-resolvable.

2. **Conditional researcher:** read `### Research needed` in PLAN.md. Skip if absent/empty.
4. **Gotcha-checker + Researcher (concurrent when both needed):** If both gotcha-checker and researcher are needed (researcher not skipped), spawn them in a single concurrent Agent dispatch (one tool call, two agents). Gate #1 waits for both to finish before proceeding. If only one is needed, run it sequentially.
5. **Reviewer dispatch** — determine which reviewers to invoke via the deterministic dispatcher script.
   - **Clear stale reviewer output first.** Delete every `*.md` file under `<worktreePath>/.pipeline/context/reviewer-output/` before dispatching reviewers. Without this, a stale file from a previous run blocks the new reviewer's Write call (Claude Code refuses to Write to a file that has not been Read in the current session — observed silent failure on r-ad7b145e and r-d5b1ccd9). Run via Bash: `find <worktreePath>/.pipeline/context/reviewer-output -maxdepth 1 -name '*.md' -delete 2>/dev/null || true` — if the directory doesn't exist yet, the command is a no-op. Do not block on the cleanup.
   - Run via Bash: `node scripts/reviewer-dispatch.mjs --plan=<worktreePath>/docs/PLAN.md --stage=plan`.
   - Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`).
   - Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
   - **Before spawning each reviewer**, prepend the following signal line to the reviewer's prompt so the reviewer writes its verdict to the per-run directory:

     > `[reviewer-output-dir: <worktreePath>/.pipeline/context/reviewer-output/]`

   - Dispatch exactly the reviewers listed in `reviewers[]`. Use `forge_get_model_recommendation` for each. Pass `[plan-stage review]` prefix in each reviewer's prompt. No reviewer-triage agent.
6. **Gate #1:** Write gate file first, then update the run (the worker exits on status change, so the file must exist first):
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate1","feature":"<feature name>","status":"pending","plan":"<worktreePath>/docs/PLAN.md"}` (absolute path so the user can locate the worktree's PLAN.md unambiguously).
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate1","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the plan summary to the user; include the absolute path `<worktreePath>/docs/PLAN.md` so they know which file to review (each plan run lives in its own worktree).
   - Ask user to type /forge:approve or /forge:discard — the implement worker will start automatically on approval

## Feature request
$ARGUMENTS
