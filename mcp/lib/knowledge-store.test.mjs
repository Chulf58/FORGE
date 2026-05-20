// @covers mcp/lib/knowledge-store.js
// Regression guard: appendSolutionDoc must write verifiedAt ISO 8601 timestamp
// to index entries.
//
// Run: node --test mcp/lib/knowledge-store.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appendSolutionDoc } from './knowledge-store.js';

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function makeProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ks-test-'));
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'solutions', 'index.json'), '[]', 'utf8');
  return dir;
}

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
