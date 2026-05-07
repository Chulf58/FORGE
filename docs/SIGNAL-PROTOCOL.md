# Signal Protocol

Agent output signals use `[signal-name]` format. This is the canonical reference.

## Active Signals

### `[reviewer-verdict]` — Gate control
**Format:** `[reviewer-verdict] {"agent":"<name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<name>","model":"<model-id>"}`
**Emitters:** All reviewer agents, completeness-checker, agent-optimizer
**Consumer:** `hooks/subagent-stop.js` — parses JSON, stores verdict on run, drives gate decisions
**Restriction:** Only reviewer-typed agents may emit. Non-reviewer verdicts are silently dropped.
**Value:** HIGH — the only signal with a mechanical hook consumer. Determines gate pass/fail.

### `[suggest]` — Next step recommendation
**Format:** `[suggest] /forge:<command>` or `[suggest] <action description>`
**Emitters:** planner, coder, debug, refactor, gotcha-checker, implementation-architect, cleanup, skills-generator
**Consumer:** Orchestrating Claude reads it to decide what to present as the next action.
**Value:** MEDIUM — guides pipeline flow. No code parses it but the LLM reliably acts on it.

### `[summary]` — Gate display text
**Format:** `[summary] <one sentence, max 120 chars>`
**Emitters:** planner, coder, debug, refactor, implementation-architect, agent-optimizer
**Consumer:** Orchestrating Claude reads it for gate presentation.
**Value:** MEDIUM — the user sees this in gate summaries.

### `[todo]` — Board task creation
**Format:** `[todo] <priority>: <title> — <description>` (critic/red-team) or `[todo] <N>. <task text>` (planner)
**Emitters:** planner, critic, red-team
**Consumer:** Orchestrating Claude reads these and calls `forge_add_todo` to create board entries.
**Value:** MEDIUM — creates persistent tasks. The LLM bridges signal to MCP tool call.

## Removed Signals

These signals have no consumers and must not be emitted. Agents that previously emitted them should stop entirely.

### `[health]` — REMOVED
**Format (historical):** `[health] <file>|<aspect>|<severity>|<note>`
**Previously emitted by:** architect, integrity-checker, regression-risk, reviewer-logic
**Reason removed:** No hook consumer, no persistent store, not displayed anywhere. Use `[todo]` for actionable findings instead.

### `[module]` — REMOVED
**Format (historical):** `[module] <module-id>`
**Previously emitted by:** planner
**Reason removed:** Documenter now uses path-prefix matching for module assignment — this signal was never read after that change.

## Low-Value Signals (keep but simplify)

### `[research-status]`
**Format:** `[research-status] complete|incomplete|not-needed`
**Emitters:** researcher
**Consumer:** Orchestrating Claude reads for flow decision.
**Note:** Could be replaced by the researcher simply stating its conclusion. The signal adds no mechanical value.

### `[solution-hit]`
**Format:** `[solution-hit] docs/solutions/<file>.md — <summary>`
**Emitters:** researcher, debug
**Consumer:** compound-refresh agent reads these.
**Note:** Only valuable if compound-refresh runs regularly. Otherwise token waste.

### `[promote-gotcha]`
**Format:** Flag added to solution files.
**Emitters:** researcher, debug
**Consumer:** compound-refresh agent.
**Note:** Same as `[solution-hit]` — only valuable with active compound-refresh cycles.

## Board/Logging Signals (not control flow)

### `[board]`
**Format:** `[board] <message>`
**Emitters:** documenter
**Consumer:** None (stderr logging only). Documents what happened during board updates.
**Value:** Diagnostic. Zero token cost to remove but harmless.

## Structured Metadata Sidecar

`docs/context/coder-status.json` is the authoritative post-coder metadata hub. Downstream agents (completeness-checker, documenter) read it to avoid redundant handoff parses. Fields:

| Field | Type | Consumer |
|-------|------|----------|
| `archUpdate` | bool | documenter step d1 |
| `decision` | bool | documenter step d1 |
| `feature` | string | documenter step d1, completeness-checker feature name |
| `filesTouched` | string[] | documenter step 5d module matching |
| `filesCreated` | string[] | documenter step 5d module matching |
| `tasksCovered` | int[] | completeness-checker step 0 fast path |
| `tasksDeferred` | int[] | completeness-checker step 0 fast path |
| `verificationClean` | bool | lean-risk-classify.mjs |
| `hasBlockers` | bool | lean-risk-classify.mjs |

## Design Principles

1. **Mechanical signals** (`[reviewer-verdict]`) justify their token cost because code acts on them.
2. **LLM-bridged signals** (`[suggest]`, `[summary]`, `[todo]`) are worth it when the orchestrating Claude reliably converts them to actions.
3. **Unread signals** (`[health]`, `[module]`) should be removed — they cost tokens with no consumer.
4. New signals should have either a hook consumer or a skill that reads them. "Maybe someone will look at this" is not a consumer.
