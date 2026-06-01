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

// ── AC-35(a): run.phases stamping ────────────────────────────────────────────

test('RED AC-35a — orchestrator stamps run.phases[]', async () => {
  const fileOps = createMockFileOps();
  const md = createMockDispatch();
  await runToGate2({ ...fileOps, dispatch: md.dispatch });

  const stampedPhases = fileOps.getCalls().some(c => c.type === 'writeRunJson' && Array.isArray(c.data?.phases) && c.data.phases.length > 0);
  assert.ok(stampedPhases, 'orchestrator must stamp run.phases[] (none found in any writeRunJson)');
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
