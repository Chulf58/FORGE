---
name: forge:debug
description: "Run the FORGE debug pipeline. Use when: user reports a bug, something is broken, or tests are failing."
argument-hint: "[bug description]"
allowed-tools: "Read Write Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run (MANDATORY — do this FIRST, before anything else)

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"debug"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: a short summary of the bug from `$ARGUMENTS` (e.g. "price fetch returns empty array")

Save the returned `runId`. You MUST reference it in all later steps.

Do NOT skip this step. Do NOT check for existing runs first. Every /forge:debug invocation creates exactly one new run.

## Model routing

Before each agent invocation, resolve which model and execution path to use:

1. Call `forge_get_model_recommendation` with the agent name.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop — do not proceed to the agent.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.

## STEP 2 — Run debug pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "debug"`.

1. **Debug agent:** traces root cause, writes fix plan to `docs/context/handoff.md`
2. **LEAN-lite reviewer gate** — **LEAN mode only**. In STANDARD and FULL, skip this step entirely and proceed to step 3.
   - Run via Bash: `node scripts/lean-risk-classify.mjs --handoff=<worktreePath>/docs/context/handoff.md`. Append the flag `--force-review` to the command if the operator's original `$ARGUMENTS` (or the current user prompt in this session) contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "skipReviewers": <bool>, "reasons": [...], "triggeredRules": [...] }`) and write it to `<worktreePath>/docs/context/lean-gate.json` for post-run auditability.
   - Log a single stderr line: `[lean-gate] skip=<bool> reasons=[<comma-joined>] triggered=[<comma-joined>]`.
   - Decision: if `skipReviewers` is `true`, skip step 3 entirely (no reviewer-triage, no reviewer dispatch) and proceed directly to step 4 (Gate #2). If `skipReviewers` is `false`, proceed to step 3 as normal.
   - The policy this enforces is documented in `CLAUDE.md` under "LEAN-lite skip rule" and "Risk surface". Do not override the classifier's verdict — if a reviewer pass is genuinely desired on a non-risk LEAN change, the operator re-invokes with `[force-review]`.
3. **Reviewer-triage → reviewers:** dispatch based on mode. Skipped when step 2 set `skipReviewers: true`.
4. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<bug summary>","createdAt":"<now ISO>"}`
   - Write `.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<bug summary>","status":"pending","applyKeyword":"apply debug: <bug summary>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the debug fix summary to the user
   - Ask user to type /forge:approve or /forge:discard

After approval, run /forge:apply.

## Bug description
$ARGUMENTS
