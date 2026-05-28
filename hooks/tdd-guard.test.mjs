/**
 * tdd-guard.test.mjs — Failing tests for hooks/tdd-guard.js (TDD Phase 1 red bar)
 *
 * Tests call runGuard(payload, env, _spawnImpl) directly — the exported function
 * is the unit under test, not the CLI bootstrap.
 *
 * Design decisions:
 * - _spawnImpl injection: runGuard accepts an optional third arg for the spawn
 *   implementation. For timeout/ENOENT tests (cases 9, 11) we inject a fake
 *   that either hangs indefinitely or throws ENOENT. This keeps tests fast and
 *   deterministic without OS-level process spawning. The injection point is
 *   an explicit third arg (not an env var) to keep the production path clean.
 * - Filesystem isolation: each test that exercises filesystem-dependent behaviour
 *   creates its own tmpdir via os.tmpdir() + mkdtemp and cleans up afterward.
 * - Block cases (1, 2, 3) fail against the stub because the stub returns exitCode 0
 *   but the tests assert exitCode === 2. Allow cases (4-11) pass against the stub
 *   because the stub returns 0 and those tests assert exitCode === 0.
 *   The three failing block cases establish the TDD red bar.
 */

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

// Load the stub via CommonJS require (hook is 'use strict' CJS)
const require = createRequire(import.meta.url);
const { runGuard } = require('./tdd-guard.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Write payload targeting the given absolute file path. */
function writePayload(filePath, cwd) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath },
    cwd: cwd ?? path.dirname(filePath),
  };
}

