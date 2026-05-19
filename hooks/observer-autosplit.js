'use strict';

// observer-autosplit.js — SessionStart hook
// Opens the FORGE observer in a Windows Terminal split pane when wt.exe is
// available, or in a new cmd.exe window as fallback when wt.exe is absent.
// Guards:
//   - Running on Windows (win32 only)
//   - This is not a subagent session (CLAUDE_CODE_TEAM_NAME not set)
//
// Always exits 0 — session start is never blocked.

const fs = require('fs');
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
 * @param {string} [projectDir]
 * @returns {string | null}
 */
function shouldSkip(env, platform, projectDir) {
  if (env.CLAUDE_CODE_TEAM_NAME) {
    return 'subagent session (CLAUDE_CODE_TEAM_NAME set)';
  }
  if (env.FORGE_OBSERVER_SPLIT === '1') {
    return 'launched via observer.bat (FORGE_OBSERVER_SPLIT=1)';
  }
  if (platform !== 'win32') {
    return 'non-Windows platform';
  }
  if (projectDir) {
    try {
      const pipelineDir = path.join(projectDir, '.pipeline');
      // Check durable marker first — survives worker-task file deletion
      if (fs.existsSync(path.join(pipelineDir, '.worker-session'))) {
        return 'worker session (.worker-session marker exists)';
      }
      // Legacy fallback: transient task file
      const entries = fs.readdirSync(pipelineDir);
      if (entries.some((e) => /^worker-task-.+\.json$/.test(e))) {
        return 'worker session (worker-task file exists)';
      }
    } catch (_) {
      // No .pipeline dir — not a worker
    }
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
 * Build the cmd.exe args array for the fallback (no wt.exe) launch.
 * Spawns:  cmd /c start cmd /k <observerCmdPath>
 * `start` is a cmd built-in — must be invoked via `cmd /c start`, not directly.
 *
 * @param {string} observerCmdPath  Absolute path to bin/forge-observer.cmd
 * @returns {string[]}
 */
function buildFallbackArgs(observerCmdPath) {
  return ['/c', 'start', 'cmd', '/k', observerCmdPath];
}

/**
 * Check whether an observer process from a previous session is still running.
 * Reads .pipeline/observer.pid — if the PID is alive, returns true.
 */
function isObserverRunning(projectDir) {
  const pidPath = path.join(projectDir, '.pipeline', 'observer.pid');
  try {
    const raw = fs.readFileSync(pidPath, 'utf8');
    const pid = parseInt(raw.trim(), 10);
    if (!pid || isNaN(pid)) return false;
    process.kill(pid, 0); // signal 0 = existence check, doesn't kill
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Write the spawned observer PID to .pipeline/observer.pid for dedup.
 */
function writeObserverPid(projectDir, pid) {
  try {
    const pidPath = path.join(projectDir, '.pipeline', 'observer.pid');
    fs.writeFileSync(pidPath, String(pid) + '\n', 'utf8');
  } catch (_) {
    // Non-fatal
  }
}

/**
 * Check whether wt.exe is available, trying PATH first then the Microsoft
 * Store App Execution Alias location.
 *
 * Returns the resolved absolute path to wt.exe if found, or null if not.
 * Never throws.
 */
function resolveWtPath() {
  // 1. Try PATH — fast, works for classic installs and most dev machines.
  try {
    execFileSync('where', ['wt.exe'], { stdio: 'ignore', timeout: 2000 });
    return 'wt.exe'; // On PATH — use by name so the shell resolves it.
  } catch (_) {
    // Not on PATH — fall through to Store-app check.
  }

  // 2. Try the Microsoft Store App Execution Alias.
  // %LOCALAPPDATA% is always set on Windows; guard for safety.
  try {
    if (process.env.LOCALAPPDATA) {
      const storePath = path.join(
        process.env.LOCALAPPDATA,
        'Microsoft', 'WindowsApps', 'wt.exe',
      );
      if (fs.existsSync(storePath)) {
        // WindowsApps is ACL-protected — spawn by name via the alias directory
        // on the PATH rather than using the raw protected path.  We return the
        // store path only as a presence indicator; callers that need to spawn
        // should add the WindowsApps dir to PATH env instead of using this
        // path directly.
        return storePath;
      }
    }
  } catch (_) {
    // Ignore any unexpected error — fail-open.
  }

  return null;
}

async function main(_rawInput) {
  const projectDir = process.cwd();
  const skipReason = shouldSkip(process.env, process.platform, projectDir);
  if (skipReason) {
    process.stderr.write('[forge-observer-autosplit] skipping — ' + skipReason + '\n');
    process.exit(0);
    return;
  }

  const pluginRoot = resolvePluginRoot();
  const observerCmdPath = path.join(pluginRoot, 'bin', 'forge-observer.cmd');

  if (isObserverRunning(projectDir)) {
    process.stderr.write('[forge-observer-autosplit] skipping — observer already running\n');
    process.exit(0);
    return;
  }

  const wtPath = resolveWtPath();
  if (wtPath !== null) {
    const args = buildWtArgs(observerCmdPath);
    // When the path is the Store-app alias, we must ensure WindowsApps is on
    // PATH so the App Execution Alias resolves correctly — spawn by name 'wt.exe'
    // with the alias directory prepended to PATH rather than using the raw ACL-
    // protected path directly.
    const spawnEnv = Object.assign({}, process.env);
    if (wtPath !== 'wt.exe' && process.env.LOCALAPPDATA) {
      const aliasDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
      spawnEnv.PATH = aliasDir + path.delimiter + (process.env.PATH || '');
    }
    try {
      const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore', env: spawnEnv });
      child.unref();
      process.stderr.write('[forge-observer-autosplit] opened observer split pane\n');
    } catch (err) {
      process.stderr.write(
        '[forge-observer-autosplit] wt.exe spawn failed: ' + (err.message || String(err)) + '\n',
      );
    }
  } else {
    const args = buildFallbackArgs(observerCmdPath);
    try {
      const child = spawn('cmd', args, { detached: true, stdio: 'ignore' });
      child.unref();
      process.stderr.write('[forge-observer-autosplit] opened observer window (cmd fallback)\n');
    } catch (err) {
      process.stderr.write(
        '[forge-observer-autosplit] cmd fallback spawn failed: ' + (err.message || String(err)) + '\n',
      );
    }
  }
  process.exit(0);
}

// Export pure helpers for unit tests.
module.exports = { shouldSkip, buildWtArgs, buildFallbackArgs, isObserverRunning, writeObserverPid, resolveWtPath };

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
