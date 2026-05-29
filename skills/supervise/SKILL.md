---
name: forge:supervise
description: "Generate a supervisor brief for the next implementation slice. Uses the cross-model supervisor agent via forge_call_external (Gemini retired; transport moving to a Playwright→ChatGPT-browser bridge). Provide a task description as the argument."
allowed-tools: "Read Grep Glob Bash"
---

Generate a supervisor brief by routing the task through the best available supervisor model.

## Step 1 — Collect project state

Gather the following WITHOUT using subagents (use Read/Grep/Bash directly):

1. **Recent commits:** run `git log --oneline -10`
2. **Working tree state:** run `git status --short`
3. **Dashboard snapshot:** call `forge_dashboard_state` for active runs, gates, board summary
4. **Recent CHANGELOG context:** `Read docs/CHANGELOG.md` (first 40 lines)

Assemble these into a single `[PROJECT STATE]` block.

## Step 2 — Read the supervisor agent prompt

Read `agents/supervisor.md`. Extract everything AFTER the frontmatter closing `---` line. This is the supervisor's system prompt.

## Step 3 — Construct the prompt

Build a single prompt string with this exact structure:

```
[SUPERVISOR INSTRUCTIONS]
<supervisor agent body from Step 2>

[PROJECT STATE]
<assembled state from Step 1>

[TASK]
<the user's task description — whatever they typed after /forge:supervise>

Produce a formal brief per the format in your instructions. If the task is unclear, ask one clarifying question instead of guessing.
```

## Step 4 — Resolve the supervisor model

Call `forge_get_model_recommendation` with:
- `agentName`: `"supervisor"`
- `budgetMode`: `"performance"`

Inspect the result:
- If `source` is `"error"` or `modelId` is null: surface the `reason` field verbatim prefixed with `[forge:supervise] routing error:` and stop — do not attempt the call.
- Otherwise: proceed with the returned `providerId` and `modelId`.

## Step 5 — Call the supervisor model

Call `forge_call_external` with:
- `providerId`: the value returned in Step 4
- `modelId`: the value returned in Step 4
- `prompt`: the constructed prompt from Step 3
- `maxTokens`: `8192`
- `reasoningEffort`: `"medium"` (only meaningful for OpenAI models)

If the call fails with "API key env var not set," tell the user to set the relevant API key as a permanent environment variable and restart the Claude Code session.

If the call fails with an API error, surface the error verbatim with `[forge:supervise]` prefix.

## Step 6 — Render the brief

Display the model's response verbatim in chat. Do NOT edit, summarize, or reinterpret it — the user needs to see the raw supervisor output to approve or adjust.

Prefix with:
```
**Supervisor brief (via <modelId>):**
```

After the brief, add:
```
Approve this brief and I'll execute it, or tell me what to adjust.
```

## Notes

- The supervisor agent is defined at `agents/supervisor.md`. Its prompt is the source of truth for how briefs should be formatted.
- The supervisor does NOT have access to the repo, tools, or MCP — it reasons only from the state injected into its prompt.
- If the user provides a previous slice's result (RESULT block), include it in the `[TASK]` section so the supervisor can produce the Scope check / Verdict / Solved review fields before the next brief.
- Model routing is controlled by the `supervisor` entry in `agentModelMap` in `forge-config.default.json`: `allowedVendors: ["openai"]`, with `gpt-5.4` the only match for `reasoning+agentic`. When OpenAI is unavailable, the router returns an explicit `source: "error"` result (handled in Step 4 above) — there is no fallback to any other vendor. **Gemini is retired and never used.** Going forward, cross-model supervision is moving to a Playwright→ChatGPT-browser bridge (parked); until then this OpenAI route is the only configured external path and requires `OPENAI_API_KEY`.