/** Create a temp dir with the given relative files populated with given content. */
async function makeTempProject(files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tdd-guard-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

/** Remove a temp dir created by makeTempProject. */
async function removeTempProject(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test case (1): blocks Write when no test file exists for target
// ---------------------------------------------------------------------------
test('(1) blocks Write when no test file exists for target source file', async () => {
  const dir = await makeTempProject({
    // Target source file exists but no adjacent test file
    'hooks/foo.js': '// source',
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'foo.js'), dir);
    const result = await runGuard(payload, {});
    // Must block (exitCode 2) — stub returns 0 so this assertion will FAIL against stub
    assert.equal(result.exitCode, 2, 'should block when no test file exists');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (2): blocks Write when test file exists but all tests pass (green)
// ---------------------------------------------------------------------------
test('(2) blocks Write when test file exists but all tests pass (green)', async () => {
  const dir = await makeTempProject({
    'hooks/bar.js': '// source',
    // A test file where all tests pass — node --test will exit 0
    'hooks/bar.test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passing test', () => { assert.ok(true); });
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'bar.js'), dir);
    const result = await runGuard(payload, {});
    // Must block (exitCode 2) — stub returns 0 so this assertion will FAIL against stub
    assert.equal(result.exitCode, 2, 'should block when all tests are green');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (3): blocks Write when test file exists but contains zero executing tests
// ---------------------------------------------------------------------------
test('(3) blocks Write when test file contains only skipped tests', async () => {
  const dir = await makeTempProject({
    'hooks/baz.js': '// source',
    // Test file with only .skip — node --test exits 0 with no executing tests
    'hooks/baz.test.mjs': `
import { test } from 'node:test';
test.skip('skipped test', () => {});
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'baz.js'), dir);
    const result = await runGuard(payload, {});
    // Must block (exitCode 2) — stub returns 0 so this assertion will FAIL against stub
    assert.equal(result.exitCode, 2, 'should block when test file has no executing tests');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (4): allows Write when test file exists and at least one test fails (red)
// ---------------------------------------------------------------------------
test('(4) allows Write when test file has at least one failing test (red bar confirmed)', async () => {
  const dir = await makeTempProject({
    'hooks/qux.js': '// source',
    // Test file with a failing assertion — node --test exits non-zero
    'hooks/qux.test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('failing test', () => { assert.equal(1, 2, 'intentionally failing'); });
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'qux.js'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0)
    assert.equal(result.exitCode, 0, 'should allow when a failing test confirms red bar');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (5): allows Write when test file imports not-yet-existing source module
// ---------------------------------------------------------------------------
test('(5) allows Write when test file imports not-yet-existing source module (module-not-found = red)', async () => {
  const dir = await makeTempProject({
    // Source file does NOT exist yet (first write scenario)
    // Test file tries to import the not-yet-existing source — node --test exits non-zero
    'hooks/newmod.test.mjs': `
import './newmod.js'; // will throw MODULE_NOT_FOUND
import { test } from 'node:test';
test('placeholder', () => {});
`,
  });
  try {
    // Payload targets the not-yet-existing source file
    const payload = writePayload(path.join(dir, 'hooks', 'newmod.js'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0) — module-not-found exit non-zero counts as red bar
    assert.equal(result.exitCode, 0, 'should allow when test imports a not-yet-existing module');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (6): allows Write on test files themselves
// ---------------------------------------------------------------------------
test('(6) allows Write on test files themselves (*.test.mjs)', async () => {
  const dir = await makeTempProject({
    'hooks/somehook.js': '// source',
  });
  try {
    // Target is a test file — should be exempt
    const payload = writePayload(path.join(dir, 'hooks', 'somehook.test.mjs'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0)
    assert.equal(result.exitCode, 0, 'should allow writes to test files');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (7): allows Write when TDD_GUARD_BYPASS=1 (checked before stdin parsing)
// ---------------------------------------------------------------------------
test('(7) allows Write when TDD_GUARD_BYPASS=1, even with malformed payload', async () => {
  // Pass null as payload — would fail parsing/extraction in a strict implementation.
  // Bypass must be evaluated BEFORE payload is inspected.
  const result = await runGuard(null, { TDD_GUARD_BYPASS: '1' });
  // Must allow (exitCode 0)
  assert.equal(result.exitCode, 0, 'bypass=1 should allow even with null payload');
});

// ---------------------------------------------------------------------------
// Test case (8): allows Write when path matches a .tddguardignore glob
// ---------------------------------------------------------------------------
test('(8) allows Write when path matches a .tddguardignore glob', async () => {
  const dir = await makeTempProject({
    // Source file in hooks/ but no adjacent test
    'hooks/legacy.js': '// legacy source with no tests',
    // .tddguardignore lists the pattern
    '.tddguardignore': 'hooks/legacy.js\n',
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'legacy.js'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0) — path is ignored
    assert.equal(result.exitCode, 0, 'should allow write for .tddguardignore-matched path');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (9): fail-open when node --test times out
// ---------------------------------------------------------------------------
test('(9) fail-open (allow) when node --test times out', async () => {
  const dir = await makeTempProject({
    'hooks/slow.js': '// source',
    'hooks/slow.test.mjs': 'import { test } from "node:test"; test("x", () => {});',
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'slow.js'), dir);

    // Inject a spawn implementation that simulates a timeout:
    // returns an object whose promise never resolves (until killed).
    // The hook must detect timeout and fail-open.
    const timeoutSpawn = () => {
      // Returns a fake child process that never emits 'close'
      const fakeChild = {
        stdout: null,
        stderr: null,
        on: () => fakeChild,
        kill: () => {},
        // A promise that represents the "never-resolving" test run
        _exitPromise: new Promise(() => {}), // never resolves
      };
      return fakeChild;
    };

    const result = await runGuard(payload, {}, timeoutSpawn);
    // Must fail-open (exitCode 0) on timeout
    assert.equal(result.exitCode, 0, 'should fail-open when test runner times out');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (10): fail-open on hook stdin parse error (malformed/missing payload)
// ---------------------------------------------------------------------------
test('(10) fail-open when payload is malformed (null)', async () => {
  // Passing null simulates a stdin parse error where payload extraction fails.
  // The hook must fail-open.
  const result = await runGuard(null, {});
  // Must fail-open (exitCode 0)
  assert.equal(result.exitCode, 0, 'should fail-open on null/malformed payload');
});

test('(10b) fail-open when payload has no tool_input', async () => {
  const result = await runGuard({}, {});
  // Must fail-open or allow (exitCode 0)
  assert.equal(result.exitCode, 0, 'should fail-open when tool_input is missing');
});

// ---------------------------------------------------------------------------
// Test case (11): fail-open when spawn throws ENOENT (node not on PATH)
// ---------------------------------------------------------------------------
test('(11) fail-open when spawn throws ENOENT (node not on PATH)', async () => {
  const dir = await makeTempProject({
    'hooks/node-missing.js': '// source',
    'hooks/node-missing.test.mjs': 'import { test } from "node:test"; test("x", () => {});',
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'node-missing.js'), dir);

    // Inject a spawn implementation that throws ENOENT synchronously
    const enoentSpawn = () => {
      const err = new Error('spawn node ENOENT');
      err.code = 'ENOENT';
      throw err;
    };

    const result = await runGuard(payload, {}, enoentSpawn);
    // Must fail-open (exitCode 0) when spawn fails with ENOENT
    assert.equal(result.exitCode, 0, 'should fail-open when spawn throws ENOENT');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (12): tddGuard: false bypasses guard — source file with no test
// ---------------------------------------------------------------------------
test('(12) tddGuard: false bypasses guard — hooks/ source file, no adjacent test', async () => {
  const dir = await makeTempProject({
    'hooks/some-feature.js': '// source — no test file',
    '.pipeline/project.json': JSON.stringify({ tddGuard: false }),
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'some-feature.js'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0) — tddGuard: false bypasses all guard logic.
    // WAVE 1: fails against unmodified hook (which returns exitCode 2, no test found).
    assert.equal(result.exitCode, 0, 'tddGuard: false must bypass guard regardless of test-file presence');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (13): tddGuard: false bypasses guard even when test exists but is green
// ---------------------------------------------------------------------------
test('(13) tddGuard: false bypasses guard — test file exists but all tests pass (green)', async () => {
  const dir = await makeTempProject({
    'hooks/greentested.js': '// source',
    'hooks/greentested.test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passing', () => { assert.ok(true); });
`,
    '.pipeline/project.json': JSON.stringify({ tddGuard: false }),
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'greentested.js'), dir);
    const result = await runGuard(payload, {});
    // Must allow (exitCode 0) — tddGuard: false skips guard before test resolution.
    // WAVE 1: fails against unmodified hook (which returns exitCode 2, all tests green → block).
    assert.equal(result.exitCode, 0, 'tddGuard: false must bypass guard even with an all-green test file');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (14): tddGuard: true keeps guard enforced (positive control / regression)
// ---------------------------------------------------------------------------
test('(14) tddGuard: true keeps guard enforced — no test file → block', async () => {
  const dir = await makeTempProject({
    'hooks/guarded.js': '// source — tddGuard explicitly true',
    '.pipeline/project.json': JSON.stringify({ tddGuard: true }),
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'guarded.js'), dir);
    const result = await runGuard(payload, {});
    // Must block (exitCode 2) — tddGuard: true means guard is active.
    assert.equal(result.exitCode, 2, 'tddGuard: true must keep guard enforced');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (15): resolves HYPHEN-form test files (<name>-test.{js,mjs}), not only dot-form
// Regression for the chronic resolveTestFile gap (TODO eb424159): resolveTestFile only
// checked <name>.test.{js,mjs}, never <name>-test.{js,mjs}, despite CLAUDE.md documenting
// the hyphen form as valid and isTestFile() recognizing it. A source file whose only test
// was hyphen-named got "no test file found" → forced a .tddguardignore entry that fully
// disabled TDD for that file. ~15 such band-aids accumulated in .tddguardignore.
// ---------------------------------------------------------------------------
test('(15) resolves adjacent hyphen test (<name>-test.mjs) and allows when it is red', async () => {
  const dir = await makeTempProject({
    'hooks/widget.js': '// source',
    // Hyphen-named test with a failing assertion → node --test exits non-zero (red bar)
    'hooks/widget-test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('failing', () => { assert.equal(1, 2, 'intentionally failing'); });
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'widget.js'), dir);
    const result = await runGuard(payload, {});
    // Must ALLOW (exitCode 0): the hyphen-named test exists and is red.
    // Against the dot-only resolveTestFile this returns 2 ("no test file found") → FAILS (red bar).
    assert.equal(result.exitCode, 0, 'should resolve <name>-test.mjs and allow when it is red');
  } finally {
    await removeTempProject(dir);
  }
});

test('(16) resolves adjacent hyphen test in .js form (<name>-test.js)', async () => {
  const dir = await makeTempProject({
    'hooks/gadget.js': '// source',
    // CommonJS hyphen test that throws → exits non-zero (red bar)
    'hooks/gadget-test.js': `
const assert = require('node:assert');
assert.equal(1, 2, 'intentionally failing');
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'gadget.js'), dir);
    const result = await runGuard(payload, {});
    assert.equal(result.exitCode, 0, 'should resolve <name>-test.js and allow when it is red');
  } finally {
    await removeTempProject(dir);
  }
});

// ---------------------------------------------------------------------------
// Test case (17): resolves DESCRIPTOR-form tests (<name>-<descriptor>-test.{js,mjs}
// or <name>-<descriptor>.test.{js,mjs}) when multiple candidates exist, and allows
// when ANY matching test is red.
// Regression for the .tddguardignore band-aid added by Phase 3 Task 13 for
// mcp/lib/orchestrator/implement-stage.mjs: the source had TWO test files —
// implement-stage.test.mjs (dot form, green AC-4/5/6/7) AND
// implement-stage-inject-test.mjs (descriptor form, with the failing AC-13 red bar).
// resolveTestFile found the dot form first, ran it green, and blocked the edit;
// the descriptor form was never considered as a candidate. Result: a
// .tddguardignore entry for implement-stage.mjs — the same anti-pattern that
// commit dbad50a6 retired. The proper fix is to recognize descriptor-form test
// names AND allow when ANY of the candidates has a failing test.
// ---------------------------------------------------------------------------
test('(17) allows Write when multiple matching tests exist and ANY has a failing test (descriptor-form)', async () => {
  const dir = await makeTempProject({
    'hooks/widget.js': '// source',
    // Dot-form sibling test — PASSING (green).
    'hooks/widget.test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passing', () => { assert.ok(true); });
`,
    // Descriptor-hyphen sibling test — FAILING (red bar exists among the candidate set).
    'hooks/widget-inject-test.mjs': `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('failing', () => { assert.equal(1, 2, 'intentionally failing'); });
`,
  });
  try {
    const payload = writePayload(path.join(dir, 'hooks', 'widget.js'), dir);
    const result = await runGuard(payload, {});
    // Must ALLOW (exit 0): the descriptor-form widget-inject-test.mjs is red, so a paired
    // failing test exists for widget.js even though widget.test.mjs is green.
    // Currently this blocks (exit 2) because resolveTestFile finds only widget.test.mjs (green)
    // — that block is the gap the .tddguardignore band-aid worked around.
    assert.equal(
      result.exitCode,
      0,
      'should recognize descriptor-form tests (<name>-<descriptor>-test.mjs) and allow when ANY matching test is red',
    );
  } finally {
    await removeTempProject(dir);
  }
});
