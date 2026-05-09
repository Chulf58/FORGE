// Tests for scripts/verify-output.mjs
// Run: node --test scripts/verify-output.test.mjs
//
// TDD red-bar tests (Tasks 1 & 2): written before the helper exists so they
// fail until Task 3 implements the script. Task 7 confirms all tests pass.
//
// Test groups:
//   1. Exit 0 — file exists with mtime >= since (fresh write)
//   2. Exit 1 — file absent
//   3. Exit 2 — file exists but mtime < since (stale)
//   4. Regression: stale pre-existing verdict file not accepted (756bd820 AC-4)
//   5. stdout is JSON on every exit path

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the script path using fileURLToPath so Windows drive letters are
// handled correctly (file:///C:/... → C:\...).
const SCRIPT = fileURLToPath(new URL('./verify-output.mjs', import.meta.url));

/**
 * Run the script with --file and --since arguments.
 * Uses process.execPath so the correct node binary is always found regardless
 * of whether `node` is on PATH in the current shell environment.
 *
 * @param {string} filePath
 * @param {number} sinceMs
 * @returns {{ exitCode: number | null, stdout: string, parsed: Record<string,unknown> | null }}
 */
function run(filePath, sinceMs) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, `--file=${filePath}`, `--since=${sinceMs}`],
    { encoding: 'utf8' },
  );
  let parsed = null;
  const rawOut = result.stdout ?? '';
  try {
    parsed = JSON.parse(rawOut.trim());
  } catch {
    // will be caught by individual test assertions
  }
  return { exitCode: result.status, stdout: rawOut.trim(), parsed };
}

// ---------------------------------------------------------------------------
// Task 1 tests — Bug 2 (756bd820) mtime rejection + gitignored-file detection
// ---------------------------------------------------------------------------

test('exit 0 when file exists with mtime >= since (fresh write detected)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const filePath = path.join(dir, 'output.md');
  const before = Date.now();
  fs.writeFileSync(filePath, 'content');
  // since = time before write; file mtime will be >= since
  const { exitCode, parsed } = run(filePath, before);
  fs.rmSync(dir, { recursive: true });
  assert.equal(exitCode, 0, 'should exit 0 for fresh file');
  assert.equal(parsed?.ok, true, 'ok should be true');
  assert.ok(typeof parsed?.reason === 'string', 'reason should be a string');
});

test('exit 2 when file exists but mtime < since (stale file — gitignored write undetected scenario)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const filePath = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(filePath, 'old content');
  // since = well in the future — file mtime will be < since
  const since = Date.now() + 60_000;
  const { exitCode, parsed } = run(filePath, since);
  fs.rmSync(dir, { recursive: true });
  assert.equal(exitCode, 2, 'should exit 2 for stale file');
  assert.equal(parsed?.ok, false, 'ok should be false');
  assert.ok(typeof parsed?.reason === 'string', 'reason should be a string');
});

test('exit 1 when file is absent', () => {
  const filePath = path.join(os.tmpdir(), `vout-absent-${Date.now()}.md`);
  const { exitCode, parsed } = run(filePath, Date.now());
  assert.equal(exitCode, 1, 'should exit 1 for missing file');
  assert.equal(parsed?.ok, false, 'ok should be false');
  assert.ok(typeof parsed?.reason === 'string', 'reason should be a string');
});

test('stdout is valid JSON on exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const filePath = path.join(dir, 'output.md');
  const before = Date.now();
  fs.writeFileSync(filePath, 'content');
  const { exitCode, stdout } = run(filePath, before);
  fs.rmSync(dir, { recursive: true });
  assert.equal(exitCode, 0);
  assert.doesNotThrow(() => JSON.parse(stdout), 'stdout must be valid JSON on exit 0');
});

test('stdout is valid JSON on exit 1', () => {
  const filePath = path.join(os.tmpdir(), `vout-missing-${Date.now()}.md`);
  const { exitCode, stdout } = run(filePath, Date.now());
  assert.equal(exitCode, 1);
  assert.doesNotThrow(() => JSON.parse(stdout), 'stdout must be valid JSON on exit 1');
});

test('stdout is valid JSON on exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const filePath = path.join(dir, 'stale.md');
  fs.writeFileSync(filePath, 'old');
  const since = Date.now() + 60_000;
  const { exitCode, stdout } = run(filePath, since);
  fs.rmSync(dir, { recursive: true });
  assert.equal(exitCode, 2);
  assert.doesNotThrow(() => JSON.parse(stdout), 'stdout must be valid JSON on exit 2');
});

// ---------------------------------------------------------------------------
// Task 2 test — 756bd820 AC-4 regression: stale pre-existing verdict file
// Simulates the scenario where a reviewer verdict file exists from a prior run
// (mtime before agentStartedAt). The worker must reject this phantom verdict.
// ---------------------------------------------------------------------------

test('AC-4 regression: stale verdict file (mtime before agentStartedAt) → exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const verdictFile = path.join(dir, 'reviewer-safety.md');

  // Write the verdict file to represent a stale file from a prior run.
  fs.writeFileSync(verdictFile, '[reviewer-verdict] APPROVED\n\nAll checks pass.');

  // agentStartedAt is set to "now + 1 s" which is after the file was written.
  // On any filesystem with sub-second or better mtime, mtime < agentStartedAt.
  // 1000 ms margin makes the test reliable across platforms including Windows NTFS.
  const agentStartedAt = Date.now() + 1_000;

  const { exitCode, parsed } = run(verdictFile, agentStartedAt);
  fs.rmSync(dir, { recursive: true });

  assert.equal(exitCode, 2, 'stale verdict file must yield exit 2, not 0');
  assert.equal(parsed?.ok, false, 'ok must be false for stale verdict');
  assert.ok(
    typeof parsed?.reason === 'string' && (
      parsed.reason.toLowerCase().includes('stale') ||
      parsed.reason.toLowerCase().includes('mtime') ||
      parsed.reason.toLowerCase().includes('old')
    ),
    `reason should mention staleness, got: ${parsed?.reason}`,
  );
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('mtime === since is accepted (inclusive boundary)', () => {
  // Write the file, stat its mtime, then verify with since = exact mtime ms.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vout-'));
  const filePath = path.join(dir, 'boundary.md');
  fs.writeFileSync(filePath, 'boundary');
  const { mtimeMs } = fs.statSync(filePath);
  const { exitCode, parsed } = run(filePath, mtimeMs);
  fs.rmSync(dir, { recursive: true });
  assert.equal(exitCode, 0, 'mtime === since should pass (inclusive)');
  assert.equal(parsed?.ok, true);
});
