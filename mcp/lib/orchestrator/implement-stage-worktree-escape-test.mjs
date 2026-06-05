// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// a8de840b #2 wiring: the orchestrator snapshots main's untracked strays at run start
// (deps.snapshotMainStrays), re-snapshots after the writer dispatches, and if a NEW
// stray appeared (a dispatched agent wrote into MAIN, outside the worktree) it logs a
// loud [worktree-escape] so the breach never reaches a clean regression silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

function makeDeps(calls, logs, snapshots) {
  let snapCall = 0;
  const run = { runId: 'r-test', status: 'running', feature: 'X', orchestratorState: {} };
  return {
    dispatch: async (agentType, promptLines) => {
      calls.push({ agentType, prompt: promptLines.join('\n') });
      return { exitCode: 0, stdout: '{}', stderr: '' };
    },
    readRunJson: async () => ({ ...run }),
    writeRunJson: async () => {},
    writeGateFile: async () => {},
    clearReviewerOutput: async () => {},
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async () => ({ stdout: '{"reviewers":[]}', exitCode: 0 }),
    readPlanMd: () => '## Active Plan\n### Feature: X\n- [ ] 1. do it',
    commitWorktree: async () => ({ committed: true, sha: 'abc' }),
    writeChangeSummary: async () => {},
    writeLog: (m) => { logs.push(m); },
    // first call = baseline (run start), subsequent = post-dispatch snapshot
    snapshotMainStrays: async () => snapshots[Math.min(snapCall++, snapshots.length - 1)],
  };
}

test('a8de840b #2: a NEW main stray after the writer dispatches logs [worktree-escape]', async () => {
  const calls = [], logs = [];
  // baseline empty; after writers a stray appeared in main
  await runImplementStageOrchestrator(makeDeps(calls, logs, [[], ['hooks/cache-drift-guard-test.mjs']]), 'r-test', '/proj/.worktrees/r-test');
  const escapeLog = logs.find((m) => /\[worktree-escape\]/.test(m));
  assert.ok(escapeLog, 'must log [worktree-escape] when a dispatched agent wrote into main');
  assert.match(escapeLog, /hooks\/cache-drift-guard-test\.mjs/, 'must name the leaked file');
});

test('a8de840b #2: no [worktree-escape] when main is unchanged (baseline == current)', async () => {
  const calls = [], logs = [];
  await runImplementStageOrchestrator(makeDeps(calls, logs, [['scripts/observer-preflight-test.mjs'], ['scripts/observer-preflight-test.mjs']]), 'r-test', '/proj/.worktrees/r-test');
  assert.ok(!logs.some((m) => /\[worktree-escape\]/.test(m)), 'pre-existing untracked files must NOT trigger an escape log');
});

test('a8de840b #2: absent snapshotMainStrays dep is a silent no-op (back-compat)', async () => {
  const calls = [], logs = [];
  const deps = makeDeps(calls, logs, [[]]);
  delete deps.snapshotMainStrays;
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.ok(!logs.some((m) => /\[worktree-escape\]/.test(m)), 'no snapshot dep → no escape check, no crash');
});
