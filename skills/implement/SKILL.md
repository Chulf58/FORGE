---
name: forge:implement
description: "Run the FORGE implement feature pipeline. Use when: user approved Gate #1 and wants to implement the planned feature."
argument-hint: "[feature name]"
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

> See **Model routing** in CLAUDE.md.

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

## STEP 3 — Run coder pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "coder"`.

**All agents in this step work inside the worktree.** When spawning each agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Coder-scout** (skip in LEAN):
   - Run via Bash: `node scripts/coder-scout.mjs --root <worktreePath>` with `timeout: 30000`.
   - If exit 0 and stdout JSON has `ok: true`: log the `signal` field from stdout. `scout.json` is written — proceed to step 2.
   - If exit non-zero, stdout is malformed, or `ok` is not `true`: log `[coder-scout] script fallback: <reason from stdout or stderr>` and invoke the `coder-scout` agent as fallback (use `forge_get_model_recommendation` and spawn via Agent). The agent writes `<worktreePath>/docs/context/scout.json` directly.
2. **Coder:** writes draft to `<worktreePath>/docs/context/handoff.md`
3. **Completeness-checker** (STANDARD/FULL only, skip in LEAN): verifies plan coverage.
4. **Reviewer dispatch** — determine which reviewers to invoke via the deterministic dispatcher script. This replaces the reviewer-triage agent.
   - Run via Bash: `node scripts/reviewer-dispatch.mjs --handoff=<worktreePath>/docs/context/handoff.md --mode=<MODE> --stage=implement`. Append `--force-review` if the operator's original `$ARGUMENTS` contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`). Write it to `<worktreePath>/docs/context/lean-gate.json` for auditability.
   - Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
   - If `reviewers` is empty: skip step 5 entirely and proceed directly to step 6 (Gate #2).
   - If `reviewers` is non-empty: proceed to step 5 with exactly those reviewers. Do NOT add or remove reviewers — the script output is authoritative.
5. **Reviewers:** dispatch exactly the reviewers listed in step 4's `reviewers[]` output. Use `forge_get_model_recommendation` for each and spawn them (in parallel when multiple). No reviewer-triage agent — the script already determined the list.
5b. **Reviewer verdict handling** (only when step 5 ran):

   Track a revision counter `N` (starts at 0, incremented before each coder re-invocation). Maximum iterations: 2.

   - Collect all `[reviewer-verdict]` signals from reviewer outputs (in `<worktreePath>/docs/context/reviewer-output/`)
   - If ANY reviewer emitted **BLOCK**: stop. Do NOT proceed to Gate #2. Present the blocker list and emit `[suggest] fix blockers and re-run /forge:implement`. Call `forge_update_run` with `status: "failed"`, `currentStep: "reviewer-blocked"`.
   - If ANY reviewer emitted **REVISE** (and none BLOCK):
     - If `N < 2`: increment `N` to `N+1`. Call `forge_update_run` with `currentStep: "coder-revision-N"` (replace N with the current value). Re-invoke the coder with `[revision-mode: N]` prepended to its prompt; pass all REVISE warnings as context (list them in the prompt). Then proceed to step 5c.
     - If `N >= 2`: call `forge_update_run` with `currentStep: "gate2-with-warnings"`. Fall through to Gate #2 with all accumulated REVISE warnings included in the gate presentation.
   - If ALL reviewers emitted **APPROVED**: proceed to Gate #2 normally.

5c. **Re-run reviewers after coder revision** (only when step 5b triggered the `N < 2` re-invoke path):

   After the revised coder output is written to `<worktreePath>/docs/context/handoff.md`: call `forge_update_run` with `currentStep: "reviewer-revision-N"` (replace N with the current value). Re-run the dispatcher script (step 4) and dispatch the resulting reviewers (step 5). Collect their `[reviewer-verdict]` signals. Return to step 5b verdict handling with the updated `N`.

   > Note: the LEAN-lite gate (step 4) is NOT re-run on revision passes. A REVISE verdict already proves reviewer scrutiny is warranted, so the classifier is bypassed and reviewers always run in the revision loop regardless of mode.

6. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}`
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<feature name>","status":"pending","applyKeyword":"apply feature: <feature>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the implementation summary to the user (include the LEAN-lite gate decision when it fired: "Reviewers skipped — classifier verdict `lean-gate.json`" or "Reviewers ran — classifier matched: <rules>"). If `N > 0` (at least one revision loop ran), prepend: "Coder revised N time(s). Final reviewer verdict: <APPROVED|REVISE>." to the summary. If the final verdict is REVISE (max iterations reached), also list the unresolved warnings.
   - Ask user to type /forge:approve or /forge:discard

$ARGUMENTS
