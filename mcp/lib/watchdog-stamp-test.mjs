// @covers mcp/lib/watchdog-stamp.mjs
//
// The worker's exit handler (forge-worker.mjs) stamps watchdog-stamp.json with
// failureReason:"worker-exited-without-reason"/status:"failed" when run.json has no
// failureReason — to catch a worker that died silently (r-468be1b4). But the implement-
// orchestrator's defer-gate writes gate2 and RETURNS by design, so the worker exits with
// status:"gate-pending" and no failureReason → the watchdog wrongly stamped it "failed"
// (soak r-1dc3d1fb / r-8c327c9a; TODO c469a000). shouldStampSilentExit gates the stamp on
// a GENUINE silent exit only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldStampSilentExit } from './watchdog-stamp.mjs';

test('gate-pending with no failureReason is an INTENTIONAL exit → no stamp (the fix)', () => {
  assert.equal(shouldStampSilentExit({ status: 'gate-pending' }), false);
});

test('running with no failureReason is a genuine silent exit → stamp (r-468be1b4 catch preserved)', () => {
  assert.equal(shouldStampSilentExit({ status: 'running' }), true);
});

test('created with no failureReason → stamp (worker died before doing anything)', () => {
  assert.equal(shouldStampSilentExit({ status: 'created' }), true);
});

test('an unknown/missing status with no failureReason → stamp (fail-safe: surface it)', () => {
  assert.equal(shouldStampSilentExit({}), true);
  assert.equal(shouldStampSilentExit({ status: 'something-new' }), true);
});

test('terminal / intentional-pause statuses never stamp', () => {
  for (const status of ['completed', 'failed', 'discarded', 'waiting-for-escalation', 'loop-guard-pending']) {
    assert.equal(shouldStampSilentExit({ status }), false, status + ' must not stamp');
  }
});

test('a run that already has a failureReason is not re-stamped', () => {
  assert.equal(shouldStampSilentExit({ status: 'running', failureReason: 'already-set' }), false);
});

test('null/non-object runData → no stamp (defensive)', () => {
  assert.equal(shouldStampSilentExit(null), false);
  assert.equal(shouldStampSilentExit(undefined), false);
});
