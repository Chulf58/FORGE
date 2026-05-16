#!/usr/bin/env node
// @covers scripts/splice-changelog.mjs
//
// Tests for scripts/splice-changelog.mjs
//
// Test cases:
//   T1 — Single fragment prepends correctly after `# Changelog` header
//   T2 — Two fragments both prepend in newest-first order
//   T3 — Re-run splice on already-spliced CHANGELOG does not duplicate entries
//   T4 — Missing docs/CHANGELOG.md → created with fragment content
//   T5 — Missing fragment directory → graceful skip, no error
//   T6 — Malicious runId (e.g. `../malicious`) → skipped, not spliced
//   T7 — fs.renameSync failure → exit 0, stderr contains splice rename failed, CHANGELOG unchanged, fragment preserved
//
// Run: node --test scripts/splice-changelog-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_PATH = resolve(__dirname, 'splice-changelog.mjs');

/**
 * Create a temp project directory with the standard layout.
 */
function makeProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'splice-test-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
  return tmp;
}

/**
 * Write a CHANGELOG fragment for a given runId.
 * @param {string} projectDir
 * @param {string} runId
 * @param {string} content
 * @param {number} [mtimeOffset=0] - milliseconds to offset mtime (negative = older)
 */
function writeFragment(projectDir, runId, content, mtimeOffset = 0) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const fragPath = join(runDir, 'CHANGELOG-fragment.md');
  writeFileSync(fragPath, content, 'utf8');
  if (mtimeOffset !== 0) {
    const mtime = new Date(Date.now() + mtimeOffset);
    utimesSync(fragPath, mtime, mtime);
  }
  return fragPath;
}

/**
 * Run the splice script in a subprocess and return { stdout, stderr, exitCode }.
 */
function runSplice(projectDir) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, projectDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

