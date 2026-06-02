#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// Phase-1 TDD wave-1 RED BAR — observer-card stamping + outcome-verification + change-summary.
// These assert behavior that does NOT exist in the orchestrator yet, so they MUST fail
// (red bar) before Phase B implements them. The failures are distinguishable from a
// module-missing error (the existing implement-stage.test.mjs T0 covers existence).
//
//   AC-35(a): orchestrator stamps run.agents[] (one entry per dispatched agent, full
//             RunAgent shape {agentId, agentType, startedAt, completedAt, durationMs, outcome}
//             — matching hooks/subagent-stop.js:516-523 + dashboard-state.js:30 'agentType')
//             via direct deps.writeRunJson (NOT forge_update_run, which rejects the field).
//   AC-35(a): orchestrator stamps run.phases (so the observer phase indicator resolves).
//   AC-36:    orchestrator writes a change-summary to .pipeline/runs/<runId>/ BEFORE gate2.
//   AC-38/AC-35(b): when a dispatch returns outcome 'uncertain', the orchestrator stamps
//             outcome:'uncertain' in run.agents AND surfaces it (never silent 'completed').
//   AC-94(a): orchestrator calls commitWorktree BEFORE gate2 on all-APPROVED path.
//   AC-94(b): orchestrator does NOT call commitWorktree on BLOCK path.
//   AC-6:     test-author is dispatched BETWEEN coder-scout and coder in the sequence.
//
// Phase 3 — AC-3: Prompt builder content assertions
//   AC-3(i):  Coder-scout and coder prompts contain ACTUAL task/AC substrings from docs/PLAN.md
//             via injected deps.readPlanMd (NOT from worktree-relative file path)
//   AC-3(ii): Coder prompt contains [scout-output: reference (required precondition)
//   AC-3(iii): Coder prompt contains [phase-scope: ONLY when fixture has ≥2 Phase headings
//
// Run: node --test mcp/lib/orchestrator/implement-stage-phase1.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

let runImplementStageOrchestrator;
const mod = await import('./implement-stage.mjs');
runImplementStageOrchestrator = mod.runImplementStageOrchestrator;

// ── Mocks ───────────────────────────────────────────────────────────────────

// dispatch returns an outcome per agent; default 'completed'. Lets a test force
// 'uncertain' for a specific agent to exercise the surfacing path.
function createMockDispatch(outcomeByAgent = {}) {
  const calls = [];
  const dispatch = async (agentType, promptLines, opts = {}) => {
    calls.push({ agentType, promptLines, opts });
    return { outcome: outcomeByAgent[agentType] || 'completed', exitCode: 0, stdout: '{}', stderr: '' };
  };
  return { dispatch, calls };
}

function createMockFileOps(readReviewerOutputOverride = null) {
  const calls = [];
  return {
    readRunJson: async (runPath) => {
      calls.push({ type: 'readRunJson', runPath });
      return { runId: 'r-test', feature: 'Phase-1 test', status: 'running', orchestratorState: { implementReviseCount: 0 } };
    },
    writeRunJson: async (runPath, data) => { calls.push({ type: 'writeRunJson', runPath, data }); },
    writeGateFile: async (gatePath, gateData) => { calls.push({ type: 'writeGateFile', gatePath, gateData }); },
    // The change-summary capture dep the orchestrator MUST call before gate2 (AC-36).
    writeChangeSummary: async (summaryPath, content) => { calls.push({ type: 'writeChangeSummary', summaryPath, content }); },
    // Task 94302649: commitWorktree mock — records calls.
    commitWorktree: async (workDir, message) => { calls.push({ type: 'commitWorktree', workDir, message }); return { committed: true, sha: 'abc123' }; },
    clearReviewerOutput: async (outputDir) => { calls.push({ type: 'clearReviewerOutput', outputDir }); },
    readReviewerOutput: async (outputDir, reviewerName) => {
      calls.push({ type: 'readReviewerOutput', outputDir, reviewerName });
      // Allow override for BLOCK scenario
      if (readReviewerOutputOverride) {
        return readReviewerOutputOverride(reviewerName);
      }
      return { verdict: 'APPROVED' };
    },
    spawnScript: async (script, args) => {
      calls.push({ type: 'spawnScript', script, args });
      return { exitCode: 0, stdout: JSON.stringify({ reviewers: ['reviewer-boundary'], reasons: ['test'] }), stderr: '' };
    },
    getCalls: () => calls,
  };
}

