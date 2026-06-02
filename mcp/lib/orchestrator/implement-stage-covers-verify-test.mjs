#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// The orchestrator must run a DETERMINISTIC test step (scripts/covers-verify.mjs)
// AFTER the coder completes and BEFORE the completeness-checker — so the coder no
// longer has to run the full suite itself. In run r-77a6fac8 the coder ran
// `node scripts/run-tests.mjs` to satisfy a full-suite acceptance criterion,
// burned its turn budget on worktree SDK-dep test noise, and the dispatch ended
// before it wrote handoff.md → outcome "uncertain" → gate2 blocked. covers-verify
// runs only the @covers tests for the changed files, off the coder's budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { runImplementStageOrchestrator } = await import('./implement-stage.mjs');

function makeDeps({ coversExitCode = 0 } = {}) {
  const calls = [];
  const deps = {
    dispatch: async (agentType, promptLines) => {
      calls.push({ type: 'dispatch', agentType });
      return { exitCode: 0, stdout: '{}', stderr: '' }; // no outcome → orchestrator treats as 'completed'
    },
    readRunJson: async () => ({
      runId: 'r-test', feature: 'Test feature', status: 'running',
      orchestratorState: { implementReviseCount: 0 },
    }),
    writeRunJson: async (p, data) => { calls.push({ type: 'writeRunJson', data }); },
    writeGateFile: async (p, gateData) => { calls.push({ type: 'writeGateFile', gateData }); },
    clearReviewerOutput: async () => { calls.push({ type: 'clearReviewerOutput' }); },
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async (script, args) => {
      calls.push({ type: 'spawnScript', script, args });
      if (script.includes('covers-verify')) {
        return { exitCode: coversExitCode, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: JSON.stringify({ reviewers: ['reviewer-boundary'], reasons: ['fx'] }), stderr: '' };
    },
    readPlanMd: () => '',
    writeLog: () => {},
  };
  return { deps, calls };
}

function idxOf(calls, pred) {
  return calls.findIndex(pred);
}

test('covers-verify runs after the coder and before the completeness-checker (passing → proceeds)', async () => {
  const { deps, calls } = makeDeps({ coversExitCode: 0 });
  await runImplementStageOrchestrator(deps, 'r-test', '/test/worktree');

  const coversIdx = idxOf(calls, c => c.type === 'spawnScript' && c.script.includes('covers-verify'));
  const coderIdx = idxOf(calls, c => c.type === 'dispatch' && c.agentType === 'coder');
  const checkerIdx = idxOf(calls, c => c.type === 'dispatch' && c.agentType === 'completeness-checker');

  assert.ok(coversIdx >= 0, 'orchestrator must invoke scripts/covers-verify.mjs');
  assert.ok(coderIdx >= 0 && coversIdx > coderIdx, 'covers-verify must run AFTER the coder');
  assert.ok(checkerIdx >= 0 && coversIdx < checkerIdx, 'covers-verify must run BEFORE the completeness-checker');

  // It must run in --changed-from-git mode (the coder's handoff format is not
  // parseable by covers-verify's "## Files modified" path-list reader), scoped to
  // the worktree root so git resolves the changed source files.
  const coversCall = calls.find(c => c.type === 'spawnScript' && c.script.includes('covers-verify'));
  assert.ok(coversCall.args.includes('--changed-from-git'),
    'covers-verify must run in --changed-from-git mode');
  assert.ok(coversCall.args.some(a => a.startsWith('--root=')), 'covers-verify needs --root=<worktree>');
});

test('covers-verify FAILURE blocks gate2 and skips completeness-checker + reviewers', async () => {
  const { deps, calls } = makeDeps({ coversExitCode: 1 });
  await runImplementStageOrchestrator(deps, 'r-test', '/test/worktree');

  const gate2 = calls.find(c => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'a failing covers-verify must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'covers-verify',
    'gate2 must be blockedBy covers-verify when covering tests fail');

  assert.equal(
    idxOf(calls, c => c.type === 'dispatch' && c.agentType === 'completeness-checker'),
    -1,
    'completeness-checker must NOT be dispatched after a covers-verify failure',
  );
  assert.equal(
    idxOf(calls, c => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch')),
    -1,
    'reviewers must NOT be dispatched after a covers-verify failure',
  );
});
