# Handoff: Knowledge layer design + Gemini model hardening (2026-04-17)

## What happened this session

### 1. Knowledge layer discussion (no implementation)
Discussed how gotchas (`docs/gotchas/GENERAL.md`) and compound knowledge (`docs/solutions/`) should work together. Key distinctions established:
- Gotchas = preventative, always-on, "never do X"
- Solutions = reactive, on-demand, "when you see Y, try Z"
- Promotion from solution → gotcha requires recurrence + pattern stability (human judgment trigger)
- Supervisor produced a design brief via gemini-2.5-flash-lite — brief was shallow/generic, proved flash-lite is not viable for supervisor work

### 2. Flash-lite fallback removed
- Removed "fallback when 2.5-flash quota runs out" from `gemini-2.5-flash-lite` notes
- Removed "secondary fallback" from `gemini-3.1-flash-lite-preview` notes
- Both models explicitly marked NOT for supervisor
- Runtime policy: on 503 from gemini-2.5-flash, surface error and stop — no silent degradation
- CHANGELOG [2026-04-17] added documenting this

### 3. `reasoningTier` field added to all models
All 11 models in `forge-config.default.json` now have `reasoningTier: "haiku"|"sonnet"|"opus"`. Values derived from existing notes ("Sonnet-tier quality", etc.). No router changes yet.

Tier assignments:
- opus: claude-opus-4-7, claude-opus-4-6, gemini-2.5-pro, gemini-3.1-pro-preview
- sonnet: claude-sonnet-4-6, gemini-2.0-flash, gemini-2.5-flash
- haiku: claude-haiku-4-5-20251001, codex-mini-latest, gemini-2.5-flash-lite, gemini-3.1-flash-lite-preview

### 4. `supervisor` entry re-added to agentModelMap
```json
"supervisor": {
  "preferred": "gemini-2.5-flash",
  "minReasoningTier": "sonnet",
  "requiredCapabilities": ["reasoning", "analysis"],
  "notes": "Routed via /forge:supervise skill (not as a Claude subagent). Requires sonnet-tier reasoning; no fallback — on 503 surface the error and stop. Skill hardcodes dispatch until router learns minReasoningTier."
}
```
- No fallback — sonnet floor enforced via requiredCapabilities until router learns minReasoningTier (TODO aee130ac)
- `gemini-3.1-flash-lite-preview` also had `reasoning` capability removed as defense-in-depth

### 5. Gemini Pro smoke test — confirmed unavailable on free API tier
- gemini-2.5-pro returned 429 with `limit: 0` — API free tier quota is literally zero, not "exhausted today"
- Notes updated: "API free tier quota is 0 — requires billing; web UI access does not apply to API calls"
- Same applied to gemini-3.1-pro-preview
- Key distinction: AI Studio web chat gives some Pro access; the API key used by forge_call_external does not

### 6. Gemini adapter retry hardening
`mcp/lib/gemini-adapter.js` updated:
- 503: exponential backoff — 2s, 4s, 8s across 3 retries (max 14s wait)
- 429: new `parse429RetryDelay()` helper parses `RetryInfo.retryDelay` from response body; retries once if < 60s (per-minute rate limit); surfaces immediately if ≥ 60s or missing (daily quota / limit=0)

## Commit
`a045ee3` — feat(gemini): reasoningTier on models, supervisor agentModelMap entry, exponential backoff retry

## What's next
- **Slice 3 (TODO aee130ac):** Teach router to honor `minReasoningTier` — ordinal comparison in catalog scan. Then the skill can stop hardcoding `gemini-2.5-flash` and ask the router instead.
- **Knowledge layer implementation:** No slices cut this session — design only. If picked up: start with solution-lookup wiring in `agents/debug.md` and `agents/researcher.md` before building promotion machinery.
- **Frontmatter stripping in supervise skill:** Gemini occasionally wraps output in markdown fences. `skills/supervise/SKILL.md` should strip ``` fences and `---` preamble before rendering.
- **DeepSeek R1:** Identified as viable cheap reasoning model — worth adding to forge-config.default.json as future external provider.
