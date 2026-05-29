// @covers scripts/phase-verify.mjs
// Tests for scripts/phase-verify.mjs — phase-level diagnostic verifier.
//
// AC assertions:
//   (a) parseShortstat() parses git shortstat output with insertions + deletions
//       and computes changedLines as their sum. Handles missing deletions side.
//   (b) diffLintErrors() compares baseline error keys to current keys and returns
//       only NEW errors present in current but not in baseline.
//   (c) runPhaseVerify() aggregates changes, lint errors, and warnings. Missing
//       or unreadable baselinePath does NOT throw — instead returns empty
//       newLintErrors (fail-open). When changedLines > locThreshold, a warning
//       string is present in warnings array; when below threshold, warnings is empty.
//
// Run: node --test scripts/phase-verify.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

// Import the module under test.
import {
  parseShortstat,
  diffLintErrors,
  runPhaseVerify,
} from './phase-verify.mjs';

// ─── (a) parseShortstat: parse git shortstat output ──────────────────────

test('(a) parseShortstat: standard "3 files changed, 10 insertions(+), 4 deletions(-)" format', () => {
  const result = parseShortstat('3 files changed, 10 insertions(+), 4 deletions(-)');
  assert.deepEqual(result, {
    filesChanged: 3,
    insertions: 10,
    deletions: 4,
    changedLines: 14,
  }, 'should parse all three stats and compute changedLines = insertions + deletions');
});

test('(a) parseShortstat: missing deletions side (only insertions)', () => {
  const result = parseShortstat('1 file changed, 5 insertions(+)');
  assert.deepEqual(result, {
    filesChanged: 1,
    insertions: 5,
    deletions: 0,
    changedLines: 5,
  }, 'should default deletions to 0 when missing; changedLines = insertions + 0');
});

test('(a) parseShortstat: missing insertions side (only deletions)', () => {
  const result = parseShortstat('2 files changed, 8 deletions(-)');
  assert.deepEqual(result, {
    filesChanged: 2,
    insertions: 0,
    deletions: 8,
    changedLines: 8,
  }, 'should default insertions to 0 when missing; changedLines = 0 + deletions');
});

// ─── (b) diffLintErrors: compare baseline vs current error keys ──────────

test('(b) diffLintErrors: returns only new keys present in current but not baseline', () => {
  const baseline = ['a', 'b'];
  const current = ['a', 'b', 'c'];
  const result = diffLintErrors(baseline, current);
  assert.deepEqual(result, ['c'], 'should return only NEW errors (c)');
});

test('(b) diffLintErrors: no new errors returns empty array', () => {
  const baseline = ['a', 'b'];
  const current = ['a'];
  const result = diffLintErrors(baseline, current);
  assert.deepEqual(result, [], 'should return empty when no new errors introduced');
});

test('(b) diffLintErrors: all errors are new (empty baseline)', () => {
  const baseline = [];
  const current = ['x', 'y'];
  const result = diffLintErrors(baseline, current);
  assert.deepEqual(result, ['x', 'y'], 'should return all current errors when baseline is empty');
});

// ─── (c) runPhaseVerify: aggregate changes, lint errors, warnings ────────

test('(c) runPhaseVerify: missing baselinePath does not throw; returns empty newLintErrors (fail-open)', async () => {
  const result = await runPhaseVerify({
    root: '/nonexistent/root',
    baselinePath: '/nonexistent/baseline.json',
    locThreshold: 500,
  });

  assert.ok(
    Array.isArray(result.newLintErrors),
    'newLintErrors should exist and be an array'
  );
  assert.deepEqual(
    result.newLintErrors,
    [],
    'missing/unreadable baselinePath should return empty newLintErrors (fail-open, no throw)'
  );
});

test('(c) runPhaseVerify: deterministic threshold test — changedLines > locThreshold produces warning', async () => {
  const tmpDir = path.join(os.tmpdir(), `forge-phase-verify-test-${Date.now()}`);

  try {
    // Create a temporary git repository
    await fs.mkdir(tmpDir, { recursive: true });

    // Initialize git repo with local config (not global)
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test User"', { cwd: tmpDir });

    // Create a baseline file and commit it
    const testFile = path.join(tmpDir, 'test-file.txt');
    await fs.writeFile(testFile, 'initial content\n');
    execSync('git add test-file.txt', { cwd: tmpDir });
    execSync('git commit -m "initial commit"', { cwd: tmpDir });

    // Append 600 lines to the file WITHOUT staging (so git diff will show them)
    const additionalLines = Array(600).fill('new line\n').join('');
    await fs.appendFile(testFile, additionalLines);

    // Run phase verify with a low threshold (500)
    const result = await runPhaseVerify({
      root: tmpDir,
      baselinePath: path.join(tmpDir, 'nonexistent-baseline.json'),
      locThreshold: 500,
    });

    // Assertions: changedLines should be >= 600, and warnings should be non-empty
    assert.ok(
      result.changedLines >= 600,
      `changedLines (${result.changedLines}) should be >= 600 after appending 600 lines`
    );
    assert.ok(
      Array.isArray(result.warnings),
      'warnings must be an array'
    );
    assert.ok(
      result.warnings.length > 0,
      'warnings should be non-empty when changedLines > locThreshold (600 > 500)'
    );
  } finally {
    // Clean up temporary repo
    try {
      execSync(`rm -r "${tmpDir}"`, { shell: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

test('(c) runPhaseVerify: deterministic threshold test — changedLines < locThreshold produces empty warnings', async () => {
  const tmpDir = path.join(os.tmpdir(), `forge-phase-verify-test-below-${Date.now()}`);

  try {
    // Create a temporary git repository
    await fs.mkdir(tmpDir, { recursive: true });

    // Initialize git repo with local config
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir });
    execSync('git config user.name "Test User"', { cwd: tmpDir });

    // Create a baseline file and commit it
    const testFile = path.join(tmpDir, 'test-file.txt');
    await fs.writeFile(testFile, 'initial content\n');
    execSync('git add test-file.txt', { cwd: tmpDir });
    execSync('git commit -m "initial commit"', { cwd: tmpDir });

    // Append a small number of lines (e.g., 10) WITHOUT staging
    const additionalLines = Array(10).fill('small change\n').join('');
    await fs.appendFile(testFile, additionalLines);

    // Run phase verify with a very high threshold (999999)
    const result = await runPhaseVerify({
      root: tmpDir,
      baselinePath: path.join(tmpDir, 'nonexistent-baseline.json'),
      locThreshold: 999999,
    });

    // Assertions: changedLines should be 10, and warnings should be empty
    assert.deepEqual(
      result.changedLines,
      10,
      'changedLines should be 10 after appending 10 lines'
    );
    assert.ok(
      Array.isArray(result.warnings),
      'warnings must be an array'
    );
    assert.deepEqual(
      result.warnings,
      [],
      'warnings should be empty when changedLines (10) < locThreshold (999999)'
    );
  } finally {
    // Clean up temporary repo
    try {
      execSync(`rm -r "${tmpDir}"`, { shell: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

test('(c) runPhaseVerify: returns { changedLines, newLintErrors, warnings } structure', async () => {
  const result = await runPhaseVerify({
    root: '/nonexistent/root',
    baselinePath: '/nonexistent/baseline.json',
    locThreshold: 500,
  });

  assert.ok(
    typeof result.changedLines === 'number',
    'changedLines must be a number'
  );
  assert.ok(
    Array.isArray(result.newLintErrors),
    'newLintErrors must be an array'
  );
  assert.ok(
    Array.isArray(result.warnings),
    'warnings must be an array'
  );
});
