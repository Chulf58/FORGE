// @covers mcp/forge-worker.mjs
// AC-3: worker detect→flip→poll→wakeup
// Source-level checks for the worker's loop-guard detection logic.
// Integration tests for the state-machine transitions are source-level
// because forge-worker.mjs is not easily unit-testable (spawns child processes).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, '..', 'mcp', 'forge-worker.mjs');
const TEST_NAME = 'loop-guard-worker-poll';

function fail(msg) {
  process.stderr.write('[' + TEST_NAME + '] FAIL: ' + msg + '\n');
  process.exit(1);
}

function pass(msg) {
  process.stdout.write('[' + TEST_NAME + '] PASS: ' + msg + '\n');
}

const src = readFileSync(WORKER_PATH, 'utf8');

// AC-3 sub-case (1): sidecar detection → status flip to loop-guard-pending
if (!src.includes('loop-guard-blocked.json')) {
  fail('forge-worker.mjs must reference loop-guard-blocked.json sidecar path');
}
if (!src.includes('loop-guard-pending')) {
  fail('forge-worker.mjs must set run status to loop-guard-pending on sidecar detection');
}
pass('sidecar path and loop-guard-pending status present');

// AC-3 sub-case (1): detection block checks running status + sidecar existence
if (!src.includes("status === 'running'") && !src.includes("status==='running'")) {
  fail('forge-worker.mjs detection block must check status === running before sidecar');
}
if (!src.includes('existsSync') || !src.includes('loop-guard-blocked')) {
  fail('forge-worker.mjs must use existsSync to check sidecar presence');
}
pass('detection block checks running status + existsSync(sidecarPath)');

// AC-3 sub-case (2): sidecar-absent → status running + inputChannel.push wakeup
if (!src.includes('loop-guard cleared — resuming')) {
  fail('forge-worker.mjs must push "loop-guard cleared — resuming" wakeup message to inputChannel');
}
if (!src.includes("status = 'running'") && !src.includes("status:'running'") && !src.includes('status: \'running\'')) {
  fail('forge-worker.mjs must flip status back to running after sidecar cleared');
}
pass('wakeup message and status-flip-to-running on cleared');

// AC-3 sub-case (2): timer reset after clear
if (!src.includes('resetWorkerTimer()') || !src.includes('resetWorkerTimer(GATE_POLL_TIMEOUT_MS)')) {
  fail('forge-worker.mjs must call resetWorkerTimer(GATE_POLL_TIMEOUT_MS) on loop-guard-pending and resetWorkerTimer() after clear');
}
pass('resetWorkerTimer calls present for both suspend and restore');

// AC-3 sub-case (5): 6h gate-poll-style timeout path
if (!src.includes('buildGatePollFailureReason') || !src.includes("'loop-guard'")) {
  fail('forge-worker.mjs must call buildGatePollFailureReason(\'loop-guard\', ...) on timeout');
}
pass('buildGatePollFailureReason(loop-guard, ...) present for timeout path');

// AC-3 sub-case (6): malformed sidecar graceful fall-through
if (!src.includes('loop-guard sidecar malformed')) {
  fail('forge-worker.mjs must log "loop-guard sidecar malformed — ignoring" for bad sidecar JSON');
}
pass('malformed sidecar graceful fall-through message present');

// waitForLoopGuardClear helper function present
if (!src.includes('waitForLoopGuardClear')) {
  fail('forge-worker.mjs must define waitForLoopGuardClear helper function');
}
pass('waitForLoopGuardClear function present');

// loopGuardDetected local flag used
if (!src.includes('loopGuardDetected')) {
  fail('forge-worker.mjs must use loopGuardDetected flag to track state transition');
}
pass('loopGuardDetected flag present');

process.stdout.write('[' + TEST_NAME + '] All checks passed\n');
process.exit(0);
