# Multi-Vendor Model Routing — Task Brief

## Problem

FORGE currently routes models in two separate tracks:
1. **Anthropic models** — declared via `model:` field in agent frontmatter. Claude Code handles dispatch natively.
2. **External models** — called via `forge_call_external` MCP tool. Currently only the `/forge:supervise` skill uses this, hardcoded to `gemini-2.5-flash`.

This is not scalable. Adding OpenAI (GPT-5.4) as a supervisor provider requires manual code changes in the skill. There is no principled way for agents to express multi-vendor preferences, and no runtime routing that picks the best available model across providers.

Additionally, the existing `agentModelMap` in `forge-config.default.json` uses:
- `preferred`: specific model ID pin
- `fallback`: specific model ID pin
- `requiredCapabilities`: array of capability tags (set-membership, not ordinal)

This was sufficient for single-provider use. It breaks when:
- You want "any opus-tier model from OpenAI or Gemini"
- You want to prevent a haiku-designated agent from being promoted to opus
- You want vendor tiebreaking when multiple providers have an available model at the required tier

## Current state

- `forge-config.default.json`: 11 models catalogued, all with `reasoningTier: "haiku"|"sonnet"|"opus"` added this session. Provider entries: anthropic (enabled), gemini (enabled), openai (disabled — no key yet).
- `mcp/lib/router.js`: recommendation engine. Priority: preferred → fallback → catalog scan by requiredCapabilities → default. Does NOT yet filter by `reasoningTier` or vendor.
- `mcp/lib/openai-adapter.js`: OpenAI Responses API adapter exists. No retry logic. No `reasoning_effort` parameter.
- `mcp/lib/gemini-adapter.js`: Gemini adapter. Has exponential backoff (503) and 429 retry.
- `skills/supervise/SKILL.md`: hardcodes `providerId: "gemini"`, `modelId: "gemini-2.5-flash"`.
- `agents/supervisor.md`: frontmatter has `model: claude-sonnet-4-6` (ignored — supervisor runs on Gemini via skill, not as Claude subagent).

## Proposed solution

### Layer 1 — Model catalog stays as-is

Each model entry in `forge-config.default.json` already has `reasoningTier` and `providerId`. No changes needed.

Add `priority` to provider entries for tiebreaking when multiple providers have a model available at the same tier:

```json
{ "id": "openai", "priority": 1 },
{ "id": "gemini", "priority": 2 },
{ "id": "anthropic", "priority": 3 }
```

Lower number = higher priority. When two providers both have an available opus-tier model, priority decides.

### Layer 2 — Agent entries gain two new fields

Replace `requiredCapabilities` (set-membership, no ordering) with two explicit fields:

**`allowedTiers`** — ordered whitelist of acceptable reasoning tiers. First listed = preferred. Router will not pick outside this list — no silent escalation, no silent degradation.

**`allowedVendors`** — whitelist of providers the agent may use for external routing. Anthropic is always implicit via frontmatter; this field only controls `forge_call_external` dispatch.

Example entries:

```json
"supervisor": {
  "preferred": "gpt-5.4",
  "fallback": "gemini-2.5-flash",
  "allowedTiers": ["opus", "sonnet"],
  "allowedVendors": ["openai", "gemini"]
},

"reviewer-boundary": {
  "preferred": "claude-haiku-4-5-20251001",
  "allowedTiers": ["haiku"],
  "allowedVendors": ["anthropic"]
},

"researcher": {
  "preferred": "claude-sonnet-4-6",
  "allowedTiers": ["sonnet"],
  "allowedVendors": ["anthropic"]
}
```

### Layer 3 — Router extended

`mcp/lib/router.js` updated with new catalog scan logic:

1. Try `preferred` — if available AND its `reasoningTier` ∈ `allowedTiers` ✓
2. Try `fallback` — same check
3. Catalog scan — filter models where:
   - `reasoningTier` ∈ `allowedTiers`
   - `providerId` ∈ `allowedVendors` (if set; if absent, any vendor)
   - Provider is enabled and not quota-exhausted
   - Order candidates: first by tier preference (index in `allowedTiers`), then by provider `priority`
4. Fail clearly with reason — never pick outside `allowedTiers`

### Layer 4 — Supervise skill de-hardcoded

`skills/supervise/SKILL.md` updated to:
1. Call `forge_get_model_recommendation` for the `supervisor` agent
2. Use the returned `providerId` and `modelId` instead of hardcoded values
3. Dispatch to either `callGemini` or `callOpenAI` based on `providerId`

`mcp/server.js` `forge_call_external` handler already routes to the right adapter based on provider type — this already works.

### Layer 5 — OpenAI adapter improvements

`mcp/lib/openai-adapter.js`:
- Add `reasoning_effort` option (default `"medium"`, passable via options)
- Add 429 retry with retryDelay parse (same pattern as Gemini adapter)
- Verify token field names for GPT-5.4 response format

### Layer 6 — GPT-5.4 added to catalog

`forge-config.default.json`:
- Add `gpt-5.4`: `reasoningTier: "opus"`, `providerId: "openai"`, capabilities, pricing notes
- Add `gpt-4.1`: `reasoningTier: "sonnet"`, `providerId: "openai"` (for non-supervisor use)
- Update supervisor `agentModelMap` entry: `preferred: "gpt-5.4"`, `fallback: "gemini-2.5-flash"`, `allowedTiers: ["opus", "sonnet"]`, `allowedVendors: ["openai", "gemini"]`
- OpenAI provider stays `enabled: false` until API key is set

## What this does NOT change

- Anthropic model routing — stays as agent frontmatter, unchanged
- Agent frontmatter `model:` field — unchanged, still controls Claude subagent model
- Gemini adapter — unchanged (retry already hardened this session)
- Any agent prompts or behavior — purely infrastructure

## Key constraints

- `allowedVendors` on agents only controls external routing (forge_call_external). Anthropic is always the implicit provider for Claude Code subagents regardless of this field.
- The router is advisory only for Anthropic — it recommends but Claude Code makes the final call based on frontmatter.
- `forge_get_model_recommendation` MCP tool currently returns a recommendation but is not called by the supervise skill. After this change, the skill will call it.
- `allowedTiers` is a hard constraint, not a preference. If no model is available within the declared tiers, the call fails — it does not silently escalate to opus or degrade to haiku.

## Implementation order (suggested slices)

1. **Config schema** — add `priority` to providers, add `gpt-5.4` + `gpt-4.1` to models, update all `agentModelMap` entries to use `allowedTiers` + `allowedVendors` instead of `requiredCapabilities`
2. **Router** — extend `recommendModel()` to honor `allowedTiers` and `allowedVendors`, apply provider priority tiebreaking
3. **OpenAI adapter** — `reasoning_effort` param, 429 retry
4. **Supervise skill** — replace hardcoded model with `forge_get_model_recommendation` lookup + provider-aware dispatch

## Open questions for supervisor review

1. Should `requiredCapabilities` be removed entirely or kept alongside `allowedTiers` for backwards compatibility during migration?
2. Should the router's tier preference (first item in `allowedTiers`) take priority over provider priority, or the other way around? I.e., if `allowedTiers: ["opus", "sonnet"]` and both a sonnet-OpenAI and opus-Gemini are available, which wins?
3. Should agents without `allowedTiers` (legacy entries) fall back to the existing `requiredCapabilities` logic, or should the router require explicit migration of all entries?
