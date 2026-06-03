// @covers mcp/lib/orchestrator/review-diff.mjs
//
// G2: the orchestrator fed reviewer-dispatch only --stage/--run-id, so it took the
// handoff-PROSE classification path where addReviewerTestsIfNeeded never runs (empty
// diff) — reviewer-tests never fired on test-touching changes, and the test-author's
// NEW (untracked) test files aren't in the coder's handoff anyway. synthesizeReviewDiff
// builds a unified diff (tracked `git diff HEAD` + untracked files as new-file hunks)
// that the dispatcher's diff parser can read so reviewer-tests fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { synthesizeReviewDiff } from './review-diff.mjs';

test('untracked file becomes a new-file hunk with a +++ b/<path> header parseable by addReviewerTestsIfNeeded', () => {
  const diff = synthesizeReviewDiff({
    trackedDiff: '',
    untracked: [{ path: 'mcp/foo.test.mjs', content: "it('x', () => {});\n" }],
  });
  assert.match(diff, /^\+\+\+ b\/mcp\/foo\.test\.mjs$/m, 'must emit a +++ b/<path> header the diff parser keys on');
  assert.match(diff, /^--- \/dev\/null$/m, 'new-file hunk must show /dev/null as the old side');
  assert.match(diff, /^\+it\('x', \(\) => \{\}\);$/m, 'content lines must be prefixed with + (so Rule-b keyword scan works)');
});

test('tracked diff is preserved verbatim ahead of synthesized untracked hunks', () => {
  const tracked = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n";
  const diff = synthesizeReviewDiff({ trackedDiff: tracked, untracked: [{ path: 'b.test.js', content: 'x' }] });
  assert.ok(diff.includes('+++ b/src/a.js'), 'tracked modified file header preserved');
  assert.ok(diff.includes('+++ b/b.test.js'), 'untracked file header appended');
  assert.ok(diff.indexOf('+++ b/src/a.js') < diff.indexOf('+++ b/b.test.js'), 'tracked diff comes first');
});

test('backslash paths are normalized to forward slashes (Windows worktree)', () => {
  const diff = synthesizeReviewDiff({ untracked: [{ path: 'mcp\\lib\\x.test.mjs', content: 'a' }] });
  assert.match(diff, /\+\+\+ b\/mcp\/lib\/x\.test\.mjs/, 'Windows backslashes must be normalized for the diff parser');
});

test('no changes → empty string (orchestrator treats null/empty as "no diff", falls back to handoff)', () => {
  assert.equal(synthesizeReviewDiff({ trackedDiff: '', untracked: [] }), '');
  assert.equal(synthesizeReviewDiff({}), '');
});

test('entries without a path are skipped (defensive)', () => {
  const diff = synthesizeReviewDiff({ untracked: [{ path: '', content: 'x' }, { path: 'ok.test.js', content: 'y' }] });
  assert.doesNotMatch(diff, /\+\+\+ b\/$/m, 'empty path must not emit a header');
  assert.match(diff, /\+\+\+ b\/ok\.test\.js/, 'valid entries still emitted');
});
