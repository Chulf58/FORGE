#!/usr/bin/env node
// Tests for scripts/cleanup-stale-pipeline-state.mjs.
//
// Covers:
//   T1 — orphan singleton (run-active.json with runId that has no run.json)
//   T2 — valid singleton (runId points to a non-terminal run.json) — preserved
//   T3 — counter file for non-existent run — deleted
//   T4 — counter file for terminal run — deleted
//   T5 — counter file for running run — preserved
//   T6 — idempotent (run twice, same end state)
//   T7 — missing .pipeline/ — no-op, no errors
//
// Run: node --test scripts/cleanup-stale-pipeline-state-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_PATH = resolve(__dirname, 'cleanup-stale-pipeline-state.mjs');

function makeProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
  mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline', 'run-agent-counts'), { recursive: true });
  return tmp;
}

function writeRun(projectDir, runId, status) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({ runId, status, pipelineType: 'plan' }),
    'utf8',
  );
}

function writeSingleton(projectDir, runId) {
  writeFileSync(
    join(projectDir, '.pipeline', 'run-active.json'),
    JSON.stringify({ runId, startedAt: Date.now() }),
    'utf8',
  );
}

function writeCounter(projectDir, runId, counts) {
  writeFileSync(
    join(projectDir, '.pipeline', 'run-agent-counts', runId + '.json'),
    JSON.stringify(counts),
    'utf8',
  );
}

function runScript(projectDir, args = []) {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out.trim().split('\n').pop());
}

test('T1 — orphan singleton (runId has no run.json) is deleted', () => {
  const tmp = makeProject();
  try {
    writeSingleton(tmp, 'r-orphan1');
    // No run.json for r-orphan1
    const result = runScript(tmp);
    assert.equal(result.singletonDeleted, true);
    assert.equal(existsSync(join(tmp, '.pipeline', 'run-active.json')), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T2 — valid singleton (runId points to running run.json) is preserved', () => {
  const tmp = makeProject();
  try {
    writeRun(tmp, 'r-active1', 'running');
    writeSingleton(tmp, 'r-active1');
    const result = runScript(tmp);
    assert.equal(result.singletonDeleted, false);
    assert.equal(existsSync(join(tmp, '.pipeline', 'run-active.json')), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T3 — counter file for non-existent run is deleted', () => {
  const tmp = makeProject();
  try {
    writeCounter(tmp, 'r-ghost1', { researcher: 2 });
    const result = runScript(tmp);
    assert.deepEqual(result.countersDeleted, ['r-ghost1']);
    assert.equal(
      existsSync(join(tmp, '.pipeline', 'run-agent-counts', 'r-ghost1.json')),
      false,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T4 — counter file for terminal run is deleted', () => {
  const tmp = makeProject();
  try {
    writeRun(tmp, 'r-done1', 'completed');
    writeRun(tmp, 'r-done2', 'failed');
    writeRun(tmp, 'r-done3', 'discarded');
    writeCounter(tmp, 'r-done1', { coder: 5 });
    writeCounter(tmp, 'r-done2', { researcher: 1 });
    writeCounter(tmp, 'r-done3', { reviewer: 3 });
    const result = runScript(tmp);
    assert.deepEqual(result.countersDeleted.sort(), ['r-done1', 'r-done2', 'r-done3']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T5 — counter file for running run is preserved', () => {
  const tmp = makeProject();
  try {
    writeRun(tmp, 'r-active2', 'running');
    writeRun(tmp, 'r-active3', 'gate-pending');
    writeCounter(tmp, 'r-active2', { coder: 3 });
    writeCounter(tmp, 'r-active3', { reviewer: 1 });
    const result = runScript(tmp);
    assert.deepEqual(result.countersDeleted, []);
    assert.deepEqual(result.preserved.sort(), ['r-active2', 'r-active3']);
    assert.equal(existsSync(join(tmp, '.pipeline', 'run-agent-counts', 'r-active2.json')), true);
    assert.equal(existsSync(join(tmp, '.pipeline', 'run-agent-counts', 'r-active3.json')), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T6 — idempotent (running twice has same end state)', () => {
  const tmp = makeProject();
  try {
    writeSingleton(tmp, 'r-orphan2');
    writeCounter(tmp, 'r-ghost2', { researcher: 2 });
    writeRun(tmp, 'r-active4', 'running');
    writeCounter(tmp, 'r-active4', { coder: 1 });

    runScript(tmp);
    const filesAfterFirst = readdirSync(join(tmp, '.pipeline', 'run-agent-counts')).sort();
    const singletonAfterFirst = existsSync(join(tmp, '.pipeline', 'run-active.json'));

    runScript(tmp);
    const filesAfterSecond = readdirSync(join(tmp, '.pipeline', 'run-agent-counts')).sort();
    const singletonAfterSecond = existsSync(join(tmp, '.pipeline', 'run-active.json'));

    assert.deepEqual(filesAfterFirst, filesAfterSecond);
    assert.equal(singletonAfterFirst, singletonAfterSecond);
    assert.deepEqual(filesAfterSecond, ['r-active4.json']);
    assert.equal(singletonAfterSecond, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T7 — missing .pipeline/ is a no-op with no errors', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cleanup-test-empty-'));
  try {
    // No .pipeline/ at all
    const result = runScript(tmp);
    assert.equal(result.singletonDeleted, false);
    assert.deepEqual(result.countersDeleted, []);
    assert.deepEqual(result.preserved, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T8 — singleton points to terminal run is treated as orphan and deleted', () => {
  const tmp = makeProject();
  try {
    writeRun(tmp, 'r-done4', 'completed');
    writeSingleton(tmp, 'r-done4');
    const result = runScript(tmp);
    assert.equal(result.singletonDeleted, true);
    assert.equal(existsSync(join(tmp, '.pipeline', 'run-active.json')), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
