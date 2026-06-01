// @covers mcp/lib/orchestrator/commit-worktree.mjs
// Task 94302649: Failing tests for commitWorktree helper
// This helper does NOT exist yet; these tests define the contract it must satisfy.
//
// The helper stages changed files INDIVIDUALLY (never --all), commits with a
// message, and returns { committed: boolean, sha?: string, reason?: string }.
// On empty diff, returns { committed: false, reason: <non-empty> } without throwing.
// Forbidden operations (--force, --amend, reset, stash, etc.) must never appear.
//
// Run: node --test mcp/lib/orchestrator/commit-worktree.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Use namespace import so a missing export fails cleanly.
import * as mod from './commit-worktree.mjs';

test('commitWorktree stages changed files INDIVIDUALLY, never --all / -A / .', async () => {
  const execCalls = [];
  const mockExec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    // First call: git diff --name-only HEAD → returns two files
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: 'file-a.js\nfile-b.js', exitCode: 0 };
    }
    // add/commit calls succeed
    if (cmd === 'git') {
      return { stdout: '', exitCode: 0 };
    }
    return { stdout: '', exitCode: 0 };
  };

  const result = await mod.commitWorktree('/test/worktree', 'Test commit', { exec: mockExec });

  // Assert both files were added INDIVIDUALLY
  const addCalls = execCalls.filter(c => c.cmd === 'git' && c.args[0] === 'add');
  assert.equal(addCalls.length, 2, 'must call git add exactly twice (one per file)');
  assert.ok(
    addCalls.some(c => c.args[1] === 'file-a.js'),
    'must add file-a.js individually',
  );
  assert.ok(
    addCalls.some(c => c.args[1] === 'file-b.js'),
    'must add file-b.js individually',
  );

  // Assert neither --all, -A, nor . appeared in any add call
  for (const call of addCalls) {
    assert.ok(
      !call.args.includes('--all') &&
      !call.args.includes('-A') &&
      !call.args.includes('.'),
      'git add must target files individually, never --all / -A / .',
    );
  }
});

test('commitWorktree commits with the given message', async () => {
  const execCalls = [];
  const mockExec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: 'file.js', exitCode: 0 };
    }
    return { stdout: 'abc123def\n', exitCode: 0 };
  };

  const testMessage = 'Orchestrator commit on gate2 APPROVED';
  await mod.commitWorktree('/test/worktree', testMessage, { exec: mockExec });

  const commitCall = execCalls.find(c => c.cmd === 'git' && c.args[0] === 'commit');
  assert.ok(commitCall, 'must call git commit');
  assert.ok(
    commitCall.args.includes('-m') || commitCall.args.includes('-F'),
    'must use -m or -F flag for commit message',
  );
  // If using -m, the message must be in args
  if (commitCall.args.includes('-m')) {
    const mIdx = commitCall.args.indexOf('-m');
    assert.equal(commitCall.args[mIdx + 1], testMessage, 'message must match the provided string');
  }
});

test('commitWorktree returns { committed: false, reason: <non-empty> } when diff is empty', async () => {
  const mockExec = async (cmd, args) => {
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: '', exitCode: 0 }; // Empty diff
    }
    return { stdout: '', exitCode: 0 };
  };

  const result = await mod.commitWorktree('/test/worktree', 'Never used', { exec: mockExec });

  assert.equal(result.committed, false, 'must return committed: false when diff is empty');
  assert.ok(result.reason, 'must return a non-empty reason when diff is empty (never throws)');
  assert.equal(typeof result.reason, 'string', 'reason must be a string');
});

test('commitWorktree never uses --force, --force-with-lease, --amend, --no-verify', async () => {
  const execCalls = [];
  const mockExec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: 'file.js', exitCode: 0 };
    }
    return { stdout: 'abc123\n', exitCode: 0 };
  };

  await mod.commitWorktree('/test/worktree', 'Test', { exec: mockExec });

  for (const call of execCalls) {
    const argsStr = call.args.join(' ');
    assert.ok(
      !argsStr.includes('--force') &&
      !argsStr.includes('--force-with-lease') &&
      !argsStr.includes('--amend') &&
      !argsStr.includes('--no-verify'),
      'must never use --force, --force-with-lease, --amend, or --no-verify',
    );
  }
});

test('commitWorktree never uses reset, clean, or stash commands', async () => {
  const execCalls = [];
  const mockExec = async (cmd, args) => {
    execCalls.push({ cmd, args });
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: 'file.js', exitCode: 0 };
    }
    return { stdout: 'abc123\n', exitCode: 0 };
  };

  await mod.commitWorktree('/test/worktree', 'Test', { exec: mockExec });

  for (const call of execCalls) {
    assert.ok(
      call.cmd !== 'git' || (
        call.args[0] !== 'reset' &&
        call.args[0] !== 'clean' &&
        call.args[0] !== 'stash'
      ),
      'must never call git reset, git clean, or git stash',
    );
  }
});

test('commitWorktree runs git against the worktree (cwd or -C)', async () => {
  const execCalls = [];
  const workDir = '/test/worktree-path';
  const mockExec = async (cmd, args, opts) => {
    execCalls.push({ cmd, args, opts });
    if (cmd === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
      return { stdout: 'file.js', exitCode: 0 };
    }
    return { stdout: 'abc123\n', exitCode: 0 };
  };

  await mod.commitWorktree(workDir, 'Test', { exec: mockExec });

  // Either -C is used in args, or exec was called with cwd in opts
  for (const call of execCalls) {
    const hasCFlag = call.args && call.args.includes('-C');
    const hasCwdOpt = call.opts && call.opts.cwd === workDir;
    // At least one must be true (test uses -C or cwd option)
    if (call.cmd === 'git') {
      assert.ok(
        hasCFlag || hasCwdOpt,
        `git calls must target the worktree (${workDir}) via -C or cwd, but got args=${JSON.stringify(call.args)} opts=${JSON.stringify(call.opts)}`,
      );
    }
  }
});