// ---------------------------------------------------------------------------
// T1 — Single fragment prepends correctly after `# Changelog` header
// ---------------------------------------------------------------------------
test('T1 — single fragment prepends after # Changelog header', () => {
  const tmp = makeProject();
  try {
    const existing = '# Changelog\n\n## [2026-01-01] Old Entry\n\n- old bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), existing, 'utf8');

    const fragContent = '## [2026-05-16] New Feature\n\n- new bullet';
    writeFragment(tmp, 'r-abc123', fragContent);

    const { exitCode, stderr } = runSplice(tmp);
    assert.equal(exitCode, 0, `expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    const result = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    // Fragment should appear before old entry
    const newIdx = result.indexOf('## [2026-05-16] New Feature');
    const oldIdx = result.indexOf('## [2026-01-01] Old Entry');
    assert.ok(newIdx !== -1, 'new entry should be in CHANGELOG');
    assert.ok(oldIdx !== -1, 'old entry should still be in CHANGELOG');
    assert.ok(newIdx < oldIdx, 'new entry should appear before old entry');

    // Fragment should appear immediately after the # Changelog header line
    const headerIdx = result.indexOf('# Changelog\n');
    assert.ok(headerIdx !== -1, '# Changelog header should be present');
    assert.ok(newIdx > headerIdx, 'new entry should come after the header');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T2 — Two fragments both prepend in newest-first order
// ---------------------------------------------------------------------------
test('T2 — two fragments prepend newest-first', () => {
  const tmp = makeProject();
  try {
    const existing = '# Changelog\n\n## [2026-01-01] Old Entry\n\n- old bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), existing, 'utf8');

    // r-older has an older mtime (10 seconds ago)
    const olderContent = '## [2026-05-15] Older Feature\n\n- older bullet';
    writeFragment(tmp, 'r-older11', olderContent, -10000);

    // r-newer has a newer mtime (now)
    const newerContent = '## [2026-05-16] Newer Feature\n\n- newer bullet';
    writeFragment(tmp, 'r-newer22', newerContent, 0);

    const { exitCode, stderr } = runSplice(tmp);
    assert.equal(exitCode, 0, `expected exit 0. stderr: ${stderr}`);

    const result = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    const newerIdx = result.indexOf('## [2026-05-16] Newer Feature');
    const olderIdx = result.indexOf('## [2026-05-15] Older Feature');
    assert.ok(newerIdx !== -1, 'newer entry should be in CHANGELOG');
    assert.ok(olderIdx !== -1, 'older entry should be in CHANGELOG');
    assert.ok(newerIdx < olderIdx, 'newer entry should appear before older entry (newest-first)');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T3 — Re-run splice on already-spliced CHANGELOG does not duplicate entries
// ---------------------------------------------------------------------------
test('T3 — idempotent: re-run does not duplicate entries', () => {
  const tmp = makeProject();
  try {
    const existing = '# Changelog\n\n## [2026-01-01] Old Entry\n\n- old bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), existing, 'utf8');

    const fragContent = '## [2026-05-16] Idempotent Feature\n\n- idempotent bullet';
    writeFragment(tmp, 'r-idem11', fragContent);

    // First run — fragment gets spliced and deleted
    const r1 = runSplice(tmp);
    assert.equal(r1.exitCode, 0, `first run exit 0. stderr: ${r1.stderr}`);

    // Re-write the fragment file to simulate re-run scenario
    writeFragment(tmp, 'r-idem11', fragContent);

    // Manually update changelog to match what would have been written (re-splicing same content)
    // Second run should detect content already present and skip
    const r2 = runSplice(tmp);
    assert.equal(r2.exitCode, 0, `second run exit 0. stderr: ${r2.stderr}`);

    const result = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    // Count occurrences of the unique fragment heading
    const occurrences = (result.match(/## \[2026-05-16\] Idempotent Feature/g) || []).length;
    assert.equal(occurrences, 1, `entry should appear exactly once, found ${occurrences}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T4 — Missing docs/CHANGELOG.md → created with fragment content
// ---------------------------------------------------------------------------
test('T4 — missing CHANGELOG is created with fragment content', () => {
  const tmp = makeProject();
  try {
    // No CHANGELOG.md
    const fragContent = '## [2026-05-16] Brand New Feature\n\n- brand new bullet';
    writeFragment(tmp, 'r-new123', fragContent);

    const { exitCode, stderr } = runSplice(tmp);
    assert.equal(exitCode, 0, `expected exit 0. stderr: ${stderr}`);

    const changelogPath = join(tmp, 'docs', 'CHANGELOG.md');
    assert.ok(existsSync(changelogPath), 'CHANGELOG.md should be created');
    const result = readFileSync(changelogPath, 'utf8');
    assert.ok(result.includes('## [2026-05-16] Brand New Feature'), 'fragment content should be in created CHANGELOG');
    assert.ok(result.includes('# Changelog'), '# Changelog header should be present');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T5 — Missing fragment directory → graceful skip, no error
// ---------------------------------------------------------------------------
test('T5 — missing fragment directory is a graceful skip', () => {
  const tmp = makeProject();
  try {
    // Remove the runs directory entirely
    rmSync(join(tmp, '.pipeline', 'runs'), { recursive: true, force: true });

    const existing = '# Changelog\n\n## [2026-01-01] Existing Entry\n\n- existing bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), existing, 'utf8');

    const { exitCode, stderr } = runSplice(tmp);
    assert.equal(exitCode, 0, `expected exit 0. stderr: ${stderr}`);

    // CHANGELOG should be unchanged
    const result = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    assert.equal(result, existing, 'CHANGELOG should be unchanged when fragment dir is missing');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T6 — Malicious runId (e.g. `../malicious`) → skipped, not spliced
// ---------------------------------------------------------------------------
test('T6 — malicious runId is skipped and not spliced', () => {
  const tmp = makeProject();
  try {
    const existing = '# Changelog\n\n## [2026-01-01] Safe Entry\n\n- safe bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), existing, 'utf8');

    // Create a directory with a malicious name that bypasses the regex check
    // The regex `^r-[a-zA-Z0-9]+$` would block `../malicious`, but we test
    // that any such invalid runId directory is skipped
    const maliciousDir = join(tmp, '.pipeline', 'runs', '..malicious');
    mkdirSync(maliciousDir, { recursive: true });
    writeFileSync(join(maliciousDir, 'CHANGELOG-fragment.md'), '## [2026-05-16] Malicious Entry\n\n- malicious bullet', 'utf8');

    // Also test a dotdot variant
    const dotdotDir = join(tmp, '.pipeline', 'runs', 'r-ok-then-..slash');
    // This won't match ^r-[a-zA-Z0-9]+$ because of the hyphen-then-dot
    // Actually, let's create one that fails regex more clearly
    mkdirSync(join(tmp, '.pipeline', 'runs', 'r-legit99'), { recursive: true });
    writeFileSync(
      join(tmp, '.pipeline', 'runs', 'r-legit99', 'CHANGELOG-fragment.md'),
      '## [2026-05-16] Legit Entry\n\n- legit bullet',
      'utf8',
    );

    const { exitCode, stderr } = runSplice(tmp);
    assert.equal(exitCode, 0, `expected exit 0. stderr: ${stderr}`);

    const result = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    assert.ok(!result.includes('Malicious Entry'), 'malicious entry should NOT be in CHANGELOG');
    assert.ok(result.includes('Legit Entry'), 'legit entry should be in CHANGELOG');

    // stderr should mention skipping the invalid runId
    assert.ok(
      stderr.includes('skipping invalid runId'),
      `stderr should mention skipping invalid runId. got: ${stderr}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T7 — fs.renameSync failure → exit 0, stderr contains splice rename failed,
//       CHANGELOG unchanged, fragment preserved
// ---------------------------------------------------------------------------
test('T7 — rename failure: exit 0, warning logged, CHANGELOG unchanged, fragment preserved', () => {
  const tmp = makeProject();
  // Write a thin wrapper script that patches fs.renameSync to throw, then
  // calls spliceChangelog. This is the only reliable cross-platform way to
  // simulate rename failure without filesystem tricks.
  const wrapperPath = join(tmp, 'splice-rename-fail-wrapper.mjs');
  // Build a file:// URL for the splice script (required for Windows ESM imports)
  const spliceScriptUrl = new URL('file://' + resolve(__dirname, 'splice-changelog.mjs').replace(/\\/g, '/')).href;
  writeFileSync(wrapperPath, `
import fs from 'node:fs';
import { spliceChangelog } from '${spliceScriptUrl}';

// Patch renameSync to throw on the first call
const orig = fs.renameSync.bind(fs);
let called = false;
fs.renameSync = (src, dst) => {
  if (!called) {
    called = true;
    throw new Error('EPERM: simulated rename failure');
  }
  return orig(src, dst);
};

spliceChangelog(${JSON.stringify(tmp)});
`, 'utf8');

  try {
    const originalContent = '# Changelog\n\n## [2026-01-01] Original Entry\n\n- original bullet\n';
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), originalContent, 'utf8');

    const fragContent = '## [2026-05-16] Rename-Fail Feature\n\n- rename-fail bullet';
    const fragPath = writeFragment(tmp, 'r-fail11', fragContent);

    const result = spawnSync(process.execPath, [wrapperPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitCode = result.status ?? 1;
    const stderr = result.stderr || '';

    assert.equal(exitCode, 0, `expected exit 0 on rename failure. stderr: ${stderr}`);
    assert.ok(
      stderr.includes('CHANGELOG splice rename failed'),
      `stderr should contain "CHANGELOG splice rename failed". got: ${stderr}`,
    );

    // Fragment should still exist (not deleted on failure)
    assert.ok(existsSync(fragPath), 'fragment should be preserved after rename failure');

    // CHANGELOG.md should be unchanged (still has original content)
    const afterContent = readFileSync(join(tmp, 'docs', 'CHANGELOG.md'), 'utf8');
    assert.equal(afterContent, originalContent, 'CHANGELOG.md should be unchanged after rename failure');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
