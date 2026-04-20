/**
 * Unit tests for observer-autosplit.js guard logic and command-string shape.
 * No external test runner. Run: node scripts/test-observer-autosplit.mjs
 * Exits 0 on success, 1 on any failure.
 */

import assert from 'assert/strict';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

// Load hook module via require(). The stdin loop is guarded by `require.main === module`
// so it does not execute here — only the pure helper exports are loaded.
const hookPath = path.join(__dirname, '..', 'hooks', 'observer-autosplit.js');
let shouldSkip, buildWtArgs;
try {
  const mod = require(hookPath);
  shouldSkip = mod.shouldSkip;
  buildWtArgs = mod.buildWtArgs;
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

// --- Result -----------------------------------------------------------------
if (passed === 3) {
  process.exit(0);
} else {
  console.error('[FAIL] ' + (3 - passed) + ' test(s) failed');
  process.exit(1);
}
