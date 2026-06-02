// @covers mcp/lib/orchestrator/commit-worktree.mjs
// Contract for commitWorktree.
//
// Detection: `git status --porcelain` (NOT `git diff --name-only HEAD`) so that
// UNTRACKED new files are committed — the bulk of a new-file feature. The prior
// `git diff` form omitted untracked files, so r-91c5b2e9 committed nothing
// (cache-drift-guard.js / its test were untracked) and gate2 had nothing to merge.
// Pipeline state/artifacts (.pipeline/, docs/context/) are excluded — not source.
// Files are staged INDIVIDUALLY (never --all/-A/.). On no source changes:
// { committed:false, reason:<non-empty> } without throwing. Forbidden ops
// (--force/--amend/--no-verify/reset/clean/stash) never appear.
//
// Run: node --test mcp/lib/orchestrator/commit-worktree.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as mod from './commit-worktree.mjs';

// Build a mock exec whose `git status --porcelain` returns the given porcelain
// text; add/commit succeed; everything else returns empty.
function mockExecFor(porcelain, execCalls) {
  return async (cmd, args, opts) => {
    execCalls.push({ cmd, args, opts });
    if (cmd === 'git' && args[0] === 'status' && args[1] === '--porcelain') {
      return { stdout: porcelain, exitCode: 0 };
    }
    return { stdout: 'abc123def\n', exitCode: 0 };
  };
}

test('commitWorktree stages changed files INDIVIDUALLY, never --all / -A / .', async () => {
  const execCalls = [];
  const mockExec = mockExecFor(' M hooks/file-a.js\n M scripts/file-b.mjs', execCalls);

  await mod.commitWorktree('/test/worktree', 'Test commit', { exec: mockExec });

  const addCalls = execCalls.filter(c => c.cmd === 'git' && c.args[0] === 'add');
  assert.equal(addCalls.length, 2, 'must call git add exactly twice (one per file)');
  assert.ok(addCalls.some(c => c.args[1] === 'hooks/file-a.js'), 'must add hooks/file-a.js individually');
  assert.ok(addCalls.some(c => c.args[1] === 'scripts/file-b.mjs'), 'must add scripts/file-b.mjs individually');
  for (const call of addCalls) {
    assert.ok(
      !call.args.includes('--all') && !call.args.includes('-A') && !call.args.includes('.'),
      'git add must target files individually, never --all / -A / .',
    );
  }
});

test('commitWorktree commits UNTRACKED new files (the fix — git diff omitted them)', async () => {
  const execCalls = [];
  // Untracked new files (??) + a tracked modification (M). All must be staged.
  const mockExec = mockExecFor('?? hooks/cache-drift-guard.js\n?? hooks/cache-drift-guard-test.mjs\n M hooks/hooks.json', execCalls);

  const result = await mod.commitWorktree('/test/worktree', 'feat', { exec: mockExec });

  const added = execCalls.filter(c => c.cmd === 'git' && c.args[0] === 'add').map(c => c.args[1]);
  assert.ok(added.includes('hooks/cache-drift-guard.js'), 'must stage the untracked new source file');
  assert.ok(added.includes('hooks/cache-drift-guard-test.mjs'), 'must stage the untracked new test file');
  assert.ok(added.includes('hooks/hooks.json'), 'must stage the tracked-modified file');
  assert.equal(result.committed, true, 'must commit when there are untracked/modified source files');
});

test('commitWorktree excludes pipeline state + per-run context (.pipeline/, docs/context/)', async () => {
  const execCalls = [];
  const mockExec = mockExecFor('?? hooks/cache-drift-guard.js\n?? docs/context/scout.json\n?? docs/context/handoff.md\n?? .pipeline/context/foo.json', execCalls);

  await mod.commitWorktree('/test/worktree', 'feat', { exec: mockExec });

  const added = execCalls.filter(c => c.cmd === 'git' && c.args[0] === 'add').map(c => c.args[1]);
  assert.deepEqual(added, ['hooks/cache-drift-guard.js'], 'must stage only source, excluding docs/context/ and .pipeline/');
});

test('commitWorktree commits with the given message', async () => {
  const execCalls = [];
  const testMessage = 'Orchestrator commit on gate2 APPROVED';
  const mockExec = mockExecFor(' M hooks/file.js', execCalls);

  await mod.commitWorktree('/test/worktree', testMessage, { exec: mockExec });

  const commitCall = execCalls.find(c => c.cmd === 'git' && c.args[0] === 'commit');
  assert.ok(commitCall, 'must call git commit');
  assert.ok(commitCall.args.includes('-m') || commitCall.args.includes('-F'), 'must use -m or -F for the message');
  if (commitCall.args.includes('-m')) {
    const mIdx = commitCall.args.indexOf('-m');
    assert.equal(commitCall.args[mIdx + 1], testMessage, 'message must match the provided string');
  }
});

test('commitWorktree returns { committed:false, reason:<non-empty> } when there are no source changes', async () => {
  const execCalls = [];
  // Only pipeline artifacts changed → no source to commit.
  const mockExec = mockExecFor('?? docs/context/scout.json\n?? .pipeline/context/foo.json', execCalls);

  const result = await mod.commitWorktree('/test/worktree', 'Never used', { exec: mockExec });

  assert.equal(result.committed, false, 'must return committed:false when no source files changed');
  assert.ok(result.reason && typeof result.reason === 'string', 'must return a non-empty string reason (never throws)');
  const addCalls = execCalls.filter(c => c.cmd === 'git' && c.args[0] === 'add');
  assert.equal(addCalls.length, 0, 'must not stage anything when only pipeline artifacts changed');
});

test('commitWorktree never uses --force, --force-with-lease, --amend, --no-verify', async () => {
  const execCalls = [];
  const mockExec = mockExecFor(' M hooks/file.js', execCalls);
  await mod.commitWorktree('/test/worktree', 'Test', { exec: mockExec });
  for (const call of execCalls) {
    const argsStr = call.args.join(' ');
    assert.ok(
      !argsStr.includes('--force') && !argsStr.includes('--force-with-lease') &&
      !argsStr.includes('--amend') && !argsStr.includes('--no-verify'),
      'must never use --force, --force-with-lease, --amend, or --no-verify',
    );
  }
});

test('commitWorktree never uses reset, clean, or stash commands', async () => {
  const execCalls = [];
  const mockExec = mockExecFor(' M hooks/file.js', execCalls);
  await mod.commitWorktree('/test/worktree', 'Test', { exec: mockExec });
  for (const call of execCalls) {
    assert.ok(
      call.cmd !== 'git' || (call.args[0] !== 'reset' && call.args[0] !== 'clean' && call.args[0] !== 'stash'),
      'must never call git reset, git clean, or git stash',
    );
  }
});

test('commitWorktree runs git against the worktree (cwd or -C)', async () => {
  const execCalls = [];
  const workDir = '/test/worktree-path';
  const mockExec = mockExecFor(' M hooks/file.js', execCalls);
  await mod.commitWorktree(workDir, 'Test', { exec: mockExec });
  for (const call of execCalls) {
    if (call.cmd === 'git') {
      const hasCFlag = call.args && call.args.includes('-C');
      const hasCwdOpt = call.opts && call.opts.cwd === workDir;
      assert.ok(hasCFlag || hasCwdOpt, `git calls must target the worktree via -C or cwd; got args=${JSON.stringify(call.args)} opts=${JSON.stringify(call.opts)}`);
    }
  }
});
