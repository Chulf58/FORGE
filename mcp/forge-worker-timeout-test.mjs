// mcp/forge-worker-timeout-test.mjs
// @covers mcp/forge-worker.mjs (AC-1, AC-2, AC-3)
//
// Tests that gate-poll timeout is decoupled from the active-worker safety valve:
//   - WORKER_TIMEOUT_MS stays 3 600 000 ms (60 min)
//   - GATE_POLL_TIMEOUT_DEFAULT_MS is 21 600 000 ms (6 h)
//   - FORGE_WORKER_GATE_TIMEOUT_MS env var overrides the gate-poll timeout
//   - Invalid env values (NaN, negative, zero, ≥24 h) fall back to the 6 h default
//   - failureReason stamp does NOT say "60-minute limit"
//
// Run: node mcp/forge-worker-timeout-test.mjs

import assert from 'assert';

// Import will fail until mcp/lib/worker-timeouts.js is created — intentional red bar.
const {
  WORKER_TIMEOUT_MS,
  GATE_POLL_TIMEOUT_DEFAULT_MS,
  parseGatePollTimeout,
  buildGatePollFailureReason,
} = await import('./lib/worker-timeouts.js');

// ── AC-2 (constants) ──────────────────────────────────────────────────────────

assert.strictEqual(
  WORKER_TIMEOUT_MS,
  3_600_000,
  `WORKER_TIMEOUT_MS must be 3 600 000 (60 min), got ${WORKER_TIMEOUT_MS}`,
);

assert.strictEqual(
  GATE_POLL_TIMEOUT_DEFAULT_MS,
  21_600_000,
  `GATE_POLL_TIMEOUT_DEFAULT_MS must be 21 600 000 (6 h), got ${GATE_POLL_TIMEOUT_DEFAULT_MS}`,
);

// ── AC-2 (env override) ───────────────────────────────────────────────────────

// Valid override
assert.strictEqual(
  parseGatePollTimeout('30000'),
  30_000,
  'parseGatePollTimeout("30000") must return 30 000',
);

// Default when env var is absent
assert.strictEqual(
  parseGatePollTimeout(undefined),
  21_600_000,
  'parseGatePollTimeout(undefined) must return the 6 h default',
);

// Default when env var is empty string
assert.strictEqual(
  parseGatePollTimeout(''),
  21_600_000,
  'parseGatePollTimeout("") must return the 6 h default',
);

// ── AC-1 (invalid input fallbacks) ───────────────────────────────────────────

// NaN (non-numeric string) → fall back to default
assert.strictEqual(
  parseGatePollTimeout('notanumber'),
  21_600_000,
  'parseGatePollTimeout("notanumber") must fall back to 6 h default (NaN guard)',
);

// Negative value → fall back to default
assert.strictEqual(
  parseGatePollTimeout('-1'),
  21_600_000,
  'parseGatePollTimeout("-1") must fall back to 6 h default (negative guard)',
);

// Zero → fall back to default
assert.strictEqual(
  parseGatePollTimeout('0'),
  21_600_000,
  'parseGatePollTimeout("0") must fall back to 6 h default (zero guard)',
);

// Exactly 24 h (86 400 000) → fall back (must be strictly less than 24 h)
assert.strictEqual(
  parseGatePollTimeout('86400000'),
  21_600_000,
  'parseGatePollTimeout("86400000") must fall back to 6 h default (≥ 24 h guard)',
);

// Just under 24 h (86 399 999) → valid
assert.strictEqual(
  parseGatePollTimeout('86399999'),
  86_399_999,
  'parseGatePollTimeout("86399999") must be accepted (< 24 h)',
);

// ── AC-3 (failureReason does not say "60-minute limit") ──────────────────────

const TS = '2026-01-01T00:00:00.000Z';

// Default 6-h gate-poll
const reason6h = buildGatePollFailureReason('gate2', 21_600_000, TS);
assert.ok(
  typeof reason6h === 'string' && reason6h.length > 0,
  'buildGatePollFailureReason must return a non-empty string',
);
assert.ok(
  !reason6h.includes('60-minute limit'),
  `failureReason for 6-h gate-poll must NOT contain "60-minute limit", got: ${reason6h}`,
);
assert.ok(
  /21600000|360.?minute|6.?hour/i.test(reason6h),
  `failureReason for 6-h gate-poll must contain a value derived from the configured timeout, got: ${reason6h}`,
);

// Custom 30-s gate-poll
const reason30s = buildGatePollFailureReason('gate2', 30_000, TS);
assert.ok(
  !reason30s.includes('60-minute limit'),
  `failureReason for 30-s gate-poll must NOT contain "60-minute limit", got: ${reason30s}`,
);

process.stderr.write('[timeout-test] PASS — all timeout assertions passed\n');
process.exit(0);
