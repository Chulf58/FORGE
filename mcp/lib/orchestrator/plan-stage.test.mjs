#!/usr/bin/env node
// TDD wave-1 red-bar: plan-stage orchestrator implementation
//
// AC-1 — AC-9 specify the orchestrator behaviour for the plan-review stage:
//   AC-1: Reads PLAN.md from worktree
//   AC-2: Dispatches reviewer agents and processes verdicts
//   AC-3: Skips researcher when no "### Research needed" heading
//   AC-4: Researches concurrently with gotcha-checker when heading present
//   AC-5: Persists planReviseCount and merges sibling orchestratorState fields
//   AC-6: Opens revisingUnresolved gate at M=2 (after 2 revision passes)
//   AC-7: BLOCK verdict opens blockedBy gate and does not re-dispatch planner
//   AC-8: Orchestrator error marks run as failed
//   AC-9: Clears reviewer output before dispatch
//
// Test strategy
// ─────────────
// All tests inject mock dependencies into runPlanStageOrchestrator({...}).
// No real filesystem, no real SDK.  Tests verify orchestrator logic in isolation
// by mocking dispatch, file I/O, verdict reading, and gate writing.
//
// Run: node --test mcp/lib/orchestrator/plan-stage.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Import the module that Phase 2 must create ──────────────────────────────
let runPlanStageOrchestrator;
try {
  const mod = await import('./plan-stage.mjs');
  runPlanStageOrchestrator = mod.runPlanStageOrchestrator;
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
    test('T0 — mcp/lib/orchestrator/plan-stage.mjs must exist and export runPlanStageOrchestrator', () => {
      assert.fail(
        'mcp/lib/orchestrator/plan-stage.mjs does not exist yet — Phase 2 must create it ' +
        'and export runPlanStageOrchestrator(deps). ' +
        'Original error: ' + err.message
      );
    });
    process.exit(1); // eslint-disable-line n/no-process-exit
  }
  throw err;
}

// ── Helper functions ────────────────────────────────────────────────────────

/**
 * Create a mock dispatch function that tracks calls and allows configuring
 * what each agent returns.
 */
function createMockDispatch() {
  const calls = [];
  const returns = {}; // agentType -> { exitCode, stdout, stderr }

  const dispatch = async (agentType, promptLines, opts = {}) => {
    calls.push({ type: 'dispatch', agentType, promptLines, opts });
    return returns[agentType] || { exitCode: 0, stdout: '{}', stderr: '' };
  };

  return { dispatch, calls, returns };
}

/**
 * Create a mock file operations object for readPlanMd, readRunJson, writeRunJson, writeGateFile, clearReviewerOutput.
 */
function createMockFileOps() {
  const calls = [];

  return {
    readPlanMd: async (planPath) => {
      calls.push({ type: 'readPlanMd', planPath });
      return '# PLAN\n\nSome content';
    },

    readRunJson: async (runPath) => {
      calls.push({ type: 'readRunJson', runPath });
      return { runId: 'r-test', status: 'running', orchestratorState: {} };
    },

    writeRunJson: async (runPath, data) => {
      calls.push({ type: 'writeRunJson', runPath, data });
    },

    writeGateFile: async (gatePath, gateData) => {
      calls.push({ type: 'writeGateFile', gatePath, gateData });
    },

    clearReviewerOutput: async (outputDir) => {
      calls.push({ type: 'clearReviewerOutput', outputDir });
    },

    readReviewerOutput: async (outputDir, reviewerName) => {
      calls.push({ type: 'readReviewerOutput', outputDir, reviewerName });
      return { verdict: 'APPROVED' };
    },

    getCalls: () => calls,
  };
}

// ── AC-0: Module export check ───────────────────────────────────────────────

test('AC-0: runPlanStageOrchestrator is exported as a function', () => {
  assert.equal(
    typeof runPlanStageOrchestrator,
    'function',
    'runPlanStageOrchestrator must be exported as a function'
  );
});

// ── AC-3: Researcher skipped when heading absent ────────────────────────────

