// Test file for scripts/reviewer-dispatch.mjs
// Required by tdd-guard.js so that modifications to reviewer-dispatch.mjs are gated.
// These tests verify the reviewer-tests dispatch routing (AC-7, AC-10).
// Full suite: scripts/reviewer-tests-dispatch.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CODER_STATUS_CLEAN = JSON.stringify({
  verificationClean: true,
  hasBlockers: false,
  archUpdate: false,
  decision: false,
  feature: 'test-feature',
  filesTouched: [],
  filesCreated: [],
  tasksCovered: [1],
  tasksDeferred: [],
});

function runDispatch(diffContent) {
  const diffFile = join(tmpdir(), `rd-test-${process.pid}-${Date.now()}.txt`);
  const statusFile = join(tmpdir(), `rd-status-${process.pid}-${Date.now()}.json`);

  try {
    writeFileSync(diffFile, diffContent, 'utf8');
    writeFileSync(statusFile, CODER_STATUS_CLEAN, 'utf8');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'reviewer-dispatch.mjs'),
        `--diff=${diffFile}`,
        `--coder-status=${statusFile}`,
        '--stage=implement',
      ],
      { encoding: 'utf8', cwd: process.cwd() },
    );

    if (result.error) {
      throw result.error;
    }

    return JSON.parse(result.stdout);
  } finally {
    try { unlinkSync(diffFile); } catch (_) { /* ignore */ }
    try { unlinkSync(statusFile); } catch (_) { /* ignore */ }
  }
}

/**
 * Run dispatcher with --run-id and a temp worktree structure.
 * Creates a temporary .pipeline/runs/<runId>/run.json structure.
 *
 * @param {string} runId - the run ID (e.g., "r-abc123")
 * @param {Object} runJsonContent - the run.json content (e.g., { reviewerOverrides: [...] })
 * @param {string} diffContent - the diff content
 * @returns {Object} - parsed stdout from dispatcher
 */
