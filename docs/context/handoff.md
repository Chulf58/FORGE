# Handoff: vendor-agnostic capability-cost routing + model management (2026-04-18)

## Outcome

14 commits on `main` ahead of `origin/main`, forming a coherent "vendor-agnostic routing with enforcement and operator-facing model curation" arc. Test suite went from 156 to 246, zero failing. Live smoke test against the real Gemini API verifies the non-Anthropic dispatch path works end-to-end.

## Commits (in order)

```
d401a12 refactor(router): remove tool-use from routing capabilities
5442635 feat(router): make provider scope vendor-agnostic by default
a7496c7 docs(routing): align GENERAL.md with vendor-agnostic capability-cost routing
9498b2f perf(config): cache routing config after first load
11a2cf3 feat(skills): mandate routing + forge_call_external dispatch in pipeline skills
5549d10 docs(skills): correct stale supervisor routing footnote
aca711b feat(usage): track quota exhaustion per model
89eb80e test(dispatch): smoke-test researcher-triage via gemini flash
fe4c822 chore(catalog): remove deprecated gemini-2.0-flash model
35c1cf0 feat(hook): enforce recommendation before pipeline agent dispatch
e5ae8c9 feat(router): prefer most-minimal capability match over cheapest cost
f4aa3d2 feat(catalog): add per-model pricing (input/output/cached USD per 1M tokens)
39e74c0 feat(mcp): add validated model add and update tools
29873ea docs(routing): document forge_add_model and forge_update_model
```

## What shipped

**Router** (`mcp/lib/router.js`): default scope is now every enabled provider, not hardcoded Anthropic. `allowedVendors` is an explicit force-override. Sort order: fewest total capabilities, cheapest `costTier`, alphabetical id. Over-capable free-tier models (e.g. `gemini-2.5-pro` on a haiku-class task) are picked only when no narrower candidate exists.

**Config cache** (`mcp/lib/config-store.js`): module-level cache fills on first `readForgeConfig`, invalidates on `writeForgeConfig`. New `invalidateConfigCache()` export. Eliminates repeated JSON parses across recommendation calls within a session.

**Per-model quota tracking** (`mcp/lib/usage-store.js`): `markModelQuotaExhausted` + `isModelQuotaExhausted` added alongside the existing provider-level primitives. Old-format `usage.json` (no `models` key) still works — the router falls back to provider-level checks automatically.

**Pipeline skills** (5 of them): routing became mandatory. Each skill now reads the recommendation, branches on `providerId`, and dispatches via either `Agent` (Anthropic) or `forge_call_external` (others) with injected context per the GENERAL.md context-injection map.

**Routing-enforcement hook** (`hooks/routing-enforcement.js` + `hooks/routing-log-clear.js`): PreToolUse hook blocks `Agent` spawns for the 29 FORGE pipeline agents unless a matching `forge_get_model_recommendation` entry exists in the session dispatch log. The log lives at `.pipeline/session-dispatch-log.json`, is cleared at SessionStart, and is written by `forge_get_model_recommendation` on successful recommendations. Fails closed (missing or malformed log blocks pipeline spawns). `supervisor` intentionally excluded — it runs via `forge_call_external`.

**Catalog cleanup**: `gemini-2.0-flash` removed (deprecated, zero free quota, was silently winning alphabetical tiebreak over working flash variants). Every remaining model gained `pricing: { input, output, cached }` in USD per 1M tokens as descriptive data; the router does not consume it yet.

**Model management tools** (`mcp/lib/model-validation.js` + 2 new MCP tools):
- `forge_add_model` — strict validation of id uniqueness, provider existence, capability allowlist (`reasoning`, `code`, `analysis`, `fast`, `agentic`, `long-context`), `costTier`, pricing shape, optional `contextWindow` / `reasoningTier` / `notes`.
- `forge_update_model` — partial update; touched fields revalidated, untouched preserved.
- Both write through `readForgeConfig` / `writeForgeConfig`, picking up the cache invalidation from `9498b2f` automatically.
- 90 new assertions in `mcp/model-mgmt-test.mjs` cover every validator branch, every rejection path, and round-trip persistence through disk.

## Live verification

Ran `node mcp/dispatch-smoke-test.mjs` against the real Gemini endpoint at end of session:
- Router returned `gemini-2.5-flash` for `researcher-triage`.
- `callGemini` made a real HTTP call, 1252 input / 135 output tokens.
- Response contained correctly formatted `[brief-for: 1]` and `[brief-for: 2]` blocks.
- Parser matched both, script reported PASS.

The trailing `Assertion failed ... UV_HANDLE_CLOSING` is a known libuv race on Windows during process teardown — fires after `process.exit(0)` and is unrelated to FORGE.

## Notable course-corrections during the session

- Started by adding `tool-use` as a routing capability. Realised mid-session this was a false abstraction (Codex via Responses API and Gemini via function calling both support tools). Removed it in `d401a12` as the foundation for the whole arc.
- Tried several alternative sort rules (tier-strict with `haiku/sonnet/opus` names, walk-the-list with a `power` metric, cost-first with real pricing). Operator called over-engineering — correctly. Reverted all uncommitted work; kept the committed `e5ae8c9` capability-specificity rule as the decided behavior.
- Fresh pricing research during the session corrected several of the initial pricing guesses: Anthropic Opus is $5/$25 not $15/$75; Gemini 2.5 Pro's cached rate is $0.125 not $0.31; Gemini 3.1 Pro Preview at power 57 dominates Sonnet on cost/value. Numbers in the committed catalog reflect the corrected data.

## Open items for a future session

1. **Live `/forge:plan` run** on a throwaway feature to verify the *skill-layer* honors routing recommendations under real conditions. The smoke test proved the mechanical chain; it does not prove I (Claude) follow skill dispatch instructions correctly in every live situation. One full plan→implement→apply cycle is the real-world proof.
2. **`forge_remove_model`** — deletion still requires hand-editing `config.models`. Defer until an operator hits the friction. The reference-check logic (refuse removal if `agentModelMap` pins the model) is the main design decision when it lands.
3. **Per-token pricing as router cost signal** — currently `pricing` is metadata. A follow-up slice could replace the `costTier` bucket tiebreak with real blended pricing (`input + output`), which would e.g. pick `gpt-4.1` ($10) over `claude-sonnet-4-6` ($18) in the same medium tier. Low priority polish; depends on whether pricing accuracy in the catalog is kept current.
4. **`.pipeline/board.json`** — remains unstaged throughout the session. Unrelated pipeline state; not touched by any slice.
5. **Push decision** — branch is 14 commits ahead of `origin/main`. Recommend preserving the sequence rather than squashing; the mid-arc corrections (tool-use reversal, capability-specificity vs cost-first debate) are useful audit evidence.

## Test commands

Full regression suite:

```
node mcp/router-test.mjs
node mcp/usage-store-test.mjs
node mcp/openai-adapter-test.mjs
node mcp/gemini-adapter-test.mjs
node mcp/model-mgmt-test.mjs
node hooks/routing-enforcement-test.js
node hooks/hook-utils-test.js
```

Credential-gated smoke test (skipped without `GEMINI_API_KEY`):

```
node mcp/dispatch-smoke-test.mjs
```
