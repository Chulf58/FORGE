// mcp/lib/worker-timeouts.test.mjs
// @covers mcp/lib/worker-timeouts.js
//
// Run: node --test mcp/lib/worker-timeouts.test.mjs
// Also verified end-to-end by: node mcp/forge-worker-timeout-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import will fail until worker-timeouts.js exists — intentional red bar.
const {
  WORKER_TIMEOUT_MS,
  GATE_POLL_TIMEOUT_DEFAULT_MS,
  parseGatePollTimeout,
  buildGatePollFailureReason,
} = await import('./worker-timeouts.js');

test('WORKER_TIMEOUT_MS is 60 minutes (3 600 000 ms)', () => {
  assert.strictEqual(WORKER_TIMEOUT_MS, 3_600_000);
});

test('GATE_POLL_TIMEOUT_DEFAULT_MS is 6 hours (21 600 000 ms)', () => {
  assert.strictEqual(GATE_POLL_TIMEOUT_DEFAULT_MS, 21_600_000);
});

test('parseGatePollTimeout: valid override', () => {
  assert.strictEqual(parseGatePollTimeout('30000'), 30_000);
});

test('parseGatePollTimeout: undefined → 6-h default', () => {
  assert.strictEqual(parseGatePollTimeout(undefined), 21_600_000);
});

test('parseGatePollTimeout: empty string → 6-h default', () => {
  assert.strictEqual(parseGatePollTimeout(''), 21_600_000);
});

test('parseGatePollTimeout: NaN string → 6-h default', () => {
  assert.strictEqual(parseGatePollTimeout('notanumber'), 21_600_000);
});

test('parseGatePollTimeout: negative value → 6-h default', () => {
  assert.strictEqual(parseGatePollTimeout('-1'), 21_600_000);
});

test('parseGatePollTimeout: zero → 6-h default', () => {
  assert.strictEqual(parseGatePollTimeout('0'), 21_600_000);
});

test('parseGatePollTimeout: exactly 24 h → 6-h default (not strictly less)', () => {
  assert.strictEqual(parseGatePollTimeout('86400000'), 21_600_000);
});

test('parseGatePollTimeout: just under 24 h → accepted', () => {
  assert.strictEqual(parseGatePollTimeout('86399999'), 86_399_999);
});

test('buildGatePollFailureReason: does not say "60-minute limit"', () => {
  const reason = buildGatePollFailureReason('gate2', 21_600_000, '2026-01-01T00:00:00.000Z');
  assert.ok(!reason.includes('60-minute limit'), `got: ${reason}`);
});

test('buildGatePollFailureReason: contains value derived from timeout', () => {
  const reason = buildGatePollFailureReason('gate2', 21_600_000, '2026-01-01T00:00:00.000Z');
  assert.match(reason, /21600000|360.?minute|6.?hour/i);
});
