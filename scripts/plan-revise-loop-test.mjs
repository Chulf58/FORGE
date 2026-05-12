#!/usr/bin/env node
// Tests for the plan-stage REVISE retry loop (closes TODO c41f1504).
//
// Covers:
//   AC-1 — REVISE-retry loop logic: planner re-invoked with [revision-mode: M] on each pass,
//           M counter increments correctly, loop never exceeds M=2.
//   AC-2 — M=1 APPROVED scenario: one REVISE then APPROVED resolves cleanly;
//           gate1 opens with status "pending" and no revisingUnresolved marker.
//   AC-3 — M=2 unresolved scenario: two REVISE passes still unresolved produces
//           gate1 with revisingUnresolved: true and status "pending" (not "failed").
//
// The tests drive a pure-function simulator extracted from skills/plan/SKILL.md.
// The simulator is imported from scripts/plan-revise-loop.mjs which does NOT exist yet —
// these tests establish the red bar before implementation.
//
// Run: node --test scripts/plan-revise-loop-test.mjs

// @covers scripts/plan-revise-loop.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import the loop simulator that the coder will create.
// This import WILL FAIL before implementation, establishing the red bar.
import { runPlanReviseLoop } from './plan-revise-loop.mjs';

// ─── AC-1: REVISE-retry loop logic ───────────────────────────────────────────

test('AC-1a: first REVISE pass re-invokes planner with [revision-mode: 1]', async () => {
  // Simulate: pass 0 → REVISE, pass 1 → REVISE, pass 2 → REVISE (M exhausted)
  // The loop must re-invoke with [revision-mode: 1] on the first retry.
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  // Must record invocations — each entry should capture the revision-mode prefix used
  assert.ok(Array.isArray(result.plannerInvocations),
    'result.plannerInvocations must be an array');
  assert.ok(result.plannerInvocations.length >= 2,
    `Expected at least 2 planner invocations (initial + retry), got ${result.plannerInvocations.length}`);

  // First invocation has no revision-mode prefix (M=0, initial pass)
  const firstInvocation = result.plannerInvocations[0];
  assert.ok(
    !firstInvocation.revisionMode || firstInvocation.revisionMode === 0,
    `First invocation must have revisionMode 0 or absent, got: ${firstInvocation.revisionMode}`
  );

  // Second invocation (first retry) must use revision-mode 1
  const secondInvocation = result.plannerInvocations[1];
  assert.equal(secondInvocation.revisionMode, 1,
    `Second invocation must have revisionMode 1, got: ${secondInvocation.revisionMode}`);
});

test('AC-1b: second REVISE pass re-invokes planner with [revision-mode: 2]', async () => {
  // Simulate: pass 0 → REVISE, pass 1 → REVISE, pass 2 → REVISE (M exhausted)
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  // Third invocation (second retry) must use revision-mode 2
  assert.ok(result.plannerInvocations.length >= 3,
    `Expected at least 3 planner invocations (initial + 2 retries), got ${result.plannerInvocations.length}`);

  const thirdInvocation = result.plannerInvocations[2];
  assert.equal(thirdInvocation.revisionMode, 2,
    `Third invocation must have revisionMode 2, got: ${thirdInvocation.revisionMode}`);
});

test('AC-1c: loop never exceeds M=2 (maximum 3 total planner invocations)', async () => {
  // Even if verdict sequence has more entries, loop must stop after M=2
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  // Must never invoke planner more than 3 times (initial + 2 retries)
  assert.ok(result.plannerInvocations.length <= 3,
    `Loop must not exceed 3 planner invocations (initial + M=2 max), ` +
    `got ${result.plannerInvocations.length}`);
});

test('AC-1d: M counter increments correctly on each REVISE pass', async () => {
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  // The M values across all invocations must be [0, 1, 2] in order
  const mValues = result.plannerInvocations.map(inv => inv.revisionMode ?? 0);
  assert.deepEqual(mValues, [0, 1, 2],
    `M counter must increment as [0, 1, 2], got: [${mValues.join(', ')}]`);
});

// ─── AC-2: M=1 APPROVED scenario (happy path) ────────────────────────────────

test('AC-2a: REVISE then APPROVED — gate1 opens with status "pending"', async () => {
  // Simulate: pass 0 → REVISE, pass 1 (M=1) → APPROVED
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  // Gate1 must be written
  assert.ok(result.gate1, 'gate1 must be present in result');
  assert.equal(result.gate1.status, 'pending',
    `gate1.status must be "pending", got: "${result.gate1.status}"`);
});

test('AC-2b: REVISE then APPROVED — gate1 has no revisingUnresolved marker', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1, 'gate1 must be present in result');

  // Must NOT have revisingUnresolved set to true
  assert.ok(
    !result.gate1.revisingUnresolved,
    `gate1.revisingUnresolved must be absent or false on resolved APPROVED path, ` +
    `got: ${result.gate1.revisingUnresolved}`
  );
});

test('AC-2c: REVISE then APPROVED — exactly 2 planner invocations', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  // Initial pass + one revision = 2 total invocations
  assert.equal(result.plannerInvocations.length, 2,
    `Expected exactly 2 planner invocations for REVISE+APPROVED, ` +
    `got ${result.plannerInvocations.length}`);

  // Second invocation used revision-mode 1 (M=1)
  assert.equal(result.plannerInvocations[1].revisionMode, 1,
    `Second invocation must use revision-mode 1, got: ${result.plannerInvocations[1].revisionMode}`);
});

