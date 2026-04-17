#!/usr/bin/env node
// Regression tests for mcp/lib/openai-adapter.js
//
// Mocks globalThis.fetch — the adapter resolves fetch at call time so overriding
// globalThis.fetch before each call is sufficient without module re-importing.
// Run: node mcp/openai-adapter-test.mjs

import { callOpenAI } from './lib/openai-adapter.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// Standard GPT-5.4 Responses API success payload
const SUCCESS_BODY = {
  id: 'resp_abc123',
  object: 'response',
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello from GPT-5.4' }],
    },
  ],
  usage: {
    input_tokens: 42,
    output_tokens: 10,
    output_tokens_details: { reasoning_tokens: 3 },
    total_tokens: 52,
  },
};

function mockFetch(responses) {
  let idx = 0;
  globalThis.fetch = async () => responses[Math.min(idx++, responses.length - 1)];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── openai-adapter-test.mjs ──────────────────────────────────────────────');

// 1. Successful response — correct text and token fields
{
  mockFetch([makeResponse(200, SUCCESS_BODY)]);
  const result = await callOpenAI('hello', 'gpt-5.4', 'test-key');
  assert(result.text === 'Hello from GPT-5.4', 'success: text extracted from output[0].content[0].text');
  assert(result.inputTokens === 42, 'success: inputTokens from usage.input_tokens (not prompt_tokens)');
  assert(result.outputTokens === 10, 'success: outputTokens from usage.output_tokens (not completion_tokens)');
  assert(result.reasoningTokens === 3, 'success: reasoningTokens from usage.output_tokens_details.reasoning_tokens');
}

// 2. Default — reasoning_effort absent means no reasoning field in request body
{
  let capturedBody;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return makeResponse(200, SUCCESS_BODY);
  };
  await callOpenAI('hello', 'gpt-5.4', 'test-key');
  assert(capturedBody.reasoning === undefined, 'default: no reasoning field when reasoningEffort not set');
}

// 3. Explicit reasoning_effort is forwarded to request body
{
  let capturedBody;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return makeResponse(200, SUCCESS_BODY);
  };
  await callOpenAI('hello', 'gpt-5.4', 'test-key', { reasoningEffort: 'high' });
  assert(capturedBody.reasoning?.effort === 'high', 'explicit reasoningEffort forwarded as reasoning.effort');
}

// 4. reasoning_effort: "medium" as sensible explicit default
{
  let capturedBody;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return makeResponse(200, SUCCESS_BODY);
  };
  await callOpenAI('hello', 'gpt-5.4', 'test-key', { reasoningEffort: 'medium' });
  assert(capturedBody.reasoning?.effort === 'medium', 'explicit medium effort forwarded correctly');
}

// 5. 429 with Retry-After header — retries once, succeeds on second attempt
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return makeResponse(429, '{"error":"rate limited"}', { 'retry-after': '2' });
    return makeResponse(200, SUCCESS_BODY);
  };
  const result = await callOpenAI('hello', 'gpt-5.4', 'test-key');
  assert(callCount === 2, '429 retry: called fetch twice');
  assert(result.text === 'Hello from GPT-5.4', '429 retry: succeeded on second attempt');
}

// 6. 429 with Retry-After > 60s — does NOT retry, throws immediately
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return makeResponse(429, '{"error":"quota exhausted"}', { 'retry-after': '120' });
  };
  let threw = false;
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch { threw = true; }
  assert(threw && callCount === 1, '429 with long Retry-After: throws immediately without retry');
}

// 7. 429 with no Retry-After header — retries once with fallback delay
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 1) return makeResponse(429, '{"error":"rate limited"}');
    return makeResponse(200, SUCCESS_BODY);
  };
  const result = await callOpenAI('hello', 'gpt-5.4', 'test-key');
  assert(callCount === 2, '429 no-header retry: retried once with fallback delay');
  assert(result.text === 'Hello from GPT-5.4', '429 no-header retry: succeeded on second attempt');
}

// 8. 429 on second attempt too — throws after one retry, no infinite loop
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return makeResponse(429, '{"error":"still rate limited"}', { 'retry-after': '2' });
  };
  let threw = false;
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch { threw = true; }
  assert(threw && callCount === 2, '429 persists: throws after exactly one retry, no infinite loop');
}

// 9. Non-retryable error (401) — throws immediately, no retry
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return makeResponse(401, '{"error":"unauthorized"}');
  };
  let threw = false;
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch { threw = true; }
  assert(threw && callCount === 1, 'non-retryable 401: throws immediately without retry');
}

// 10. Network failure — throws with descriptive message
{
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  let msg = '';
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch (e) { msg = e.message; }
  assert(msg.includes('network'), 'network failure: throws with network error message');
}

// 11. Non-2xx error — raw body NOT in error message, status code IS present
{
  const sensitiveBody = JSON.stringify({
    error: { type: 'invalid_request_error', code: 'model_not_found',
             message: 'Model not found. Authorization: Bearer sk-secret-key-here' },
  });
  globalThis.fetch = async () => makeResponse(400, sensitiveBody);
  let msg = '';
  try { await callOpenAI('hello', 'gpt-5.4', 'sk-secret-key'); } catch (e) { msg = e.message; }
  assert(!msg.includes('sk-secret-key'), 'non-2xx: raw body (with potential key) not in error message');
  assert(!msg.includes('Authorization'), 'non-2xx: sensitive body content not in error message');
  assert(msg.includes('400'), 'non-2xx: status code present in message');
  assert(msg.includes('invalid_request_error'), 'non-2xx: error type extracted from body');
}

// 12. Non-2xx with non-JSON body — status only, no raw body
{
  globalThis.fetch = async () => makeResponse(503, 'Service Unavailable internal-token=abc123');
  let msg = '';
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch (e) { msg = e.message; }
  assert(!msg.includes('internal-token'), 'non-2xx non-JSON: raw body not in error message');
  assert(msg.includes('503'), 'non-2xx non-JSON: status code present');
}

// 13. JSON parse error on 200 — fixed string, no raw body
{
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => 'not-json api_key=sk-leaked',
  });
  let msg = '';
  try { await callOpenAI('hello', 'gpt-5.4', 'test-key'); } catch (e) { msg = e.message; }
  assert(!msg.includes('sk-leaked'), 'JSON parse error: raw body not in error message');
  assert(!msg.includes('not-json'), 'JSON parse error: body slice not in error message');
  assert(msg.includes('JSON parse failed'), 'JSON parse error: descriptive message present');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
