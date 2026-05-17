#!/usr/bin/env node
'use strict';
// @covers bin/forge-worktree.js
// Tests for isWhitelistedWorktreeSwap — the pre-flight CLAUDE.md swap whitelist.
//
// Pre-flight in merge() rejects worktrees with uncommitted tracked changes.
// The create step always injects CLAUDE-WORKER.md → CLAUDE.md (line 126 of
// forge-worktree.js), so CLAUDE.md shows as modified in every worktree. When
// the content still matches CLAUDE-WORKER.md, the change is benign — the
// helper lets the pre-flight skip it.
//
// Run: node scripts/forge-worktree-preflight-test.mjs
// Auto-discovered by scripts/run-tests.mjs via scripts/*-test.mjs suffix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mod = require('../bin/forge-worktree.js');

test('isWhitelistedWorktreeSwap — exported by bin/forge-worktree.js', () => {
  assert.equal(typeof mod.isWhitelistedWorktreeSwap, 'function',
    'isWhitelistedWorktreeSwap must be exported');
});

test('isWhitelistedWorktreeSwap — identical files returns true', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'forge-preflight-plugin-'));
  const worktreePath = mkdtempSync(join(tmpdir(), 'forge-preflight-wt-'));
  try {
    writeFileSync(join(pluginRoot, 'CLAUDE-WORKER.md'), 'hello');
    writeFileSync(join(worktreePath, 'CLAUDE.md'), 'hello');
    const result = mod.isWhitelistedWorktreeSwap(worktreePath, pluginRoot);
    assert.equal(result, true, 'identical content → should return true');
  } finally {
    try { rmSync(pluginRoot, { recursive: true, force: true }); } catch (_) {}
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  }
});

test('isWhitelistedWorktreeSwap — differing content returns false', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'forge-preflight-plugin-'));
  const worktreePath = mkdtempSync(join(tmpdir(), 'forge-preflight-wt-'));
  try {
    writeFileSync(join(pluginRoot, 'CLAUDE-WORKER.md'), 'hello');
    writeFileSync(join(worktreePath, 'CLAUDE.md'), 'different');
    const result = mod.isWhitelistedWorktreeSwap(worktreePath, pluginRoot);
    assert.equal(result, false, 'differing content → should return false');
  } finally {
    try { rmSync(pluginRoot, { recursive: true, force: true }); } catch (_) {}
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  }
});

test('isWhitelistedWorktreeSwap — missing CLAUDE.md returns false', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'forge-preflight-plugin-'));
  const worktreePath = mkdtempSync(join(tmpdir(), 'forge-preflight-wt-'));
  try {
    writeFileSync(join(pluginRoot, 'CLAUDE-WORKER.md'), 'hello');
    // No CLAUDE.md written to worktreePath
    const result = mod.isWhitelistedWorktreeSwap(worktreePath, pluginRoot);
    assert.equal(result, false, 'missing CLAUDE.md → should return false');
  } finally {
    try { rmSync(pluginRoot, { recursive: true, force: true }); } catch (_) {}
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  }
});

test('isWhitelistedWorktreeSwap — missing CLAUDE-WORKER.md returns false', () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'forge-preflight-plugin-'));
  const worktreePath = mkdtempSync(join(tmpdir(), 'forge-preflight-wt-'));
  try {
    // No CLAUDE-WORKER.md in pluginRoot
    writeFileSync(join(worktreePath, 'CLAUDE.md'), 'hello');
    const result = mod.isWhitelistedWorktreeSwap(worktreePath, pluginRoot);
    assert.equal(result, false, 'missing CLAUDE-WORKER.md → should return false');
  } finally {
    try { rmSync(pluginRoot, { recursive: true, force: true }); } catch (_) {}
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch (_) {}
  }
});