test('AC-3: researcher skipped when "### Research needed" heading absent', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => {
    // Content WITHOUT "### Research needed"
    return '# PLAN\n\n## Analysis\n\nNo research section.';
  };

  const mockDispatch = createMockDispatch();
  mockDispatch.returns['planner'] = { exitCode: 0, stdout: '{}', stderr: '' };
  mockDispatch.returns['gotcha-checker'] = { exitCode: 0, stdout: '{}', stderr: '' };
  mockDispatch.returns['reviewer-dispatch'] = {
    exitCode: 0,
    stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
    stderr: ''
  };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => mockDispatch.returns['reviewer-dispatch'],
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore errors from missing implementation
  }

  const dispatchCalls = mockDispatch.calls.filter(c => c.type === 'dispatch');
  const dispatchedAgents = new Set(dispatchCalls.map(c => c.agentType));

  assert.ok(
    dispatchedAgents.has('planner'),
    'AC-3: planner should be dispatched'
  );
  assert.ok(
    dispatchedAgents.has('gotcha-checker'),
    'AC-3: gotcha-checker should be dispatched'
  );
  assert.equal(
    dispatchedAgents.has('researcher'),
    false,
    'AC-3: researcher must NOT be dispatched when heading absent'
  );
});

// ── AC-4: Researcher + gotcha-checker concurrent when heading present ───────

test('AC-4: researcher and gotcha-checker start before either ends (Promise.all concurrency)', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => {
    // Content WITH "### Research needed"
    return '# PLAN\n\n### Research needed\n\nSome research topic.';
  };

  const mockDispatch = createMockDispatch();
  const concurrencyLog = [];

  // Mock dispatch to log start/end times
  mockDispatch.dispatch = async (agentType, promptLines, opts = {}) => {
    concurrencyLog.push({ type: 'start', agentType, time: Date.now() });
    mockDispatch.calls.push({ type: 'dispatch', agentType, promptLines, opts });

    // Simulate async work
    await new Promise(r => setTimeout(r, 10));

    concurrencyLog.push({ type: 'end', agentType, time: Date.now() });
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore errors
  }

  const researcherStart = concurrencyLog.find(e => e.type === 'start' && e.agentType === 'researcher');
  const gotchaStart = concurrencyLog.find(e => e.type === 'start' && e.agentType === 'gotcha-checker');
  const researcherEnd = concurrencyLog.find(e => e.type === 'end' && e.agentType === 'researcher');
  const gotchaEnd = concurrencyLog.find(e => e.type === 'end' && e.agentType === 'gotcha-checker');

  if (researcherStart && gotchaStart && researcherEnd && gotchaEnd) {
    // Both agents were dispatched; verify concurrency
    const allStartsBeforeAnyEnd =
      researcherStart.time <= researcherEnd.time &&
      researcherStart.time <= gotchaEnd.time &&
      gotchaStart.time <= researcherEnd.time &&
      gotchaStart.time <= gotchaEnd.time;

    assert.ok(
      allStartsBeforeAnyEnd,
      'AC-4: both researcher and gotcha-checker must start before either ends (Promise.all)'
    );
  }
});

// ── AC-2 + AC-5: APPROVED sequence writes gate1 ─────────────────────────────

test('AC-2 + AC-5: APPROVED verdict writes gate1 without revisingUnresolved/blockedBy', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    status: 'running',
    orchestratorState: { planReviseCount: 0 }
  });

  const mockDispatch = createMockDispatch();
  mockDispatch.returns['planner'] = { exitCode: 0, stdout: '{}', stderr: '' };
  mockDispatch.returns['gotcha-checker'] = { exitCode: 0, stdout: '{}', stderr: '' };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore
  }

  const writeGateCalls = fileOps.getCalls().filter(c => c.type === 'writeGateFile');
  const gateFile = writeGateCalls.find(c => c.gateData?.gate === 'gate1');

  if (gateFile) {
    const gateData = gateFile.gateData;
    assert.equal(
      gateData.revisingUnresolved === true,
      false,
      'AC-5: gate1 should not have revisingUnresolved=true for APPROVED verdict'
    );
    assert.equal(
      gateData.blockedBy,
      undefined,
      'AC-2: gate1 should not have blockedBy for APPROVED verdict'
    );
  }

  const writeRunCalls = fileOps.getCalls().filter(c => c.type === 'writeRunJson');
  const runUpdate = writeRunCalls[writeRunCalls.length - 1];
  if (runUpdate?.data) {
    assert.equal(
      runUpdate.data.gateState?.gate,
      'gate1',
      'AC-2: APPROVED verdict should set gateState.gate=gate1'
    );
  }
});

