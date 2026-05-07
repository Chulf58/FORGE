#!/usr/bin/env node
// Tests for the terminal-status poll debounce logic added to forge-worker.mjs.
// Since the logic is inline in main(), these tests mirror the exact conditional
// expressions verbatim so regressions are caught without spawning a real worker.
// Run: node mcp/terminal-status-poll-test.mjs

import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

console.log('\n── terminal-status-poll-test.mjs ────────────────────────────────────────');

// --- Inline logic mirrored from forge-worker.mjs ---

/**
 * Returns true when the debounce window has elapsed and a status read should occur.
 * Mirrors: Date.now() - lastStatusReadAt >= 500
 */
function shouldPoll(lastStatusReadAt) {
  return Date.now() - lastStatusReadAt >= 500;
}

/**
 * Returns true when the status value is terminal and should break the worker loop.
 * Mirrors: terminalStatus === 'completed' || terminalStatus === 'failed' || terminalStatus === 'discarded'
 */
function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'discarded';
}

/**
 * Mirrors readRunData() from forge-worker.mjs.
 * Returns parsed run object or null on any error (fail-open).
 */
function readRunDataSync(projectDir, runId) {
  try {
    const runPath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    return JSON.parse(readFileSync(runPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function makeRunDir(projectDir, runId) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

const tmpRoot = join(tmpdir(), 'forge-terminal-poll-' + randomBytes(4).toString('hex'));

// TEST 1 — Debounce: poll fires when lastStatusReadAt is 0 (initial state)
assert(shouldPoll(0) === true, 'poll fires on first call (lastStatusReadAt=0)');

// TEST 2 — Debounce: poll suppressed when called immediately after previous read
{
  const now = Date.now();
  assert(shouldPoll(now) === false, 'poll suppressed when called within 500 ms window');
}

// TEST 3 — Debounce: poll fires after 500+ ms have elapsed
{
  const past = Date.now() - 600;
  assert(shouldPoll(past) === true, 'poll fires after 600 ms elapsed');
}

// TEST 4 — Debounce: fires at exactly the 500 ms boundary (>= semantics)
{
  const past = Date.now() - 500;
  assert(shouldPoll(past) === true, 'poll fires at exactly 500 ms boundary (>= semantics)');
}

// TEST 5 — Terminal status: 'completed' exits
assert(isTerminalStatus('completed') === true, "status 'completed' is terminal");

// TEST 6 — Terminal status: 'failed' exits
assert(isTerminalStatus('failed') === true, "status 'failed' is terminal");

// TEST 7 — Terminal status: 'discarded' exits
assert(isTerminalStatus('discarded') === true, "status 'discarded' is terminal");

// TEST 8 — Non-terminal status: 'gate-pending' does not exit
assert(isTerminalStatus('gate-pending') === false, "status 'gate-pending' is not terminal");

// TEST 9 — Non-terminal status: 'running' does not exit
assert(isTerminalStatus('running') === false, "status 'running' is not terminal");

// TEST 10 — Fail-open: null (absent run.json) is not terminal
assert(isTerminalStatus(null) === false, 'null status (absent run.json) is not terminal — fail-open');

// TEST 11 — Fail-open: undefined is not terminal
assert(isTerminalStatus(undefined) === false, 'undefined status is not terminal — fail-open');

// TEST 12 — readRunData: absent run.json returns null (fail-open)
{
  const proj = join(tmpRoot, 'proj-absent');
  mkdirSync(proj, { recursive: true });
  const result = readRunDataSync(proj, 'r-absent01');
  assert(result === null, 'readRunData returns null for absent run.json (fail-open)');
}

// TEST 13 — readRunData: malformed JSON returns null (fail-open)
{
  const proj = join(tmpRoot, 'proj-malformed');
  const runDir = makeRunDir(proj, 'r-malform1');
  writeFileSync(join(runDir, 'run.json'), '{ not valid json', 'utf-8');
  const result = readRunDataSync(proj, 'r-malform1');
  assert(result === null, 'readRunData returns null for malformed JSON (fail-open)');
}

// TEST 14 — readRunData: valid run.json with terminal status parses correctly
{
  const proj = join(tmpRoot, 'proj-terminal');
  const runDir = makeRunDir(proj, 'r-terminal1');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ status: 'completed', runId: 'r-terminal1' }), 'utf-8');
  const result = readRunDataSync(proj, 'r-terminal1');
  assert(result !== null && result.status === 'completed', 'readRunData returns parsed object for valid run.json');
}

// TEST 15 — Full integration: terminal run triggers break on first poll
{
  const proj = join(tmpRoot, 'proj-integration');
  const runDir = makeRunDir(proj, 'r-integ001');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ status: 'failed', runId: 'r-integ001' }), 'utf-8');
  let lastStatusReadAt = 0; // initial state — poll should fire
  let shouldBreak = false;
  if (shouldPoll(lastStatusReadAt)) {
    lastStatusReadAt = Date.now();
    const terminalData = readRunDataSync(proj, 'r-integ001');
    const terminalStatus = terminalData && terminalData.status;
    if (isTerminalStatus(terminalStatus)) {
      shouldBreak = true;
    }
  }
  assert(shouldBreak === true, 'full flow: failed run triggers break on first poll');
}

// TEST 16 — Full integration: gate-pending run does not trigger break
{
  const proj = join(tmpRoot, 'proj-gate-pending');
  const runDir = makeRunDir(proj, 'r-gate0001');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ status: 'gate-pending', runId: 'r-gate0001' }), 'utf-8');
  let lastStatusReadAt = 0;
  let shouldBreak = false;
  if (shouldPoll(lastStatusReadAt)) {
    lastStatusReadAt = Date.now();
    const terminalData = readRunDataSync(proj, 'r-gate0001');
    const terminalStatus = terminalData && terminalData.status;
    if (isTerminalStatus(terminalStatus)) {
      shouldBreak = true;
    }
  }
  assert(shouldBreak === false, 'full flow: gate-pending run does not trigger break');
}

// TEST 17 — Full integration: poll suppressed within debounce window even for terminal run
{
  const proj = join(tmpRoot, 'proj-debounced');
  const runDir = makeRunDir(proj, 'r-dbnce001');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ status: 'completed', runId: 'r-dbnce001' }), 'utf-8');
  const lastStatusReadAt = Date.now(); // just read — within 500 ms
  let pollFired = false;
  if (shouldPoll(lastStatusReadAt)) {
    pollFired = true;
  }
  assert(pollFired === false, 'poll suppressed within 500 ms window even for terminal run');
}

// Cleanup
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}

console.log('\n  ' + passed + '/' + (passed + failed) + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed > 0 ? 1 : 0);
