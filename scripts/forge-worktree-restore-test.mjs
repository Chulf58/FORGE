#!/usr/bin/env node
'use strict';
// Regression test for restoreAccidentalDeletions in bin/forge-worktree.js
// (closes d9683d2a part B).
//
// Guards the helper shipped in commit e0d6625a: after `git worktree remove`,
// merge cascades have historically left tracked files deleted from main's
// working tree (still in HEAD, missing on disk). The 52-files-deleted incident
// in session 21c0959a blocked worker spawn until manual `git restore` ran.
//
// This test exercises the pure helper across four scenarios using a temp git
// repo. The helper must also be importable without triggering the CLI dispatch
// — that's covered by the `require.main === module` guard at the bottom of
// bin/forge-worktree.js (also part of d9683d2a part B).
//
// Run: node scripts/forge-worktree-restore-test.mjs
// Auto-discovered by scripts/run-tests.mjs via scripts/*-test.mjs suffix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mod = require('../bin/forge-worktree.js');

function git(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-restore-test-'));
  git('git init', tmp);
  git('git config user.email "test@test.com"', tmp);
  git('git config user.name "Test"', tmp);
  // Seed three tracked files so deletion scenarios have targets.
  writeFileSync(join(tmp, 'a.txt'), 'aaa\n');
  writeFileSync(join(tmp, 'b.txt'), 'bbb\n');
  mkdirSync(join(tmp, 'sub'), { recursive: true });
  writeFileSync(join(tmp, 'sub', 'c.txt'), 'ccc\n');
  git('git add .', tmp);
  git('git commit -m "init"', tmp);
  return tmp;
}

test('restoreAccidentalDeletions — exported by bin/forge-worktree.js', () => {
  assert.equal(typeof mod.restoreAccidentalDeletions, 'function',
    'restoreAccidentalDeletions must be exported for regression-test access');
});

test('restoreAccidentalDeletions — no deletions returns empty array', () => {
  const repo = setupRepo();
  const cwd0 = process.cwd();
  try {
    process.chdir(repo);
    const result = mod.restoreAccidentalDeletions();
    assert.deepEqual(result, [], 'no `D ` entries → empty restored list');
  } finally {
    process.chdir(cwd0);
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

test('restoreAccidentalDeletions — single deletion is restored', () => {
  const repo = setupRepo();
  const cwd0 = process.cwd();
  try {
    process.chdir(repo);
    // Simulate the merge-cascade pattern: tracked file deleted from working
    // tree but still in HEAD/index. `git status` reports ` D a.txt`.
    unlinkSync(join(repo, 'a.txt'));
    assert.ok(!existsSync(join(repo, 'a.txt')), 'precondition: a.txt is deleted on disk');
    const result = mod.restoreAccidentalDeletions();
    assert.deepEqual(result, ['a.txt'], 'returns the restored file path');
    assert.ok(existsSync(join(repo, 'a.txt')), 'a.txt is restored on disk');
  } finally {
    process.chdir(cwd0);
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

test('restoreAccidentalDeletions — multiple deletions are all restored', () => {
  const repo = setupRepo();
  const cwd0 = process.cwd();
  try {
    process.chdir(repo);
    unlinkSync(join(repo, 'a.txt'));
    unlinkSync(join(repo, 'b.txt'));
    unlinkSync(join(repo, 'sub', 'c.txt'));
    const result = mod.restoreAccidentalDeletions();
    assert.equal(result.length, 3, 'three deletions → three entries returned');
    assert.ok(result.includes('a.txt'), 'a.txt in returned list');
    assert.ok(result.includes('b.txt'), 'b.txt in returned list');
    // Path can come back as 'sub/c.txt' or 'sub\\c.txt' depending on git porcelain
    assert.ok(result.some((p) => p === 'sub/c.txt' || p === 'sub\\c.txt'),
      'sub/c.txt in returned list (any separator)');
    assert.ok(existsSync(join(repo, 'a.txt')), 'a.txt restored');
    assert.ok(existsSync(join(repo, 'b.txt')), 'b.txt restored');
    assert.ok(existsSync(join(repo, 'sub', 'c.txt')), 'sub/c.txt restored');
  } finally {
    process.chdir(cwd0);
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

test('restoreAccidentalDeletions — git failure does not throw (allowFail path)', () => {
  // Run in a non-git directory. `git status --short` fails internally; the
  // helper's `run('git', ['status', '--short'], { allowFail: true })` returns
  // empty string, and the helper returns []. No throw.
  const tmp = mkdtempSync(join(tmpdir(), 'forge-restore-nogit-'));
  const cwd0 = process.cwd();
  try {
    process.chdir(tmp);
    const result = mod.restoreAccidentalDeletions();
    // Either empty array (status returned '') or a thrown error converted to
    // empty result. The helper's contract is "never throw" — assert that.
    assert.ok(Array.isArray(result), 'returns array even when git status fails');
  } finally {
    process.chdir(cwd0);
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
});