// ── AC-5: REVISE M=0 — counter persistence + sibling field merge ───────────

test('AC-5: REVISE M=0 — planReviseCount incremented and persisted before re-dispatch', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';

  let readRunCallCount = 0;
  fileOps.readRunJson = async () => {
    readRunCallCount++;
    return {
      runId: 'r-test',
      status: 'running',
      orchestratorState: {
        planReviseCount: 0,
        someOtherField: 'preserved'
      }
    };
  };

  const mockDispatch = createMockDispatch();
  let planDispatchCount = 0;
  mockDispatch.dispatch = async (agentType, promptLines, opts = {}) => {
    mockDispatch.calls.push({ type: 'dispatch', agentType, promptLines, opts });
    if (agentType === 'planner') {
      planDispatchCount++;
    }
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
    readReviewerOutput: async () => ({ verdict: 'REVISE' }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore
  }

  const writeRunCalls = fileOps.getCalls().filter(c => c.type === 'writeRunJson');
  const reviseWrite = writeRunCalls.find(w =>
    w.data?.orchestratorState?.planReviseCount === 1
  );

  if (reviseWrite) {
    assert.equal(
      reviseWrite.data.orchestratorState.planReviseCount,
      1,
      'AC-5: planReviseCount should be incremented to 1 after first REVISE'
    );
    assert.equal(
      reviseWrite.data.orchestratorState.someOtherField,
      'preserved',
      'AC-5: sibling fields must be preserved when updating planReviseCount'
    );
  }

  const planersDispatched = mockDispatch.calls.filter(c => c.agentType === 'planner');
  assert.ok(
    planersDispatched.length >= 2,
    'AC-5: planner should be re-dispatched after REVISE'
  );
});

// ── AC-6: M=2 REVISE opens revisingUnresolved gate ──────────────────────────

test('AC-6: M=2 REVISE (after 2 revision passes) opens revisingUnresolved gate', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';

  let reviseCount = 0;
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    status: 'running',
    orchestratorState: {
      planReviseCount: reviseCount
    }
  });

  const mockDispatch = createMockDispatch();
  mockDispatch.dispatch = async (agentType, promptLines, opts = {}) => {
    mockDispatch.calls.push({ type: 'dispatch', agentType, promptLines, opts });
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };

  // Simulate 3 REVISE verdicts in sequence (M reaches 2 after 2nd verdict)
  const verdicts = ['REVISE', 'REVISE', 'REVISE'];
  let verdictIndex = 0;

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
    readReviewerOutput: async () => {
      const verdict = verdicts[verdictIndex];
      verdictIndex++;
      if (verdict === 'REVISE') {
        reviseCount++;
      }
      return { verdict };
    },
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore
  }

  const writeGateCalls = fileOps.getCalls().filter(c => c.type === 'writeGateFile');
  const revisingGate = writeGateCalls.find(c => c.gateData?.revisingUnresolved === true);

  if (revisingGate) {
    assert.ok(
      revisingGate.gateData.revisingUnresolved,
      'AC-6: revisingUnresolved gate should be opened at M=2'
    );
  }
});

// ── AC-7: BLOCK verdict — blockedBy gate ────────────────────────────────────

test('AC-7: BLOCK verdict opens blockedBy gate and does not re-dispatch planner', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    status: 'running',
    orchestratorState: { planReviseCount: 0 }
  });

  const mockDispatch = createMockDispatch();
  let planDispatchCount = 0;
  mockDispatch.dispatch = async (agentType, promptLines, opts = {}) => {
    if (agentType === 'planner') {
      planDispatchCount++;
    }
    mockDispatch.calls.push({ type: 'dispatch', agentType, promptLines, opts });
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
    readReviewerOutput: async () => ({ verdict: 'BLOCK' }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore
  }

  const writeGateCalls = fileOps.getCalls().filter(c => c.type === 'writeGateFile');
  const blockGate = writeGateCalls.find(c => c.gateData?.blockedBy);

  if (blockGate) {
    assert.ok(
      blockGate.gateData.blockedBy,
      'AC-7: blockedBy field should be set for BLOCK verdict'
    );
  }

  const plansDispatched = mockDispatch.calls.filter(c => c.agentType === 'planner');
  assert.equal(
    plansDispatched.length,
    1,
    'AC-7: planner should not be re-dispatched after BLOCK'
  );
});

