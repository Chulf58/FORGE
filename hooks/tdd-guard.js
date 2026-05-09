'use strict';

// tdd-guard.js — PreToolUse hook (Phase 2 implementation)
//
// Scope note: this hook intentionally uses a NARROWER, ADDITIVE rule compared
// to hooks/workflow-guard.js. workflow-guard.js excludes /hooks/, /bin/, /mcp/
// from its isSourceFile check because it gates end-of-pipeline workflow steps
// (apply-stage commit signals). tdd-guard.js gates *every* Write/Edit/MultiEdit
// on plugin source code regardless of pipeline stage — so /hooks/, /bin/, /mcp/,
// and /scripts/ are IN scope here. The two hooks serve different policies and
// are intentionally disjoint in their source-file detection rules.
// (See PLAN.md "reviewer-boundary warning — source-file detection scope" resolution.)

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { STDIN_TIMEOUT_LONG } = require('./hook-utils');

/**
 * @typedef {{ exitCode: number, stderr: string }} GuardResult
 */

// Dirs that tdd-guard covers (narrower than workflow-guard which EXCLUDES these).
const GUARDED_DIRS = ['hooks', 'bin', 'scripts', 'mcp'];

// Patterns that identify test files by name.
const TEST_FILE_RE = /(?:\.test\.[cm]?js|\.test\.mjs|-test\.[cm]?js|-test\.mjs)$/;

/**
 * Returns true if the given relative or absolute path segment is under a tests dir.
 * @param {string} filePath
 */
function isTestDir(filePath) {
  const parts = filePath.split(/[\\/]/);
  return parts.includes('__tests__') || parts.includes('tests');
}

/**
 * Returns true if the file path should be treated as a test file (exempt from guard).
 * @param {string} filePath
 */
function isTestFile(filePath) {
  return TEST_FILE_RE.test(filePath) || isTestDir(filePath);
}

/**
 * Returns true if the file is under one of the guarded source dirs relative to cwd.
 * @param {string} filePath  - absolute path
 * @param {string} cwd       - project root
 */
function isGuardedSourceFile(filePath, cwd) {
  const rel = path.relative(cwd, filePath);
  // Reject absolute-path escapes and parent traversal
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const topDir = rel.split(/[\\/]/)[0];
  return GUARDED_DIRS.includes(topDir);
}

/**
 * Check if filePath matches any line in .tddguardignore (exact relative-path match).
 * Lines starting with # or blank lines are skipped.
 * v1: exact string equality on relative path (glob matching deferred to v2).
 * @param {string} filePath
 * @param {string} cwd
 * @returns {boolean}
 */
function isIgnored(filePath, cwd) {
  const ignorePath = path.join(cwd, '.tddguardignore');
  let content;
  try {
    content = fs.readFileSync(ignorePath, 'utf8');
  } catch {
    return false;
  }
  const rel = path.relative(cwd, filePath).replace(/\\/g, '/');
  for (const line of content.split('\n')) {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith('#')) continue;
    // v1: exact relative-path match (documented simplification — glob in v2)
    if (pattern === rel) return true;
  }
  return false;
}

/**
 * Resolve the test file for a given source file, using the deterministic order:
 *   1. Adjacent: <dir>/<name>.test.js or <dir>/<name>.test.mjs
 *   2. Sibling tests dir: <projectRoot>/tests/<name>.test.js or .test.mjs
 *   3. <dir>/__tests__/<name>.test.js or .test.mjs
 * Returns the first path that exists on disk, or null.
 * @param {string} filePath  - absolute source path
 * @param {string} cwd       - project root
 * @returns {string|null}
 */
function resolveTestFile(filePath, cwd) {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath).replace(/\.[cm]?js$/, '');

  const candidates = [
    path.join(dir, `${name}.test.js`),
    path.join(dir, `${name}.test.mjs`),
    path.join(cwd, 'tests', `${name}.test.js`),
    path.join(cwd, 'tests', `${name}.test.mjs`),
    path.join(dir, '__tests__', `${name}.test.js`),
    path.join(dir, '__tests__', `${name}.test.mjs`),
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch {
      // not found — try next
    }
  }
  return null;
}

/**
 * Spawn `node --test <testFile>` and return the exit code.
 * Returns 'TIMEOUT' on timeout, 'SPAWN_ERROR' on ENOENT/throw.
 * @param {string} testFile
 * @param {Function} spawnImpl
 * @returns {Promise<number|'TIMEOUT'|'SPAWN_ERROR'>}
 */
