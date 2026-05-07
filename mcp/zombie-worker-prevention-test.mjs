#!/usr/bin/env node
// Unit test: sweepStalePids helper from mcp/lib/worker-pids.js
//
// Tests that the sweep correctly:
//   - identifies dead PIDs, marks runs failed, deletes PID files, returns swept=1
//   - leaves non-running runs (e.g. completed) untouched even when the PID is dead
//
// Run: node mcp/zombie-worker-prevention-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { sweepStalePids } from './lib/worker-pids.js';

const LABEL = '[zombie-worker-prevention]';

function fail(msg) {
  console.error(LABEL + ' FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

/**
 * Returns a PID that is guaranteed to be dead.
 *
 * Strategy: spawn `node -e "process.exit(0)"` synchronously and capture its
 * pid. spawnSync() waits for exit before returning, so by the time we read
 * .pid the child has already exited and the OS has reaped it (no zombie on
 * any POSIX system once the parent calls spawnSync). This is more reliable
 * than a magic constant because:
 *   - PID 2 is alive on Linux (kthreadd).
 *   - INT_MAX-style PIDs can theoretically be recycled on long-running boxes.
 *   - A freshly-exited child PID is guaranteed dead on all platforms this
 *     plugin targets (macOS, Linux, Windows via Node's kill(0) probe).
 *
 * @returns {number}
 */
function getDeadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 5000 });
  if (result.pid == null || result.pid <= 0) {
    // Fallback: use a very high PID that is almost certainly unused.
    // 2147483646 is near the 32-bit signed int max; unlikely to be a live PID.
    return 2147483646;
  }
  return result.pid;
}

function seedPidFile(pidsDir, runId, pid) {
  const filePath = join(pidsDir, runId + '.json');
  writeFileSync(filePath, JSON.stringify({ runId, pid, startedAt: new Date().toISOString() }, null, 2), 'utf-8');
  return filePath;
}

function seedRunJson(projectDir, runId, status) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const runPath = join(runDir, 'run.json');
  writeFileSync(runPath, JSON.stringify({
    runId,
    status,
    feature: 'test-feature',
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
  return runPath;
}

function readRunJson(projectDir, runId) {
  const p = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-zombie-test-'));
  const pidsDir = join(projectDir, '.pipeline', 'worker-pids');
  mkdirSync(pidsDir, { recursive: true });

  const deadPid = getDeadPid();

  // Seed run-A: status=running, dead PID — should be swept and marked failed.
  const runIdA = 'r-deadtest1';
  seedPidFile(pidsDir, runIdA, deadPid);
  const runPathA = seedRunJson(projectDir, runIdA, 'running');
  const pidFileA = join(pidsDir, runIdA + '.json');

  // Seed run-B: status=completed, dead PID — PID file deleted but run.json NOT modified.
  const runIdB = 'r-deadtest2';
  seedPidFile(pidsDir, runIdB, deadPid);
  seedRunJson(projectDir, runIdB, 'completed');
  const pidFileB = join(pidsDir, runIdB + '.json');

  let failure = null;

  try {
    const result = sweepStalePids(projectDir);

    // ── Assert 1: return shape has swept=2 (both dead PID files removed) ──────
    // Both PID files belong to dead PIDs; the sweep deletes them regardless of
    // run status. swept counts PID file deletions, not run-status changes.
    if (typeof result.swept !== 'number') {
      failure = 'return value.swept is not a number: ' + JSON.stringify(result);
    } else if (result.swept !== 2) {
      failure = 'expected swept=2 (both dead PID files deleted), got swept=' + result.swept;
    }

    // ── Assert 2: run-A (running) is now marked failed ────────────────────────
    if (!failure) {
      const runA = readRunJson(projectDir, runIdA);
      if (!runA) {
        failure = 'run.json for ' + runIdA + ' missing after sweep';
      } else if (runA.status !== 'failed') {
        failure = 'run-A status should be "failed" after sweep, got: ' + runA.status;
      } else if (runA.failureReason !== 'worker process no longer alive (swept)') {
        failure = 'run-A failureReason unexpected: ' + runA.failureReason;
      } else {
        console.error(LABEL + ' assert 2 PASS — run-A (running) marked failed');
      }
    }

    // ── Assert 3: PID file for run-A is deleted ───────────────────────────────
    if (!failure) {
      if (existsSync(pidFileA)) {
        failure = 'PID file for run-A should be deleted after sweep, but still exists';
      } else {
        console.error(LABEL + ' assert 3 PASS — PID file for run-A deleted');
      }
    }

    // ── Assert 4: run-B (completed) run.json is NOT changed ───────────────────
    // The sweep marks only 'running' runs as failed; completed/failed runs are
    // left untouched (PID file is still deleted since the PID is dead).
    if (!failure) {
      const runB = readRunJson(projectDir, runIdB);
      if (!runB) {
        failure = 'run.json for ' + runIdB + ' missing after sweep';
      } else if (runB.status !== 'completed') {
        failure = 'run-B status should remain "completed", got: ' + runB.status;
      } else {
        console.error(LABEL + ' assert 4 PASS — run-B (completed) left untouched');
      }
    }

    // ── Assert 5: PID file for run-B is deleted (dead PID, any run status) ────
    if (!failure) {
      if (existsSync(pidFileB)) {
        failure = 'PID file for run-B should be deleted after sweep, but still exists';
      } else {
        console.error(LABEL + ' assert 5 PASS — PID file for run-B deleted');
      }
    }

    // ── Assert 6: no errors in return value ───────────────────────────────────
    if (!failure && result.errors !== 0) {
      failure = 'expected errors=0, got errors=' + result.errors;
    }

    if (!failure) {
      console.error(LABEL + ' PASS');
      console.error('  deadPid: ' + deadPid);
      console.error('  swept:   ' + result.swept);
      console.error('  alive:   ' + result.alive);
      console.error('  errors:  ' + result.errors);
    }

  } catch (err) {
    failure = 'test harness error: ' + (err && err.stack || String(err));
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failure) fail(failure);
  process.exit(0);
}

main().catch((err) => {
  console.error(LABEL + ' unexpected throw:', err);
  process.exit(1);
});
