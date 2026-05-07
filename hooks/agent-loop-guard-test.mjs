import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Helpers

function runHook(input, env = {}, cwd) {
  const hookPath = new URL('./agent-loop-guard.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const spawnOpts = {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  };
  if (cwd !== undefined) spawnOpts.cwd = cwd;
  const result = spawnSync(process.execPath, [hookPath], spawnOpts);
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-loop-guard-test-'));
  await fs.mkdir(path.join(dir, '.pipeline'), { recursive: true });
  return dir;
}

async function writeRunActive(dir, data) {
  await fs.writeFile(path.join(dir, '.pipeline', 'run-active.json'), JSON.stringify(data), 'utf8');
}

async function writeCounts(dir, runId, counts) {
  const countsDir = path.join(dir, '.pipeline', 'run-agent-counts');
  await fs.mkdir(countsDir, { recursive: true });
  await fs.writeFile(path.join(countsDir, runId + '.json'), JSON.stringify(counts), 'utf8');
}

async function readCounts(dir, runId) {
  try {
    const raw = await fs.readFile(path.join(dir, '.pipeline', 'run-agent-counts', runId + '.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// Tests

test('exits 0 for non-Agent tool calls', () => {
  const result = runHook({ tool_name: 'Write', tool_input: {} });
  assert.equal(result.exitCode, 0, 'should exit 0 for Write tool');
});

test('exits 0 when tool_name is missing', () => {
  const result = runHook({});
  assert.equal(result.exitCode, 0);
});

test('exits 0 for documenter (exempt)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-abc123' });
  await writeCounts(dir, 'r-abc123', { documenter: 5 });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:documenter' },
    cwd: dir,
  }, {}, dir);
  assert.equal(result.exitCode, 0, 'documenter should always be allowed');
});

test('exits 0 when no run-active.json (conductor session)', () => {
  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:coder' },
    cwd: os.tmpdir(),
  }, {}, os.tmpdir());
  assert.equal(result.exitCode, 0, 'conductor session should pass through');
});

test('exits 0 on first dispatch (count 0 → 1)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-abc123' });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:coder' },
    cwd: dir,
  }, {}, dir);
  assert.equal(result.exitCode, 0, 'first dispatch should be allowed');
});

test('exits 0 on second dispatch (count 1 → 2)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-abc123' });
  await writeCounts(dir, 'r-abc123', { coder: 1 });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:coder' },
    cwd: dir,
  }, {}, dir);
  assert.equal(result.exitCode, 0, 'second dispatch should be allowed');
});

test('exits 2 and denies on third dispatch (count >= 2)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-abc123' });
  await writeCounts(dir, 'r-abc123', { coder: 2 });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:coder' },
    cwd: dir,
  }, {}, dir);
  assert.equal(result.exitCode, 2, 'third dispatch should be denied');
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.permissionDecision, 'deny');
  assert.ok(result.stderr.includes('[forge-stuck] HARD STOP'));
});

test('deny message includes agent type and run id', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-abc123' });
  await writeCounts(dir, 'r-abc123', { planner: 3 });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:planner' },
    cwd: dir,
  }, {}, dir);
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.includes('planner'), 'stderr should name the agent type');
  assert.ok(result.stderr.includes('r-abc123'), 'stderr should include runId');
});

test('strips forge: prefix for counter key', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRunActive(dir, { runId: 'r-testrun' });

  runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:coder' },
    cwd: dir,
  }, {}, dir);

  // Give async write time to complete
  await new Promise((r) => setTimeout(r, 200));
  const counts = await readCounts(dir, 'r-testrun');
  // Key should be 'coder', not 'forge:coder'
  assert.ok(counts !== null && typeof counts.coder === 'number', 'key should be normalized without forge: prefix');
});
