#!/usr/bin/env node
// @covers scripts/post-apply-lifecycle.mjs
// Tests that Job 6 (plan-cleanup / removePlanSection) has been removed.
// Red bar: currently the script calls removePlanSection() which logs plan-cleanup.
// Green bar: after removing Job 6, stderr must not contain plan-cleanup.
//
// Also tests Job 4b (CHANGELOG fragment splice) — added for CHANGELOG fragment feature.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'post-apply-lifecycle.mjs');

function makeMinimalProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'pal-job6-test-'));
  mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline', 'context', 'reviewer-output'), { recursive: true });
  return tmp;
}

function makeProjectWithFragment(runId, fragmentContent, changelogContent) {
  const tmp = mkdtempSync(join(tmpdir(), 'pal-job4b-test-'));
  mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline', 'context', 'reviewer-output'), { recursive: true });
  mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md'), fragmentContent, 'utf8');
  if (changelogContent !== undefined) {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs', 'CHANGELOG.md'), changelogContent, 'utf8');
  }
  return tmp;
}

function runScript(dir, featureName) {
  return spawnSync(process.execPath, [SCRIPT_PATH, featureName], {
    cwd: dir,
    encoding: 'utf8',
  });
}

test('Job 6 removed: stderr must not contain plan-cleanup', () => {
  const dir = makeMinimalProject();
  try {
    const out = runScript(dir, 'test-feature');
    const stderr = out.stderr || '';

    assert.ok(
      !stderr.includes('plan-cleanup'),
      `stderr must not contain "plan-cleanup" after Job 6 removal, got:\n${stderr}`,
    );
    assert.match(stderr, /\[lifecycle\] done/, 'stderr must contain [lifecycle] done');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('script exits 0 and emits [lifecycle] done with no plan-cleanup line', () => {
  const dir = makeMinimalProject();
  try {
    const out = runScript(dir, '');
    const stderr = out.stderr || '';

    assert.equal(out.status, 0, `script must exit 0, got ${out.status}`);
    assert.match(stderr, /\[lifecycle\] done/, 'stderr must contain [lifecycle] done');
    assert.ok(!stderr.includes('plan-cleanup'), 'no plan-cleanup reference in stderr');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Job 4b — CHANGELOG fragment splice (red bar — will fail until Job 4b is added)
// ---------------------------------------------------------------------------
test('Job 4b: pending CHANGELOG fragment is spliced into CHANGELOG.md', () => {
  const runId = 'r-test4b1';
  const fragContent = '## [2026-05-16] Test Feature\n\n- test bullet';
  const existingChangelog = '# Changelog\n\n## [2026-01-01] Old Entry\n\n- old bullet\n';
  const dir = makeProjectWithFragment(runId, fragContent, existingChangelog);
  try {
    const out = runScript(dir, 'test-feature');
    const stderr = out.stderr || '';

    assert.equal(out.status, 0, `script must exit 0, got ${out.status}. stderr: ${stderr}`);

    const changelogPath = join(dir, 'docs', 'CHANGELOG.md');
    assert.ok(existsSync(changelogPath), 'CHANGELOG.md must exist after lifecycle');
    const result = readFileSync(changelogPath, 'utf8');
    assert.ok(
      result.includes('## [2026-05-16] Test Feature'),
      `fragment content must be in CHANGELOG.md after Job 4b splice. CHANGELOG:\n${result}`,
    );

    // Fragment should be deleted after successful splice
    const fragmentPath = join(dir, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md');
    assert.ok(!existsSync(fragmentPath), 'fragment file must be deleted after successful splice');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
