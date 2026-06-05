#!/usr/bin/env node
// @covers mcp/lib/worktree-intent.mjs
// TDD red-bar: worktree-intent helper functions
//
// New module (does not exist yet): mcp/lib/worktree-intent.mjs
// Exports two pure functions:
// - wantsWorktree({ pipelineType, useWorktree }) → boolean
// - isWorktreePath(workDir, runId) → boolean

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Import the module (guard against missing source) ──────────────────────────
let wantsWorktree;
let isWorktreePath;

try {
  const mod = await import('./worktree-intent.mjs');
  wantsWorktree = mod.wantsWorktree;
  isWorktreePath = mod.isWorktreePath;
} catch (err) {
  test('T0 — worktree-intent.mjs must be importable', () => {
    assert.fail('Failed to import: ' + err.message);
  });
  process.exit(1); // eslint-disable-line n/no-process-exit
}

// ── Test wantsWorktree ──────────────────────────────────────────────────────

test('wantsWorktree: implement pipeline → true', () => {
  const result = wantsWorktree({ pipelineType: 'implement', useWorktree: false });
  assert.strictEqual(result, true, 'implement pipelineType must return true regardless of useWorktree');
});

test('wantsWorktree: pipelineType=plan, useWorktree=false → false', () => {
  const result = wantsWorktree({ pipelineType: 'plan', useWorktree: false });
  assert.strictEqual(result, false, 'plan pipeline with useWorktree=false must return false');
});

test('wantsWorktree: pipelineType=plan, useWorktree=true → true', () => {
  const result = wantsWorktree({ pipelineType: 'plan', useWorktree: true });
  assert.strictEqual(result, true, 'plan pipeline with useWorktree=true must return true');
});

test('wantsWorktree: pipelineType=research, useWorktree=false → false', () => {
  const result = wantsWorktree({ pipelineType: 'research', useWorktree: false });
  assert.strictEqual(result, false, 'research pipeline with useWorktree=false must return false');
});

test('wantsWorktree: pipelineType=explore, useWorktree=false → false', () => {
  const result = wantsWorktree({ pipelineType: 'explore', useWorktree: false });
  assert.strictEqual(result, false, 'explore pipeline with useWorktree=false must return false');
});

test('wantsWorktree: pipelineType=refactor, useWorktree=false → false', () => {
  const result = wantsWorktree({ pipelineType: 'refactor', useWorktree: false });
  assert.strictEqual(result, false, 'refactor pipeline with useWorktree=false must return false');
});

test('wantsWorktree: pipelineType=debug, useWorktree=false → false', () => {
  const result = wantsWorktree({ pipelineType: 'debug', useWorktree: false });
  assert.strictEqual(result, false, 'debug pipeline with useWorktree=false must return false');
});

// ── Test isWorktreePath ──────────────────────────────────────────────────────

test('isWorktreePath: path containing .worktrees/<runId> → true', () => {
  const result = isWorktreePath('/proj/forge-plugin/.worktrees/r-abc123', 'r-abc123');
  assert.strictEqual(result, true, 'path with .worktrees/<runId> must return true');
});

test('isWorktreePath: path containing .worktrees/<runId> in the middle → true', () => {
  const result = isWorktreePath('/proj/.worktrees/r-guard-test/some/nested/path', 'r-guard-test');
  assert.strictEqual(result, true, 'path with .worktrees/<runId> in the middle must return true');
});

test('isWorktreePath: main project root (no .worktrees segment) → false', () => {
  const result = isWorktreePath('/proj/forge-plugin', 'r-abc');
  assert.strictEqual(result, false, 'main project root without .worktrees must return false');
});

test('isWorktreePath: main project with different runId → false', () => {
  const result = isWorktreePath('/proj/forge-plugin', 'r-xyz');
  assert.strictEqual(result, false, 'main project root must return false even with runId');
});

test('isWorktreePath: path with .worktrees but different runId → false', () => {
  const result = isWorktreePath('/proj/.worktrees/r-other-run/path', 'r-abc-test');
  assert.strictEqual(result, false, 'path with different .worktrees/<runId> must return false');
});

test('isWorktreePath: Windows-style path with .worktrees/<runId> → true', () => {
  const result = isWorktreePath('C:\\Users\\cuj\\forge-plugin\\.worktrees\\r-test123', 'r-test123');
  assert.strictEqual(result, true, 'Windows-style path with .worktrees/<runId> must return true');
});

test('isWorktreePath: empty workDir → false', () => {
  const result = isWorktreePath('', 'r-abc');
  assert.strictEqual(result, false, 'empty workDir must return false');
});

test('isWorktreePath: runId with special characters (hyphen, alphanumeric) → true', () => {
  const result = isWorktreePath('/proj/.worktrees/r-abc-def-123', 'r-abc-def-123');
  assert.strictEqual(result, true, 'runId with hyphens must match correctly in .worktrees path');
});
