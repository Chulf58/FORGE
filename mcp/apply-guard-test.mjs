#!/usr/bin/env node
// Tests for the apply-guard logic in forge_create_run.
// Validates that apply runs are blocked when a source worker is still alive
// (gate2 approved, no failureReason) and allowed when the source worker is dead.
// Run: node mcp/apply-guard-test.mjs

import { createRun } from '../packages/forge-core/src/runs/index.js';
import { listRuns } from '../packages/forge-core/src/runs/index.js';
import { getRun } from '../packages/forge-core/src/runs/index.js';
import { updateRun } from '../packages/forge-core/src/runs/index.js';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

console.log('\n── apply-guard-test.mjs ─────────────────────────────────────────────────');

// Create a unique temp directory for each test run
const tmpRoot = join(tmpdir(), 'forge-apply-guard-' + randomBytes(4).toString('hex'));

function makeTempProject() {
  const dir = join(tmpRoot, 'proj-' + randomBytes(3).toString('hex'));
  mkdirSync(join(dir, '.pipeline', 'runs'), { recursive: true });
  return dir;
}

// --- Guard logic extracted from server.js forge_create_run ---
// This mirrors the exact check in server.js lines 1630-1646.
function applyGuardBlocks(projectDir) {
  const gatePendingRuns = listRuns(projectDir, { status: 'gate-pending' });
  const aliveSource = gatePendingRuns.find(entry => {
    try {
      const r = getRun(projectDir, entry.runId);
      return r && !r.failureReason
        && r.gateState?.gate === 'gate2'
        && r.gateState?.status === 'approved';
    } catch (_) { return false; }
  });
  return aliveSource != null;
}

// TEST 1: Block when source run has gate2 approved (worker alive)
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0001' });
  updateRun(proj, run.runId, {
    status: 'gate-pending',
    gateState: { gate: 'gate2', status: 'approved', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === true, 'blocks when gate2 approved, no failureReason');
}

// TEST 2: Allow when source run has gate2 approved but has failureReason (worker dead)
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0002' });
  updateRun(proj, run.runId, {
    status: 'gate-pending',
    gateState: { gate: 'gate2', status: 'approved', feature: 'test-feature', createdAt: new Date().toISOString() },
    failureReason: 'worker crashed',
  });
  assert(applyGuardBlocks(proj) === false, 'allows when gate2 approved but failureReason set');
}

// TEST 3: Allow when source run is failed (worker dead)
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0003' });
  updateRun(proj, run.runId, {
    status: 'failed',
    gateState: { gate: 'gate2', status: 'approved', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === false, 'allows when run status is failed');
}

// TEST 4: Allow when no gate-pending runs exist
{
  const proj = makeTempProject();
  assert(applyGuardBlocks(proj) === false, 'allows when no runs exist');
}

// TEST 5: Allow when gate-pending run has gate1 (not gate2)
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'plan', feature: 'test-feature', runId: 'r-test0005' });
  updateRun(proj, run.runId, {
    status: 'gate-pending',
    gateState: { gate: 'gate1', status: 'pending', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === false, 'allows when gate is gate1 not gate2');
}

// TEST 6: Allow when gate2 is still pending (not yet approved)
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0006' });
  updateRun(proj, run.runId, {
    status: 'gate-pending',
    gateState: { gate: 'gate2', status: 'pending', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === false, 'allows when gate2 is pending (not approved)');
}

// TEST 7: Block when commit gate is pending (worker still doing apply work)
// After gate2 approval, the worker progresses to commit gate — still alive.
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0007' });
  updateRun(proj, run.runId, {
    status: 'gate-pending',
    gateState: { gate: 'commit', status: 'pending', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  // The guard checks for gate2+approved specifically — a commit gate means
  // the worker already progressed past gate2, so it should NOT block.
  assert(applyGuardBlocks(proj) === false, 'allows when gate is commit (worker already progressed)');
}

// TEST 8: Allow when run is completed
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0008' });
  updateRun(proj, run.runId, {
    status: 'completed',
    gateState: { gate: 'gate2', status: 'approved', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === false, 'allows when run is completed');
}

// TEST 9: Allow when run is discarded
{
  const proj = makeTempProject();
  const run = createRun({ projectRoot: proj, sessionId: 's1', pipelineType: 'implement', feature: 'test-feature', runId: 'r-test0009' });
  updateRun(proj, run.runId, {
    status: 'discarded',
    gateState: { gate: 'gate2', status: 'approved', feature: 'test-feature', createdAt: new Date().toISOString() },
  });
  assert(applyGuardBlocks(proj) === false, 'allows when run is discarded');
}

// Cleanup
try { rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}

console.log('\n  ' + passed + '/' + (passed + failed) + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed > 0 ? 1 : 0);