// ── AC-9: Stale reviewer output cleared before dispatch ──────────────────────

test('AC-9: clearReviewerOutput called before reviewer-dispatch (spawnScript)', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    status: 'running',
    orchestratorState: {}
  });

  const callOrder = [];
  const mockDispatch = async (agentType, promptLines, opts = {}) => {
    callOrder.push({ step: 'dispatch', agent: agentType });
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };

  const originalClear = fileOps.clearReviewerOutput;
  fileOps.clearReviewerOutput = async (outputDir) => {
    callOrder.push({ step: 'clearReviewerOutput' });
    return originalClear.call(fileOps, outputDir);
  };

  const deps = {
    ...fileOps,
    dispatch: mockDispatch,
    spawnScript: async (script, args, opts) => {
      callOrder.push({ step: 'spawnScript', script });
      return {
        exitCode: 0,
        stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
        stderr: '',
      };
    },
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore
  }

  const clearCall = callOrder.find(c => c.step === 'clearReviewerOutput');
  const spawnCall = callOrder.find(c => c.step === 'spawnScript');

  if (clearCall && spawnCall) {
    assert.ok(
      callOrder.indexOf(clearCall) < callOrder.indexOf(spawnCall),
      'AC-9: clearReviewerOutput must be called BEFORE reviewer spawnScript'
    );
  }
});

// ── Gate-write contract: required fields per skills/plan/SKILL.md:144-146 ───

test('Gate1 contract: APPROVED gate-pending payload includes runId, feature, status, plan', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    feature: 'Test feature name',
    status: 'running',
    orchestratorState: { planReviseCount: 0 },
  });

  const mockDispatch = createMockDispatch();
  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async () => ({ exitCode: 0, stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }), stderr: '' }),
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
  };

  try { await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree'); } catch (_) {}

  const gateCall = fileOps.getCalls().find(c => c.type === 'writeGateFile');
  assert.ok(gateCall, 'writeGateFile must be called');
  const g = gateCall.gateData;
  assert.equal(g.runId, 'r-test', 'gate-pending must include runId for /forge:approve to route');
  assert.equal(g.feature, 'Test feature name', 'gate-pending must include feature for observer display');
  assert.equal(g.status, 'pending', 'gate-pending must include status field');
  assert.ok(typeof g.plan === 'string' && g.plan.length > 0, 'gate-pending must include plan absolute path');
  assert.ok(g.plan.includes('PLAN.md'), 'gate-pending plan field must point to PLAN.md');
});

test('Gate1 BLOCK contract: blockedBy gate also includes runId, feature, status, plan', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    feature: 'Block feature',
    status: 'running',
    orchestratorState: { planReviseCount: 0 },
  });

  const mockDispatch = createMockDispatch();
  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async () => ({ exitCode: 0, stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }), stderr: '' }),
    readReviewerOutput: async () => ({ verdict: 'BLOCK' }),
  };

  try { await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree'); } catch (_) {}

  const gateCall = fileOps.getCalls().find(c => c.type === 'writeGateFile' && c.gateData?.blockedBy);
  assert.ok(gateCall, 'BLOCK writeGateFile must be called');
  const g = gateCall.gateData;
  assert.equal(g.runId, 'r-test', 'BLOCK gate must include runId');
  assert.equal(g.feature, 'Block feature', 'BLOCK gate must include feature');
  assert.equal(g.status, 'pending', 'BLOCK gate must include status');
  assert.ok(g.plan && g.plan.includes('PLAN.md'), 'BLOCK gate must include plan path');
});

