#!/usr/bin/env node
'use strict';
// Regression test for resolveRunId in hooks/hook-utils.js (closes f2f65ce9).
//
// Guards the hook-side of singleton elimination (commit 8fc4f99c): hooks must
// be able to resolve the active runId reliably even when 2+ non-terminal runs
// exist in .pipeline/runs/, by reading the FORGE_WORKER_RUN_ID env var that
// the MCP server injects into worker processes (mcp/server.js:1841 + :2698).
//
// Without resolveRunId, hooks fall back to findActiveRun() which returns null
// when active.length !== 1, causing subagent-stop / ctx-pre-tool /
// ctx-session-start to silently skip work and leaving null outcome/completedAt
// on run-active.json (the "orphan agent" failure mode in TODO 7fe538ee
// sub-bug 2 — recurring 3× this session).
//
// Run: node hooks/resolve-runid-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const path = require('node:path');

const utils = require('./hook-utils.js');

function seed(projectDir, runs) {
  for (const [runId, status] of runs) {
    mkdirSync(join(projectDir, '.pipeline', 'runs', runId), { recursive: true });
    writeFileSync(
      join(projectDir, '.pipeline', 'runs', runId, 'run.json'),
      JSON.stringify({ runId, status, pipelineType: 'plan', feature: 'test' })
    );
  }
}

test('resolveRunId — exported by hooks/hook-utils.js', () => {
  assert.equal(typeof utils.resolveRunId, 'function',
    'resolveRunId must be exported for hook consumers');
});

test('resolveRunId — env var FORGE_WORKER_RUN_ID takes precedence over everything', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  // Seed multiple non-terminal runs (would defeat findActiveRun fallback).
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  const original = process.env.FORGE_WORKER_RUN_ID;
  process.env.FORGE_WORKER_RUN_ID = 'r-envwins';
  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-envwins',
      'env var must beat worktree-path detection AND findActiveRun fallback');
  } finally {
    if (original === undefined) delete process.env.FORGE_WORKER_RUN_ID;
    else process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — worktree path detection from payload.cwd', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]); // multiple non-terminal
  const original = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;
  try {
    const wtPath = path.join(projectDir, '.worktrees', 'r-wtwins');
    const result = await utils.resolveRunId(projectDir, { cwd: wtPath });
    assert.equal(result, 'r-wtwins',
      'worktree-path detection must beat findActiveRun fallback');
  } finally {
    if (original !== undefined) process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — env var rejects invalid runId format', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  seed(projectDir, [['r-onlyone', 'running']]);
  const original = process.env.FORGE_WORKER_RUN_ID;
  process.env.FORGE_WORKER_RUN_ID = 'not-a-runid'; // invalid (no r- prefix)
  try {
    const result = await utils.resolveRunId(projectDir, {});
    // Invalid env var → fall through to findActiveRun (single run → returns it)
    assert.equal(result, 'r-onlyone',
      'invalid env var must be rejected; fall through to findActiveRun');
  } finally {
    if (original === undefined) delete process.env.FORGE_WORKER_RUN_ID;
    else process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — falls back to findActiveRun when env+cwd unavailable', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  seed(projectDir, [['r-singlerun', 'running']]);
  const original = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;
  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, 'r-singlerun',
      'no env var + no cwd-worktree → findActiveRun returns the single run');
  } finally {
    if (original !== undefined) process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — returns null when env+cwd unavailable AND multiple non-terminal runs', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]);
  const original = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;
  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, null,
      'fail-open: ambiguous fallback returns null (preserves prior findActiveRun behavior)');
  } finally {
    if (original !== undefined) process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — returns null when env+cwd unavailable AND zero non-terminal runs', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  // No runs seeded
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
  const original = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;
  try {
    const result = await utils.resolveRunId(projectDir, {});
    assert.equal(result, null, 'no runs at all → null');
  } finally {
    if (original !== undefined) process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('resolveRunId — payload.cwd outside .worktrees/ does not match', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-rrid-test-'));
  seed(projectDir, [['r-aaa111', 'running'], ['r-bbb222', 'running']]); // ambiguous
  const original = process.env.FORGE_WORKER_RUN_ID;
  delete process.env.FORGE_WORKER_RUN_ID;
  try {
    const result = await utils.resolveRunId(projectDir, { cwd: projectDir });
    assert.equal(result, null,
      'cwd outside .worktrees/ → no path match → fall through → ambiguous fallback null');
  } finally {
    if (original !== undefined) process.env.FORGE_WORKER_RUN_ID = original;
    rmSync(projectDir, { recursive: true, force: true });
  }
});
