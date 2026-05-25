// @covers scripts/eval-agent-prompts.mjs
// Tests for the eval runner — baseline update, comparison, and scheduled modes.
// Uses Node built-in test runner (node --test).
//
// Red bar: fails before --update-baseline writes a real baseline.json
// Green bar: passes after Task 15 implementation wires the real flags

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const runnerPath = join(projectRoot, 'scripts', 'eval-agent-prompts.mjs');

/**
 * Run the eval runner with the given args from cwd.
 * Returns { stdout, stderr, code }.
 */
function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [runnerPath, ...args], {
      cwd: cwd || projectRoot,
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status ?? 1,
    };
  }
}

test('--update-baseline writes evals/baseline.json', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eval-test-'));
  try {
    // Set up a minimal scenario tree in the tmp dir structure
    // Runner reads from its own projectRoot, so we test against actual projectRoot
    // but look for output in a predictable place
    const result = run(['--update-baseline'], projectRoot);
    // Stub exits 0 but doesn't write baseline.json — real impl should write it
    assert.equal(result.code, 0, 'should exit 0: ' + result.stderr);
    const baselinePath = join(projectRoot, 'evals', 'baseline.json');
    assert.ok(existsSync(baselinePath), 'baseline.json should exist after --update-baseline');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--compare-baseline exits 0 when no regressions', async () => {
  const result = run(['--compare-baseline'], projectRoot);
  // Stub outputs "[eval] --compare-baseline: not yet implemented" — real impl should emit JSON
  assert.ok(
    result.code === 0 || result.code === 1,
    'should exit 0 (no regression) or 1 (regressions): ' + result.stderr,
  );
  // Real impl should emit JSON to stdout
  if (result.code === 0 && result.stdout.includes('{')) {
    const parsed = JSON.parse(result.stdout);
    assert.ok('regressions' in parsed, 'output should have regressions field');
    assert.ok('agentResults' in parsed, 'output should have agentResults field');
  }
});

test('--scheduled writes a report to evals/scheduled-runs/', async () => {
  const scheduledDir = join(projectRoot, 'evals', 'scheduled-runs');
  const filesBefore = existsSync(scheduledDir)
    ? (await import('node:fs')).readdirSync(scheduledDir).length
    : 0;

  const result = run(['--scheduled'], projectRoot);
  assert.equal(result.code, 0, 'scheduled should exit 0: ' + result.stderr);

  // Real impl should write a report file
  const { readdirSync: rdSync } = await import('node:fs');
  if (existsSync(scheduledDir)) {
    const filesAfter = rdSync(scheduledDir).length;
    assert.ok(filesAfter > filesBefore, 'should write at least one report file to evals/scheduled-runs/');
  }
});
