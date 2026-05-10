#!/usr/bin/env node
// Tests for scripts/post-apply-lifecycle.mjs Job 6 (removePlanSection).
// Closes bba4a9d9 — stacked PLAN.md across runs.
//
// Covers:
//   T1 (AC-1) — single-feature plan: matching ### Feature: section removed
//   T2 (AC-2) — multi-feature plan: only the just-shipped feature is removed,
//               other ### Feature: sections preserved
//   T3 (AC-3 real case) — long slugified feature name matches shorter heading
//                         ("add-wiring-verify-tdd-chain-wave-5-post-handoff-de"
//                          → "wiring-verify (TDD chain Wave 5)")
//   T4 (AC-3 reverse) — heading title is a substring of feature name
//   T5 (AC-4 zero matches) — feature name with no overlap → skip, no edit
//   T6 (AC-4 multiple matches) — ambiguous match → skip, no edit
//   T7 — empty/short feature name skipped (existing behavior preserved)
//   T8 — PLAN.md absent skipped (existing behavior preserved)
//
// Run: node --test scripts/post-apply-lifecycle-prune-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'post-apply-lifecycle.mjs');

function makeProject(planContent) {
  const tmp = mkdtempSync(join(tmpdir(), 'lifecycle-prune-test-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  if (planContent !== undefined) {
    writeFileSync(join(tmp, 'docs', 'PLAN.md'), planContent, 'utf8');
  }
  return tmp;
}

function runScript(projectDir, featureName) {
  // Run the lifecycle script with cwd=projectDir so projectDir resolution works.
  const out = execFileSync(process.execPath, [SCRIPT_PATH, featureName], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return out;
}

function readPlan(projectDir) {
  return readFileSync(join(projectDir, 'docs', 'PLAN.md'), 'utf8');
}

test('T1 (AC-1) — single-feature plan: matching ### Feature: section removed', () => {
  const plan = [
    '## Active Plan',
    '',
    '### Feature: foo-feature',
    '',
    'Summary: do foo.',
    '',
    '- [x] Task 1',
    '',
    '---',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'foo-feature');
    const after = readPlan(dir);
    assert.ok(!after.includes('### Feature: foo-feature'),
      'feature heading should be removed; got:\n' + after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T2 (AC-2) — multi-feature plan: only just-shipped feature removed', () => {
  const plan = [
    '## Active Plan',
    '',
    '### Feature: alpha-feature',
    '',
    'Summary: alpha.',
    '',
    '- [x] alpha task',
    '',
    '---',
    '',
    '### Feature: beta-feature',
    '',
    'Summary: beta.',
    '',
    '- [x] beta task',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'alpha-feature');
    const after = readPlan(dir);
    assert.ok(!after.includes('### Feature: alpha-feature'), 'alpha removed');
    assert.ok(after.includes('### Feature: beta-feature'), 'beta preserved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T3 (AC-3 real case) — long slugified feature matches shorter heading', () => {
  // Mirrors r-f33f77f3: feature="add-wiring-verify-tdd-chain-wave-5-post-handoff-de"
  // heading="### Feature: wiring-verify (TDD chain Wave 5)" — substring match in
  // either direction fails, but token-overlap (wiring/verify/tdd/chain/wave/5)
  // matches strongly.
  const plan = [
    '## Active Plan',
    '',
    '### Feature: wiring-verify (TDD chain Wave 5)',
    '',
    'Summary: post-handoff verifier.',
    '',
    '- [x] Task 1',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'add-wiring-verify-tdd-chain-wave-5-post-handoff-de');
    const after = readPlan(dir);
    assert.ok(!after.includes('### Feature:'),
      'long-feature → short-heading should match and remove; got:\n' + after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T4 (AC-3 reverse) — heading title is substring of feature name', () => {
  const plan = [
    '## Active Plan',
    '',
    '### Feature: stage auto-complete',
    '',
    'Summary: auto-complete prior stage.',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'forge-advance-stage-auto-complete-when-gate-approved');
    const after = readPlan(dir);
    assert.ok(!after.includes('### Feature: stage auto-complete'),
      'heading-as-substring case should match; got:\n' + after);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T5 (AC-4 zero matches) — no overlap → skip, no edit', () => {
  const plan = [
    '## Active Plan',
    '',
    '### Feature: completely unrelated',
    '',
    '- [x] Task',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'totally-different-thing');
    const after = readPlan(dir);
    assert.equal(after, plan, 'no-match case must leave PLAN.md untouched');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T6 (AC-4 multiple matches) — ambiguous → skip, no edit', () => {
  // Two headings share the same significant tokens with the feature name.
  const plan = [
    '## Active Plan',
    '',
    '### Feature: foo-bar baz',
    '',
    'Summary: first.',
    '',
    '---',
    '',
    '### Feature: foo bar quux',
    '',
    'Summary: second.',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, 'foo-bar');
    const after = readPlan(dir);
    assert.equal(after, plan,
      'ambiguous-match case must leave PLAN.md untouched (fail-open per AC-4)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T7 — empty/short feature name skipped', () => {
  const plan = [
    '## Active Plan',
    '',
    '### Feature: x',
    '',
  ].join('\n');
  const dir = makeProject(plan);
  try {
    runScript(dir, '');
    const after = readPlan(dir);
    assert.equal(after, plan, 'empty feature name must be a no-op');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T8 — PLAN.md absent → no error, no edit', () => {
  const dir = makeProject(undefined); // no PLAN.md written
  try {
    // Must not throw — fail-open per existing script contract
    runScript(dir, 'anything');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
