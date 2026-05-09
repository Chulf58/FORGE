// Test file for scripts/reviewer-dispatch.mjs
// Required by tdd-guard.js so that modifications to reviewer-dispatch.mjs are gated.
// These tests verify the reviewer-tests dispatch routing (AC-7, AC-10).
// Full suite: scripts/reviewer-tests-dispatch.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
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
