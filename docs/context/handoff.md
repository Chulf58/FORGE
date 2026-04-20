# Handoff: SessionStart auto-split observer pane (Windows Terminal)

## Summary
Adds `hooks/observer-autosplit.js` to open the FORGE observer in a Windows Terminal split pane on SessionStart, with unit tests and a `wrapperLauncherContent` comment update.

## Files to create
### `hooks/observer-autosplit.js`
```javascript
'use strict';

// observer-autosplit.js — SessionStart hook
// Opens the FORGE observer in a Windows Terminal split pane when:
//   - Running on Windows
//   - wt.exe is on PATH
//   - This is not a subagent session (CLAUDE_CODE_TEAM_NAME not set)
//
// Always exits 0 — session start is never blocked.

const path = require('path');
const { execFileSync, spawn } = require('child_process');
const readline = require('readline');
const { resolvePluginRoot } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;

/**
 * Returns a non-empty skip reason string, or null to proceed.
 * Pure function — testable without spawning.
 *
 * @param {{ [key: string]: string | undefined }} env
 * @param {string} platform
 * @returns {string | null}
 */
function shouldSkip(env, platform) {
  if (env.CLAUDE_CODE_TEAM_NAME) {
    return 'subagent session (CLAUDE_CODE_TEAM_NAME set)';
  }
  if (platform !== 'win32') {
    return 'non-Windows platform';
  }
  return null;
}

/**
 * Build the wt.exe args array (excludes 'wt.exe' itself).
 *
 * @param {string} observerCmdPath  Absolute path to bin/forge-observer.cmd
 * @returns {string[]}
 */
function buildWtArgs(observerCmdPath) {
  return [
    '-w', '0',
    'sp', '-V',
    '--size', '0.35',
    '--',
    'cmd', '/c', observerCmdPath,
  ];
}

/**
 * Check whether wt.exe is available on PATH.
 * Returns true if found, false if not.
 */
function isWtAvailable() {
  try {
    execFileSync('where', ['wt.exe'], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

async function main(_rawInput) {
  const skipReason = shouldSkip(process.env, process.platform);
  if (skipReason) {
    process.stderr.write('[forge-observer-autosplit] skipping — ' + skipReason + '\n');
    process.exit(0);
    return;
  }

  if (!isWtAvailable()) {
    process.stderr.write('[forge-observer-autosplit] wt.exe not found — skipping split\n');
    process.exit(0);
    return;
  }

  const pluginRoot = resolvePluginRoot();
  const observerCmdPath = path.join(pluginRoot, 'bin', 'forge-observer.cmd');
  const args = buildWtArgs(observerCmdPath);

  try {
    const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore' });
    child.unref();
    process.stderr.write('[forge-observer-autosplit] opened observer split pane\n');
  } catch (err) {
    process.stderr.write(
      '[forge-observer-autosplit] spawn failed: ' + (err.message || String(err)) + '\n',
    );
  }
  process.exit(0);
}

// Export pure helpers for unit tests.
module.exports = { shouldSkip, buildWtArgs };

// -- Stdin reader — only runs when executed directly, not when require()d -----
// Guard prevents the stdin loop and process.exit() from firing when the test
// file loads this module via require().
if (require.main === module) {
  let inputData = '';
  const timer = setTimeout(() => {
    main(inputData || '{}').catch(() => process.exit(0));
  }, STDIN_TIMEOUT_MS);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => { inputData += line + '\n'; });
  rl.on('close', () => {
    clearTimeout(timer);
    main(inputData || '{}').catch(() => process.exit(0));
  });
}
```

### `scripts/test-observer-autosplit.mjs`
```javascript
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
```

## Files to modify
### `hooks/hooks.json`
**Change:** Append observer-autosplit entry as last item in SessionStart array.

**Find:**
```json
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/usage-clear-quota-flags.js\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
```

**Replace with:**
```json
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/usage-clear-quota-flags.js\""
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/observer-autosplit.js\""
          }
        ]
      }
    ],
    "UserPromptSubmit": [
```

### `hooks/mcp-deps-install.js`
**Change:** Add observer-pointer comment line to `wrapperLauncherContent` string.

**Find:**
```javascript
  const wrapperLauncherContent =
    '@echo off\r\n' +
    'REM FORGE wrapper launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
    'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
    claudeEnvLine +
    '"' + process.execPath + '" "' + wrapperJsPath + '" %*\r\n';
```

**Replace with:**
```javascript
  const wrapperLauncherContent =
    '@echo off\r\n' +
    'REM FORGE wrapper launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
    'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
    'REM For the observer-primary UX, use bin/forge-observer.cmd to launch the dashboard.\r\n' +
    claudeEnvLine +
    '"' + process.execPath + '" "' + wrapperJsPath + '" %*\r\n';
```

## Verification
- Stdin loop guarded with `require.main === module` — prior draft lacked this, causing `process.exit(0)` to fire when the test loaded the module via `require()`, killing the test process before any assertions ran.

## Doc hints
arch-update: true
decision: false
