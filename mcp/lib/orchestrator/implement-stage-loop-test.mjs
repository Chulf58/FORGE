// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Observer overhaul W3, tasks 7-8 (AC-8/AC-9): the orchestrator must execute a Phase Execution
// Loop when the plan has `#### Phase N` headings — pre-stub ALL plan-phases into run.phases, then
// FOR EACH phase: stamp running → (test-author if test tasks) → coder-scout → coder (phase-scoped)
// → reviewers → on APPROVED per-phase commit + stamp completed; completeness ONCE after the loop.
// run.phases holds PLAN-phases (loop-owned), NOT agent dispatches (those stay in run.agents).
// RED against the current single-pass orchestrator; GREEN after the loop is implemented.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';
import { PhaseEntry } from '../../../packages/forge-core/src/runs/schemas.js';

const PLAN_2PHASE = [
  '## Active Plan', '', '### Feature: Two-Phase X', '',
  '#### Phase 1 — Alpha', '- [ ] 1. do alpha `scripts/alpha.mjs`', '  Verify: ok', '',
  '#### Phase 2 — Beta', '- [ ] 2. do beta `scripts/beta.mjs`', '  Verify: ok', '',
].join('\n');

// verdictFn(commitsSoFar) lets a test drive reviewer verdicts per phase — e.g. APPROVE phase 1
// (0 commits) then BLOCK phase 2 (1 commit). Default: all APPROVED (the AC-8 happy path).
function makeDeps(verdictFn = () => 'APPROVED') {
  let run = { runId: 'r-test', feature: 'Two-Phase X', status: 'running', orchestratorState: {}, phases: [], agents: [] };
  const dispatches = [];
  const commits = [];
  const gateFiles = [];
  let clearCount = 0;
  const deps = {
    dispatch: async (agentType, promptLines) => {
      dispatches.push({
        agentType,
        prompt: promptLines.join('\n'),
        phasesAtDispatch: JSON.parse(JSON.stringify(run.phases || [])),
      });
      return { outcome: 'completed' };
    },
    readRunJson: async () => JSON.parse(JSON.stringify(run)),
    writeRunJson: async (_p, data) => { run = { ...run, ...data }; },
    writeGateFile: async (_p, data) => { gateFiles.push(data); },
    clearReviewerOutput: async () => { clearCount++; },
    readReviewerOutput: async () => ({ verdict: verdictFn(commits.length) }),
    spawnScript: async (script) => (String(script).includes('covers-verify')
      ? { exitCode: 0, stdout: '', stderr: '' }
      : { exitCode: 0, stdout: JSON.stringify({ reviewers: ['reviewer-boundary'] }), stderr: '' }),
    buildReviewDiff: async () => null,
    changedTestFiles: async () => [],
    readPlanMd: async () => PLAN_2PHASE,
    commitWorktree: async (_wd, message) => { commits.push(message); return { committed: true, sha: 'sha' + commits.length }; },
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
  return { deps, getRun: () => run, dispatches, commits, gateFiles, getClearCount: () => clearCount };
}

test('AC-8(a): all plan-phase stubs are pre-populated in run.phases BEFORE any dispatch', async () => {
  const { deps, dispatches } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.ok(dispatches.length > 0, 'at least one agent dispatched');
  const labels = dispatches[0].phasesAtDispatch.map((p) => p.label);
  assert.ok(labels.includes('Phase 1 — Alpha') && labels.includes('Phase 2 — Beta'),
    'both plan-phase stubs must exist before the first dispatch (stable denominator); saw ' + JSON.stringify(labels));
});

test('AC-8(b): run.phases holds ONE entry per PLAN-phase, each completed+APPROVED+committedAt', async () => {
  const { deps, getRun } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const phases = getRun().phases || [];
  assert.deepEqual(phases.map((p) => p.label), ['Phase 1 — Alpha', 'Phase 2 — Beta'],
    'run.phases must be the PLAN phases (loop-owned) — not agent dispatches');
  for (const p of phases) {
    assert.equal(p.status, 'completed', `phase ${p.label} completed`);
    assert.equal(p.reviewerVerdict, 'approved', `phase ${p.label} approved (lowercase — PhaseEntry-valid)`);
    assert.ok(p.committedAt, `phase ${p.label} carries committedAt (per-phase commit sha)`);
  }
});

test('AC-8(c): the coder prompt for each phase carries [phase-scope: <label>]', async () => {
  const { deps, dispatches } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const coderDispatches = dispatches.filter((d) => d.agentType === 'coder');
  assert.equal(coderDispatches.length, 2, 'one coder dispatch per phase');
  assert.match(coderDispatches[0].prompt, /\[phase-scope: Phase 1 — Alpha\]/);
  assert.match(coderDispatches[1].prompt, /\[phase-scope: Phase 2 — Beta\]/);
});

test('AC-8(d): reviewer-output is cleared at least once per phase', async () => {
  const { deps, getClearCount } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.ok(getClearCount() >= 2, `reviewer-output cleared per phase (>=2 for 2 phases); got ${getClearCount()}`);
});

test('AC-8(e): a per-phase commit is made matching "forge: <label> [<runId>]"', async () => {
  const { deps, commits } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.deepEqual(commits, ['forge: Phase 1 — Alpha [r-test]', 'forge: Phase 2 — Beta [r-test]']);
});

test('AC-8(f): completeness-checker runs exactly ONCE after the loop (not per-phase)', async () => {
  const { deps, dispatches } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const completeness = dispatches.filter((d) => d.agentType === 'completeness-checker');
  assert.equal(completeness.length, 1, 'completeness-checker once after the loop, not per-phase');
});

test('AC-11: BLOCK mid-loop — prior phase keeps committedAt; blocked phase carries blockedBy.phase; completeness NOT run', async () => {
  // APPROVE phase 1 (commits=0 at its review), BLOCK phase 2 (commits=1 after phase 1 committed).
  const { deps, getRun, gateFiles, dispatches } = makeDeps((commitsSoFar) => (commitsSoFar >= 1 ? 'BLOCK' : 'APPROVED'));
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const phases = getRun().phases || [];
  assert.equal(phases[0].status, 'completed', 'phase 1 stays completed');
  assert.ok(phases[0].committedAt, 'phase 1 RETAINS its committedAt after a later phase BLOCKs');
  assert.equal(phases[1].status, 'blocked', 'phase 2 is blocked');
  assert.equal(phases[1].reviewerVerdict, 'blocked', 'phase 2 carries blocked verdict (lowercase — PhaseEntry-valid)');
  const gate2 = gateFiles.find((g) => g.gate === 'gate2' && g.blockedBy);
  assert.ok(gate2, 'a gate2 with blockedBy was written');
  assert.equal(gate2.blockedBy.phase, 1, 'blockedBy.phase === 1 (the blocked phase index)');
  assert.equal(dispatches.filter((d) => d.agentType === 'completeness-checker').length, 0,
    'completeness-checker must NOT run when a phase BLOCKs');
  assert.equal(getRun().status, 'gate-pending', 'run is gate-pending (stop-for-human), not failed');
});

test('AC-11: REVISE-unresolved — phase fails after REVISE_CAP; run failed with phase-scoped reason', async () => {
  const { deps, getRun } = makeDeps(() => 'REVISE');
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.equal(getRun().status, 'failed', 'unresolved REVISE fails the run');
  assert.match(getRun().failureReason || '', /Phase 1 — Alpha/, 'failureReason names the phase label (phase-scoped)');
  const phases = getRun().phases || [];
  assert.equal(phases[0].status, 'revise-unresolved', 'phase 1 stamped revise-unresolved');
  assert.doesNotThrow(() => PhaseEntry.parse(phases[0]),
    'the revise-unresolved phase entry must satisfy PhaseEntry (lowercase reviewerVerdict + in-enum status) — forge_get_run parses it');
});

// Schema guard (the one the unit tests were MISSING — the soak r-43611a31 caught it via forge_get_run):
// every run.phases entry the loop writes MUST satisfy the PhaseEntry Zod schema, because forge_get_run
// + the observer parse run.json through it. Uppercase verdicts ('APPROVED'/'BLOCK') or an out-of-enum
// status make forge_get_run THROW on a real run.
test('schema: loop-produced run.phases entries all validate against PhaseEntry (lowercase verdicts, in-enum status)', async () => {
  const { deps, getRun } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const phases = getRun().phases || [];
  assert.ok(phases.length > 0, 'phases populated');
  for (const p of phases) {
    assert.doesNotThrow(() => PhaseEntry.parse(p),
      `phase "${p.label}" must satisfy PhaseEntry — forge_get_run parses run.json through it; got ${JSON.stringify(p)}`);
  }
});
