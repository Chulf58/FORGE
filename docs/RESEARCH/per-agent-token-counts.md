# Per-Agent Token Counts Research
_Completed: 2026-03-22_

## Question
Do the Claude CLI streaming protocol or hooks expose per-subagent token data? Can FORGE show actual per-agent token figures instead of heuristic estimates?

## Verdict
**CLI/API limitation — not client-side solvable.** The stream-json format exposes only a single session-level aggregate. FORGE's current heuristic (attribute result tokens to the running card) is as good as it gets without upstream changes.

---

## What the stream-json format actually exposes

| Event type | Token data |
|------------|-----------|
| `claude-progress` (tool_use blocks) | None — only label, toolName, category, filePath |
| `claude-result` | `{ usage: { input_tokens, output_tokens } }` — session total only, fired once at end |

No per-tool, per-turn, or per-subagent breakdown anywhere in the stream.

---

## How FORGE's current attribution works

FORGE achieves per-agent breakdown via client-side heuristic inference in `agents.svelte.ts`:
1. When a `claude-progress` Agent/Task tool call fires → mark that agent card as `running`
2. When `claude-result` fires → attribute all tokens in that result to whichever card is currently running
3. In parallel waves → distribute tokens evenly across all concurrent running cards (floor + remainder)
4. If no card is running → attribute to the `orchestratorTokens` bucket

This is a **workaround**, not actual data from the CLI. It works well for sequential pipelines but is approximate for parallel waves and cases where the orchestrator itself does significant work between dispatches.

---

## Why actual per-subagent counts aren't available

Each subagent (Agent/Task tool call) is a nested session from the orchestrator's perspective. The Claude API returns token counts only at the top-level orchestrator session level. The CLI surfaces exactly what the API returns — no internal per-subagent accounting is exposed in stream-json.

Related: `docs/RESEARCH/context-monitor.md` documents that Claude Code's PostToolUse hook payloads also contain no token data (confirmed open GitHub issues as of March 2026: #34879, #34340, #33420, #34184).

---

## What would fix it

Requires upstream changes — not fixable client-side:
- **API change**: Return per-tool or per-turn token usage in API responses
- **CLI change**: Expose per-subagent token accounting in the stream-json result event

Transcript file reading is a theoretically possible workaround but fragile and not exposed via stream-json.

## Recommendation

Close the todo. Current heuristic is the right approach given the constraint. Revisit if/when Claude CLI exposes per-subagent token data in a future release.
