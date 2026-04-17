---
title: OpenAI Responses API uses input_tokens / output_tokens, not prompt_tokens / completion_tokens
date: 2026-04-17
files_touched:
  - mcp/lib/openai-adapter.js
tags:
  - openai
  - responses-api
  - tokens
  - usage
---

## Symptom

Token counts returned from `forge_call_external` for OpenAI models are always 0, even on successful calls.

## Root cause

The OpenAI Responses API (`/v1/responses`) uses different field names than the Chat Completions API:

| API | Input tokens | Output tokens |
|-----|-------------|---------------|
| Chat Completions (`/v1/chat/completions`) | `usage.prompt_tokens` | `usage.completion_tokens` |
| Responses (`/v1/responses`) | `usage.input_tokens` | `usage.output_tokens` |

The adapter was reading `prompt_tokens` and `completion_tokens`, which are always undefined on Responses API responses, so `?? 0` always resolved to 0.

## Fix

In `mcp/lib/openai-adapter.js`, change:

```js
// Before (wrong — Chat Completions field names)
inputTokens: data.usage?.prompt_tokens ?? 0,
outputTokens: data.usage?.completion_tokens ?? 0,

// After (correct — Responses API field names)
inputTokens: data.usage?.input_tokens ?? 0,
outputTokens: data.usage?.output_tokens ?? 0,
```

Reasoning tokens (for models that support `reasoning_effort`) are separately tracked under `usage.output_tokens_details.reasoning_tokens`.

## Promotion

[promote-gotcha] docs/solutions/openai-responses-api-token-fields.md — this is a universal Responses API gotcha, not project-specific; applies to any OpenAI adapter

## Verified

Fixed in commit `0279e94`. All 15 adapter tests pass with the corrected field names.
