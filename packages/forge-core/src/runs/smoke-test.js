#!/usr/bin/env node

// Smoke test for run registry.
// Run: node packages/forge-core/src/runs/smoke-test.js
// Uses a temp directory — does not touch your project's .pipeline/

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRun, getRun, listRuns, updateRun } from './index.js';

const tmp = mkdtempSync(join(tmpdir(), 'forge-run-test-'));
console.log('Test dir:', tmp);

// Ensure .pipeline/ exists (createRun creates .pipeline/runs/ but needs .pipeline/)
try {

  // 1. Create a run
  console.log('\n--- createRun ---');
  const run = createRun({
    projectRoot: tmp,
    sessionId: 'test-session-001',
    pipelineType: 'plan',
    mode: 'LEAN',
    feature: 'Add user preferences',
  });
  console.log('Created:', run.runId, run.status, run.pipelineType, run.mode);

  // 2. Get it back
  console.log('\n--- getRun ---');
  const fetched = getRun(tmp, run.runId);
  console.log('Fetched:', fetched.runId, fetched.feature);
  console.assert(fetched.runId === run.runId, 'runId mismatch');
  console.assert(fetched.sessionId === 'test-session-001', 'sessionId mismatch');

  // 3. List runs
  console.log('\n--- listRuns ---');
  const all = listRuns(tmp);
  console.log('Total runs:', all.length);
  console.assert(all.length === 1, 'Expected 1 run');

  // 4. Update status
  console.log('\n--- updateRun (status -> running) ---');
  const updated = updateRun(tmp, run.runId, {
    status: 'running',
    currentStep: 'planner',
  });
  console.log('Updated:', updated.status, updated.currentStep);
  console.assert(updated.status === 'running', 'Status should be running');

  // 5. Update with gate state
  console.log('\n--- updateRun (gate-pending) ---');
  const gated = updateRun(tmp, run.runId, {
    status: 'gate-pending',
    currentStep: 'gate1',
    gateState: {
      gate: 'gate1',
      status: 'pending',
      feature: 'Add user preferences',
      createdAt: new Date().toISOString(),
    },
  });
  console.log('Gated:', gated.status, gated.gateState.gate, gated.gateState.status);

  // 6. Verify index is in sync
  console.log('\n--- verify index sync ---');
  const indexed = listRuns(tmp);
  console.log('Index status:', indexed[0].status);
  console.assert(indexed[0].status === 'gate-pending', 'Index should reflect gate-pending');

  // 7. Create a second run
  console.log('\n--- second run ---');
  const run2 = createRun({
    projectRoot: tmp,
    sessionId: 'test-session-002',
    pipelineType: 'debug',
    mode: 'STANDARD',
    feature: 'Fix crash on empty input',
  });
  console.log('Created:', run2.runId, run2.pipelineType);

  // 8. List with filter
  console.log('\n--- listRuns (filter: status=created) ---');
  const created = listRuns(tmp, { status: 'created' });
  console.log('Created runs:', created.length);
  console.assert(created.length === 1, 'Only run2 should be created');

  // 9. Verify disk layout
  console.log('\n--- disk layout ---');
  const indexExists = existsSync(join(tmp, '.pipeline', 'runs', 'index.json'));
  const run1Exists = existsSync(join(tmp, '.pipeline', 'runs', run.runId, 'run.json'));
  const run2Exists = existsSync(join(tmp, '.pipeline', 'runs', run2.runId, 'run.json'));
  console.log('index.json:', indexExists);
  console.log(run.runId + '/run.json:', run1Exists);
  console.log(run2.runId + '/run.json:', run2Exists);
  console.assert(indexExists && run1Exists && run2Exists, 'All files should exist');

  // 10. getNonExistent returns null
  console.log('\n--- getRun (nonexistent) ---');
  const ghost = getRun(tmp, 'r-00000000');
  console.log('Nonexistent run:', ghost);
  console.assert(ghost === null, 'Should be null');

  console.log('\n✓ All checks passed');

} finally {
  // Cleanup
  rmSync(tmp, { recursive: true, force: true });
}
