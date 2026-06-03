// @covers scripts/reviewer-dispatch.mjs
// Task 29 behavioral red bar — per-phase PARALLEL plan review.
//
// When a plan has phases, dispatchPerPhase must emit ONE phase-scoped reviewer set per
// phase (NOT a single whole-plan set), each scoped to that phase's task lines, with
// gotcha-checker running ONCE over the whole plan, and the total dispatch count within
// the per-run loop-guard cap (MAX_DISPATCHES_PER_AGENT_PER_RUN = 25).
//
// Run: node --test scripts/reviewer-dispatch-test.mjs
//
// RED BAR: until dispatchPerPhase is exported from reviewer-dispatch.mjs, the import is
// undefined and every assertion fails.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchPerPhase } from './reviewer-dispatch.mjs';

// 3-phase fixture — each phase carries keywords that map to a DISTINCT reviewer, so a
// phase-scoped result is distinguishable from a whole-plan result.
const THREE_PHASE_PLAN = `## Active Plan

### Feature: Demo

#### Phase 1 — Auth layer
- [ ] 1. Add token validation and crypto hashing for the secret store (wave: 1)
  Verify: WHEN x THEN y; oracle: node --test a.mjs; observable: z

#### Phase 2 — Data boundary
- [ ] 2. Change the schema contract and the module interface across modules (wave: 1)
  Verify: WHEN x THEN y; oracle: node --test b.mjs; observable: z

#### Phase 3 — Perf
- [ ] 3. Optimize the loop over a large dataset in a tight foreach (wave: 1)
  Verify: WHEN x THEN y; oracle: node --test c.mjs; observable: z
`;

test('dispatchPerPhase is exported', () => {
  assert.equal(typeof dispatchPerPhase, 'function', 'dispatchPerPhase export missing');
});

test('emits one phase-scoped reviewer set per phase (not a single whole-plan set)', () => {
  const result = dispatchPerPhase(THREE_PHASE_PLAN);
  assert.ok(Array.isArray(result.perPhase), 'result.perPhase must be an array');
  assert.equal(result.perPhase.length, 3, 'expected exactly one reviewer set per phase (3)');
  for (const p of result.perPhase) {
    assert.equal(typeof p.phaseIndex, 'number', 'each set carries a numeric phaseIndex');
    assert.ok(Array.isArray(p.reviewers), 'each set carries a reviewers array');
  }
});

test('each set is PHASE-SCOPED — keywords map to the right phase only', () => {
  const result = dispatchPerPhase(THREE_PHASE_PLAN);
  const byPhase = Object.fromEntries(result.perPhase.map((p) => [p.phaseIndex, p.reviewers]));
  // Phase 1 (auth/token/crypto) → reviewer-safety; should NOT be the same flat set across phases.
  assert.ok(byPhase[1].includes('reviewer-safety'), 'phase 1 (auth/crypto) should include reviewer-safety');
  assert.ok(byPhase[2].includes('reviewer-boundary'), 'phase 2 (schema/contract/module) should include reviewer-boundary');
  assert.ok(byPhase[3].includes('reviewer-performance'), 'phase 3 (loop/large dataset) should include reviewer-performance');
  // Phase-scoped, not whole-plan: phase 3's perf keywords must NOT have leaked reviewer-performance into phase 1.
  assert.ok(!byPhase[1].includes('reviewer-performance'), 'phase 1 must NOT carry phase 3 reviewers (proves scoping)');
});

test('gotcha-checker runs ONCE over the whole plan (not per phase)', () => {
  const result = dispatchPerPhase(THREE_PHASE_PLAN);
  assert.ok(result.gotchaChecker, 'result must report the gotcha-checker disposition');
  assert.equal(result.gotchaChecker.scope, 'whole-plan', 'gotcha-checker is a single whole-plan pass');
});

test('total dispatch count stays within the per-run loop-guard cap', () => {
  const result = dispatchPerPhase(THREE_PHASE_PLAN);
  assert.equal(typeof result.totalDispatches, 'number', 'totalDispatches must be reported');
  assert.equal(typeof result.cap, 'number', 'cap must be reported');
  assert.ok(result.totalDispatches <= result.cap, `totalDispatches (${result.totalDispatches}) must be <= cap (${result.cap})`);
  assert.equal(result.withinCap, true, 'withinCap must be true for a 3-phase plan');
});

// --- G2: --tests-diff threads the real worktree diff into the HANDOFF path ---
// The orchestrator classifies via the handoff path (it passes no --diff). G2 threads
// the real worktree diff (incl. untracked test files) via --tests-diff so the
// dispatcher's addReviewerTestsIfNeeded force-include fires reviewer-tests on
// test-touching changes — WITHOUT switching to the diff-classification path
// (coderStatus stays undefined → classifyHandoff, not classifyDiff). These spawn the
// real CLI (a degenerate empty-mock would never catch the path-routing bug — G0).

const HANDOFF_CLEAN = `# Handoff

## Files to modify

\`\`\`
src/util.js
\`\`\`

## Verification

All checks pass. No blockers.
`;

const TESTS_DIFF_TOUCHING_TEST_FILE = `diff --git a/foo.test.js b/foo.test.js
index 1234567..abcdefg 100644
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,5 +1,6 @@
 describe('foo', () => {
   it('returns value', () => {
+    expect(x).toBe(1);
   });
 });
`;

function runHandoffDispatch(handoffContent, testsDiffContent) {
  const handoffFile = join(tmpdir(), `rd-handoff-${process.pid}-${Date.now()}.md`);
  const testsDiffFile = testsDiffContent !== undefined
    ? join(tmpdir(), `rd-tdiff-${process.pid}-${Date.now()}.txt`)
    : null;
  try {
    writeFileSync(handoffFile, handoffContent, 'utf8');
    const args = [
      join(process.cwd(), 'scripts', 'reviewer-dispatch.mjs'),
      `--handoff=${handoffFile}`,
      '--stage=implement',
    ];
    if (testsDiffFile) {
      writeFileSync(testsDiffFile, testsDiffContent, 'utf8');
      args.push(`--tests-diff=${testsDiffFile}`);
    }
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: process.cwd() });
    if (result.error) throw result.error;
    return JSON.parse(result.stdout);
  } finally {
    try { unlinkSync(handoffFile); } catch (_) { /* ignore */ }
    if (testsDiffFile) { try { unlinkSync(testsDiffFile); } catch (_) { /* ignore */ } }
  }
}

test('G2: handoff path WITHOUT --tests-diff does NOT dispatch reviewer-tests (baseline)', () => {
  const result = runHandoffDispatch(HANDOFF_CLEAN, undefined);
  assert.ok(
    !result.reviewers.includes('reviewer-tests'),
    `reviewer-tests must NOT appear without a test-touching diff; got ${JSON.stringify(result.reviewers)}`,
  );
});

test('G2: handoff path WITH --tests-diff touching a test file DOES dispatch reviewer-tests', () => {
  const result = runHandoffDispatch(HANDOFF_CLEAN, TESTS_DIFF_TOUCHING_TEST_FILE);
  assert.ok(
    result.reviewers.includes('reviewer-tests'),
    `--tests-diff with a test-file diff must force-include reviewer-tests on the handoff path; got ${JSON.stringify(result.reviewers)}`,
  );
});
