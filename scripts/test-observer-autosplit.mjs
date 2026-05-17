/**
 * Unit tests for observer-autosplit.js guard logic and command-string shape.
 * No external test runner. Run: node scripts/test-observer-autosplit.mjs
 * Exits 0 on success, 1 on any failure.
 */

import assert from 'assert/strict';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

// Load hook module via require(). The stdin loop is guarded by `require.main === module`
// so it does not execute here — only the pure helper exports are loaded.
const hookPath = path.join(__dirname, '..', 'hooks', 'observer-autosplit.js');
let shouldSkip, buildWtArgs, buildFallbackArgs;
try {
  const mod = require(hookPath);
  shouldSkip = mod.shouldSkip;
  buildWtArgs = mod.buildWtArgs;
  buildFallbackArgs = mod.buildFallbackArgs;
} catch (err) {
  console.error('[FAIL] Could not require hook:', err.message);
  process.exit(1);
}

let passed = 0;

// --- Test 1: subagent skip ---------------------------------------------------
try {
  const reason = shouldSkip({ CLAUDE_CODE_TEAM_NAME: 'test' }, 'win32');
  assert.ok(reason !== null, 'should return a skip reason when CLAUDE_CODE_TEAM_NAME is set');
  assert.ok(typeof reason === 'string' && reason.includes('subagent'), 'reason should mention subagent');
  console.log('[PASS] Test 1: subagent guard returns skip reason');
  passed++;
} catch (err) {
  console.error('[FAIL] Test 1: subagent guard —', err.message);
}

// --- Test 2: non-Windows skip -----------------------------------------------
try {
  const reason = shouldSkip({}, 'linux');
  assert.ok(reason !== null, 'should return a skip reason on non-Windows');
  assert.ok(typeof reason === 'string' && reason.includes('non-Windows'), 'reason should mention non-Windows');
  console.log('[PASS] Test 2: non-Windows guard returns skip reason');
  passed++;
} catch (err) {
  console.error('[FAIL] Test 2: non-Windows guard —', err.message);
}

// --- Test 3: command string shape -------------------------------------------
try {
  const pluginRoot = 'C:\\plugin';
  const observerCmdPath = path.win32.join(pluginRoot, 'bin', 'forge-observer.cmd');
  const args = buildWtArgs(observerCmdPath);
  const expected = [
    '-w', '0',
    'sp', '-V',
    '--size', '0.35',
    '--',
    'cmd', '/c',
    'C:\\plugin\\bin\\forge-observer.cmd',
  ];
  assert.deepEqual(args, expected, 'args array must match expected shape');
  console.log('[PASS] Test 3: command string shape is correct');
  passed++;
} catch (err) {
  console.error('[FAIL] Test 3: command string shape —', err.message);
}

// --- Test 4: fallback args shape --------------------------------------------
try {
  const pluginRoot = 'C:\\plugin';
  const observerCmdPath = path.win32.join(pluginRoot, 'bin', 'forge-observer.cmd');
  const args = buildFallbackArgs(observerCmdPath);
  const expected = ['/c', 'start', 'cmd', '/k', 'C:\\plugin\\bin\\forge-observer.cmd'];
  assert.deepEqual(args, expected, 'fallback args array must match expected shape');
  console.log('[PASS] Test 4: fallback args shape is correct');
  passed++;
} catch (err) {
  console.error('[FAIL] Test 4: fallback args shape —', err.message);
}

// --- Test 5: buildFallbackArgs uses cmd /c start (not spawn of start directly) --
try {
  const args = buildFallbackArgs('C:\\any\\path.cmd');
  assert.equal(args[0], '/c', 'first arg must be /c (cmd built-in routing)');
  assert.equal(args[1], 'start', 'second arg must be start');
  assert.equal(args[2], 'cmd', 'third arg must be cmd (new console shell)');
  assert.equal(args[3], '/k', 'fourth arg must be /k (keep window open)');
  console.log('[PASS] Test 5: fallback invokes start as cmd built-in');
  passed++;
} catch (err) {
  console.error('[FAIL] Test 5: fallback cmd built-in check —', err.message);
}

// --- Test 6: .worker-session marker present → shouldSkip returns "worker session" ----
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  try {
    const pipelineDir = path.join(tmpDir, '.pipeline');
    fs.mkdirSync(pipelineDir);
    fs.writeFileSync(path.join(pipelineDir, '.worker-session'), '', 'utf8');
    const reason = shouldSkip({}, 'win32', tmpDir);
    assert.ok(reason !== null, 'should return a skip reason when .worker-session exists');
    assert.ok(typeof reason === 'string' && reason.includes('worker session'),
      'reason should mention "worker session", got: ' + reason);
    console.log('[PASS] Test 6: .worker-session marker → shouldSkip returns worker session reason');
    passed++;
  } catch (err) {
    console.error('[FAIL] Test 6: .worker-session marker —', err.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Test 7: legacy worker-task-*.json only (no .worker-session) → shouldSkip returns "worker session" ---
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  try {
    const pipelineDir = path.join(tmpDir, '.pipeline');
    fs.mkdirSync(pipelineDir);
    fs.writeFileSync(path.join(pipelineDir, 'worker-task-abc123.json'), '{}', 'utf8');
    const reason = shouldSkip({}, 'win32', tmpDir);
    assert.ok(reason !== null, 'should return a skip reason when worker-task-*.json exists');
    assert.ok(typeof reason === 'string' && reason.includes('worker session'),
      'reason should mention "worker session", got: ' + reason);
    console.log('[PASS] Test 7: legacy worker-task-*.json only → shouldSkip returns worker session reason');
    passed++;
  } catch (err) {
    console.error('[FAIL] Test 7: legacy worker-task-*.json —', err.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Test 8: no markers present (conductor session) → shouldSkip returns null ---
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
  try {
    const pipelineDir = path.join(tmpDir, '.pipeline');
    fs.mkdirSync(pipelineDir);
    // No .worker-session, no worker-task-*.json
    const reason = shouldSkip({}, 'win32', tmpDir);
    assert.equal(reason, null, 'should return null (no skip) for a conductor session with no markers');
    console.log('[PASS] Test 8: no markers present → shouldSkip returns null (conductor session)');
    passed++;
  } catch (err) {
    console.error('[FAIL] Test 8: no-marker conductor session —', err.message);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Result -----------------------------------------------------------------
if (passed === 8) {
  process.exit(0);
} else {
  console.error('[FAIL] ' + (8 - passed) + ' test(s) failed');
  process.exit(1);
}
