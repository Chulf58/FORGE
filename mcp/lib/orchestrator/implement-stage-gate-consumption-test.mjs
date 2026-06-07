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
import { GateState, RunAgent } from '../../../packages/forge-core/src/runs/schemas.js';

const STAGE_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'implement-stage.mjs'), 'utf-8');

// A realistic plan — the orchestrated implement REQUIRES a gate1-approved plan, so in production
// activeTasksText is non-empty. PLAN_WITH_TEST names a *-test file in a task → test-author runs
// (the wave-gate is satisfied); PLAN_NO_TEST has tasks but no *-test → test-author is gated off.
const PLAN_WITH_TEST = '## Active Plan\n\n### Feature: X\n\n#### Phase 1 — W\n- [ ] 1. Implement — create `scripts/thing-test.mjs` (red) then `scripts/thing.mjs`\n  Verify: AC-1: `node scripts/thing-test.mjs` exits 0\n';
const PLAN_NO_TEST = '## Active Plan\n\n### Feature: X\n\n#### Phase 1 — W\n- [ ] 1. Update config `forge-config.default.json`\n  Verify: config loads without error\n';

function makeDeps({ outcomes = {}, reviewerStdout, reviewDiffPath = null, testFilesWritten = [], planMd = PLAN_WITH_TEST } = {}) {
  const calls = [];
  const run = { runId: 'r-test', feature: 'X', status: 'running', orchestratorState: { implementReviseCount: 0 } };
  const deps = {
    dispatch: async (agentType, promptLines) => {
      calls.push({ type: 'dispatch', agentType, promptLines });
      // outcomes map lets a test mark a specific agent 'uncertain' (string) OR pass a full
      // result object { outcome, reason, attempts } to assert reason/attempts propagation.
      const o = outcomes[agentType];
      if (o && typeof o === 'object') return o;
      return o ? { outcome: o } : { exitCode: 0, stdout: '{}', stderr: '' };
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
    readPlanMd: async () => planMd,
    commitWorktree: async () => ({ committed: true, sha: 'abc' }),
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
  return { deps, calls };
}

test('G8: coder-scout uncertain → gate2 blocked, coder NOT dispatched (scout precondition enforced)', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'coder-scout': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'a failed coder-scout must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'coder-scout', 'gate2 blockedBy coder-scout');
  assert.equal(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'coder'), -1,
    'coder must NOT run after a failed scout (no scout output)');
});

test('G7/G8: test-author uncertain → gate2 blocked, coder NOT dispatched (red-bar precondition)', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'test-author': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
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
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const taBlock = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.blockedBy?.agentType === 'test-author');
  assert.ok(!taBlock, 'test-author must NOT block gate2 when it actually wrote test files (manifest is only a proxy)');
  assert.notEqual(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'coder'), -1,
    'coder MUST run when test-author wrote the red-bar test files, even if the manifest is absent');
});