test('AC-2d: REVISE then APPROVED — run does not enter failed state', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  // The loop result must NOT indicate a failed run
  assert.ok(!result.failed,
    `Run must not be marked failed when M=1 resolves to APPROVED, got result.failed: ${result.failed}`);
});

// ─── AC-3: M=2 unresolved → gate1 opens with revisingUnresolved marker ───────

test('AC-3a: two unresolved REVISE passes — gate1 written with revisingUnresolved: true', async () => {
  // Simulate: pass 0 → REVISE, pass 1 (M=1) → REVISE, pass 2 (M=2) → REVISE
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  // Gate1 must still be written (not failed/aborted)
  assert.ok(result.gate1,
    'gate1 must be written even after M=2 unresolved REVISE passes');

  // Must have revisingUnresolved: true
  assert.strictEqual(result.gate1.revisingUnresolved, true,
    `gate1.revisingUnresolved must be true when both passes still emit REVISE, ` +
    `got: ${result.gate1.revisingUnresolved}`);
});

test('AC-3b: two unresolved REVISE passes — gate1 status is "pending" not "failed"', async () => {
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1, 'gate1 must be present');
  assert.equal(result.gate1.status, 'pending',
    `gate1.status must be "pending" (not "failed") after M=2 unresolved, ` +
    `got: "${result.gate1.status}"`);
});

test('AC-3c: two unresolved REVISE passes — run is NOT marked as failed', async () => {
  // Key divergence from implement-stage: M>=2 REVISE opens gate1 with marker
  // rather than failing the run (human conductor can fix PLAN.md inline)
  const verdictSequence = ['REVISE', 'REVISE', 'REVISE'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(!result.failed,
    `Run must NOT be marked failed after M=2 unresolved REVISE (unlike implement-stage). ` +
    `got result.failed: ${result.failed}`);
});

test('AC-3d: BLOCK verdict — loop exits without writing gate1', async () => {
  // AC-5 contract: BLOCK behavior unchanged — exits the loop, no gate1
  const verdictSequence = ['BLOCK'];

  const result = runPlanReviseLoop(verdictSequence);

  // gate1 must NOT be written on BLOCK
  assert.ok(!result.gate1,
    `gate1 must NOT be written when reviewer emits BLOCK, got: ${JSON.stringify(result.gate1)}`);

  // Run must be marked failed (or at least blocked) on BLOCK
  assert.ok(result.failed || result.blocked,
    `Result must indicate failed/blocked state on BLOCK verdict, ` +
    `got result.failed=${result.failed}, result.blocked=${result.blocked}`);
});

test('AC-3e: APPROVED immediately — gate1 opens clean, no revision invocations', async () => {
  // Sanity check: no REVISE at all means gate1 opens immediately, M stays 0
  const verdictSequence = ['APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1, 'gate1 must be present');
  assert.equal(result.gate1.status, 'pending',
    `gate1.status must be "pending", got: "${result.gate1.status}"`);
  assert.ok(!result.gate1.revisingUnresolved,
    'gate1.revisingUnresolved must be absent/false on clean APPROVED');

  // Only one invocation (initial pass)
  assert.equal(result.plannerInvocations.length, 1,
    `Expected exactly 1 planner invocation for immediate APPROVED, ` +
    `got ${result.plannerInvocations.length}`);
});

// ─── AC-6: smoke test — r-5caed835 scenario ──────────────────────────────────
// Scenario: 3 spec-precision REVISE concerns from reviewers, all inline-fixable.
// Planner M=1 revision pass resolves all 3 concerns; reviewer APPROVES on pass 2.
// Gate1 must open clean (no revisingUnresolved).

test('AC-6a: r-5caed835 scenario — 3 REVISE concerns resolved at M=1, gate1 present', async () => {
  // The planner's single revision pass (M=1) addresses all 3 inline concerns.
  // Reviewer emits APPROVED on the second pass.
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1,
    'gate1 must be present after M=1 resolves all 3 concerns');
});

test('AC-6b: r-5caed835 scenario — gate1 status is "pending"', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1, 'gate1 must be present');
  assert.equal(result.gate1.status, 'pending',
    `gate1.status must be "pending", got: "${result.gate1.status}"`);
});

test('AC-6c: r-5caed835 scenario — gate1 has no revisingUnresolved marker', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.ok(result.gate1, 'gate1 must be present');
  assert.ok(
    !result.gate1.revisingUnresolved,
    `gate1.revisingUnresolved must be absent or falsy when APPROVED at M=1, ` +
    `got: ${result.gate1.revisingUnresolved}`
  );
});

test('AC-6d: r-5caed835 scenario — exactly 2 planner invocations (initial + M=1 retry)', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.equal(result.plannerInvocations.length, 2,
    `Expected exactly 2 planner invocations (initial + one retry), ` +
    `got ${result.plannerInvocations.length}`);
  assert.equal(result.plannerInvocations[1].revisionMode, 1,
    `Second invocation must use revision-mode 1, got: ${result.plannerInvocations[1].revisionMode}`);
});

test('AC-6e: r-5caed835 scenario — run not marked failed', async () => {
  const verdictSequence = ['REVISE', 'APPROVED'];

  const result = runPlanReviseLoop(verdictSequence);

  assert.equal(result.failed, false,
    `Run must not be marked failed after M=1 APPROVED, got result.failed: ${result.failed}`);
});
