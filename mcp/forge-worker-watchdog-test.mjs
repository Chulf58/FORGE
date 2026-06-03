// @covers mcp/forge-worker.mjs
//
// The watchdog-stamp decision must be gated through shouldStampSilentExit (mcp/lib/
// watchdog-stamp.mjs) so a gate-pending defer-gate exit is NOT stamped "failed"
// (TODO c469a000). forge-worker.mjs has module-load side effects and can't be unit-
// imported, so this asserts against its source (same approach as the other forge-worker
// source-assertion tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'forge-worker.mjs'), 'utf-8');

test('forge-worker imports shouldStampSilentExit from the watchdog-stamp module', () => {
  assert.match(SRC, /shouldStampSilentExit[^\n]*watchdog-stamp\.mjs/,
    'forge-worker must import shouldStampSilentExit from ./lib/watchdog-stamp.mjs');
});

test('the watchdog stamp is gated on shouldStampSilentExit, not a bare !failureReason check', () => {
  assert.match(SRC, /if \(shouldStampSilentExit\(/,
    'the stamp block must call shouldStampSilentExit(runData) — so a gate-pending exit is not stamped failed');
  // the old bare guard must be gone from the stamp site
  assert.doesNotMatch(SRC, /if \(!runData\.failureReason\) \{/,
    'the bare `if (!runData.failureReason)` stamp guard must be replaced by shouldStampSilentExit');
});
