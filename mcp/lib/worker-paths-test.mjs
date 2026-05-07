import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { join } from 'node:path';
import { workerLogPath, killPillPath, resetPillPath } from './worker-paths.js';

test('workerLogPath returns expected path for valid input', () => {
  const result = workerLogPath('/project', 'r-abc123');
  assert.equal(result, join('/project', '.pipeline', 'worker-logs', 'r-abc123.log'));
});

test('killPillPath returns expected path for valid input', () => {
  const result = killPillPath('/project', 'r-abc123');
  assert.equal(result, join('/project', '.pipeline', 'worker-kill', 'r-abc123'));
});

test('resetPillPath uses worktreePath as base (not projectRoot)', () => {
  const worktreePath = '/project/.worktrees/r-abc123';
  const result = resetPillPath(worktreePath, 'r-abc123');
  assert.equal(result, join(worktreePath, '.pipeline', 'worker-reset', 'r-abc123'));
});

test('resetPillPath and workerLogPath differ when worktreePath !== projectRoot', () => {
  const projectRoot = '/project';
  const worktreePath = '/project/.worktrees/r-abc123';
  const runId = 'r-abc123';
  // reset-pill is in worktree
  assert.ok(resetPillPath(worktreePath, runId).startsWith(worktreePath));
  // log and kill-pill are in main project root
  assert.ok(workerLogPath(projectRoot, runId).startsWith(projectRoot));
  assert.ok(killPillPath(projectRoot, runId).startsWith(projectRoot));
});

test('non-worktree runs: all paths under same root', () => {
  const projectRoot = '/project';
  const runId = 'r-abc123';
  // When workDir === projectRoot (non-worktree), resetPillPath should also be under projectRoot
  const reset = resetPillPath(projectRoot, runId);
  const log = workerLogPath(projectRoot, runId);
  const kill = killPillPath(projectRoot, runId);
  assert.ok(reset.startsWith(projectRoot));
  assert.ok(log.startsWith(projectRoot));
  assert.ok(kill.startsWith(projectRoot));
});

test('rejects invalid runId in workerLogPath', () => {
  assert.throws(() => workerLogPath('/project', 'invalid-id'), /Invalid runId/);
});

test('rejects invalid runId in killPillPath', () => {
  assert.throws(() => killPillPath('/project', 'not-valid'), /Invalid runId/);
});

test('rejects invalid runId in resetPillPath', () => {
  assert.throws(() => resetPillPath('/project', '../escape'), /Invalid runId/);
});

test('accepts alphanumeric suffixes of various lengths', () => {
  assert.doesNotThrow(() => workerLogPath('/p', 'r-a1b2c3d4'));
  assert.doesNotThrow(() => killPillPath('/p', 'r-ABCDEF'));
  assert.doesNotThrow(() => resetPillPath('/p', 'r-1'));
});
