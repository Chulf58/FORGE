// @covers scripts/gotchas-coverage-verify.mjs
// Tests for the gotchas-coverage verifier — the safety net for the GENERAL.md split (Task 17).
//
// Contract (AC-17): scripts/gotchas-coverage-verify.mjs reads docs/gotchas/index.json under a
// project dir, and for EACH record asserts (a) the record's `title` appears as a markdown heading
// in the record's `file`, AND (b) the title is queryable through searchGotchasIndex. It prints
// one `PASS: <title>` line per covered record and one `[coverage-gap] <title>` line per gap,
// exiting 0 iff every record is covered, non-zero otherwise.
//
// The script takes the project dir as argv[2] (falls back to process.cwd()) so it is testable
// against fixtures without touching the real repo index.
//
// Run: node --test scripts/gotchas-coverage-verify-test.mjs
//
// RED BAR: until scripts/gotchas-coverage-verify.mjs exists, `node` exits non-zero with
// MODULE_NOT_FOUND, so the GOOD-fixture "exit 0 + PASS lines" assertion fails. Once implemented
// per AC-17 these become GREEN.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'gotchas-coverage-verify.mjs');

// Build a throwaway project dir with docs/gotchas/index.json + topic files.
function makeFixture(records, files) {
  const dir = mkdtempSync(join(tmpdir(), 'gcv-'));
  const gotchasDir = join(dir, 'docs', 'gotchas');
  mkdirSync(gotchasDir, { recursive: true });
  writeFileSync(join(dir, 'docs', 'gotchas', 'index.json'), JSON.stringify(records, null, 2), 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, 'utf8');
  }
  return dir;
}

function run(projectDir) {
  return spawnSync(process.execPath, [scriptPath, projectDir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('GOOD fixture: every record heading present → exit 0 with one PASS per record', () => {
  const records = [
    { title: 'Topic One', file: 'docs/gotchas/topic-one.md', tags: ['t1'], keywords: ['one'] },
    { title: 'Topic Two', file: 'docs/gotchas/topic-two.md', tags: ['t2'], keywords: ['two'] },
  ];
  const files = {
    'docs/gotchas/topic-one.md': '## Topic One\n\nbody for topic one\n',
    'docs/gotchas/topic-two.md': '## Topic Two\n\nbody for topic two\n',
  };
  const dir = makeFixture(records, files);
  try {
    const r = run(dir);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.equal(r.status, 0, `expected exit 0 for fully-covered fixture, got ${r.status}\n${out}`);
    assert.match(out, /PASS:\s*Topic One/, 'expected a PASS line for "Topic One"');
    assert.match(out, /PASS:\s*Topic Two/, 'expected a PASS line for "Topic Two"');
    assert.ok(!/\[coverage-gap\]/.test(out), 'fully-covered fixture must not report any coverage gap');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GAP fixture: a record whose file lacks the heading → non-zero with [coverage-gap] <title>', () => {
  const records = [
    { title: 'Topic One', file: 'docs/gotchas/topic-one.md', tags: ['t1'], keywords: ['one'] },
    { title: 'Topic Missing', file: 'docs/gotchas/topic-missing.md', tags: ['tm'], keywords: ['missing'] },
  ];
  const files = {
    'docs/gotchas/topic-one.md': '## Topic One\n\nbody for topic one\n',
    // topic-missing.md exists but does NOT contain a "## Topic Missing" heading
    'docs/gotchas/topic-missing.md': '## Some Other Heading\n\nbody without the indexed title\n',
  };
  const dir = makeFixture(records, files);
  try {
    const r = run(dir);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.notEqual(r.status, 0, `expected non-zero exit when a record heading is missing\n${out}`);
    assert.match(out, /\[coverage-gap\]/, 'expected a [coverage-gap] marker');
    assert.match(out, /Topic Missing/, 'the gap report must name the uncovered title');
    assert.match(out, /PASS:\s*Topic One/, 'covered records should still report PASS');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