function runNodeTest(testFile, spawnImpl) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let child;
    try {
      // Strip NODE_TEST_CONTEXT so the child runs as a top-level test process
      // and propagates exit codes normally (1 on failing test, 0 on green).
      // Without this, when tdd-guard.test.mjs is itself run under `node --test`,
      // the child inherits NODE_TEST_CONTEXT=child-v8 and behaves as a test
      // worker — suppressing exit-code propagation (always exits 0).
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      // Use process.execPath so the correct node binary is found regardless of PATH
      child = spawnImpl(process.execPath, ['--test', testFile], { stdio: 'ignore', env: childEnv });
    } catch {
      // ENOENT or similar — fail-open
      return finish('SPAWN_ERROR');
    }

    const timer = setTimeout(() => {
      try { child.kill && child.kill(); } catch { /* ignore kill errors */ }
      finish('TIMEOUT');
    }, 2000);

    child.on('close', (code) => {
      clearTimeout(timer);
      finish(typeof code === 'number' ? code : 1);
    });

    child.on('error', () => {
      clearTimeout(timer);
      finish('SPAWN_ERROR');
    });
  });
}

/**
 * Run the TDD guard check against the given PreToolUse payload.
 *
 * @param {unknown} payload  - Parsed stdin JSON payload from Claude Code
 * @param {object}  env      - Environment variables (defaults to process.env)
 * @param {Function|null} _spawnImpl - Optional spawn override for testing timeout/ENOENT paths
 * @returns {Promise<GuardResult>}
 */
async function runGuard(payload, env = process.env, _spawnImpl = null) {
  // (a) Bypass first — checked before any payload inspection
  if (env.TDD_GUARD_BYPASS === '1') {
    return { exitCode: 0, stderr: '' };
  }

  // (b) Defensive payload extraction — fail-open on missing/invalid payload
  if (!payload || typeof payload !== 'object') {
    return { exitCode: 0, stderr: '' };
  }
  const toolInput = payload.tool_input;
  if (!toolInput || typeof toolInput !== 'object') {
    return { exitCode: 0, stderr: '' };
  }
  const filePath = toolInput.file_path || toolInput.path;
  const cwd = payload.cwd;
  if (!filePath || typeof filePath !== 'string' || !cwd || typeof cwd !== 'string') {
    return { exitCode: 0, stderr: '' };
  }

  // (c) Test-file exemption — always allow writes to test files
  if (isTestFile(filePath)) {
    return { exitCode: 0, stderr: '' };
  }

  // (d) Source-file detection — only intercept guarded dirs
  if (!isGuardedSourceFile(filePath, cwd)) {
    return { exitCode: 0, stderr: '' };
  }

  // (e) .tddguardignore glob match (v1: exact relative-path equality)
  if (isIgnored(filePath, cwd)) {
    return { exitCode: 0, stderr: '' };
  }

  // (f) Test-file resolution — deterministic order, first match wins
  const testFile = resolveTestFile(filePath, cwd);
  if (!testFile) {
    const msg = [
      `TDD Guard: no test file found for ${path.relative(cwd, filePath)}.`,
      'Write a failing test first, then re-attempt this edit.',
      '(v1 note: any failing test in the resolved test file counts — hook cannot verify the test is semantically about this module.)',
    ].join(' ');
    return { exitCode: 2, stderr: msg };
  }

  // (g) Run the test file
  const spawnImpl = _spawnImpl || spawn;
  const exitResult = await runNodeTest(testFile, spawnImpl);

  // Fail-open on timeout or spawn error
  if (exitResult === 'TIMEOUT' || exitResult === 'SPAWN_ERROR') {
    const warn = exitResult === 'TIMEOUT'
      ? 'TDD Guard: test runner timed out — failing open (allowing write).'
      : 'TDD Guard: could not spawn node (ENOENT?) — failing open (allowing write).';
    return { exitCode: 0, stderr: warn };
  }

  if (exitResult === 0) {
    // All tests green (or no executing tests) — block
    const msg = [
      `TDD Guard: test file ${path.relative(cwd, testFile)} has no failing tests (exit 0).`,
      'Ensure at least one test is failing (red bar) before writing source.',
      '(v1 note: this hook checks any failing test in the resolved test file; v1 cannot semantically verify the failing test is *about* the target module.)',
    ].join(' ');
    return { exitCode: 2, stderr: msg };
  }

  // Non-zero exit ⇒ failing test exists ⇒ allow
  return { exitCode: 0, stderr: '' };
}

module.exports = { runGuard };

// ---------------------------------------------------------------------------
// CLI bootstrap — only when invoked directly (not when require()'d by tests)
// ---------------------------------------------------------------------------
if (require.main === module) {
  let inputData = '';

  const timer = setTimeout(() => {
    runGuard(tryParse(inputData), process.env)
      .then(handleResult)
      .catch(() => process.exit(0));
  }, STDIN_TIMEOUT_LONG);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => { inputData += line + '\n'; });
  rl.on('close', () => {
    clearTimeout(timer);
    runGuard(tryParse(inputData), process.env)
      .then(handleResult)
      .catch(() => process.exit(0));
  });

  function tryParse(raw) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }

  function handleResult(result) {
    if (result.exitCode === 2) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.stderr,
          },
        }) + '\n'
      );
      console.error(result.stderr);
      process.exit(2);
    } else {
      process.exit(0);
    }
  }
}
