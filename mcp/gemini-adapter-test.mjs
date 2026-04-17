#!/usr/bin/env node
// Regression tests for mcp/lib/gemini-adapter.js — security and behaviour.
// Run: node mcp/gemini-adapter-test.mjs

import { callGemini } from './lib/gemini-adapter.js';

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

const SUCCESS_BODY = {
  candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
};

function mockFetch(responses) {
  let idx = 0;
  globalThis.fetch = async (url, opts) => {
    const resp = responses[Math.min(idx++, responses.length - 1)];
    resp._capturedUrl = url;
    resp._capturedOpts = opts;
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      headers: { get: (name) => resp.headers?.[name.toLowerCase()] ?? null },
      text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
    };
  };
}

console.log('\n── gemini-adapter-test.mjs ──────────────────────────────────────────────');

// 1. API key is sent as x-goog-api-key header, NOT in the URL
{
  let capturedUrl, capturedHeaders;
  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(SUCCESS_BODY),
    };
  };
  await callGemini('hello', 'gemini-2.5-flash', 'my-secret-key');
  assert(!capturedUrl.includes('my-secret-key'), 'API key NOT present in request URL');
  assert(!capturedUrl.includes('?key='), 'URL does not contain ?key= query param');
  assert(capturedHeaders['x-goog-api-key'] === 'my-secret-key', 'API key sent via x-goog-api-key header');
}

// 2. Successful response parses correctly
{
  mockFetch([{ status: 200, body: SUCCESS_BODY }]);
  const result = await callGemini('hello', 'gemini-2.5-flash', 'test-key');
  assert(result.text === 'Hello from Gemini', 'success: text extracted correctly');
  assert(result.inputTokens === 10, 'success: inputTokens correct');
  assert(result.outputTokens === 5, 'success: outputTokens correct');
}

// 3. Error messages do NOT include raw response body (key protection)
{
  const sensitiveBody = JSON.stringify({
    error: {
      code: 401,
      message: 'API key invalid. See https://... ?key=my-secret-key',
      status: 'UNAUTHENTICATED',
    },
  });
  mockFetch([{ status: 401, body: sensitiveBody }]);
  let errorMsg = '';
  try { await callGemini('hello', 'gemini-2.5-flash', 'my-secret-key'); } catch (e) { errorMsg = e.message; }
  assert(!errorMsg.includes('my-secret-key'), 'error message does not echo API key');
  assert(!errorMsg.includes('See https://'), 'error message does not include raw body URL');
  assert(errorMsg.includes('401'), 'error message includes status code');
  assert(errorMsg.includes('UNAUTHENTICATED'), 'error message includes error status string');
}

// 4. Non-JSON error body — error message contains status, not raw body
{
  mockFetch([{ status: 503, body: 'Service Unavailable (proxy timeout)' }]);
  // Force past retries by exhausting them
  let capturedCalls = 0;
  globalThis.fetch = async () => {
    capturedCalls++;
    return {
      ok: false, status: 503,
      headers: { get: () => null },
      text: async () => 'Service Unavailable with internal-token=abc123',
    };
  };
  let errorMsg = '';
  try { await callGemini('hello', 'gemini-2.5-flash', 'my-secret-key'); } catch (e) { errorMsg = e.message; }
  assert(!errorMsg.includes('internal-token=abc123'), 'non-JSON error: raw body not in error message');
  assert(errorMsg.includes('503'), 'non-JSON error: status code present');
}

// 5. 503 retry still works (exponential backoff)
{
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount <= 2) return {
      ok: false, status: 503,
      headers: { get: () => null },
      text: async () => '{"error":{"status":"UNAVAILABLE"}}',
    };
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(SUCCESS_BODY),
    };
  };
  const result = await callGemini('hello', 'gemini-2.5-flash', 'test-key');
  assert(callCount === 3, '503 retry: fetched 3 times before success');
  assert(result.text === 'Hello from Gemini', '503 retry: success on third attempt');
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
