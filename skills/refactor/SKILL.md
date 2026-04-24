---
name: forge:refactor
description: "Run the FORGE refactor pipeline. Use when: user wants to clean up, restructure, or improve existing code."
argument-hint: "[file or area to refactor]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run and worktree (MANDATORY — do this FIRST, before anything else)

**1a. Create the run.**

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"refactor"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: a short summary of the refactor target from `$ARGUMENTS` (e.g. "split handlers.js into per-domain modules")

Save the returned `runId`. You MUST reference it in all later steps.

**1b. Create the worktree.**

Call `forge_create_worktree` with the `runId`. This creates:
- a git worktree at `.worktrees/<runId>/`
- a branch `forge/<runId>`
- copies `.pipeline/` and `docs/` into the worktree

Save the returned `worktreePath`. All agent work in this pipeline happens inside this path.

**1c. Mark running.**

Call `forge_update_run` with the `runId` and `status: "running"`, `currentStep: "setup"`.

Do NOT skip any of these sub-steps. Do NOT check for existing runs first. Every /forge:refactor invocation creates exactly one new run with its own worktree.

> See **Model routing** in CLAUDE.md.

## STEP 2 — Run refactor pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "refactor"`.

**All agents in this step work inside the worktree.** When spawning the refactor agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Refactor agent:** analyzes the target file or area, writes refactor plan to `<worktreePath>/docs/context/handoff.md`
2. **Reviewer dispatch** — determine which reviewers to invoke via the deterministic dispatcher script.
   - Run via Bash: `node scripts/reviewer-dispatch.mjs --handoff=<worktreePath>/docs/context/handoff.md --mode=<MODE> --stage=implement --pipeline=refactor`. Append `--force-review` if the operator's original `$ARGUMENTS` contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`). Write it to `<worktreePath>/docs/context/lean-gate.json` for auditability.
   - Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
   - The script always includes `reviewer-style` for refactor pipelines. If no other risk-surface rules triggered, `reviewer-style` is the only reviewer dispatched.
   - If `reviewers` is non-empty: proceed to step 3 with exactly those reviewers.
3. **Reviewers:** dispatch exactly the reviewers listed in step 2's `reviewers[]` output. No reviewer-triage agent.
4. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<refactor summary>","createdAt":"<now ISO>"}`
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<refactor summary>","status":"pending","applyKeyword":"apply refactor: <refactor summary>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the refactor plan summary to the user
   - Ask user to type /forge:approve or /forge:discard

After approval, run /forge:apply.

## What to refactor
$ARGUMENTS
