---
name: forge:refactor
description: "Run the FORGE refactor pipeline. Use when: user wants to clean up, restructure, or improve existing code."
argument-hint: "[file or area to refactor]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run (MANDATORY — do this FIRST, before anything else)

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"refactor"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: a short summary of the refactor target from `$ARGUMENTS` (e.g. "split handlers.js into per-domain modules")

Save the returned `runId`. You MUST reference it in all later steps.

Do NOT skip this step. Do NOT check for existing runs first. Every /forge:refactor invocation creates exactly one new run.

## Model routing

Before each agent invocation, resolve which model and execution path to use:

1. Call `forge_get_model_recommendation` with the agent name.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop — do not proceed to the agent.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.

## STEP 2 — Run refactor pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "refactor"`.

1. **Refactor agent:** analyzes the target file or area, writes refactor plan to `docs/context/handoff.md`
2. **Reviewer-triage → reviewers:** dispatch based on mode. **Always include `reviewer-style`** regardless of mode — refactors change code structure, and style consistency must be verified even in LEAN mode.
3. **Gate #2:** First update the run, then write gate state:
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, `currentStep: "gate2"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<refactor summary>","createdAt":"<now ISO>"}`
   - Write `.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<refactor summary>","status":"pending","applyKeyword":"apply refactor: <refactor summary>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the refactor plan summary to the user
   - Ask user to type /forge:approve or /forge:discard

After approval, run /forge:apply.

## What to refactor
$ARGUMENTS
