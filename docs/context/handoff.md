# Handoff: Multi-vendor routing, knowledge integration, README, reviewer rename (2026-04-17)

## What happened this session

### 1. Gemini model hardening
- Flash-lite fallback concept killed — proven too weak for supervisor (shallow brief, hallucinated module)
- `reasoningTier` field added to all 11 catalog models
- `supervisor` entry re-added to `agentModelMap` with `allowedTiers: ["opus", "sonnet"]`, `allowedVendors: ["openai", "gemini"]`
- Gemini adapter: exponential backoff 503 retry (2s/4s/8s), 429 retry with Retry-After parsing
- Gemini 2.5-pro confirmed unavailable on free API tier (limit: 0 — requires billing; web UI ≠ API)

### 2. Multi-vendor model routing (4 slices)
Full workstream shipped and pushed:

**Slice 1 — Config + router:**
- Provider `priority` field added (openai:1, gemini:2, anthropic:3)
- `gpt-5.4` (opus) and `gpt-4.1` (sonnet) added to model catalog
- Router extended with `allowedTiers` (hard constraint, no silent escalation) + `allowedVendors` + tier-preference ordering + provider priority tiebreaking
- Legacy `requiredCapabilities` path preserved
- 12 router unit tests

**Slice 2 — OpenAI adapter:**
- `reasoningEffort` option added (opt-in, forwarded as `reasoning.effort` only to OpenAI)
- 429 retry with `Retry-After` header parsing + 10s fallback
- Token field bug fixed: `prompt_tokens`/`completion_tokens` → `input_tokens`/`output_tokens`
- `reasoningTokens` exposed in return value
- 15 adapter unit tests

**Slice 3 — Supervise skill de-hardcoded:**
- `/forge:supervise` now calls `forge_get_model_recommendation` (budgetMode: "performance")
- Dispatches to returned providerId + modelId — no longer hardcoded to Gemini
- Brief prefix shows actual model used
- `forge_call_external` MCP tool gains optional `reasoningEffort` param
- Supervisor normalization cleanup: commit subject corrected by supervisor review

**Activation TODO:** `86198e49` — set `OPENAI_API_KEY` + flip `enabled: true`, smoke test GPT-5.4 routing

### 3. reviewer → reviewer-boundary rename
- `agents/reviewer.md` renamed to `agents/reviewer-boundary.md`
- All 15 reference sites updated across agents, config, MCP server, pipeline state
- TODO `1b92130b` on board (done — can be closed)

### 4. README rewrite
- New tagline, glass wall section with open kitchen analogy
- "Your first feature" walkthrough (plan→approve→implement→approve→apply)
- "How it runs" trust section (agents, hooks, MCP server, local-only state, routing)
- Pipeline modes table, gates explained, full commands table
- Marketplace install marked in-progress; What's coming: TUI + worktree

### 5. Knowledge integration layer (3 slices)
Full workstream shipped and pushed:

**Slice 1 — Consumer agents:**
- `agents/debug.md` Step 0.5 now emits `[solution-hit] docs/solutions/<file>.md — <summary>` when match found; continues if no match
- `agents/researcher.md` adds Step 1 (solutions check) per-question before any codebase/web search
- `docs/gotchas/GENERAL.md`: `[solution-hit]` signal documented

**Slice 2 — compound-refresh promotion:**
- `agents/compound-refresh.md` extended: scans `docs/RESEARCH/` and `docs/context/` for `[solution-hit]` frequency (threshold: 2 hits = candidate); scans `docs/solutions/` for `[promote-gotcha]` flags
- Reports `[promote?]` candidates section in every run (even when empty)
- `docs/gotchas/GENERAL.md`: `[promote-gotcha]` signal documented
- Explicit guard: never auto-edits `docs/gotchas/GENERAL.md`

**Slice 3 — Emission guidance:**
- `debug` and `researcher` now told when to write `[promote-gotcha]`: when a solution is universal (not project-specific)

**Smoke test:** real solution file created (`docs/solutions/openai-responses-api-token-fields.md`), mock RESEARCH file with 2x `[solution-hit]` hits, all 3 grep paths verified working manually

### 6. GPT-5.4 research
- GPT-5.4: opus-tier, 1M context, $2.50/$15 per 1M input/output, supports `reasoning_effort`
- GPT-4.1: sonnet-tier, current recommended OpenAI production model, $2/$8
- OpenAI subscriptions (ChatGPT Plus/Pro) are NOT API access — separate billing at platform.openai.com
- Cost estimate for supervisor: ~$0.60–1.00/heavy day at 30-40 calls

## What's next
- **OpenAI activation** (TODO `86198e49`): set `OPENAI_API_KEY`, flip provider to enabled, smoke test GPT-5.4 as supervisor
- **FORGE-REFERENCE.md refresh** (deferred): stale on reasoningTier, allowedTiers, allowedVendors, reviewer-boundary rename, new signals — update when needed for user-facing milestone
- **Router slice 3** (TODO `aee130ac`): teach router to honor `minReasoningTier` for catalog scan — closes out tier-based routing board item
- **Knowledge layer validation**: run a real debug pipeline and verify `[solution-hit]` fires, then run compound-refresh and verify promotion candidate surfaces

## Commits this session
```
a0472ad feat(knowledge): add promote-gotcha emission guidance to debug and researcher
ae11bba feat(knowledge): add first solution doc + smoke test for lookup and promotion
c381ad9 feat(knowledge): surface gotcha promotion candidates in compound-refresh
c4406de feat(knowledge): wire debug and researcher to consult solutions first
61b2f1e feat(supervise): route provider and model via recommendation
0279e94 feat(openai): add reasoning effort and retry handling
0c75077 feat(router): add tier-locked multi-vendor recommendation logic
1032fb9 feat(agents): rename reviewer→reviewer-boundary; rewrite README
a045ee3 feat(gemini): reasoningTier on models, supervisor agentModelMap entry, exponential backoff retry
```
