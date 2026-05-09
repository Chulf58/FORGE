// Tests for reviewer-tests dispatch routing in scripts/reviewer-dispatch.mjs
// Run: node --test scripts/reviewer-tests-dispatch.test.mjs
//
// Wave 1 (red bar): these tests fail because `reviewer-tests` is not yet in the
// dispatch map in reviewer-dispatch.mjs. Wave 2 (task 3) adds the mapping.
//
// AC-7 tightening: keywords (skip, mock, eslint-disable, etc.) ONLY trigger
// reviewer-tests when they appear on `+` lines inside a hunk whose enclosing
// file is a test-file path. Keywords in non-test files do NOT trigger.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Helpers -----------------------------------------------------------------

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
  const diffFile = join(tmpdir(), `test-diff-${process.pid}-${Date.now()}.txt`);
  const statusFile = join(tmpdir(), `test-status-${process.pid}-${Date.now()}.json`);

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

// --- Fixtures ----------------------------------------------------------------

// (a) Diff touching a test file — should dispatch reviewer-tests
const DIFF_TEST_FILE_ASSERTION = `diff --git a/foo.test.js b/foo.test.js
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

// (b) Test file with it.skip keyword — should dispatch reviewer-tests
const DIFF_TEST_FILE_SKIP = `diff --git a/foo.test.js b/foo.test.js
index 1234567..abcdefg 100644
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,5 +1,6 @@
 describe('foo', () => {
+  it.skip('skipped test', () => {
+    expect(x).toBe(1);
+  });
 });
`;

// (c) Non-test file with eslint-disable — must NOT dispatch reviewer-tests
// (AC-7 tightening: keyword must be in a test-file hunk)
const DIFF_NON_TEST_ESLINT_DISABLE = `diff --git a/hooks/foo.js b/hooks/foo.js
index 1234567..abcdefg 100644
--- a/hooks/foo.js
+++ b/hooks/foo.js
@@ -1,3 +1,4 @@
 'use strict';
+/* eslint-disable no-console */
 module.exports = function() {};
`;

// (d) Clean diff — no test files, no keywords — must NOT dispatch reviewer-tests
const DIFF_CLEAN_NON_TEST = `diff --git a/src/util.js b/src/util.js
index 1234567..abcdefg 100644
--- a/src/util.js
+++ b/src/util.js
@@ -1,3 +1,4 @@
 function util() {}
+const x = 1;
 module.exports = { util };
`;

// (e) Test file AND a file that triggers another reviewer rule (shell-spawn).
// reviewer-tests must appear alongside the other triggered reviewers.
const DIFF_TEST_FILE_PLUS_SHELL_SPAWN = `diff --git a/scripts/runner.mjs b/scripts/runner.mjs
index 1234567..abcdefg 100644
--- a/scripts/runner.mjs
+++ b/scripts/runner.mjs
@@ -1,3 +1,4 @@
 import { execSync } from 'node:child_process';
+execSync('git status');
 export default function run() {}
diff --git a/foo.test.js b/foo.test.js
index 1234567..abcdefg 100644
--- a/foo.test.js
+++ b/foo.test.js
@@ -1,5 +1,6 @@
 describe('foo', () => {
   it('runs test', () => {
+    expect(runner()).toBe(0);
   });
 });
`;

// --- Tests -------------------------------------------------------------------

test('dispatch: test-file diff dispatches reviewer-tests (a)', () => {
  const result = runDispatch(DIFF_TEST_FILE_ASSERTION);
  assert.ok(
    result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests in ${JSON.stringify(result.reviewers)}`,
  );
});

test('dispatch: test-file with it.skip dispatches reviewer-tests (b)', () => {
  const result = runDispatch(DIFF_TEST_FILE_SKIP);
  assert.ok(
    result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests in ${JSON.stringify(result.reviewers)}`,
  );
});

test('dispatch: eslint-disable in non-test file does NOT dispatch reviewer-tests (c)', () => {
  const result = runDispatch(DIFF_NON_TEST_ESLINT_DISABLE);
  assert.ok(
    !result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests NOT in ${JSON.stringify(result.reviewers)}`,
  );
});

test('dispatch: clean non-test diff does NOT dispatch reviewer-tests (d)', () => {
  const result = runDispatch(DIFF_CLEAN_NON_TEST);
  assert.ok(
    !result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests NOT in ${JSON.stringify(result.reviewers)}`,
  );
});

test('dispatch: test-file diff with shell-spawn includes reviewer-tests alongside other reviewers (e)', () => {
  const result = runDispatch(DIFF_TEST_FILE_PLUS_SHELL_SPAWN);
  assert.ok(
    result.reviewers.includes('reviewer-tests'),
    `Expected reviewer-tests in ${JSON.stringify(result.reviewers)}`,
  );
  // At least one other reviewer must be present (reviewer-safety from shell-spawn)
  const otherReviewers = result.reviewers.filter((r) => r !== 'reviewer-tests');
  assert.ok(
    otherReviewers.length > 0,
    `Expected at least one other reviewer alongside reviewer-tests; got ${JSON.stringify(result.reviewers)}`,
  );
});