const RUN_AGENT_KEYS = ['agentId', 'agentType', 'startedAt', 'completedAt', 'durationMs', 'outcome'];

async function runToGate2(deps, runId = 'r-test', workDir = '/test/worktree') {
  try { await runImplementStageOrchestrator(deps, runId, workDir); } catch (_) { /* tolerate incomplete impl */ }
}

function lastRunJsonData(fileOps) {
  const writes = fileOps.getCalls().filter(c => c.type === 'writeRunJson' && c.data);
  return writes.length ? writes[writes.length - 1].data : null;
}

// ── AC-35(a): run.agents stamping ────────────────────────────────────────────

test('RED AC-35a — orchestrator stamps run.agents[] with the full RunAgent shape', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  // run.agents must appear in some writeRunJson payload.
  const withAgents = fileOps.getCalls().filter(c => c.type === 'writeRunJson' && Array.isArray(c.data?.agents) && c.data.agents.length > 0);
  assert.ok(withAgents.length > 0, 'orchestrator must stamp run.agents[] via writeRunJson (none found)');

  const entry = withAgents[withAgents.length - 1].data.agents[0];
  for (const k of RUN_AGENT_KEYS) {
    assert.ok(k in entry, `run.agents entry missing key '${k}' (full RunAgent shape required)`);
  }
  assert.ok(!('type' in entry) || 'agentType' in entry, "must use 'agentType', not 'type' (dashboard-state.js:30 reads agentType)");
});

// ── AC-35(a): run.agents startedAt/completedAt must be epoch-ms (type: number) ───

test('RED AC-35a.type — run.agents[] startedAt and completedAt must be epoch-ms numbers, not ISO strings', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const withAgents = fileOps.getCalls().filter(c => c.type === 'writeRunJson' && Array.isArray(c.data?.agents) && c.data.agents.length > 0);
  assert.ok(withAgents.length > 0, 'orchestrator must stamp run.agents[] (none found)');

  const entry = withAgents[withAgents.length - 1].data.agents[0];
  assert.strictEqual(typeof entry.startedAt, 'number', `startedAt must be a number (epoch-ms), but got ${typeof entry.startedAt} (value: ${JSON.stringify(entry.startedAt)})`);
  assert.strictEqual(typeof entry.completedAt, 'number', `completedAt must be a number (epoch-ms), but got ${typeof entry.completedAt} (value: ${JSON.stringify(entry.completedAt)})`);
  assert.ok(entry.startedAt > 0 && entry.completedAt > 0, 'both startedAt and completedAt must be positive epoch-ms values');
});

// ── AC-35(a): run.phases stamping ────────────────────────────────────────────

test('RED AC-35a — orchestrator stamps run.phases[]', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const stampedPhases = fileOps.getCalls().some(c => c.type === 'writeRunJson' && Array.isArray(c.data?.phases) && c.data.phases.length > 0);
  assert.ok(stampedPhases, 'orchestrator must stamp run.phases[] (none found in any writeRunJson)');
});

// ── AC-35(a): run.phases entries must be objects with {index, label, status} shape ───