test('G3: completeness-checker uncertain → gate2 blocked, reviewers NOT dispatched', async () => {
  const { deps, calls } = makeDeps({ outcomes: { 'completeness-checker': 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'an incomplete impl must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'completeness-checker', 'gate2 blockedBy completeness-checker');
  assert.equal(calls.findIndex((c) => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch')), -1,
    'reviewers must NOT run after a completeness block');
});

test('G5: reviewer-dispatch failure (unparseable output) → gate2 blocked, not a silent clean pass', async () => {
  const { deps, calls } = makeDeps({ reviewerStdout: 'NOT JSON {' });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const gate2 = calls.find((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  assert.ok(gate2, 'a reviewer-dispatch failure must open gate2');
  assert.equal(gate2.gateData.blockedBy?.agentType, 'reviewer-dispatch',
    'gate2 blockedBy reviewer-dispatch when selection fails — never silently proceed with zero reviewers');
});

test('G2: reviewer-dispatch is invoked with --tests-diff=<path> when buildReviewDiff yields a diff', async () => {
  const { deps, calls } = makeDeps({ reviewDiffPath: '/wt/.pipeline/context/review-diff.patch' });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const rd = calls.find((c) => c.type === 'spawnScript' && c.script.includes('reviewer-dispatch'));
  assert.ok(rd, 'reviewer-dispatch must be spawned');
  assert.ok(
    Array.isArray(rd.args) && rd.args.includes('--tests-diff=/wt/.pipeline/context/review-diff.patch'),
    'reviewer-dispatch must receive --tests-diff=<path> so reviewer-tests fires on test-touching changes; got ' + JSON.stringify(rd.args),
  );
});

test('G2: no --tests-diff arg when buildReviewDiff yields null (fail-open to handoff classification)', async () => {
  const { deps, calls } = makeDeps({ reviewDiffPath: null });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
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

// bug #2 (r-5d8837d6): the orchestrator wrote a PARTIAL gateState into run.json
// (e.g. { gate: 'gate2', uncertain: true }) missing the GateState-required fields
// status/feature/createdAt — so forge_get_run THREW on schema validation and the
// run became unreadable (dashboard + /forge:approve broke). Every run.json gateState
// the orchestrator writes must satisfy the real GateState schema.
test('bug #2: uncertain-coder run.json gateState satisfies GateState schema (getRun must not throw)', async () => {
  const { deps, calls } = makeDeps({ outcomes: { coder: 'uncertain' } });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const runWrites = calls.filter((c) => c.type === 'writeRunJson' && c.data && c.data.gateState);
  assert.ok(runWrites.length > 0, 'orchestrator must write a gateState to run.json');
  for (const w of runWrites) {
    assert.doesNotThrow(() => GateState.parse(w.data.gateState),
      'run.json gateState must satisfy GateState schema; got ' + JSON.stringify(w.data.gateState));
    assert.equal(w.data.gateState.feature, 'X', 'gateState.feature must be carried (observer display)');
  }
});

test('bug #2: clean-APPROVED run.json gateState also satisfies GateState schema', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const runWrites = calls.filter((c) => c.type === 'writeRunJson' && c.data && c.data.gateState);
  assert.ok(runWrites.length > 0, 'orchestrator must write a gateState to run.json');
  for (const w of runWrites) {
    assert.doesNotThrow(() => GateState.parse(w.data.gateState),
      'run.json gateState must satisfy GateState schema; got ' + JSON.stringify(w.data.gateState));
  }
});

// Step 1 diagnosability (r-5d8837d6): stampedDispatch recorded only `outcome` and DROPPED
// the classifyOutcome `reason` + runWithRetry `attempts` — so every 'uncertain' was a guess
// (couldn't tell max_turns vs artifact-absent vs stream-abort). dispatchAgent already returns
// { outcome, reason, attempts }; persist them on the run.json agents[] entry.
test('diagnosability: uncertain agent persists `reason` + `attempts` on run.json agents[]', async () => {
  const { deps, calls } = makeDeps({ outcomes: { coder: { outcome: 'uncertain', reason: 'file absent: docs/context/handoff.md', attempts: 2 } } });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const coderEntry = calls
    .filter((c) => c.type === 'writeRunJson' && c.data && Array.isArray(c.data.agents))
    .flatMap((c) => c.data.agents)
    .find((a) => a.agentType === 'coder');
  assert.ok(coderEntry, 'coder agent entry must be stamped on run.json');
  assert.equal(coderEntry.reason, 'file absent: docs/context/handoff.md', 'the uncertain reason must be persisted, not dropped');
  assert.equal(coderEntry.attempts, 2, 'the dispatch attempt count must be persisted');
});

// (b)-gated: the orchestrator must GATE test-author on whether the plan names a *-test file
// (mirroring skills/implement/SKILL.md:170-196), and SIGNAL the coder via [test-author-output:]
// when a wave ran so the coder writes NO tests (source-only) — closing the duplicate-test /
// Red+Green-collapse / turn-budget hole observed on r-5d8837d6.
test('(b)-gated: plan with NO *-test task → test-author SKIPPED, coder runs without [test-author-output:]', async () => {
  const { deps, calls } = makeDeps({ planMd: PLAN_NO_TEST });
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.equal(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'test-author'), -1,
    'test-author must NOT be dispatched when the plan names no *-test file');
  const coderCall = calls.find((c) => c.type === 'dispatch' && c.agentType === 'coder');
  assert.ok(coderCall, 'coder must still run');
  assert.ok(!coderCall.promptLines.join('\n').includes('[test-author-output:'),
    'coder prompt must NOT carry [test-author-output:] when no test-author wave ran');
});

test('(b)-gated: plan WITH a *-test task → test-author dispatched, coder prompt carries [test-author-output:]', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.notEqual(calls.findIndex((c) => c.type === 'dispatch' && c.agentType === 'test-author'), -1,
    'test-author must be dispatched when the plan names a *-test file');
  const coderCall = calls.find((c) => c.type === 'dispatch' && c.agentType === 'coder');
  assert.ok(coderCall, 'coder must run');
  assert.ok(coderCall.promptLines.join('\n').includes('[test-author-output:'),
    'coder prompt must carry [test-author-output:] when a test-author wave ran (so the coder writes no tests)');
});

// Slowness fix (r-82c06b51, 2026-06-07): the haiku test-author ran the full 168-file suite
// (`node scripts/run-tests.mjs`, ~22 min) for red-bar verification — because its injected Verify:
// line named run-tests.mjs and the orchestrator prompt carried no counter-instruction, so it
// obeyed the conflicting command over test-author.md's own `node --test <files>` rule. The
// orchestrator-built prompt MUST forbid the full suite (mirrors coder.md:266 / coderPromptLines),
// so the directive sits right next to the Verify line instead of relying on the agent reading the .md.
test('slowness: test-author prompt forbids the full regression suite (run only its own test file)', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const ta = calls.find((c) => c.type === 'dispatch' && c.agentType === 'test-author');
  assert.ok(ta, 'test-author must be dispatched (PLAN_WITH_TEST names a *-test)');
  const joined = ta.promptLines.join('\n');
  assert.match(joined, /never run the full regression suite/i,
    'test-author prompt must explicitly forbid the full regression suite (it wrongly ran the 168-file suite on r-82c06b51)');
  assert.match(joined, /run-tests\.mjs/,
    'the prohibition must name scripts/run-tests.mjs — the exact command the haiku agent obeyed from its Verify line');
});

// Step-1 read-side: the diagnosability write (reason+attempts on the agent entry) is useless if
// the RunAgent schema strips them on read — forge_get_run + dashboard parse through RunAgent, so
// the two fields must be in the schema or they never surface (observed validating r-08832e73).
test('Step-1 read-side: RunAgent schema PRESERVES reason + attempts (getRun/dashboard must not strip)', () => {
  const parsed = RunAgent.parse({
    agentId: 'a1', agentType: 'coder', startedAt: 1, completedAt: 2, durationMs: 1,
    outcome: 'uncertain', reason: 'file absent: docs/context/handoff.md', attempts: 2,
  });
  assert.equal(parsed.reason, 'file absent: docs/context/handoff.md', 'reason must survive the schema parse (not be stripped)');
  assert.equal(parsed.attempts, 2, 'attempts must survive the schema parse');
});

test('control: all-clean still reaches a clean gate2 (no spurious block from the new guards)', async () => {
  const { deps, calls } = makeDeps({});
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const gate2s = calls.filter((c) => c.type === 'writeGateFile' && c.gateData?.gate === 'gate2');
  const finalGate = gate2s[gate2s.length - 1];
  assert.ok(finalGate, 'clean run reaches gate2');
  assert.ok(!finalGate.gateData.blockedBy, 'clean run must NOT be blocked by the new guards');
});
