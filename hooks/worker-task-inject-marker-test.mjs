#!/usr/bin/env node
// Tests for hooks/worker-task-inject.js marker placement.
//
// Background: forge_advance_stage spawns the worker with cwd = worktree.
// The SessionStart hook (worker-task-inject.js) currently writes
// `.pipeline/.worker-session` via `resolveProjectDir(payload)`, which
// strips the `.worktrees/r-<id>` suffix and returns the main project root.
// Result: marker ends up at `<main>/.pipeline/.worker-session`, but the
// worker model checks `.pipeline/.worker-session` relative to ITS cwd
// (the worktree) per CLAUDE.md. With no marker at the worktree path, the
// worker mis-identifies as a conductor and refuses to act.
//
// Observed live in r-4d4607a8 worker log line 390 — "Conductor session
// confirmed" — the worker glob'd `.pipeline/.worker-session` and found
// nothing because the marker was written one level up at main's path.
//
// Fix: write the marker to BOTH `<main>/.pipeline/.worker-session` (for
// existing consumers that check main) AND `<process.cwd()>/.pipeline/
// .worker-session` (where worktree-cwd workers actually look).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(__dirname, 'worker-task-inject.js');
const PLUGIN_ROOT = resolve(__dirname, '..');

function runHook(payload, cwd, env) {
  return new Promise((resolveP, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', (code) => resolveP({ code, stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function makeWorktreeFixture(runId) {
  const main = mkdtempSync(join(tmpdir(), 'wt-marker-test-'));
  const wt = join(main, '.worktrees', runId);
  mkdirSync(join(main, '.pipeline'), { recursive: true });
  mkdirSync(join(wt, '.pipeline'), { recursive: true });
  // Pre-write worker-task-<runId>.json at the worktree's .pipeline/ (where
  // forge_advance_stage spawns workers with workDir = worktreePath).
  writeFileSync(
    join(wt, '.pipeline', 'worker-task-' + runId + '.json'),
    JSON.stringify({
      runId,
      feature: 'test-feature',
      pipelineType: 'implement',
      originalPipelineType: 'plan',
      targetStage: 'implement',
      createdAt: new Date().toISOString(),
    }),
    'utf8',
  );
  return { main, wt };
}

test('marker is written at the worker-cwd worktree path (closes worker-session-missing bug)', async () => {
  const runId = 'r-aaaaaaaa';
  const { main, wt } = makeWorktreeFixture(runId);
  try {
    const res = await runHook({ cwd: wt }, wt, { FORGE_WORKER_RUN_ID: runId });
    const wtMarker = join(wt, '.pipeline', '.worker-session');
    assert.equal(existsSync(wtMarker), true,
      'worktree-cwd worker should find .worker-session at its own cwd (got stderr: ' + res.stderr + ')');
    const data = JSON.parse(readFileSync(wtMarker, 'utf8'));
    assert.equal(data.runId, runId, 'marker carries the spawned worker runId');
  } finally {
    rmSync(main, { recursive: true, force: true });
  }
});

test('marker is also written to the main project root (preserves existing consumer behavior)', async () => {
  const runId = 'r-bbbbbbbb';
  const { main, wt } = makeWorktreeFixture(runId);
  try {
    await runHook({ cwd: wt }, wt, { FORGE_WORKER_RUN_ID: runId });
    const mainMarker = join(main, '.pipeline', '.worker-session');
    assert.equal(existsSync(mainMarker), true,
      'main project root should also have .worker-session for hooks that check via resolveProjectDir');
  } finally {
    rmSync(main, { recursive: true, force: true });
  }
});

test('non-worktree session: marker is written at the single cwd location (no regression)', async () => {
  const runId = 'r-cccccccc';
  const main = mkdtempSync(join(tmpdir(), 'wt-marker-test-noWT-'));
  try {
    mkdirSync(join(main, '.pipeline'), { recursive: true });
    writeFileSync(
      join(main, '.pipeline', 'worker-task-' + runId + '.json'),
      JSON.stringify({
        runId, feature: 'test', pipelineType: 'plan',
        createdAt: new Date().toISOString(),
      }),
      'utf8',
    );
    await runHook({ cwd: main }, main, { FORGE_WORKER_RUN_ID: runId });
    assert.equal(existsSync(join(main, '.pipeline', '.worker-session')), true,
      'main-cwd worker still gets marker at main/.pipeline/.worker-session');
  } finally {
    rmSync(main, { recursive: true, force: true });
  }
});