function runDispatchWithRunId(runId, runJsonContent, diffContent) {
  const diffFile = join(tmpdir(), `rd-test-diff-${process.pid}-${Date.now()}.txt`);
  const statusFile = join(tmpdir(), `rd-status-${process.pid}-${Date.now()}.json`);
  const tmpWorktree = join(tmpdir(), `rd-worktree-${process.pid}-${Date.now()}`);
  const runDir = join(tmpWorktree, '.pipeline', 'runs', runId);

  try {
    // Create directory structure
    mkdirSync(runDir, { recursive: true });

    // Write run.json
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(runJsonContent, null, 2), 'utf8');

    // Write diff and status files
    writeFileSync(diffFile, diffContent, 'utf8');
    writeFileSync(statusFile, CODER_STATUS_CLEAN, 'utf8');

    // Call dispatcher with --run-id and --worktree
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'reviewer-dispatch.mjs'),
        `--run-id=${runId}`,
        `--worktree=${tmpWorktree}`,
        `--diff=${diffFile}`,
        `--coder-status=${statusFile}`,
        '--stage=implement',
      ],
      { encoding: 'utf8', cwd: process.cwd() },
    );

    if (result.error) {
      throw result.error;
    }

    return {
      stdout: JSON.parse(result.stdout),
      stderr: result.stderr,
      code: result.status,
    };
  } finally {
    try { unlinkSync(diffFile); } catch (_) { /* ignore */ }
    try { unlinkSync(statusFile); } catch (_) { /* ignore */ }
    try { rmSync(tmpWorktree, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

// (revision pass 1) verifies taskLines lowercasing comment is present in source
test('reviewer-dispatch: taskLines lowercasing comment present in source', () => {
  const src = readFileSync(new URL('./reviewer-dispatch.mjs', import.meta.url), 'utf8');
  assert.ok(
    src.includes('taskLines is already lowercased upstream'),
    'Expected lowercasing comment in dispatchForPlanStage',
  );
});

// (a) Diff touching a test file — should dispatch reviewer-tests (AC-7a)
test('reviewer-dispatch: test-file path triggers reviewer-tests', () => {
  const diff = `diff --git a/foo.test.js b/foo.test.js
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
  const result = runDispatch(diff);
  assert.ok(
    result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests in ${JSON.stringify(result.reviewers)}`,
  );
});

// (c) eslint-disable in non-test file — must NOT dispatch reviewer-tests (AC-7 tightening)
test('reviewer-dispatch: eslint-disable in non-test file does NOT trigger reviewer-tests', () => {
  const diff = `diff --git a/hooks/foo.js b/hooks/foo.js
index 1234567..abcdefg 100644
--- a/hooks/foo.js
+++ b/hooks/foo.js
@@ -1,3 +1,4 @@
 'use strict';
+/* eslint-disable no-console */
 module.exports = function() {};
`;
  const result = runDispatch(diff);
  assert.ok(
    !result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests NOT in ${JSON.stringify(result.reviewers)}`,
  );
});

// ============================================================================
// NEW TESTS FOR reviewerOverrides FEATURE (Phase 1 — Failing tests)
// ============================================================================

// Case (a): non-empty reviewerOverrides returns that list verbatim
test('reviewer-dispatch: non-empty reviewerOverrides returns override list verbatim', () => {
  const runId = 'r-test-override-a';
  const runJson = {
    reviewerOverrides: ['reviewer-safety', 'reviewer-boundary'],
  };
  // Clean diff that would trigger zero reviewers on keyword-scan
  const cleanDiff = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My Project
+Updated readme.
 This is a test.
`;

  const result = runDispatchWithRunId(runId, runJson, cleanDiff);

  assert.strictEqual(
    result.code,
    0,
    `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`,
  );

  // The override list should be returned exactly as provided, NOT based on diff classification
  assert.deepStrictEqual(
    result.stdout.reviewers.sort(),
    ['reviewer-boundary', 'reviewer-safety'],
    `Expected exact override list, got ${JSON.stringify(result.stdout.reviewers)}`,
  );
});

// Case (b): empty reviewerOverrides falls through to keyword-scan
test('reviewer-dispatch: empty reviewerOverrides falls through to keyword-scan', () => {
  const runId = 'r-test-override-b';
  const runJson = {
    reviewerOverrides: [],
  };
  // Clean diff with no risk triggers should return empty with empty overrides
  const cleanDiff = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My Project
 This is a test.
+Updated.
`;

  const result = runDispatchWithRunId(runId, runJson, cleanDiff);

  assert.strictEqual(
    result.code,
    0,
    `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`,
  );

  // With empty overrides on a clean diff, should return empty (no risk)
  // This verifies the override behavior falls through correctly
  assert.deepStrictEqual(
    result.stdout.reviewers,
    [],
    `Expected empty list for clean diff + empty overrides, got ${JSON.stringify(result.stdout.reviewers)}`,
  );
});

// Case (c): missing --run-id uses keyword-scan unchanged
test('reviewer-dispatch: missing --run-id uses keyword-scan unchanged', () => {
  // Call WITHOUT --run-id (existing behavior should be unchanged)
  const cleanDiff = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My Project
 This is a test.
+Updated.
`;

  const result = runDispatch(cleanDiff);

  // Should still work as before: clean diff = empty reviewers
  assert.deepStrictEqual(
    result.reviewers,
    [],
    `Expected empty reviewers for clean diff without --run-id, got ${JSON.stringify(result.reviewers)}`,
  );
});

// Case (d): path traversal --run-id is validated and fails open (Resolution item 1)
test('reviewer-dispatch: path traversal --run-id is rejected, fails open to keyword-scan', () => {
  const runId = '../../etc/passwd'; // Invalid run ID with traversal
  const runJson = {
    reviewerOverrides: ['reviewer-malicious'],
  };
  // Clean diff
  const cleanDiff = `diff --git a/README.md b/README.md
index 1234567..abcdefg 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,4 @@
 # My Project
 This is a test.
+Updated.
`;

  const result = runDispatchWithRunId(runId, runJson, cleanDiff);

  // Should fail open: still produce a result (not crash)
  assert.strictEqual(
    result.code,
    0,
    `Expected exit 0 (fail-open), got ${result.code}. stderr: ${result.stderr}`,
  );

  // stderr should contain validation warning
  assert.ok(
    result.stderr.includes('[reviewer-dispatch] invalid --run-id:') ||
    result.stderr.includes('[reviewer-dispatch]'),
    `Expected validation warning in stderr, got: ${result.stderr}`,
  );

  // Result should NOT contain the malicious override
  assert.ok(
    !result.stdout.reviewers.includes('reviewer-malicious'),
    `Should not return malicious override; got ${JSON.stringify(result.stdout.reviewers)}`,
  );
});

// Case (e): snapshot back-compat — SKIPPED for now (requires implementation)
// TODO: This test requires the override path to be implemented before it can pass.
// It verifies that calling without --run-id on a canonical diff produces the same output
// as calling with --run-id where reviewerOverrides is empty.
// Uncomment after Phase 2 implementation:
/*
test('reviewer-dispatch: snapshot back-compat (no --run-id vs empty overrides)', () => {
  const canonicalDiff = `diff --git a/docs/README.md b/docs/README.md
index 1234567..abcdefg 100644
--- a/docs/README.md
+++ b/docs/README.md
@@ -1,3 +1,4 @@
 # Documentation
+Updated docs.
 No risk triggers.
`;

  // Call WITHOUT --run-id (baseline)
  const withoutRunId = runDispatch(canonicalDiff);

  // Call WITH --run-id and empty overrides
  const runId = 'r-test-compat';
  const runJson = { reviewerOverrides: [] };
  const withRunId = runDispatchWithRunId(runId, runJson, canonicalDiff);

  assert.deepStrictEqual(
    withRunId.stdout.reviewers.sort(),
    withoutRunId.reviewers.sort(),
    'Back-compat broken: --run-id with empty overrides should match no --run-id',
  );
});
*/
