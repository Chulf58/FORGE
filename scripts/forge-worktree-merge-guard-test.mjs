#!/usr/bin/env node
'use strict';
// @covers bin/forge-worktree.js
// Regression test for the merge() zero-commit data-loss guard.
//
// WHY: r-501eb714 (2026-05-26) — a commit gate opened on a worktree branch with
// 0 commits ahead of base. `forge-worktree.js merge` would then run a no-op
// `git merge` (exit 0, "Already up to date"), mark mergeOk=true, and REMOVE the
// worktree — silently discarding any recoverable work while reporting success.
// The guard refuses to merge (and refuses to remove the worktree) when the
// branch has 0 commits ahead of base. Worker-independent: this runs in the
// conductor's inline /forge:approve merge too.
//
// Run: node scripts/forge-worktree-merge-guard-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../bin/forge-worktree.js', import.meta.url));

function git(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-merge-guard-test-'));
  git('git init', tmp);
  git('git config user.email "test@test.com"', tmp);
  git('git config user.name "Test"', tmp);
  writeFileSync(join(tmp, 'README.md'), 'init\n');
  git('git add README.md', tmp);
  git('git commit -m "init"', tmp);
  return tmp;
}

function runMerge(repo, slug) {
  try {
    const stdout = execFileSync(process.execPath, [binPath, 'merge', slug], {
      cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exit: 0, out: stdout, err: '' };
  } catch (e) {
    return { exit: e.status, out: e.stdout || '', err: e.stderr || '' };
  }
}

function parseJsonLine(s) {
  const lines = (s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{')) {
      try { return JSON.parse(lines[i]); } catch (_) { /* keep scanning */ }
    }
  }
  return null;
}

// Test A — the guard: a 0-commit-ahead branch must be REFUSED and the worktree preserved.
test('merge refuses a worktree branch with 0 commits ahead — preserves worktree (no silent discard)', () => {
  const repo = setupRepo();
  try {
    const slug = 'r-zero-commit';
    git(`git worktree add -b forge/${slug} .worktrees/${slug} HEAD`, repo);
    const wtPath = join(repo, '.worktrees', slug);
    assert.ok(existsSync(wtPath), 'precondition: worktree exists');

    const r = runMerge(repo, slug);
    const j = parseJsonLine(r.err) || parseJsonLine(r.out);

    assert.notEqual(r.exit, 0, 'merge must exit non-zero on a 0-commit branch');
    assert.ok(j && j.ok === false, 'must report ok:false');
    assert.match((j && j.error) || '', /0 commits|nothing to merge/i, 'error must explain there is nothing to merge');
    assert.ok(existsSync(wtPath), 'worktree must NOT be removed — work would be discarded otherwise');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test B — control: a real commit ahead still merges and removes the worktree (guard not over-broad).
test('merge proceeds when the branch has >=1 commit ahead — control (guard is not vacuous)', () => {
  const repo = setupRepo();
  try {
    const slug = 'r-real-commit';
    git(`git worktree add -b forge/${slug} .worktrees/${slug} HEAD`, repo);
    const wtPath = join(repo, '.worktrees', slug);
    writeFileSync(join(wtPath, 'feature.txt'), 'work\n');
    git('git add feature.txt', wtPath);
    git('git commit -m "real work"', wtPath);

    const r = runMerge(repo, slug);
    const j = parseJsonLine(r.out) || parseJsonLine(r.err);

    assert.equal(r.exit, 0, 'merge must succeed when there is a real commit to merge');
    assert.ok(j && j.ok === true, 'must report ok:true');
    assert.ok(!existsSync(wtPath), 'worktree should be removed after a successful merge');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});
