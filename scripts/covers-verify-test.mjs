#!/usr/bin/env node
// Tests for scripts/covers-verify.mjs — post-handoff coverage verifier.
//
// AC-3 assertions:
//   (a) parser→map→lookup flow — verifier resolves a touched src file's covering
//       test via parser+map and triggers `node --test <testFile>` reporting PASS/FAIL
//       (sub-assertions: parser sees the test file's @covers, map keys match,
//       lookup returns the test path)
//   (b) a touched src file that exists in no test's @covers declarations emits
//       a [covers-gap] line on stderr (gap = file not in map)
//   (c) a touched src file with a covering test that fails causes the verifier
//       to exit non-zero
//   (d) batched subprocess isolation — multiple test files in one `node --test <a> <b>`
//       invocation succeed/fail per file independently, with stdout/stderr separated
//       from gap reporting
//
// Run: node --test scripts/covers-verify-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// @covers scripts/covers-verify.mjs
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERIFIER = resolve(__dirname, 'covers-verify.mjs');

function makeTmpProject() {
  const root = mkdtempSync(join(tmpdir(), 'covers-verify-test-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'context'), { recursive: true });
  return root;
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function makeHandoff(touchedFiles) {
  const fileList = touchedFiles.join('\n');
  return [
    '## Files modified',
    '',
    '```',
    fileList,
    '```',
    '',
    '## Summary',
    '',
    'Test handoff.',
  ].join('\n');
}

function runVerifier(root, args = []) {
  const result = spawnSync(
    process.execPath,
    [VERIFIER, `--handoff=${join(root, 'docs/context/handoff.md')}`, `--root=${root}`, ...args],
    { encoding: 'utf8', cwd: root },
  );
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Helper: assert the verifier started (i.e., covers-verify.mjs was found and loaded)
// If the module is missing, stderr contains "Cannot find module" — we assert it is absent
// so that tests fail genuinely until the implementation exists.
function assertVerifierLoaded(result, label) {
  assert.ok(
    !result.stderr.includes('Cannot find module') && !result.stderr.includes('MODULE_NOT_FOUND'),
    `${label} — covers-verify.mjs must exist and load without MODULE_NOT_FOUND; stderr=${result.stderr}`,
  );
}

// ─── (a) parser→map→lookup flow ─────────────────────────────────────────────

test('(a) verifier resolves covering test for a touched src file and reports PASS', () => {
  const root = makeTmpProject();
  try {
    // A passing test file that covers scripts/target-src.mjs
    writeFile(root, 'scripts/target-src-test.mjs', [
      '// @covers scripts/target-src.mjs',
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("target-src passes", () => { assert.ok(true); });',
    ].join('\n'));

    // Handoff references the source file
    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/target-src.mjs']));

    const result = runVerifier(root);

    // Must have loaded (not MODULE_NOT_FOUND)
    assertVerifierLoaded(result, '(a)');

    // Exit code 0 (covering test passed)
    assert.equal(result.code, 0, `verifier should exit 0 when covering test passes; stderr=${result.stderr}`);

    // Output references the test file path (verifier ran it)
    assert.ok(
      result.stdout.includes('target-src-test') || result.stderr.includes('target-src-test'),
      'verifier output should reference the test file it ran',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(a) sub-assertion: parser reads @covers tag and map key matches canonical forward-slash path', async () => {
  // Import parser and map builder directly to verify the chain
  const { parseCovers } = await import('./covers-parser.mjs');
  const { buildCoversMap } = await import('./covers-map.mjs');

  const root = makeTmpProject();
  try {
    writeFile(root, 'scripts/chain-src-test.mjs', [
      '// @covers scripts/chain-src.mjs',
      'import { test } from "node:test";',
      'test("chain", () => {});',
    ].join('\n'));

    // Parser sub-assertion
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(join(root, 'scripts/chain-src-test.mjs'), 'utf8');
    const parsed = parseCovers(content);
    assert.deepEqual(parsed.covered, ['scripts/chain-src.mjs'], 'parser sees the @covers tag');

    // Map sub-assertion
    const map = await buildCoversMap(root);
    assert.ok(
      Object.prototype.hasOwnProperty.call(map, 'scripts/chain-src.mjs'),
      'map key is canonical forward-slash path',
    );

    // Lookup sub-assertion: the test file path appears in the map value
    const testPaths = map['scripts/chain-src.mjs'].map(p => p.replace(/\\/g, '/'));
    assert.ok(
      testPaths.some(p => p.endsWith('scripts/chain-src-test.mjs')),
      'lookup returns the test file path',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (b) covers-gap: touched file not in any @covers declaration ─────────────

test('(b) touched src file with no @covers entry emits [covers-gap] on stderr', () => {
  const root = makeTmpProject();
  try {
    // Test file covers a DIFFERENT source file — not the one touched
    writeFile(root, 'scripts/other-test.mjs', [
      '// @covers scripts/other-src.mjs',
      'import { test } from "node:test";',
      'test("other", () => {});',
    ].join('\n'));

    // Handoff references a src file that no test covers
    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/uncovered-src.mjs']));

    const result = runVerifier(root);

    // Must have loaded (not MODULE_NOT_FOUND)
    assertVerifierLoaded(result, '(b)');

    assert.ok(
      result.stderr.includes('[covers-gap]'),
      `stderr should contain [covers-gap]; got: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes('scripts/uncovered-src.mjs'),
      `[covers-gap] line should name the uncovered file; got: ${result.stderr}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (c) failing covering test causes exit non-zero ──────────────────────────

test('(c) touched src file with a failing covering test causes verifier to exit non-zero', () => {
  const root = makeTmpProject();
  try {
    // A failing test file that covers scripts/broken-src.mjs
    writeFile(root, 'scripts/broken-src-test.mjs', [
      '// @covers scripts/broken-src.mjs',
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("broken-src fails", () => { assert.fail("intentional failure"); });',
    ].join('\n'));

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/broken-src.mjs']));

    const result = runVerifier(root);

    // Must have loaded — MODULE_NOT_FOUND must not be in stderr
    assertVerifierLoaded(result, '(c)');

    assert.notEqual(result.code, 0, 'verifier should exit non-zero when covering test fails');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (d) batched subprocess isolation ────────────────────────────────────────

test('(d) multiple test files batched in one node --test invocation: pass/fail per file independently', () => {
  const root = makeTmpProject();
  try {
    // Passing test covering scripts/src-a.mjs
    writeFile(root, 'scripts/src-a-test.mjs', [
      '// @covers scripts/src-a.mjs',
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("src-a passes", () => { assert.ok(true); });',
    ].join('\n'));

    // Failing test covering scripts/src-b.mjs
    writeFile(root, 'scripts/src-b-test.mjs', [
      '// @covers scripts/src-b.mjs',
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("src-b fails", () => { assert.fail("intentional"); });',
    ].join('\n'));

    // Handoff touches both source files
    writeFile(root, 'docs/context/handoff.md', makeHandoff([
      'scripts/src-a.mjs',
      'scripts/src-b.mjs',
    ]));

    const result = runVerifier(root);

    // Must have loaded — MODULE_NOT_FOUND must not be in stderr
    assertVerifierLoaded(result, '(d)');

    // Overall exit code must be non-zero (one test failed)
    assert.notEqual(result.code, 0, 'verifier exits non-zero when any batched test fails');

    // Gap reporting (stderr) must not be mixed with test runner output —
    // [covers-gap] lines only appear when a file is NOT in the map, not for failing tests.
    // Since both files ARE in the map, no [covers-gap] should appear.
    assert.ok(
      !result.stderr.includes('[covers-gap]'),
      `stderr must not emit [covers-gap] when files are covered; stderr=${result.stderr}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
