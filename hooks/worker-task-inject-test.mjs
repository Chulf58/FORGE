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

// --- taskBrief injection (end-to-end, spawns the hook subprocess) ---

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __hookDir = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__hookDir, 'worker-task-inject.js');

function runHookSubprocess(projectDir) {
  return new Promise((resolve, reject) => {
    const payload = { cwd: projectDir, session_id: 'test', hook_event_name: 'SessionStart' };
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(__hookDir, '..'), FORGE_WORKER_RUN_ID: 'r-test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr }));
    child.on('error', reject);
  });
}

function extractAdditionalContext(stdout) {
  try {
    const obj = JSON.parse(stdout);
    return obj?.hookSpecificOutput?.additionalContext || '';
  } catch (_) {
    return '';
  }
}

function makeProjectWithTask(taskData) {
  const dir = makeTmp();
  const taskPath = join(dir, '.pipeline', 'worker-task-' + (taskData.runId || 'r-test') + '.json');
  writeFileSync(taskPath, JSON.stringify(taskData), 'utf8');
  return dir;
}

test('taskBrief present: hook injects brief between markers', async () => {
  const dir = makeProjectWithTask({
    runId: 'r-test',
    feature: 'short feature',
    pipelineType: 'research',
    taskBrief: 'Detailed research brief.\nLine two of brief.',
  });
  try {
    const { stdout } = await runHookSubprocess(dir);
    const ctx = extractAdditionalContext(stdout);
    assert.ok(ctx.includes('--- Task brief ---'),
      'additionalContext missing "--- Task brief ---" opening marker. Got: ' + ctx.slice(0, 300));
    assert.ok(ctx.includes('Detailed research brief.'),
      'additionalContext missing brief body. Got: ' + ctx.slice(0, 300));
    assert.ok(ctx.includes('Line two of brief.'),
      'additionalContext lost multi-line brief content. Got: ' + ctx.slice(0, 300));
    assert.ok(ctx.includes('--- end brief ---'),
      'additionalContext missing "--- end brief ---" closing marker.');
  } finally {
    cleanup(dir);
  }
});

test('taskBrief absent: hook injects no brief markers', async () => {
  const dir = makeProjectWithTask({
    runId: 'r-test',
    feature: 'short feature',
    pipelineType: 'research',
  });
  try {
    const { stdout } = await runHookSubprocess(dir);
    const ctx = extractAdditionalContext(stdout);
    assert.ok(!ctx.includes('--- Task brief ---'),
      'additionalContext should not include "--- Task brief ---" when taskBrief absent.');
    assert.ok(!ctx.includes('--- end brief ---'),
      'additionalContext should not include "--- end brief ---" when taskBrief absent.');
  } finally {
    cleanup(dir);
  }
});

test('CLAUDE-WORKER.md content NOT appended to additionalContext (Option B / Task 9)', async () => {
  // Phase-2 Task-9 (Option B) retires CLAUDE-WORKER.md across all consumers, including
  // this hook's old "append CLAUDE-WORKER.md content to additionalContext" block. The
  // hook must NOT inject `# FORGE Worker — Runtime Instructions` (the CLAUDE-WORKER
  // sentinel) into the SessionStart additionalContext anymore — per-agent systemPrompts
  // come from agents/<type>.md via mcp/lib/orchestrator/agent-dispatch.mjs (Phase 1).
  const dir = makeProjectWithTask({
    runId: 'r-test',
    feature: 'short feature',
    pipelineType: 'research',
  });
  try {
    const { stdout } = await runHookSubprocess(dir);
    const ctx = extractAdditionalContext(stdout);
    assert.ok(
      !ctx.includes('FORGE Worker — Runtime Instructions'),
      'additionalContext must NOT contain the CLAUDE-WORKER.md sentinel (Option B).',
    );
    assert.ok(
      !ctx.includes('CLAUDE-WORKER'),
      'additionalContext must NOT reference CLAUDE-WORKER at all (Option B).',
    );
  } finally {
    cleanup(dir);
  }
});

test('taskBrief with control characters: stripped, surrounding text preserved', async () => {
  // Use String.fromCharCode to ensure non-literal control bytes in the source.
  const NUL = String.fromCharCode(0);
  const ESC = String.fromCharCode(27);
  const DEL = String.fromCharCode(127);
  const brief = 'Safe text' + NUL + 'with null' + ESC + 'with esc' + DEL + 'with del - end';
  const dir = makeProjectWithTask({
    runId: 'r-test',
    feature: 'short feature',
    pipelineType: 'research',
    taskBrief: brief,
  });
  try {
    const { stdout } = await runHookSubprocess(dir);
    const ctx = extractAdditionalContext(stdout);
    assert.ok(!ctx.includes(NUL), 'NUL byte should be stripped from additionalContext');
    assert.ok(!ctx.includes(ESC), 'ESC byte should be stripped from additionalContext');
    assert.ok(!ctx.includes(DEL), 'DEL byte should be stripped from additionalContext');
    assert.ok(ctx.includes('Safe text') && ctx.includes('with null') && ctx.includes('end'),
      'surrounding text should survive control-char stripping. Got: ' + ctx.slice(0, 300));
  } finally {
    cleanup(dir);
  }
});
