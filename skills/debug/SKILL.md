---
name: forge:debug
description: "Run the FORGE debug pipeline. Use when: user reports a bug, something is broken, or tests are failing."
argument-hint: "[bug description]"
allowed-tools: "Read Write Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run and worktree (MANDATORY — do this FIRST, before anything else)

**1a. Create the run.**

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"debug"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: a short summary of the bug from `$ARGUMENTS` (e.g. "price fetch returns empty array")

Save the returned `runId`. You MUST reference it in all later steps.

**1b. Create the worktree.**

Call `forge_create_worktree` with the `runId`. This creates:
- a git worktree at `.worktrees/<runId>/`
- a branch `forge/<runId>`
- copies `.pipeline/` and `docs/` into the worktree

Save the returned `worktreePath`. All agent work in this pipeline happens inside this path.

**1c. Mark running.**

Call `forge_update_run` with the `runId` and `status: "running"`, `currentStep: "setup"`.

Do NOT skip any of these sub-steps. Do NOT check for existing runs first. Every /forge:debug invocation creates exactly one new run with its own worktree.

> See **Model routing** in CLAUDE.md.

## STEP 2 — Run debug pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "debug"`.

**All agents in this step work inside the worktree.** When spawning the debug agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Debug agent:** traces root cause, writes fix plan to `<worktreePath>/docs/context/handoff.md`
2. **LEAN-lite reviewer gate** — **LEAN mode only**. In STANDARD and FULL, skip this step entirely and proceed to step 3.
   - Run via Bash: `node scripts/lean-risk-classify.mjs --handoff=<worktreePath>/docs/context/handoff.md`. Append the flag `--force-review` to the command if the operator's original `$ARGUMENTS` (or the current user prompt in this session) contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "skipReviewers": <bool>, "reasons": [...], "triggeredRules": [...] }`) and write it to `<worktreePath>/docs/context/lean-gate.json` for post-run auditability.
   - Log a single stderr line: `[lean-gate] skip=<bool> reasons=[<comma-joined>] triggered=[<comma-joined>]`.
   - Decision: if `skipReviewers` is `true`, skip step 3 entirely (no reviewer-triage, no reviewer dispatch) and proceed directly to step 4 (Gate #2). If `skipReviewers` is `false`, proceed to step 3 as normal.
   - The policy this enforces is documented in `CLAUDE.md` under "LEAN-lite skip rule" and "Risk surface". Do not override the classifier's verdict — if a reviewer pass is genuinely desired on a non-risk LEAN change, the operator re-invokes with `[force-review]`.
3. **Reviewer-triage → reviewers:** dispatch based on mode. Skipped when step 2 set `skipReviewers: true`.
4. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<bug summary>","createdAt":"<now ISO>"}`
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<bug summary>","status":"pending","applyKeyword":"apply debug: <bug summary>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the debug fix summary to the user
   - Ask user to type /forge:approve or /forge:discard

After approval, run /forge:apply.

## Bug description
$ARGUMENTS
