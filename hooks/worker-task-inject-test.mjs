import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Shim that mirrors hooks/worker-task-inject.js findWorkerTaskFile exactly.
// Accepts explicit (dir, cwdForTest, runIdForTest) so tests control all three
// inputs without mutating process.env or process.cwd().
import path from 'node:path';

function findWorkerTaskFile(dir, cwdForTest, runIdForTest) {
  const runId = runIdForTest !== undefined ? runIdForTest : undefined;
  if (runId) {
    const pipelineDir = path.join(cwdForTest, '.pipeline');
    const specific = 'worker-task-' + runId + '.json';
    try {
      const entries = readdirSync(pipelineDir);
      return entries.includes(specific) ? path.join(pipelineDir, specific) : null;
    } catch (_) {
      return null;
    }
  }
  const pipelineDir = path.join(dir, '.pipeline');
  try {
    const entries = readdirSync(pipelineDir);
    const match = entries.find((e) => /^worker-task-.+\.json$/.test(e));
    return match ? path.join(pipelineDir, match) : null;
  } catch (_) {
    return null;
  }
}

function makeTmp() {
  const dir = join(tmpdir(), 'wtinject-test-' + Math.random().toString(36).slice(2));
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// --- Targeted mode (FORGE_WORKER_RUN_ID present) ---

test('targeted: returns exact file when present', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(join(cwd, '.pipeline', 'worker-task-abc123.json'), '{}');
    const result = findWorkerTaskFile('/irrelevant', cwd, 'abc123');
    assert.equal(result, join(cwd, '.pipeline', 'worker-task-abc123.json'));
  } finally {
    cleanup(cwd);
  }
});

test('targeted: returns null when exact file absent (sibling present)', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(join(cwd, '.pipeline', 'worker-task-zzz999.json'), '{}');
    const result = findWorkerTaskFile('/irrelevant', cwd, 'abc123');
    assert.equal(result, null);
  } finally {
    cleanup(cwd);
  }
});

test('targeted: does NOT return lex-first sibling for wrong run', () => {
  const cwd = makeTmp();
  try {
    writeFileSync(join(cwd, '.pipeline', 'worker-task-aaa.json'), '{}');
    writeFileSync(join(cwd, '.pipeline', 'worker-task-bbb.json'), '{}');
    // Worker B asks for its own file — must NOT get worker-task-aaa.json
    const result = findWorkerTaskFile('/irrelevant', cwd, 'bbb');
    assert.equal(result, join(cwd, '.pipeline', 'worker-task-bbb.json'));
  } finally {
    cleanup(cwd);
  }
});

test('targeted: returns null when .pipeline dir missing', () => {
  const dir = join(tmpdir(), 'no-pipeline-' + Math.random().toString(36).slice(2));
  const result = findWorkerTaskFile('/irrelevant', dir, 'abc123');
  assert.equal(result, null);
});

// --- Fallback mode (no FORGE_WORKER_RUN_ID) ---

test('fallback: returns lex-first matching file', () => {
  const dir = makeTmp();
  try {
    writeFileSync(join(dir, '.pipeline', 'worker-task-bbb.json'), '{}');
    writeFileSync(join(dir, '.pipeline', 'worker-task-aaa.json'), '{}');
    const result = findWorkerTaskFile(dir, '/irrelevant', undefined);
    assert.equal(result, join(dir, '.pipeline', 'worker-task-aaa.json'));
  } finally {
    cleanup(dir);
  }
});

test('fallback: returns null when no task file exists', () => {
  const dir = makeTmp();
  try {
    const result = findWorkerTaskFile(dir, '/irrelevant', undefined);
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

test('fallback: does not match non-task files', () => {
  const dir = makeTmp();
  try {
    writeFileSync(join(dir, '.pipeline', 'run.json'), '{}');
    writeFileSync(join(dir, '.pipeline', 'gate-pending.json'), '{}');
    const result = findWorkerTaskFile(dir, '/irrelevant', undefined);
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

test('fallback: returns null when .pipeline dir missing', () => {
  const dir = join(tmpdir(), 'no-pipeline-fallback-' + Math.random().toString(36).slice(2));
  const result = findWorkerTaskFile(dir, '/irrelevant', undefined);
  assert.equal(result, null);
});