test('RED AC-35a.shape — run.phases[] entries must be objects with {index, label, status} keys, not bare strings', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const withPhases = fileOps.getCalls().filter(c => c.type === 'writeRunJson' && Array.isArray(c.data?.phases) && c.data.phases.length > 0);
  assert.ok(withPhases.length > 0, 'orchestrator must stamp run.phases[] (none found)');

  const phases = withPhases[withPhases.length - 1].data.phases;
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    assert.strictEqual(typeof phase, 'object', `phases[${i}] must be an object, but got ${typeof phase} (value: ${JSON.stringify(phase)})`);
    assert.ok(phase !== null, `phases[${i}] must not be null`);
    assert.ok(!Array.isArray(phase), `phases[${i}] must not be an array`);

    // Check required keys
    assert.ok('index' in phase, `phases[${i}] missing required key 'index' (must be {index, label, status})`);
    assert.ok('label' in phase, `phases[${i}] missing required key 'label' (must be {index, label, status})`);
    assert.ok('status' in phase, `phases[${i}] missing required key 'status' (must be {index, label, status})`);
  }
});

// ── AC-36: change-summary written before gate2 ───────────────────────────────

test('RED AC-36 — orchestrator writes change-summary BEFORE gate2', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const calls = fileOps.getCalls();
  const csIdx = calls.findIndex(c => c.type === 'writeChangeSummary');
  const gate2Idx = calls.findIndex(c => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');

  assert.notEqual(csIdx, -1, 'orchestrator must capture a change-summary (writeChangeSummary never called)');
  assert.ok(gate2Idx === -1 || csIdx < gate2Idx, 'change-summary must be written BEFORE the gate2 write');
});

// ── AC-38 / AC-35(b): uncertain outcome stamped + surfaced ───────────────────

test('RED AC-38 — an uncertain dispatch is stamped uncertain AND surfaced (not silent completed)', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch({ coder: 'uncertain' });
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const data = lastRunJsonData(fileOps);
  const agents = (data && Array.isArray(data.agents)) ? data.agents : [];
  const coderEntry = agents.find(a => a.agentType === 'coder');
  assert.ok(coderEntry, 'coder must appear in run.agents');
  assert.equal(coderEntry.outcome, 'uncertain', 'an uncertain dispatch must be stamped outcome:uncertain (not completed)');

  // Surfaced: a gate-pending write carrying an uncertain marker (never silently continue).
  const surfaced = fileOps.getCalls().some(c =>
    (c.type === 'writeGateFile' && (c.gateData?.uncertain || c.gateData?.blockedBy)) ||
    (c.type === 'writeRunJson' && c.data?.gateState && JSON.stringify(c.data.gateState).includes('uncertain'))
  );
  assert.ok(surfaced, 'an uncertain outcome must be surfaced to the conductor (gate-pending uncertain marker), not swallowed');
});

// ── AC-94(a): commitWorktree called before gate2 on all-APPROVED ──────────────

test('RED AC-94a — orchestrator calls commitWorktree BEFORE gate2 when all reviewers APPROVE', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const calls = fileOps.getCalls();
  const commitIdx = calls.findIndex(c => c.type === 'commitWorktree');
  const gate2Idx = calls.findIndex(c => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');

  assert.notEqual(commitIdx, -1, 'orchestrator must call commitWorktree on all-APPROVED path (never called)');
  assert.ok(gate2Idx === -1 || commitIdx < gate2Idx, 'commitWorktree must be called BEFORE gate2 write');
});

// ── AC-94(b): commitWorktree NOT called on BLOCK ────────────────────────────

test('RED AC-94b — orchestrator does NOT call commitWorktree when a reviewer returns BLOCK', async () => {
  // Override readReviewerOutput to return BLOCK for reviewer-boundary
  const fileOps = createMockFileOps((reviewerName) => {
    if (reviewerName === 'reviewer-boundary') {
      return { verdict: 'BLOCK' };
    }
    return { verdict: 'APPROVED' };
  });
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const calls = fileOps.getCalls();
  const commitCalls = calls.filter(c => c.type === 'commitWorktree');
  assert.equal(commitCalls.length, 0, 'orchestrator must NOT call commitWorktree on BLOCK path (but was called)');

  // Verify gate2 was written with blockedBy marker
  const gate2 = calls.find(c => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'gate2 must be written on BLOCK path');
  assert.ok(gate2.gateData?.blockedBy, 'gate2 must include blockedBy marker when BLOCK occurs');
});

