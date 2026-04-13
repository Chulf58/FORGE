#!/usr/bin/env node

// Smoke test for worktree creation bound to runs.
// Run: node packages/forge-core/src/runs/smoke-test-worktree.js
//
// Requires: git, a temp directory that becomes a git repo.

import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createRun, getRun, createWorktree } from './index.js';

function git(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

const tmp = mkdtempSync(join(tmpdir(), 'forge-wt-test-'));
console.log('Test dir:', tmp);

try {
  // Set up a minimal git repo
  git('git init', tmp);
  git('git config user.email "test@test.com"', tmp);
  git('git config user.name "Test"', tmp);
  writeFileSync(join(tmp, 'README.md'), '# Test\n');
  git('git add .', tmp);
  git('git commit -m "init"', tmp);

  // Create .pipeline/ and docs/ so copy logic has something to copy
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"test"}\n');
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'PLAN.md'), '# Plan\n');

  // 1. Create a run
  console.log('\n--- createRun ---');
  const run = createRun({
    projectRoot: tmp,
    sessionId: 'wt-test',
    pipelineType: 'implement',
    mode: 'LEAN',
    feature: 'Worktree test feature',
  });
  console.log('Created run:', run.runId);
  console.assert(!run.worktreePath, 'Should have no worktree yet');
  console.assert(!run.branchName, 'Should have no branch yet');

  // 2. Create a worktree for this run
  console.log('\n--- createWorktree ---');
  const updated = createWorktree(tmp, run.runId);
  console.log('Worktree path:', updated.worktreePath);
  console.log('Branch name:', updated.branchName);
  console.assert(updated.worktreePath !== null, 'worktreePath should be set');
  console.assert(updated.branchName === 'forge/' + run.runId, 'branchName should be forge/<runId>');

  // 3. Verify worktree directory exists
  console.log('\n--- verify worktree on disk ---');
  const wtExists = existsSync(updated.worktreePath);
  console.log('Worktree dir exists:', wtExists);
  console.assert(wtExists, 'Worktree directory should exist');

  // 4. Verify .pipeline/ was copied
  const pipelineCopied = existsSync(join(updated.worktreePath, '.pipeline', 'project.json'));
  console.log('.pipeline/project.json copied:', pipelineCopied);
  console.assert(pipelineCopied, '.pipeline/ should be copied to worktree');

  // 5. Verify docs/ was copied
  const docsCopied = existsSync(join(updated.worktreePath, 'docs', 'PLAN.md'));
  console.log('docs/PLAN.md copied:', docsCopied);
  console.assert(docsCopied, 'docs/ should be copied to worktree');

  // 6. Verify git branch was created
  const branches = git('git branch', tmp);
  console.log('\n--- git branches ---');
  console.log(branches);
  console.assert(branches.includes('forge/' + run.runId), 'Branch should exist');

  // 7. Verify run was updated on disk
  console.log('\n--- verify run persisted ---');
  const reread = getRun(tmp, run.runId);
  console.log('Persisted worktreePath:', reread.worktreePath);
  console.log('Persisted branchName:', reread.branchName);
  console.assert(reread.worktreePath === updated.worktreePath, 'worktreePath should persist');
  console.assert(reread.branchName === updated.branchName, 'branchName should persist');

  // 8. Calling again should error (idempotency guard)
  console.log('\n--- double-create guard ---');
  try {
    createWorktree(tmp, run.runId);
    console.assert(false, 'Should have thrown');
  } catch (e) {
    console.log('Correctly rejected:', e.message);
    console.assert(e.message.includes('already has a worktree'), 'Should mention existing worktree');
  }

  console.log('\n✓ All worktree checks passed');

} finally {
  // Cleanup: remove worktrees before deleting the repo
  try {
    execSync('git worktree prune', { cwd: tmp, stdio: 'pipe' });
  } catch (_) {}
  rmSync(tmp, { recursive: true, force: true });
}
