# Handoff: Multi-model supervisor loop, Gemini hardening, Opus 4.7

## Overview

Session activated the Gemini-backed supervisor loop, tested all free-tier Gemini models, hardened the supervisor prompt (architecture ground truth + adversarial review), added 503 auto-retry to the Gemini adapter, added per-model token tracking, and updated the model registry for Claude Opus 4.7.

## Session commits

| Commit | What |
|---|---|
| `3864c77` | Gemini model inventory, supervisor architecture context, adversarial review |
| `e2234cd` | End-of-session handoff + changelog (mid-session) |
| `3ceb720` | Auto-retry on 503 with 2s delay in gemini-adapter |
| `6f7a8b6` | Per-model token tracking in usage store |
| `cbb84fc` | Add claude-opus-4-7, update fallback refs and supervisor prompt |

## Key outcomes

### Supervisor loop validated
- End-to-end: collect state -> call Gemini via forge_call_external -> render brief -> user approves -> dev Claude executes -> feed result back for adversarial review
- Adversarial review working — caught incomplete RESULT reporting on first pass
- gemini-2.5-flash is primary (Sonnet-tier); flash-lite is fallback (Haiku-tier, weaker quality)

### Gemini free-tier model inventory
- **Working:** gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3.1-flash-lite-preview
- **Quota exhausted:** gemini-2.0-flash (deprecated), gemini-2.5-pro, gemini-3.1-pro-preview
- Pattern: flash/lite models have generous free quota; pro models exhaust daily limits quickly
- 503 errors are transient Google-side overload, not quota — now auto-retried

### Gemini adapter hardened
- `mcp/lib/gemini-adapter.js`: single retry on HTTP 503 with 2s delay
- Proven needed by repeated 503s during session

### Per-model token tracking
- `mcp/lib/usage-store.js`: `recordUsage()` now accepts optional `modelId`, tracks per-model requestCount/tokenCount/lastUsed within each provider
- `mcp/server.js`: passes modelId from forge_call_external
- Note: MCP server must restart for changes to take effect (long-lived process)

### Claude Opus 4.7
- New Anthropic flagship released 2026-04-16, model ID `claude-opus-4-7`
- Step-change in agentic coding, 1M context, Jan 2026 knowledge cutoff
- Added to forge-config.default.json, all agentModelMap fallbacks updated, supervisor prompt updated
- Opus 4.6 marked as legacy

### Tier-based routing vision
- Future direction: agents declare capability tier (haiku/sonnet/opus) instead of hardcoded model IDs
- Router picks best available model at runtime by cost/quota/availability
- Added as TODO `aee130ac` on the board

## Blocking context

- External provider track paused — user has no additional API keys or CLIs beyond current Gemini free tier
- `bin/forge.cmd` has uncommitted changes from a prior session (unrelated)
- Per-model tracking in usage.json won't populate until next session (MCP server restart needed)

## What the user wants next session

Not specified. Candidates:
- Continue using supervisor loop for real implementation work
- TUI work (paused, highest priority per board)
- Red-team security audit
