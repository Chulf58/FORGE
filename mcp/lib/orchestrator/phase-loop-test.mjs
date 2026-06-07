// @covers mcp/lib/orchestrator/phase-loop.mjs
//
// Observer overhaul W3, task 6 (AC-7): shared phase-sequencing primitives extracted into a pure
// module so the orchestrator loop (implement-stage.mjs) and skills/implement/SKILL.md cannot drift
// on phase-entry shape. Pure functions only (codebase convention: reviewer-verdict.mjs,
// commit-worktree.mjs, wave-split.mjs). RED before phase-loop.mjs exists, GREEN after.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectPhases,
  phaseScopePrefix,
  makeRunningEntry,
  makeCompletedEntry,
  makeBlockedEntry,
} from './phase-loop.mjs';

const PLAN_3 = [
  '## Active Plan', '', '### Feature: X', '',
  '#### Phase 1 — Alpha', '- [ ] 1. do alpha `a.mjs`', '  Intent: build a', '',
  '#### Phase 2 — Beta', '- [ ] 2. do beta `b.mjs`', '',
  '#### Phase 3 — Gamma', '- [ ] 3. do gamma `c.mjs`', '',
].join('\n');

const PLAN_NONE = ['## Active Plan', '', '### Feature: Y', '- [ ] 1. one task `z.mjs`', '  Verify: ok'].join('\n');

test('AC-7: detectPhases returns ordered {index,label,taskLines} for 3 #### Phase headings', () => {
  const phases = detectPhases(PLAN_3);
  assert.equal(phases.length, 3, 'three phases detected');
  assert.deepEqual(phases.map((p) => p.index), [0, 1, 2], '0-based ordered indices');
  assert.match(phases[0].label, /^Phase 1 — Alpha/);
  assert.match(phases[1].label, /^Phase 2 — Beta/);
  assert.match(phases[2].label, /^Phase 3 — Gamma/);
  assert.match(phases[0].taskLines, /do alpha/, 'phase 0 carries its own task lines');
  assert.doesNotMatch(phases[0].taskLines, /do beta/, 'phase 0 taskLines are scoped to phase 0 only');
});

test('AC-7: detectPhases returns [] for a plan with no #### Phase headings (single-pass fallback)', () => {
  assert.deepEqual(detectPhases(PLAN_NONE), []);
});

test('AC-7: phaseScopePrefix returns a string containing [phase-scope: <label>] + the task lines', () => {
  const s = phaseScopePrefix('Phase 1 — Alpha', '- [ ] 1. do alpha');
  assert.match(s, /\[phase-scope: Phase 1 — Alpha\]/);
  assert.match(s, /do alpha/);
});

test('AC-7: makeRunningEntry → {index,label,status:"running"}', () => {
  assert.deepEqual(makeRunningEntry(2, 'Phase 3 — Gamma'), { index: 2, label: 'Phase 3 — Gamma', status: 'running' });
});

test('AC-7: makeCompletedEntry → {index,label,status:"completed",reviewerVerdict,committedAt}', () => {
  assert.deepEqual(
    makeCompletedEntry(0, 'Phase 1 — Alpha', 'APPROVED', 'abc123'),
    { index: 0, label: 'Phase 1 — Alpha', status: 'completed', reviewerVerdict: 'APPROVED', committedAt: 'abc123' },
  );
});

test('AC-7: makeBlockedEntry → {index,label,status:"blocked",reviewerVerdict:"BLOCK"}', () => {
  assert.deepEqual(
    makeBlockedEntry(1, 'Phase 2 — Beta'),
    { index: 1, label: 'Phase 2 — Beta', status: 'blocked', reviewerVerdict: 'BLOCK' },
  );
});
