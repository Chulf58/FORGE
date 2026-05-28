// @covers mcp/lib/knowledge-store.js
// Regression guard: appendSolutionDoc must write verifiedAt ISO 8601 timestamp
// to index entries. Also covers kind-field and appendEvidence (Tasks 21-22).
//
// Run: node --test mcp/lib/knowledge-store.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appendSolutionDoc, searchConstraints, searchPatterns, appendEvidence } from './knowledge-store.js';

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ks-test-'));
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'solutions', 'index.json'), '[]', 'utf8');
  return dir;
}

function makeGotchaProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ks-kind-'));
  mkdirSync(join(dir, 'docs', 'gotchas'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'),
    '# GENERAL\n\n## Widget timeout\n\nThe widget times out after 30s.\n', 'utf8');
  writeFileSync(join(dir, 'docs', 'solutions', 'index.json'), JSON.stringify([
    { title: 'Widget Fix', file: 'docs/solutions/widget-fix.md', tags: ['widget'], keywords: ['widget', 'fix'] },
  ], null, 2), 'utf8');
  writeFileSync(join(dir, 'docs', 'solutions', 'widget-fix.md'),
    '# Widget Fix\n\nHow we fixed the widget.\n', 'utf8');
  return dir;
}

// --- Task 21: kind field on retrieval readers ---

test('searchConstraints results carry kind:"gotcha"', () => {
  const dir = makeGotchaProjectDir();
  try {
    const hits = searchConstraints(dir, 'widget');
    assert.ok(hits.length >= 1, 'expected a gotcha hit');
    for (const h of hits) assert.equal(h.kind, 'gotcha', 'constraint result must carry kind:gotcha');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('searchPatterns results carry kind:"solution"', () => {
  const dir = makeGotchaProjectDir();
  try {
    const hits = searchPatterns(dir, 'widget', null);
    assert.ok(hits.length >= 1, 'expected a solution hit');
    for (const h of hits) assert.equal(h.kind, 'solution', 'pattern result must carry kind:solution');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- Task 22: appendEvidence ---

test('appendEvidence export exists', () => {
  assert.equal(typeof appendEvidence, 'function', 'appendEvidence must be exported');
});

test('appendEvidence rejects empty sourceEvidence', () => {
  const dir = makeGotchaProjectDir();
  try {
    const before = readFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
    let refused = false;
    try {
      const res = appendEvidence(dir, { type: 'gotcha', title: 'Widget timeout', sourceEvidence: '' });
      if (!res || res.merged !== true) refused = true;
    } catch { refused = true; }
    assert.ok(refused, 'empty sourceEvidence must be refused');
    const after = readFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
    assert.equal(after, before, 'file must be unchanged when evidence is empty');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendSolutionDoc writes verifiedAt ISO 8601 timestamp to index entry', () => {
  const projectDir = makeProjectDir();
  try {
    appendSolutionDoc(projectDir, {
      title: 'Test verifiedAt entry',
      content: 'Body text.',
      tags: ['test'],
    });

    const indexRaw = readFileSync(join(projectDir, 'docs', 'solutions', 'index.json'), 'utf8');
    const entries = JSON.parse(indexRaw);
    assert.equal(entries.length, 1, 'expected one entry in index');
    const entry = entries[0];
    assert.ok('verifiedAt' in entry, 'entry must have verifiedAt field');
    assert.match(entry.verifiedAt, ISO_8601_RE, 'verifiedAt must match ISO 8601 pattern');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});
