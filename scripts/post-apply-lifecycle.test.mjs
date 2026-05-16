#!/usr/bin/env node
// @covers scripts/post-apply-lifecycle.mjs
// Tests that Job 6 (plan-cleanup / removePlanSection) has been removed.
// Red bar: currently the script calls removePlanSection() which logs plan-cleanup.
// Green bar: after removing Job 6, stderr must not contain plan-cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
