#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// R1 (research 2026-06-02): SDK stream aborts/limits do NOT throw — they arrive as
// a `result` event with subtype 'error_during_execution' / 'error_max_turns' / etc.
// (sdk.d.ts SDKResultError, type:'result', is_error, terminal_reason). dispatchAgent's
// stream-drain only caught THROWN errors, so a non-throwing error-result left the
// agent classified by artifact-absence ("mtime check failed") with NO signal that it
// was a (retryable) stream abort. errorResultReason() detects it → the dispatch-error
// path fires with a precise reason that R2's retry can key on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorResultReason, drainStream } from './agent-dispatch.mjs';

async function* genOk() {
  yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
  yield { type: 'result', subtype: 'success', is_error: false };
}
async function* genErr() {
  yield { type: 'assistant', message: {} };
  yield { type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' };
}
async function* genThrow() {
  yield { type: 'assistant', message: {} };
  throw new Error('boom');
}

test('drainStream: a success result leaves streamError null', async () => {
  const { streamError } = await drainStream(genOk());
  assert.equal(streamError, null, 'a successful stream must not set streamError');
});

test('drainStream: a non-throwing error result becomes a streamError (R1)', async () => {
  const { streamError } = await drainStream(genErr());
  assert.ok(streamError instanceof Error && /error_during_execution/.test(streamError.message),
    'a result error event must surface as a streamError naming the subtype');
});

test('drainStream: a thrown stream error is captured as streamError', async () => {
  const { streamError } = await drainStream(genThrow());
  assert.ok(streamError instanceof Error && /boom/.test(streamError.message), 'thrown errors must still be captured');
});

test('dispatchAgent delegates stream draining to drainStream (R1 wiring)', async () => {
  // Wiring assertion: dispatchAgent must consume the SDK stream via drainStream so
  // the R1 error-result detection actually fires in production (not just in unit
  // tests). A genuine structural requirement, not a format regex — the behavior is
  // covered by the drainStream cases above; this guarantees the seam is wired in.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'agent-dispatch.mjs'), 'utf-8');
  assert.ok(/await drainStream\(stream\)/.test(src),
    'dispatchAgent must call `await drainStream(stream)` (delegate stream-draining + R1 detection)');
});

test('detects error_during_execution result, naming subtype + terminal_reason', () => {
  const r = errorResultReason({ type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' });
  assert.ok(
    typeof r === 'string' && r.includes('error_during_execution') && r.includes('aborted_streaming'),
    'must return a reason naming subtype + terminal_reason; got: ' + r,
  );
});

test('detects error_max_turns result', () => {
  assert.ok(errorResultReason({ type: 'result', subtype: 'error_max_turns' }), 'error_max_turns is a stream/limit error');
});

test('detects is_error:true regardless of subtype', () => {
  assert.ok(errorResultReason({ type: 'result', is_error: true, subtype: 'success' }), 'is_error:true must count as an error');
});

test('returns null for a successful result', () => {
  assert.equal(errorResultReason({ type: 'result', subtype: 'success', is_error: false }), null);
});

test('returns null for non-result messages and junk input', () => {
  assert.equal(errorResultReason({ type: 'assistant', message: {} }), null);
  assert.equal(errorResultReason(null), null);
  assert.equal(errorResultReason('nope'), null);
  assert.equal(errorResultReason({ type: 'result' }), null, 'a bare result with no error signal is not an error');
});
