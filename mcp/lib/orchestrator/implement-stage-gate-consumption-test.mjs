// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Orchestrator quality-gap fix-run, Slice 2 (G3/G5/G8): the orchestrator dispatched
// coder-scout, completeness-checker, and reviewer-dispatch but DISCARDED their results —
// so a failed scout (coder runs without its precondition), an incomplete impl, or a
// reviewer-dispatch crash all reached gate2 silently. These failure-path tests assert the
// orchestrator now CONSUMES each result and blocks gate2 instead of passing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

function makeDeps({ outcomes = {}, reviewerStdout } = {}) {
  const calls = [];
  const run = { runId: 'r-test', feature: 'X', status: 'running', orchestratorState: { implementReviseCount: 0 } };
  const deps = {
    dispatch: async (agentType) => {
      calls.push({ type: 'dispatch', agentType });
      // outcomes map lets a test mark a specific agent 'uncertain' (stampedDispatch reads result.outcome)
      return outcomes[agentType] ? { outcome: outcomes[agentType] } : { exitCode: 0, stdout: '{}', stderr: '' };
    },
    readRunJson: async () => ({ ...run }),
    writeRunJson: async (p, data) => { calls.push({ type: 'writeRunJson', data }); },
    writeGateFile: async (p, gateData) => { calls.push({ type: 'writeGateFile', gateData }); },
    clearReviewerOutput: async () => {},
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async (script) => {
      calls.push({ type: 'spawnScript', script });
      if (script.includes('covers-verify')) return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: reviewerStdout ?? JSON.stringify({ reviewers: ['reviewer-boundary'] }), stderr: '' };
    },
    readPlanMd: () => '',
    commitWorktree: async () => ({ committed: true, sha: 'abc' }),
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
  return { deps, calls };
}

test('G8: coder-scout uncertain → gate2 blocked, coder NOT dispatched (scout precondition enforced)', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'coder-scout': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'a failed coder-scout must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'coder-scout', 'gate2 blockedBy coder-scout');
  assert.equal(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'coder'), -1,
    'coder must NOT run after a failed scout (no scout output)');
});

test('G3: completeness-checker uncertain → gate2 blocked, reviewers NOT dispatched', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'completeness-checker': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'an incomplete impl must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'completeness-checker', 'gate2 blockedBy completeness-checker');
  assert.equal(calls.findIndex((c) => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch')), -1,
    'reviewers must NOT run after a completeness block');
});

test('G5: reviewer-dispatch failure (unparseable output) → gate2 blocked, not a silent clean pass', async () => {
  const { deps, calls } = makeDeps({ reviewerStdout: 'NOT JSON {' });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'a reviewer-dispatch failure must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'reviewer-dispatch',
    'gate2 blockedBy reviewer-dispatch when selection fails — never silently proceed with zero reviewers');
});

test('control: all-clean still reaches a clean gate2 (no spurious block from the new guards)', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2s = calls.filter((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  const finalGate = gate2s[gate2s.length - 1];
  assert.ok(finalGate, 'clean run reaches gate2');
  assert.ok(!finalGate.gateData.blockedBy, 'clean run must NOT be blocked by the new guards');
});
