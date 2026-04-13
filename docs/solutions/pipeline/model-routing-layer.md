---
title: Intelligent Model Routing Layer
category: pipeline
date: 2026-04-11
files_touched:
  - mcp/lib/config-store.js
  - mcp/lib/usage-store.js
  - mcp/lib/router.js
  - mcp/lib/openai-adapter.js
  - mcp/server.js
  - forge-config.default.json
  - hooks/mcp-deps-install.js
tags:
  - multi-model routing
  - quota management
  - provider adapter pattern
  - fallback chain
  - budget-driven selection
---

## Problem
FORGE agents were hardcoded to single models; no way to route light tasks to fast models (Haiku) or heavy tasks to capable models (Opus). Budget tracking per project was impossible. External providers (OpenAI) couldn't be used as fallbacks.

## Solution
Built a 4-module routing layer in `mcp/lib/`: config-store (resolves user config with CLAUDE_PLUGIN_DATA primary, .pipeline fallback), usage-store (tracks per-project quotas and quota exhaustion), router (pure function with 4-priority fallback chain: agent preference → capability match → budget class → default), and openai-adapter (calls OpenAI Responses API, detects quota exhaustion on 401/429). 6 new MCP tools expose routing + quota management. Default config template maps all 28 agents with preferred models + fallbacks + required capabilities. Config bootstrap hook installs default on first session.

## Key patterns
- **Config resolution precedence:** CLAUDE_PLUGIN_DATA > .pipeline/project.json > built-in defaults. Never crash on missing config — degrade gracefully.
- **Quota tracking:** Store per-project usage in JSON (epochMs, modelId, inputTokens, outputTokens, cost). On exceeding soft limit, recommend budget class; on hard limit (401/429), block.
- **4-priority fallback chain:** Agent preference → matches capabilities (safety, logic, performance) → budget class (economy/standard/performance) → system default. Always has escape route.
- **External adapter pattern:** Provider adapters (OpenAI, future: Google, Perplexity) wrap external APIs; detect provider-specific errors (rate limit, quota, auth) and report quota exhaustion to usage-store.
- **Soft vs hard limits:** Soft limit triggers recommendation (don't block); hard limit (401/429) blocks and forces budget-class fallback. Prevents runaway spend; allows deliberate overage.

