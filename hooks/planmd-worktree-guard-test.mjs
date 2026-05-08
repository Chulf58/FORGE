'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Inline the PLAN.md worktree boundary guard logic for unit testing.
// Mirrors the implementation in hooks/workflow-guard.js (task 5).
// ---------------------------------------------------------------------------

const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

/**
 * Returns a deny reason string if the write to `rawTarget` from `cwd`
 * violates the PLAN.md worktree boundary, or null if the write is allowed.
 *
 * @param {string} rawTarget - the file_path from the tool input
 * @param {string} cwd       - simulated process.cwd()
 * @returns {string|null}
 */
function checkPlanMdGuard(rawTarget, cwd) {
  if (!rawTarget) return null;
  const normalizedTarget = path.resolve(cwd, rawTarget).replace(/\\/g, '/').toLowerCase();
  if (!normalizedTarget.endsWith('docs/plan.md')) return null;

  const cwdNormalized = cwd.replace(/\\/g, '/');
  const worktreeMatch = cwdNormalized.match(/\.worktrees\/(r-[a-zA-Z0-9]+)(?:\/|$)/);
  if (!worktreeMatch) return null; // not in a worktree — pass through

  const normalizedCwd = cwdNormalized.toLowerCase();
  if (
    !normalizedTarget.startsWith(normalizedCwd + '/') &&
    normalizedTarget !== normalizedCwd
  ) {
    return 'FORGE: docs/PLAN.md must be written inside the worktree, not the main project root. ' +
      'Offending path: ' + path.resolve(cwd, rawTarget);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('guard passes — absolute path inside worktree', () => {
  const cwd = '/project/.worktrees/r-abc123';
  const target = '/project/.worktrees/r-abc123/docs/PLAN.md';
  assert.equal(checkPlanMdGuard(target, cwd), null);
});

test('guard blocks — absolute path to main root docs/PLAN.md from worktree cwd', () => {
  const cwd = '/project/.worktrees/r-abc123';
  const target = '/project/docs/PLAN.md';
  const result = checkPlanMdGuard(target, cwd);
  assert.ok(result !== null, 'expected a deny reason');
  assert.ok(result.includes('FORGE:'));
  assert.ok(result.includes('/project/docs/PLAN.md') || result.includes('\\project\\docs\\PLAN.md'));
});

test('guard passes — write from main root cwd (not a worktree)', () => {
  const cwd = '/project';
  const target = '/project/docs/PLAN.md';
  assert.equal(checkPlanMdGuard(target, cwd), null);
});

test('guard passes — non-plan file from worktree cwd', () => {
  const cwd = '/project/.worktrees/r-abc123';
  const target = '/project/.worktrees/r-abc123/docs/CHANGELOG.md';
  assert.equal(checkPlanMdGuard(target, cwd), null);
});

test('guard passes — null target', () => {
  const cwd = '/project/.worktrees/r-abc123';
  assert.equal(checkPlanMdGuard(null, cwd), null);
});

test('guard blocks — relative path resolving outside worktree', () => {
  const cwd = '/project/.worktrees/r-abc123';
  const target = '../../docs/PLAN.md'; // resolves to /project/docs/PLAN.md
  const result = checkPlanMdGuard(target, cwd);
  assert.ok(result !== null, 'expected a deny reason for path traversal outside worktree');
});

test('guard passes — cwd with non-runId worktrees segment is treated as main root', () => {
  // A path containing ".worktrees" but without a valid runId should not trigger
  // the guard because worktreeMatch will fail the RUN_ID_RE pattern
  const cwd = '/project/.worktrees/invalid-id';
  const target = '/project/docs/PLAN.md';
  // "invalid-id" does NOT match /r-[a-zA-Z0-9]+/ so guard treats cwd as non-worktree
  assert.equal(checkPlanMdGuard(target, cwd), null);
});