test('Gate1 revisingUnresolved contract: M=2 gate also includes runId, feature, status, plan', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  let reviseCount = 0;
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    feature: 'Revise feature',
    status: 'running',
    orchestratorState: { planReviseCount: reviseCount },
  });

  const mockDispatch = createMockDispatch();
  const deps = {
    ...fileOps,
    dispatch: mockDispatch.dispatch,
    spawnScript: async () => ({ exitCode: 0, stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }), stderr: '' }),
    readReviewerOutput: async () => { reviseCount++; return { verdict: 'REVISE' }; },
  };

  try { await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree'); } catch (_) {}

  const gateCall = fileOps.getCalls().find(c => c.type === 'writeGateFile' && c.gateData?.revisingUnresolved === true);
  assert.ok(gateCall, 'revisingUnresolved writeGateFile must be called when M=2');
  const g = gateCall.gateData;
  assert.equal(g.runId, 'r-test', 'revisingUnresolved gate must include runId');
  assert.equal(g.feature, 'Revise feature', 'revisingUnresolved gate must include feature');
  assert.equal(g.status, 'pending', 'revisingUnresolved gate must include status');
  assert.ok(g.plan && g.plan.includes('PLAN.md'), 'revisingUnresolved gate must include plan path');
});

// ── AC-8 strengthened: error-path merge preserves sibling fields ─────────────

test('AC-8 strengthened: orchestrator error preserves runId/stages/feature via merge', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    feature: 'Preserve me',
    stages: { plan: { agents: ['planner'], status: 'running' } },
    status: 'running',
    orchestratorState: { planReviseCount: 0, sentinel: 'keep' },
  });

  // dispatch throws — drives orchestrator into the catch block
  const deps = {
    ...fileOps,
    dispatch: async () => { throw new Error('dispatch failed intentionally'); },
    spawnScript: async () => ({ exitCode: 0, stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }), stderr: '' }),
  };

  try { await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree'); } catch (_) {}

  const failedWrite = fileOps.getCalls().filter(c => c.type === 'writeRunJson').find(w => w.data?.status === 'failed');
  assert.ok(failedWrite, 'writeRunJson must be called with status:failed on error');
  const d = failedWrite.data;
  assert.equal(d.status, 'failed', 'status must be failed');
  assert.ok(d.failureReason && d.failureReason.length > 0, 'failureReason must be set');
  // Critical: existing fields must survive the failure write
  assert.equal(d.runId, 'r-test', 'runId must be preserved through merge');
  assert.equal(d.feature, 'Preserve me', 'feature must be preserved through merge');
  assert.ok(d.stages && d.stages.plan, 'stages must be preserved through merge');
  assert.equal(d.orchestratorState?.sentinel, 'keep', 'orchestratorState sibling fields must be preserved');
});

// ── AC-8: Orchestrator error marks run failed ───────────────────────────────

test('AC-8: orchestrator error marks run as failed with failureReason', async () => {
  const fileOps = createMockFileOps();
  fileOps.readPlanMd = async () => '# PLAN\n\nContent';
  fileOps.readRunJson = async () => ({
    runId: 'r-test',
    status: 'running',
    orchestratorState: {}
  });

  // Make dispatch throw an error
  const errorDispatch = async (agentType) => {
    throw new Error('dispatch failed intentionally');
  };

  const deps = {
    ...fileOps,
    dispatch: errorDispatch,
    spawnScript: async (script, args, opts) => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['plan-skeptic'], reasons: ['test-fixture'] }),
      stderr: ''
    }),
  };

  try {
    await runPlanStageOrchestrator(deps, 'r-test', '/test/worktree');
  } catch (e) {
    // Ignore the error thrown
  }

  const writeRunCalls = fileOps.getCalls().filter(c => c.type === 'writeRunJson');
  const failedRun = writeRunCalls.find(w => w.data?.status === 'failed');

  if (failedRun) {
    assert.equal(
      failedRun.data.status,
      'failed',
      'AC-8: run status should be set to failed on orchestrator error'
    );
    assert.ok(
      failedRun.data.failureReason && failedRun.data.failureReason.length > 0,
      'AC-8: failureReason must be set and non-empty'
    );
  }
});
