// @covers mcp/lib/orchestrator/worktree-guard.mjs
//
// a8de840b #2 — structural backstop: after the writer dispatches, the orchestrator
// compares main's untracked files (under hooks/mcp/scripts) against a baseline captured
// at run start. Any NEW entry is a worktree-isolation escape (a dispatched agent wrote
// into MAIN). detectMainStrays is the pure diff; baselining handles main's pre-existing
// untracked files (e.g. scripts/observer-preflight-test.mjs) so only fresh leaks flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMainStrays } from './worktree-guard.mjs';

test('flags a NEW stray not present in the baseline', () => {
  const baseline = ['scripts/observer-preflight-test.mjs'];
  const current = ['scripts/observer-preflight-test.mjs', 'hooks/cache-drift-guard-test.mjs'];
  assert.deepEqual(detectMainStrays(baseline, current), ['hooks/cache-drift-guard-test.mjs']);
});

test('pre-existing untracked files (in the baseline) are NOT flagged', () => {
  const baseline = ['scripts/observer-preflight-test.mjs', 'evals/x.json'];
  assert.deepEqual(detectMainStrays(baseline, ['scripts/observer-preflight-test.mjs', 'evals/x.json']), []);
});

test('empty baseline → every current entry is a stray', () => {
  assert.deepEqual(detectMainStrays([], ['hooks/a.mjs', 'mcp/b.mjs']), ['hooks/a.mjs', 'mcp/b.mjs']);
});

test('a removed file is not a stray (only additions count)', () => {
  assert.deepEqual(detectMainStrays(['hooks/a.mjs'], []), []);
});

test('null / undefined inputs are handled (no throw, empty result)', () => {
  assert.deepEqual(detectMainStrays(undefined, undefined), []);
  assert.deepEqual(detectMainStrays(null, ['x']), ['x']);
  assert.deepEqual(detectMainStrays(['x'], null), []);
});
