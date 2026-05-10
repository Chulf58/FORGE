---
name: forge:explore
description: "Run an exploration pipeline as an in-session subagent. Creates a FORGE run and invokes the researcher agent to investigate the codebase."
argument-hint: "<what to explore or investigate>"
allowed-tools: "Read Glob Grep Agent"
---

Run the researcher agent as an in-session subagent to explore/investigate the topic below. The researcher inherits this session's permissions so it can complete without manual approval.

## Step 1 — Create run (no worker spawn)

Call `forge_create_run` with:
- `sessionId`: `"conductor"`
- `pipelineType`: `"research"`
- `feature`: a short summary derived from the user's input below
- `spawnWorker`: `false`

Save the returned `runId`.

## Step 2 — Model routing

Before invoking the researcher agent, resolve the model:

1. Call `forge_get_model_recommendation` with agent name `"researcher"`.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → use `Agent(subagent_type="forge:researcher", model=<family>)` where `family` is the short name (`sonnet`, `opus`, or `haiku`). If `family` is `null`, omit the model parameter.
   - **any other provider** → read `agents/researcher.md`, assemble context, call `forge_call_external`.
4. If `forge_get_model_recommendation` is unavailable (MCP error): invoke without explicit model.

## Step 3 — Invoke researcher subagent

Call `forge_update_run` with `runId`, `status: "running"`.

Before invoking the researcher agent, write `.pipeline/dispatch-context.json` in the project root with:
```json
{ "runId": "<runId>", "createdAt": "<now ISO>" }
```

Invoke the researcher agent via `Agent(subagent_type="forge:researcher")` with a prompt that includes:
- The exploration topic from the user's input below
- Instruction to write findings to `docs/RESEARCH/<topic-slug>.md`
- The `runId` so the agent can reference it

The subagent runs inside this session and inherits all permissions.

After the researcher agent returns (or on any error — use try/finally), delete `.pipeline/dispatch-context.json`.

## Step 4 — Complete the run

After the researcher agent returns:
- Call `forge_update_run` with `runId`, `status: "completed"`
- Report one line: "Exploration complete: `<feature>` (run `<runId>`) — findings in `docs/RESEARCH/`"

## Exploration topic
$ARGUMENTS
