#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// R2 (research 2026-06-02): bounded retry-on-stream-error. The dispatcher must
// re-run an agent when it fails with a transient STREAM error (R1's signal), but
// NOT when it fails for a logic reason (missing artifact / no completion signal).
// Retry is the recovery half of supervised-retry; R1 was the sensor. Worktree
// isolation (cwd=workDir) makes a re-dispatch overwrite-same-file safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableStreamError, retryDelayMs, runWithRetry } from './agent-dispatch.mjs';

// ── isRetryableStreamError ────────────────────────────────────────────────
test('isRetryableStreamError: true for stream/dispatch errors, false for logic failures', () => {
  assert.equal(isRetryableStreamError('dispatch error: stream result error: error_during_execution (aborted_streaming)'), true);
  assert.equal(isRetryableStreamError('dispatch error: boom'), true, 'thrown stream errors retry');
  assert.equal(isRetryableStreamError('file absent: /w/docs/context/scout.json'), false, 'missing artifact is a logic failure');
  assert.equal(isRetryableStreamError('mtime check failed'), false);
  assert.equal(isRetryableStreamError('no completion signal detected in stream output'), false);
  assert.equal(isRetryableStreamError(undefined), false);
  assert.equal(isRetryableStreamError(null), false);
});

// ── retryDelayMs ──────────────────────────────────────────────────────────
test('retryDelayMs: exponential base with jitter, capped', () => {
  for (let i = 0; i < 20; i++) {
    const d1 = retryDelayMs(1);
    const d2 = retryDelayMs(2);
    assert.ok(d1 >= 2000 && d1 < 4000, 'attempt 1 in [2000,4000); got ' + d1);
    assert.ok(d2 >= 4000 && d2 < 6000, 'attempt 2 in [4000,6000); got ' + d2);
  }
  assert.ok(retryDelayMs(10) <= 30000, 'capped at 30000');
});

// ── runWithRetry ──────────────────────────────────────────────────────────
const noSleep = { sleep: async () => {}, delayFn: () => 0 };

test('runWithRetry: returns immediately on completed (1 attempt, no retry)', async () => {
  let calls = 0;
  const r = await runWithRetry(async () => { calls++; return { outcome: 'completed' }; }, noSleep);
  assert.equal(calls, 1);
  assert.equal(r.outcome, 'completed');
  assert.equal(r.attempts, 1);
});

test('runWithRetry: retries a stream-error uncertain, then succeeds (2 attempts)', async () => {
  let calls = 0;
  const r = await runWithRetry(async () => {
    calls++;
    return calls === 1 ? { outcome: 'uncertain', reason: 'dispatch error: stream result error: x' } : { outcome: 'completed' };
  }, noSleep);
  assert.equal(calls, 2, 'must retry once then succeed');
  assert.equal(r.outcome, 'completed');
  assert.equal(r.attempts, 2);
});

test('runWithRetry: stream-error twice → stops at cap (2), returns uncertain', async () => {
  let calls = 0;
  const r = await runWithRetry(async () => { calls++; return { outcome: 'uncertain', reason: 'dispatch error: boom' }; }, noSleep);
  assert.equal(calls, 2, 'must not exceed maxAttempts=2');
  assert.equal(r.outcome, 'uncertain');
  assert.equal(r.attempts, 2);
});

test('runWithRetry: does NOT retry a non-retryable (logic) uncertain', async () => {
  let calls = 0;
  const r = await runWithRetry(async () => { calls++; return { outcome: 'uncertain', reason: 'mtime check failed' }; }, noSleep);
  assert.equal(calls, 1, 'missing-artifact/logic failures must NOT retry');
  assert.equal(r.outcome, 'uncertain');
});

// ── dispatchAgent wiring ──────────────────────────────────────────────────
test('dispatchAgent runs its attempt through runWithRetry (R2 wiring)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'agent-dispatch.mjs'), 'utf-8');
  // Match the CALL site (not the function definition) — dispatchAgent must wrap its
  // per-attempt dispatch+verify in runWithRetry(attemptDispatch).
  assert.ok(/runWithRetry\(attemptDispatch\b/.test(src), 'dispatchAgent must drive its dispatch attempt through runWithRetry(attemptDispatch …)');
});
