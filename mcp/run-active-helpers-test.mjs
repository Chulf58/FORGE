#!/usr/bin/env node
// Unit tests for getRunActivePath() and writeRunActive() from forge-core runs/index.js
// Run: node mcp/run-active-helpers-test.mjs

import { getRunActivePath, writeRunActive } from '../packages/forge-core/src/runs/index.js';
import { existsSync, readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    process.stdout.write('  PASS  ' + label + '\n');
    passed++;
  } else {
    process.stderr.write('  FAIL  ' + label + '\n');
    failed++;
  }
}

function makeProjectDir() {
  const dir = join(tmpdir(), 'forge-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

process.stdout.write('\n── run-active-helpers-test.mjs ──────────────────────────────────────────\n');

// 1. getRunActivePath returns expected path for valid runId
{
  const projectDir = join(tmpdir(), 'fake-project');
  const runId = 'r-abc123';
  const result = getRunActivePath(projectDir, runId);
  assert(
    result.includes('r-abc123') && result.endsWith('run-active.json'),
    'getRunActivePath: path contains runId and ends with run-active.json',
  );
  // Verify the path segments are correct
  const normalized = result.replace(/\\/g, '/');
  assert(
    normalized.includes('.pipeline/runs/r-abc123/run-active.json'),
    'getRunActivePath: path structure is .pipeline/runs/<runId>/run-active.json',
  );
}

// 2. getRunActivePath throws TypeError for runId missing 'r-' prefix
{
  let threw = false;
  let errType = false;
  try {
    getRunActivePath(join(tmpdir(), 'fake'), 'abc123');
  } catch (err) {
    threw = true;
    errType = err instanceof TypeError;
  }
  assert(threw && errType, 'getRunActivePath: throws TypeError for runId without r- prefix');
}

// 3. getRunActivePath throws for path traversal attempt
{
  let threw = false;
  try {
    getRunActivePath(join(tmpdir(), 'fake'), 'r-../../etc/passwd');
  } catch (err) {
    threw = true;
  }
  assert(threw, 'getRunActivePath: throws for path traversal attempt in runId');
}

// 4. getRunActivePath throws for empty string
{
  let threw = false;
  try {
    getRunActivePath(join(tmpdir(), 'fake'), '');
  } catch (err) {
    threw = true;
  }
  assert(threw, 'getRunActivePath: throws for empty runId');
}

// 5. getRunActivePath throws for runId with special chars
{
  let threw = false;
  try {
    getRunActivePath(join(tmpdir(), 'fake'), 'r-abc!@#');
  } catch (err) {
    threw = true;
  }
  assert(threw, 'getRunActivePath: throws for runId with special characters');
}

// 6. writeRunActive writes file with correct content
{
  const projectDir = makeProjectDir();
  const runId = 'r-test01';
  const runDirPath = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDirPath, { recursive: true });

  const payload = {
    startedAt: 1700000000000,
    runId,
    pipelineType: 'implement',
    feature: 'test feature',
    agents: [],
    stages: null,
  };

  try {
    writeRunActive(projectDir, runId, payload);
    const filePath = getRunActivePath(projectDir, runId);
    assert(existsSync(filePath), 'writeRunActive: file exists after write');

    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert(content.runId === runId, 'writeRunActive: runId field matches');
    assert(content.pipelineType === 'implement', 'writeRunActive: pipelineType field matches');
    assert(content.feature === 'test feature', 'writeRunActive: feature field matches');
    assert(Array.isArray(content.agents), 'writeRunActive: agents is array');
  } catch (err) {
    process.stderr.write('  FAIL  writeRunActive write/read threw: ' + err.message + '\n');
    failed++;
  } finally {
    cleanup(projectDir);
  }
}

// 7. writeRunActive throws TypeError for invalid runId — no partial write
{
  const projectDir = makeProjectDir();
  let threw = false;
  try {
    writeRunActive(projectDir, 'bad-id', { runId: 'bad-id' });
  } catch (err) {
    threw = err instanceof TypeError;
  }
  assert(threw, 'writeRunActive: throws TypeError for invalid runId');
  cleanup(projectDir);
}

// 8. writeRunActive leaves no leftover .tmp files (atomic temp-rename pattern)
{
  const projectDir = makeProjectDir();
  const runId = 'r-test02';
  const runDirPath = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDirPath, { recursive: true });

  const payload = { startedAt: Date.now(), runId, pipelineType: 'plan', feature: 'f', agents: [] };
  try {
    writeRunActive(projectDir, runId, payload);
    const tmpFiles = readdirSync(runDirPath).filter(f => f.includes('.tmp.'));
    assert(tmpFiles.length === 0, 'writeRunActive: no leftover .tmp files after atomic write');
  } catch (err) {
    process.stderr.write('  FAIL  temp-rename check threw: ' + err.message + '\n');
    failed++;
  } finally {
    cleanup(projectDir);
  }
}

// 9. writeRunActive with optional worktreePath in payload
{
  const projectDir = makeProjectDir();
  const runId = 'r-test03';
  const runDirPath = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDirPath, { recursive: true });

  const payload = {
    startedAt: Date.now(),
    runId,
    pipelineType: 'implement',
    feature: 'with worktree',
    agents: [],
    worktreePath: '/some/worktree/path',
  };

  try {
    writeRunActive(projectDir, runId, payload);
    const filePath = getRunActivePath(projectDir, runId);
    const content = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert(content.worktreePath === '/some/worktree/path', 'writeRunActive: optional worktreePath preserved');
  } catch (err) {
    process.stderr.write('  FAIL  worktreePath preservation threw: ' + err.message + '\n');
    failed++;
  } finally {
    cleanup(projectDir);
  }
}

process.stdout.write('\n');
process.stdout.write('  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
