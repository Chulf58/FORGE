# Handoff: Multi-model supervisor smoke test and hardening

## Overview

Session focused on activating the Gemini-backed supervisor loop (`/forge:supervise`) and hardening it for real use. Tested all available Gemini models on the free tier, updated the model inventory, improved the supervisor prompt with architecture ground truth and adversarial review capabilities, and ran the full supervisor loop end-to-end.

## Session commits

| Commit | What |
|---|---|
| `3864c77` | Gemini model inventory, supervisor architecture context, adversarial review |

## What was done

### Gemini model availability testing (free tier)
Tested every text-capable Gemini model via `forge_call_external`. Results:
- **Working:** `gemini-2.5-flash` (Sonnet-tier), `gemini-2.5-flash-lite` (Haiku-tier), `gemini-3.1-flash-lite-preview` (preview)
- **Quota exhausted:** `gemini-2.0-flash`, `gemini-2.5-pro`, `gemini-3.1-pro-preview`, `gemini-2.0-flash-lite`, `gemini-2.5-computer-use`
- **Not available for generateContent:** `gemini-deep-research`
- **Empty response:** `gemini-3-flash-preview` (unreliable)
- Pattern: free tier only has meaningful quota on flash/lite models. Pro models exhaust daily limits quickly.
- 503 errors are transient Google-side overload, not quota — retry works.

### forge-config.default.json updates
- Added 5 new Gemini models with verified status notes
- Marked `gemini-2.0-flash` as deprecated
- Swapped supervisor preferred model to `gemini-2.5-flash`
- Added missing `implementation-architect` to `agentModelMap`
- Removed `supervisor` from `agentModelMap` (routes via `forge_call_external`, not frontmatter)
- Updated Gemini provider notes with accurate free-tier description

### Supervisor prompt improvements (agents/supervisor.md)
- Added "FORGE plugin architecture" ground-truth section: exact file paths, how Claude Code agents work, Anthropic model IDs, MCP tools, and the critical constraint that external providers can't be set via frontmatter
- Strengthened per-response review to be adversarial: mandatory Challenges field, checks for unrequested changes, verification validity, silent side effects, rubber-stamp detection

### Supervisor loop testing
Ran 3 real supervisor briefs via `forge_call_external`:
1. **First brief (pre-architecture context):** Hallucinated file paths, misunderstood Agent tool, proposed impossible changes. Proved the need for ground truth in the prompt.
2. **Second brief (with architecture context, gemini-2.5-flash):** Correct file paths, correct understanding of frontmatter constraints. Proposed sync command — reasonable but not the most impactful next step.
3. **Third brief (adversarial review, gemini-2.5-flash-lite fallback during 503):** Successfully challenged the dev Claude's incomplete RESULT reporting — caught that 3 files were modified but not explained in FILES CHANGED. Adversarial review working.

## Key architectural insight confirmed

Multi-model in FORGE has two tracks:
1. **Anthropic track:** frontmatter `model:` field controls which Claude model an agent runs on. `agentModelMap` is a sync/documentation reference, not runtime routing — we don't control Claude Code's Agent tool.
2. **External track:** skills/agents call `forge_call_external` to delegate reasoning to Gemini/OpenAI. This is the real multi-model capability. The supervisor pattern is the proof.

## What the user wants next session

Continue the multi-model feature. The supervisor loop works. Next steps likely involve:
- Making more pipeline agents delegate work to Gemini via the supervisor/external pattern
- Or building the `/forge:sync-agent-models` command (supervisor's suggestion) as a maintenance tool
- The user should decide which track to prioritize

## Blocking context

- `bin/forge.cmd` has uncommitted changes from a prior session (unrelated)
- `.pipeline/forge-config.json` and `.pipeline/usage.json` are untracked local state files
