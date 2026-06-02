#!/usr/bin/env node
// @covers scripts/covers-verify.mjs
//
// covers-verify --changed-from-git resolves the touched SOURCE files from the
// worktree's git state (modified tracked + untracked) instead of parsing the
// handoff's "## Files modified" section. The orchestrator uses this mode: the
// coder's handoff uses "## Files to create" / "## Files to modify" with content
// blocks, which the handoff parser cannot read (it matches "## Files modified"
// + a path list), so the handoff path would silently resolve zero files. git is
// format-independent and reflects what actually changed on disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER = resolve(__dirname, 'covers-verify.mjs');

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

const PASSING_TEST = (src) =>
  `// @covers ${src}\nimport { test } from 'node:test';\nimport assert from 'node:assert';\ntest('ok', () => assert.ok(true));\n`;
const FAILING_TEST = (src) =>
  `// @covers ${src}\nimport { test } from 'node:test';\nimport assert from 'node:assert';\ntest('bad', () => assert.ok(false));\n`;

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'covers-git-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t.t']);
  git(root, ['config', 'user.name', 't']);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'thing.mjs'), 'export const v = 1;\n');
  writeFileSync(join(root, 'scripts', 'thing-test.mjs'), PASSING_TEST('scripts/thing.mjs'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [VERIFIER, '--changed-from-git', `--root=${root}`], {
    cwd: root, encoding: 'utf8',
  });
}

test('--changed-from-git runs the covering test for a MODIFIED tracked source file', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'scripts', 'thing.mjs'), 'export const v = 2;\n');
    const r = run(root);
    assert.equal(r.status, 0, 'passing covering test must exit 0 (stderr: ' + r.stderr + ')');
    assert.match(r.stderr, /thing-test\.mjs/, 'must resolve+run the covering test via @covers');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--changed-from-git runs the covering test for a NEW untracked source file', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'scripts', 'newmod.mjs'), 'export const x = 1;\n');
    writeFileSync(join(root, 'scripts', 'newmod-test.mjs'), PASSING_TEST('scripts/newmod.mjs'));
    const r = run(root);
    assert.equal(r.status, 0, 'exit 0 (stderr: ' + r.stderr + ')');
    assert.match(r.stderr, /newmod-test\.mjs/, 'must resolve+run the new untracked file covering test');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--changed-from-git exits NON-ZERO when a covering test fails', () => {
  const root = makeRepo();
  try {
    writeFileSync(join(root, 'scripts', 'thing.mjs'), 'export const v = 2;\n');
    writeFileSync(join(root, 'scripts', 'thing-test.mjs'), FAILING_TEST('scripts/thing.mjs'));
    const r = run(root);
    assert.notEqual(r.status, 0, 'a failing covering test must make covers-verify exit non-zero');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('--changed-from-git ignores non-source changes (no covering test, exit 0)', () => {
  const root = makeRepo();
  try {
    // Only a docs/json change -> no covering tests resolved -> trivial pass.
    writeFileSync(join(root, 'README.md'), '# changed\n');
    const r = run(root);
    assert.equal(r.status, 0, 'non-source change must not fail (stderr: ' + r.stderr + ')');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
