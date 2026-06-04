// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Orchestrator quality-gap fix-run, Slice 2 (G3/G5/G8): the orchestrator dispatched
// coder-scout, completeness-checker, and reviewer-dispatch but DISCARDED their results —
// so a failed scout (coder runs without its precondition), an incomplete impl, or a
// reviewer-dispatch crash all reached gate2 silently. These failure-path tests assert the
// orchestrator now CONSUMES each result and blocks gate2 instead of passing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

const STAGE_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'implement-stage.mjs'), 'utf-8');

function makeDeps({ outcomes = {}, reviewerStdout, reviewDiffPath = null, testFilesWritten = [] } = {}) {
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
    spawnScript: async (script, args) => {
      calls.push({ type: 'spawnScript', script, args });
      if (script.includes('covers-verify')) return { exitCode: 0, stdout: '', stderr: '' };
      return { exitCode: 0, stdout: reviewerStdout ?? JSON.stringify({ reviewers: ['reviewer-boundary'] }), stderr: '' };
    },
    // G2: returns the path to a synthesized review diff (or null when none). Default null
    // so existing tests see current behavior (no --tests-diff arg threaded).
    buildReviewDiff: async () => reviewDiffPath,
    // 53dea988: the test files test-author wrote into the worktree (real output). Default []
    // so the existing "uncertain test-author → blocked" test still blocks (no tests written).
    changedTestFiles: async () => testFilesWritten,
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

test('G7/G8: test-author uncertain → gate2 blocked, coder NOT dispatched (red-bar precondition)', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'test-author': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'an unverified test-author (no red-bar artifact) must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'test-author', 'gate2 blockedBy test-author');
  assert.equal(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'coder'), -1,
    'coder must NOT run without a verified red bar from test-author');
});

// 53dea988: test-author (haiku) reliably writes its red-bar TEST FILES but not always its
// manifest (.pipeline/context/test-author-output.json, the G7 expectedArtifact). The manifest
// is a proxy; the test files are the real output. When the outcome is 'uncertain' (manifest
// absent) BUT test-author actually wrote test files into the worktree, artifact-wins → completed.
test('53dea988: test-author uncertain BUT test files written → artifact-wins, NOT blocked, coder runs', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'test-author': 'uncertain' }, testFilesWritten: ['scripts/foo-test.mjs'] });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const taBlock = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.blockedBy?.agentType === 'test-author');
  assert.ok(!taBlock, 'test-author must NOT block gate2 when it actually wrote test files (manifest is only a proxy)');
  assert.notEqual(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'coder'), -1,
    'coder MUST run when test-author wrote the red-bar test files, even if the manifest is absent');
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

test('G2: reviewer-dispatch is invoked with --tests-diff=<path> when buildReviewDiff yields a diff', async () => {
  const { deps, calls } = makeDeps({ reviewDiffPath: '/wt/.pipeline/context/review-diff.patch' });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const rd = calls.find((c) => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch'));
  assert.ok(rd, 'reviewer-dispatch must be spawned');
  assert.ok(
    Array.isArray(rd.args) && rd.args.includes('--tests-diff=/wt/.pipeline/context/review-diff.patch'),
    'reviewer-dispatch must receive --tests-diff=<path> so reviewer-tests fires on test-touching changes; got ' + JSON.stringify(rd.args),
  );
});

test('G2: no --tests-diff arg when buildReviewDiff yields null (fail-open to handoff classification)', async () => {
  const { deps, calls } = makeDeps({ reviewDiffPath: null });
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const rd = calls.find((c) => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch'));
  assert.ok(rd, 'reviewer-dispatch must be spawned');
  assert.ok(
    !rd.args.some((a) => a.startsWith('--tests-diff=')),
    'no --tests-diff when no diff is available; got ' + JSON.stringify(rd.args),
  );
});

// 775944dd: the a8de840b worktree-guard fires on ANY new file under hooks/mcp/scripts in
// main during the writer-dispatch window — including the conductor's own concurrent edits
// (observed r-8c327c9a). The detection over-fires in the safe direction; the MESSAGE must
// be framed as a POSSIBLE breach (could be a concurrent conductor edit), not a definitive one.
test('worktree-escape message is advisory (POSSIBLE + notes concurrent conductor edit), not a definitive breach claim (775944dd)', () => {
  const m = STAGE_SRC.match(/\[worktree-escape\][\s\S]{0,500}?\);/);
  assert.ok(m, 'the [worktree-escape] writeLog must be present');
  assert.match(m[0], /POSSIBLE/, 'message must be advisory (POSSIBLE), not assert a breach as fact');
  assert.match(m[0], /conductor/i, 'message must note it ALSO fires on a concurrent conductor edit');
  assert.doesNotMatch(m[0], /dispatched agent wrote into MAIN/, 'the definitive "dispatched agent wrote into MAIN" wording must be softened');
});

test('control: all-clean still reaches a clean gate2 (no spurious block from the new guards)', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/wt');
  const gate2s = calls.filter((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  const finalGate = gate2s[gate2s.length - 1];
  assert.ok(finalGate, 'clean run reaches gate2');
  assert.ok(!finalGate.gateData.blockedBy, 'clean run must NOT be blocked by the new guards');
});