// ── AC-6: test-author dispatch sequence ──────────────────────────────────────

test('RED AC-6 — test-author dispatched BETWEEN coder-scout and coder in the sequence', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const calls = md.calls;
  const agentTypes = calls.map(c => c.agentType);

  // Find indices of the three agents that define the sequence
  const scoutIdx = agentTypes.indexOf('coder-scout');
  const testAuthorIdx = agentTypes.indexOf('test-author');
  const coderIdx = agentTypes.indexOf('coder');

  assert.notEqual(scoutIdx, -1, 'coder-scout must be dispatched');
  assert.notEqual(coderIdx, -1, 'coder must be dispatched');
  assert.notEqual(testAuthorIdx, -1, 'test-author must be dispatched (currently missing from sequence)');

  // Verify the order: coder-scout < test-author < coder
  assert.ok(scoutIdx < testAuthorIdx, `coder-scout (index ${scoutIdx}) must be dispatched BEFORE test-author (index ${testAuthorIdx})`);
  assert.ok(testAuthorIdx < coderIdx, `test-author (index ${testAuthorIdx}) must be dispatched BEFORE coder (index ${coderIdx})`);
});

// ── AC-3: Prompt builder content assertions (Phase 3 RED BAR) ────────────────

// Helper: Create a mock orchestrator run with fixture docs/PLAN.md + fixture workDir
// PLAN.md is injected via deps.readPlanMd, NOT written to the worktree-relative path.
async function runOrchestratorWithFixture(planMd, opts = {}) {
  const os = await import('node:os');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  // Create temp fixture directory structure (no docs/PLAN.md written — that's the point)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'));
  const workDir = path.join(tempDir, 'worktree');
  const pipelineDir = path.join(tempDir, '.pipeline', 'runs', 'r-test');

  await fs.mkdir(path.join(workDir, '.pipeline', 'context'), { recursive: true });
  await fs.mkdir(pipelineDir, { recursive: true });

  // Create mock dispatch that captures promptLines
  const dispatchCalls = [];
  const mockDispatch = async (agentType, promptLines) => {
    dispatchCalls.push({ agentType, promptLines });
    return { outcome: 'completed', exitCode: 0, stdout: '{}', stderr: '' };
  };

  // Create minimal file ops with injected readPlanMd
  const fileOps = {
    readRunJson: async () => ({
      runId: 'r-test',
      feature: opts.feature || 'Test Feature',
      status: 'running',
      orchestratorState: { implementReviseCount: 0 }
    }),
    writeRunJson: async () => {},
    writeGateFile: async () => {},
    clearReviewerOutput: async () => {},
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ reviewers: ['reviewer-boundary'], reasons: ['test'] }),
      stderr: ''
    }),
    // Injected dependency: return the fixture PLAN.md content
    readPlanMd: async () => planMd,
  };

  // Run orchestrator
  try {
    await runImplementStageOrchestrator(
      { ...fileOps, dispatch: mockDispatch },
      'r-test',
      workDir
    );
  } catch (_) {
    // Tolerate incomplete impl
  }

  // Cleanup (best effort)
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (_) {}

  return { dispatchCalls, planMd, tempDir };
}

test('RED AC-3(i) — coder-scout prompt contains ACTUAL task/AC substring from docs/PLAN.md', async () => {
  const planMd = `## Active Plan

### Feature: Test Feature

#### Phase 1 — First phase heading

- [ ] 1. First task description with distinctive marker
  Intent: Do something unique
  Verify: AC-1: When X then Y; observable: verify with marker ABC-123

- [ ] 2. Second task description
`;

  const result = await runOrchestratorWithFixture(planMd, { feature: 'Test Feature' });

  // Find coder-scout dispatch call
  const scoutCall = result.dispatchCalls.find(c => c.agentType === 'coder-scout');
  assert.ok(scoutCall, 'coder-scout must be dispatched');

  const promptText = (scoutCall.promptLines || []).join('\n');

  // Must contain actual task context, not just feature word
  // This assertion MUST FAIL because the current code reads from the WRONG path (workDir/../docs/PLAN.md)
  // and the injected readPlanMd is being ignored.
  assert.ok(
    promptText.includes('First task description') || promptText.includes('marker ABC-123') || promptText.includes('AC-1'),
    `coder-scout prompt must contain actual task/AC substring from PLAN.md (found none); prompt was: ${promptText}`
  );
});

