---
name: forge:research
description: "Run a research pipeline as an autonomous background worker. Creates a FORGE run, spawns a worker process, and frees the conductor."
argument-hint: "<research question or topic>"
allowed-tools: "Read Glob Grep"
model: claude-sonnet-4-6
---

## STEP 1 — Dispatch worker (MANDATORY — do this FIRST, before anything else)

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"research"`
- `feature`: a SHORT title (one phrase, under 120 chars) for the dashboard label
- `taskBrief`: the FULL detailed topic from the user's input below — questions, file references, output spec, constraints. The worker sees this verbatim in its SessionStart prompt. Capped at 16 KB; control chars stripped.
- `spawnWorker`: `true`
- `useWorktree`: `false`

The worker runs the researcher agent autonomously — it writes findings to `docs/RESEARCH/<topic-slug>.md` and completes the run. No gate pause (research has no gate).

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Research running in background. Findings will appear in docs/RESEARCH/."

Do NOT invoke the researcher agent directly. Do NOT check for existing runs first. Every /forge:research invocation creates exactly one new run.

Exit — do not proceed to further steps.

<!-- Steps 2–3 below are executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 2 — Model routing (worker)

Before invoking the researcher agent, resolve the model:

1. Call `forge_get_model_recommendation` with agent name `"researcher"`.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → use `Agent(subagent_type="forge:researcher", model=<family>)` where `family` is the short name (`sonnet`, `opus`, or `haiku`). If `family` is `null`, omit the model parameter.
   - **any other provider** → read `agents/researcher.md`, assemble context, call `forge_call_external`.
4. If `forge_get_model_recommendation` is unavailable (MCP error): invoke without explicit model.

## STEP 3 — Run researcher pipeline (worker)

Call `forge_update_run` with `runId`, `status: "running"`.

Invoke the researcher agent with a prompt that includes:
- The research topic from the feature request below
- Instruction to write findings to `docs/RESEARCH/<topic-slug>.md`
- The `runId` so the agent can reference it

After the researcher completes:
- Call `forge_update_run` with `runId`, `status: "completed"`

## Research topic
$ARGUMENTS
