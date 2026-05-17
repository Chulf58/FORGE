#!/usr/bin/env node
'use strict';
// @covers bin/forge-worktree.js
// Regression test for removeWorktreeDir, cleanup fs-cleanup, and audit subcommand.
//
// Covers AC-1 through AC-5 for feature 91780bca.
//
// Run: node scripts/forge-worktree-cleanup-test.mjs
// Auto-discovered by scripts/run-tests.mjs via scripts/*-test.mjs suffix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mod = require('../bin/forge-worktree.js');
const binPath = fileURLToPath(new URL('../bin/forge-worktree.js', import.meta.url));

function git(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function setupRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-cleanup-test-'));
  git('git init', tmp);
  git('git config user.email "test@test.com"', tmp);
  git('git config user.name "Test"', tmp);
  // Need at least one commit so git commands work properly
  execSync('echo "init" > README.md', { cwd: tmp, shell: true });
  git('git add README.md', tmp);
  git('git commit -m "init"', tmp);
  return tmp;
}

// Test 1 — removeWorktreeDir export (red-bar trigger)
test('removeWorktreeDir — exported by bin/forge-worktree.js', () => {
  assert.equal(typeof mod.removeWorktreeDir, 'function', 'removeWorktreeDir must be exported');
});

// Test 2 — removeWorktreeDir removes a directory
test('removeWorktreeDir — removes a real directory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-rmdir-test-'));
  assert.ok(existsSync(tmp), 'precondition: temp dir exists');
  const result = mod.removeWorktreeDir(tmp);
  assert.equal(result.removed, true, 'removeWorktreeDir should return { removed: true }');
  assert.ok(!existsSync(tmp), 'directory should no longer exist after removeWorktreeDir');
});

// Test 3 — removeWorktreeDir handles non-existent path
test('removeWorktreeDir — handles non-existent path without throwing', () => {
  const fakePath = join(tmpdir(), 'forge-nonexistent-xyz-' + Date.now());
  assert.ok(!existsSync(fakePath), 'precondition: path does not exist');
  let result;
  assert.doesNotThrow(() => {
    result = mod.removeWorktreeDir(fakePath);
  }, 'must not throw for non-existent path');
  assert.equal(result.removed, false, 'should return { removed: false } for non-existent path');
});

// Test 4 — merge() fs cleanup (AC-1): removeWorktreeDir removes a worktree-like dir
test('removeWorktreeDir — removes a .worktrees/<slug>/ style directory (AC-1)', () => {
  const repo = setupRepo();
  try {
    const wtDir = join(repo, '.worktrees');
    const wtPath = join(wtDir, 'r-test-slug-abc');
    mkdirSync(wtPath, { recursive: true });
    assert.ok(existsSync(wtPath), 'precondition: worktree dir exists');
    const result = mod.removeWorktreeDir(wtPath);
    assert.equal(result.removed, true, 'should return { removed: true }');
    assert.ok(!existsSync(wtPath), 'directory no longer exists after removeWorktreeDir');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 5 — cleanup() fs cleanup (AC-2): plain dirs under .worktrees/ are removed
test('cleanup — removes plain dirs under .worktrees/ (AC-2)', () => {
  const repo = setupRepo();
  try {
    const wtDir = join(repo, '.worktrees');
    const slug1 = 'r-cleanup-test-a1b2';
    const slug2 = 'r-cleanup-test-c3d4';
    mkdirSync(join(wtDir, slug1), { recursive: true });
    mkdirSync(join(wtDir, slug2), { recursive: true });
    assert.ok(existsSync(join(wtDir, slug1)), 'precondition: dir1 exists');
    assert.ok(existsSync(join(wtDir, slug2)), 'precondition: dir2 exists');

    // Run cleanup as subprocess
    const output = execFileSync(process.execPath, [binPath, 'cleanup'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = JSON.parse(output.trim());
    assert.equal(result.ok, true, 'cleanup should return ok: true');

    // Both dirs should be gone
    assert.ok(!existsSync(join(wtDir, slug1)), 'slug1 dir should be removed');
    assert.ok(!existsSync(join(wtDir, slug2)), 'slug2 dir should be removed');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 6 — audit: orphans detected (AC-3 first branch)
test('audit — detects orphan directories (AC-3)', () => {
  const repo = setupRepo();
  try {
    const wtDir = join(repo, '.worktrees');
    const slug = 'r-orphan-abc';
    mkdirSync(join(wtDir, slug), { recursive: true });
    assert.ok(existsSync(join(wtDir, slug)), 'precondition: orphan dir exists');

    const output = execFileSync(process.execPath, [binPath, 'audit'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = JSON.parse(output.trim());
    assert.equal(result.ok, false, 'audit with orphans should return ok: false');
    assert.ok(Array.isArray(result.orphans), 'orphans should be an array');
    const hasOrphan = result.orphans.some(p => p.includes('r-orphan-abc'));
    assert.ok(hasOrphan, 'orphans array should contain r-orphan-abc path');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 7 — audit: no orphans (AC-3 second branch)
test('audit — no orphans returns ok:true and empty array (AC-3)', () => {
  const repo = setupRepo();
  try {
    // No .worktrees/ dir at all
    const output = execFileSync(process.execPath, [binPath, 'audit'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const result = JSON.parse(output.trim());
    assert.equal(result.ok, true, 'audit with no orphans should return ok: true');
    assert.ok(Array.isArray(result.orphans), 'orphans should be an array');
    assert.equal(result.orphans.length, 0, 'orphans array should be empty');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 8 — audit --prune (AC-5)
test('audit --prune — removes orphan directories and reports count (AC-5)', () => {
  const repo = setupRepo();
  try {
    const wtDir = join(repo, '.worktrees');
    const slug = 'r-prune-test';
    const orphanPath = join(wtDir, slug);
    mkdirSync(orphanPath, { recursive: true });
    assert.ok(existsSync(orphanPath), 'precondition: orphan dir exists');

    const pruneOutput = execFileSync(process.execPath, [binPath, 'audit', '--prune'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pruneResult = JSON.parse(pruneOutput.trim());
    assert.equal(pruneResult.ok, true, 'audit --prune should return ok: true');
    assert.ok(pruneResult.pruned >= 1, 'pruned count should be >= 1');
    assert.ok(!existsSync(orphanPath), 'orphan directory should no longer exist after --prune');

    // Follow-up audit should show no orphans
    const auditOutput = execFileSync(process.execPath, [binPath, 'audit'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const auditResult = JSON.parse(auditOutput.trim());
    assert.equal(auditResult.ok, true, 'follow-up audit should return ok: true');
    assert.equal(auditResult.orphans.length, 0, 'follow-up audit should have no orphans');
  } finally {
    try { rmSync(repo, { recursive: true, force: true }); } catch (_) {}
  }
});

// Regression: covers AC-1 through AC-5 for feature 91780bca.
// Red bar: fails before Task 1 (removeWorktreeDir undefined).
// Green bar: passes after Tasks 1-5 complete.
