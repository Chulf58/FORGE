---
name: implement
description: "Run the FORGE implement feature pipeline. Use when: user approved Gate #1 and wants to implement the planned feature."
argument-hint: "[feature name]"
context: fork
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run and worktree (MANDATORY — do this FIRST, before anything else)

**1a. Create the run.**

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"implement"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading

Save the returned `runId`. You MUST reference it in all later steps.

**1b. Create the worktree.**

Call `forge_create_worktree` with the `runId`. This creates:
- a git worktree at `.worktrees/<runId>/`
- a branch `forge/<runId>`
- copies `.pipeline/` and `docs/` into the worktree

Save the returned `worktreePath`. All agent work in this pipeline happens inside this path.

**1c. Mark running.**

Call `forge_update_run` with the `runId` and `status: "running"`, `currentStep: "setup"`.

Do NOT skip any of these sub-steps. Do NOT check for existing runs first. Every /forge:implement invocation creates exactly one new run with its own worktree.

## STEP 2 — Read plan and check blockers

Read `<worktreePath>/docs/PLAN.md` for the approved plan. Use the worktree path, not the main project root.

Check if the target task has a non-empty `blockedBy` array (via `forge_read_board` or reading `.pipeline/board.json` in the main project). If the task is blocked, warn the user: "This task is blocked by: [blocker IDs]. Resolve blockers first or confirm you want to proceed anyway." Wait for confirmation before continuing.

## Model routing (optional)

Before spawning each agent, you may call `forge_get_model_recommendation` with the agent name and budget mode to check the optimal model. If the recommendation differs from the agent's frontmatter `model:` field, pass the recommended model via the Agent tool's `model` parameter. This is advisory — if the MCP tool is unavailable, use the frontmatter default.

## STEP 2b — Scoping check (conditional implementation-architect)

After reading the plan, assess whether the next implementation slice needs narrowing. Apply this checklist against the active `[ ]` task lines in the current feature section:

1. **Large plan** — count the active `[ ]` task lines. More than 8 = structurally complex.
2. **Broad file spread** — extract the file paths from task lines (text in backticks). Count unique top-level directories (e.g. `src/main/`, `src/renderer/`, `hooks/`). Three or more = cross-cutting.
3. **Risky keywords** — any task description contains: "migrate", "refactor", "rename across", "shared state", "store", "schema", "cross-module", or "move from".

**If ANY condition is true:** invoke `implementation-architect` before the coder.

- Update the run: `forge_update_run` with `currentStep: "implementation-architect"`
- Spawn the `implementation-architect` agent. Prepend the worktree path instruction (same as below). Pass the feature name in the prompt.
- It reads the plan and writes `<worktreePath>/docs/context/slice-brief.md`
- The coder will then scope to the slice brief instead of the full plan

**If NONE are true:** skip directly to Step 3.

## STEP 3 — Run implement pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "coder"`.

**All agents in this step work inside the worktree.** When spawning each agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Coder-scout** (skip in LEAN): writes `<worktreePath>/docs/context/scout.json`
2. **Coder:** writes draft to `<worktreePath>/docs/context/handoff.md`
3. **Completeness-checker** (skip in LEAN): verifies plan coverage
4. **Reviewer-triage → reviewers:** dispatch based on mode
5. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}`
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"gate":"gate2","feature":"<feature name>","status":"pending","applyKeyword":"apply feature: <feature>"}`
   - Present the implementation summary to the user
   - Ask user to type /forge:approve or /forge:discard

$ARGUMENTS
