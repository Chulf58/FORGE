#!/usr/bin/env node
'use strict';
// Regression test for migrateForgeConfig path-resolution behavior (closes d9683d2a part A).
//
// Guards the main-root fallback shipped in commit 25a1ba95: when CLAUDE_PLUGIN_DATA
// is unset, the resolver MUST use the explicit mainProjectDir argument rather than
// falling back to process.cwd() — worker sessions run in a worktree, so cwd would
// point to the worktree dir and config writes would land in the wrong place.
//
// Run: node hooks/mcp-deps-install-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mod = require('./mcp-deps-install.js');

test('resolveLiveConfigPath — exported by hooks/mcp-deps-install.js', () => {
  assert.equal(typeof mod.resolveLiveConfigPath, 'function',
    'resolveLiveConfigPath must be exported for regression-test access');
});

test('resolveLiveConfigPath — pluginDataDir set returns <pluginDataDir>/forge-config.json', () => {
  const result = mod.resolveLiveConfigPath('/data/plugin', '/main/project');
  assert.equal(result, path.join('/data/plugin', 'forge-config.json'),
    'when pluginDataDir is set, fallback is bypassed');
});

test('resolveLiveConfigPath — pluginDataDir null returns <mainProjectDir>/.pipeline/forge-config.json', () => {
  const result = mod.resolveLiveConfigPath(null, '/main/project');
  assert.equal(result, path.join('/main/project', '.pipeline', 'forge-config.json'),
    'when pluginDataDir is null, fallback uses mainProjectDir (NOT process.cwd)');
});

test('resolveLiveConfigPath — regression guard: never includes .worktrees/ when mainProjectDir is the main root', () => {
  // The bug this fixes: in worker sessions process.cwd() is the worktree path
  // (e.g. /main/project/.worktrees/r-abc123/), so a cwd-based fallback would
  // write the config into the worktree. The fix is to pass mainProjectDir
  // explicitly. This test verifies the resolved path is rooted at the
  // mainProjectDir argument we passed, not at any worktree subpath.
  const mainRoot = path.join('/main', 'project'); // platform-normalized
  const result = mod.resolveLiveConfigPath(null, mainRoot);
  assert.ok(!result.includes('.worktrees'),
    'resolved path must never traverse into .worktrees/ when mainProjectDir is the main root; got ' + result);
  // Compare normalized paths to avoid leading-slash + separator mismatches on Windows.
  assert.ok(path.normalize(result).startsWith(path.normalize(mainRoot)),
    'resolved path must start with the mainProjectDir argument; got ' + result + ' vs ' + mainRoot);
});