test('RED AC-3(i) — coder prompt contains ACTUAL task/AC substring from docs/PLAN.md', async () => {
  const planMd = `## Active Plan

### Feature: Test Feature

#### Phase 1 — First phase

- [ ] 1. Implementation task with observable marker
  Verify: AC-1: Must assert observable behavior
`;

  const result = await runOrchestratorWithFixture(planMd, { feature: 'Test Feature' });

  // Find coder dispatch call
  const coderCall = result.dispatchCalls.find(c => c.agentType === 'coder');
  assert.ok(coderCall, 'coder must be dispatched');

  const promptText = (coderCall.promptLines || []).join('\n');

  // Must contain actual task content, not just the feature word
  // This assertion MUST FAIL because the current code reads from the WRONG path
  // and the injected readPlanMd is being ignored.
  assert.ok(
    promptText.includes('Implementation task') || promptText.includes('observable behavior') || promptText.includes('AC-1'),
    `coder prompt must contain actual task/AC substring from PLAN.md (found none); prompt was: ${promptText}`
  );
});

test('RED AC-3(ii) — coder prompt contains [scout-output: reference', async () => {
  const planMd = `## Active Plan

### Feature: Test Feature

#### Phase 1 — First phase

- [ ] 1. Coder task
`;

  const result = await runOrchestratorWithFixture(planMd, { feature: 'Test Feature' });

  const coderCall = result.dispatchCalls.find(c => c.agentType === 'coder');
  assert.ok(coderCall, 'coder must be dispatched');

  const promptText = (coderCall.promptLines || []).join('\n');

  assert.ok(
    promptText.includes('[scout-output:'),
    `coder prompt must contain [scout-output: reference (required precondition); prompt was: ${promptText}`
  );
});

test('RED AC-3(iii) — coder prompt CONTAINS [phase-scope: when fixture plan has ≥2 Phase headings', async () => {
  const planMd = `## Active Plan

### Feature: Test Feature

#### Phase 1 — First phase

- [ ] 1. Task one

#### Phase 2 — Second phase

- [ ] 2. Task two
`;

  const result = await runOrchestratorWithFixture(planMd, { feature: 'Test Feature' });

  const coderCall = result.dispatchCalls.find(c => c.agentType === 'coder');
  assert.ok(coderCall, 'coder must be dispatched');

  const promptText = (coderCall.promptLines || []).join('\n');

  assert.ok(
    promptText.includes('[phase-scope:'),
    `coder prompt MUST contain [phase-scope: when PLAN.md has ≥2 Phase headings; prompt was: ${promptText}`
  );
});

test('RED AC-3(iii) — coder prompt OMITS [phase-scope: when fixture plan has ≤1 Phase heading', async () => {
  const planMd = `## Active Plan

### Feature: Test Feature

#### Phase 1 — Only one phase

- [ ] 1. Task one
`;

  const result = await runOrchestratorWithFixture(planMd, { feature: 'Test Feature' });

  const coderCall = result.dispatchCalls.find(c => c.agentType === 'coder');
  assert.ok(coderCall, 'coder must be dispatched');

  const promptText = (coderCall.promptLines || []).join('\n');

  assert.ok(
    !promptText.includes('[phase-scope:'),
    `coder prompt must NOT contain [phase-scope: when PLAN.md has ≤1 Phase heading; but found it. Prompt was: ${promptText}`
  );
});
