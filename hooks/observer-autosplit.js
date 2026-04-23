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
const { resolvePluginRoot, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

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
