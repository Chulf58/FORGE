#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Observer overhaul W2 (Phase 2): the orchestrator must stamp each phase entry
// status:'running' BEFORE its agent dispatch and 'completed' AFTER. Today every phase is
// stamped 'completed' immediately (persisted only after the dispatch returns), so the
// observer's "(running X)" branch never fires. Also: the REVISE loop must persist via
// mergeRun(), never bare Object.assign({}, currentRun, …) (the sibling-field-preservation
// rule — bare Object.assign drops run.agents[]/run.phases[] across revise iterations).
// RED before the implement-stage.mjs change, GREEN after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runImplementStageOrchestrator } from '../mcp/lib/orchestrator/implement-stage.mjs';

const STAGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'lib', 'orchestrator', 'implement-stage.mjs',
);
const STAGE_SRC = readFileSync(STAGE_PATH, 'utf-8');

// PLAN names a *-test file so the gated test-author wave runs (a representative multi-agent path).
// No `#### Phase N` heading → SINGLE-PASS path, where stampedDispatch owns the per-agent phase
// stamping that this W2 test asserts. (Multi-phase loop behavior: implement-stage-loop-test.mjs.)
const PLAN = '## Active Plan\n\n### Feature: X\n\n- [ ] 1. Implement — create `scripts/thing-test.mjs` (red) then `scripts/thing.mjs`\n  Verify: AC-1: `node --test scripts/thing-test.mjs` exits 0\n';

function makeDeps() {
  let run = { runId: 'r-test', feature: 'X', status: 'running', orchestratorState: { implementReviseCount: 0 }, phases: [], agents: [] };
  const dispatchObservations = [];
  const deps = {
    dispatch: async (agentType) => {
      // Snapshot the PERSISTED phase state visible at the moment this agent is dispatched.
      // With correct stamping, this agent's own phase entry must already read 'running'.
      dispatchObservations.push({ agentType, phases: JSON.parse(JSON.stringify(run.phases || [])) });
      return { exitCode: 0, stdout: '{}', stderr: '' };
    },
    readRunJson: async () => JSON.parse(JSON.stringify(run)),
    writeRunJson: async (_p, data) => { run = { ...run, ...data }; },
    writeGateFile: async () => {},
    clearReviewerOutput: async () => {},
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async (script) => (String(script).includes('covers-verify')
      ? { exitCode: 0, stdout: '', stderr: '' }
      : { exitCode: 0, stdout: JSON.stringify({ reviewers: ['reviewer-boundary'] }), stderr: '' }),
    buildReviewDiff: async () => null,
    changedTestFiles: async () => ['scripts/thing-test.mjs'],
    readPlanMd: async () => PLAN,
    commitWorktree: async () => ({ committed: true, sha: 'abc123' }),
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
  return { deps, getRun: () => run, dispatchObservations };
}

test('W2: each dispatched agent phase reads status:"running" at dispatch time', async () => {
  const { deps, dispatchObservations } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  assert.ok(dispatchObservations.length > 0, 'at least one agent must be dispatched');
  for (const obs of dispatchObservations) {
    const mine = obs.phases.filter((p) => p.label === obs.agentType);
    assert.ok(mine.length > 0,
      `phase entry for "${obs.agentType}" must be PERSISTED (status:running) before its dispatch — none found`);
    assert.equal(mine[mine.length - 1].status, 'running',
      `"${obs.agentType}" phase must read 'running' at dispatch time (was '${mine[mine.length - 1].status}')`);
  }
});

test('W2: every phase ends status:"completed" after a clean run (running → completed transition)', async () => {
  const { deps, getRun } = makeDeps();
  await runImplementStageOrchestrator(deps, 'r-test', '/proj/.worktrees/r-test');
  const phases = getRun().phases || [];
  assert.ok(phases.length > 0, 'phases must be populated');
  for (const p of phases) {
    assert.equal(p.status, 'completed', `final phase "${p.label}" must be 'completed' (was '${p.status}')`);
  }
});

test('W2: REVISE loop uses mergeRun, not bare Object.assign({}, currentRun, …)', () => {
  assert.doesNotMatch(STAGE_SRC, /Object\.assign\(\{\}\s*,\s*currentRun/,
    'the REVISE-loop run.json write must use mergeRun() — bare Object.assign({}, currentRun, …) drops sibling run.agents[]/run.phases[]');
});
