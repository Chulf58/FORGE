---
name: forge:supervise
description: "Generate a supervisor brief for the next implementation slice. Uses the Gemini-backed supervisor agent via forge_call_external. Provide a task description as the argument."
allowed-tools: "Read Grep Glob Bash"
---

Generate a supervisor brief by routing the task through the Gemini-backed supervisor agent.

## Step 1 — Collect project state

Gather the following WITHOUT using subagents (use Read/Grep/Bash directly):

1. **Recent commits:** run `git log --oneline -10`
2. **Working tree state:** run `git status --short`
3. **Dashboard snapshot:** call `forge_dashboard_state` for active runs, gates, board summary
4. **Recent CHANGELOG context:** `Read docs/CHANGELOG.md` (first 40 lines)

Assemble these into a single `[PROJECT STATE]` block.

## Step 2 — Read the supervisor agent prompt

Read `agents/supervisor.md`. Extract everything AFTER the frontmatter closing `---` line. This is the supervisor's system prompt.

## Step 3 — Construct the Gemini prompt

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

## Step 4 — Call Gemini

Call `forge_call_external` with:
- `providerId`: `"gemini"`
- `modelId`: `"gemini-2.5-flash"`
- `prompt`: the constructed prompt from Step 3
- `maxTokens`: `8192`

If the call fails with "API key env var not set," tell the user to set `GEMINI_API_KEY` as a permanent Windows environment variable and restart the Claude Code session.

If the call fails with a Gemini API error, surface the error verbatim with `[forge:supervise]` prefix.

## Step 5 — Render the brief

Display Gemini's response verbatim in chat. Do NOT edit, summarize, or reinterpret it — the user needs to see the raw supervisor output to approve or adjust.

Prefix with:
```
**Supervisor brief (via Gemini):**
```

After the brief, add:
```
Approve this brief and I'll execute it, or tell me what to adjust.
```

## Notes

- The supervisor agent is defined at `agents/supervisor.md`. Its prompt is the source of truth for how briefs should be formatted.
- The supervisor does NOT have access to the repo, tools, or MCP — it reasons only from the state injected into its prompt.
- If the user provides a previous slice's result (RESULT block), include it in the `[TASK]` section so the supervisor can produce the Scope check / Verdict / Solved review fields before the next brief.
- The `agentModelMap` in `forge-config.default.json` should have a `supervisor` entry with `provider: "gemini"` — but the skill hardcodes the dispatch for now until generic multi-provider routing is built.
