---
name: debug
description: "Run the FORGE debug pipeline. Use when: user reports a bug, something is broken, or tests are failing."
argument-hint: "[bug description]"
context: fork
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

## Model routing (optional)

Before spawning each agent, you may call `forge_get_model_recommendation` with the agent name and budget mode to check the optimal model. If the recommendation differs from the agent's frontmatter `model:` field, pass the recommended model via the Agent tool's `model` parameter. This is advisory — if the MCP tool is unavailable, use the frontmatter default.

## STEP 2 — Run debug pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "debug"`.

1. **Debug agent:** traces root cause, writes fix plan to `docs/context/handoff.md`
2. **Reviewer-triage → reviewers:** dispatch based on mode
3. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<bug summary>","createdAt":"<now ISO>"}`
   - Write `.pipeline/gate-pending.json`: `{"gate":"gate2","feature":"<bug summary>","status":"pending","applyKeyword":"apply debug: <bug summary>"}`
   - Present the debug fix summary to the user
   - Ask user to type /forge:approve or /forge:discard

After approval, run /forge:apply.

## Bug description
$ARGUMENTS
