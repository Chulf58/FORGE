// @covers mcp/lib/gotchas-index.mjs
// Tests for gotchas-index — index-backed retrieval of moved gotcha sections.
// Pure function `searchGotchasIndex(projectDir, keyword) -> {title, file, tags, keywords}[]`,
// reads docs/gotchas/index.json (mirroring the docs/solutions/index.json pattern).
//
// Run: node --test mcp/lib/gotchas-index.test.mjs
//
// RED BAR: until mcp/lib/gotchas-index.mjs exists, searchGotchasIndex is null and
// every call below throws → all behavior tests fail. Once implemented per AC-16,
// these become GREEN. (No assert.fail placeholders — real behavior assertions.)

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// projectDir = repo root (this test lives at mcp/lib/)
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let searchGotchasIndex;
try {
  ({ searchGotchasIndex } = await import('./gotchas-index.mjs'));
} catch {
  searchGotchasIndex = null;
}

test('module exports searchGotchasIndex function', () => {
  assert.equal(typeof searchGotchasIndex, 'function', 'searchGotchasIndex export missing or not a function');
});

test('(a) keyword query returns an array of index records', () => {
  // Contract: searchGotchasIndex always returns an array (possibly empty). Each entry
  // has the index-record shape from docs/gotchas/index.json: { title, file, tags?, keywords? }.
  const out = searchGotchasIndex(projectDir, 'frontmatter');
  assert.ok(Array.isArray(out), 'must return an array');
});

test('(b) keyword matching nothing returns empty array', () => {
  const out = searchGotchasIndex(projectDir, 'xyzzy-no-such-token-9999');
  assert.deepEqual(out, [], 'no-match returns empty array');
});

test('(c) empty / null / whitespace keyword returns empty array without throwing', () => {
  assert.deepEqual(searchGotchasIndex(projectDir, ''), []);
  assert.deepEqual(searchGotchasIndex(projectDir, '   '), []);
  assert.deepEqual(searchGotchasIndex(projectDir, null), []);
});

test('(d) returned records carry the documented shape ({ title, file })', () => {
  // When at least one gotcha is indexed (post-Task-16), a known-token query should
  // produce records whose `title` and `file` fields are strings. Until the index has
  // any entries this may return []; the assertion runs only on non-empty results.
  const out = searchGotchasIndex(projectDir, 'frontmatter');
  for (const r of out) {
    assert.equal(typeof r.title, 'string', 'index record must have a string `title`');
    assert.equal(typeof r.file, 'string', 'index record must have a string `file` path');
  }
});

test('(e) returned records carry kind:"gotcha" (Task 21)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gi-kind-'));
  try {
    mkdirSync(join(tmpDir, 'docs', 'gotchas'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs', 'gotchas', 'index.json'), JSON.stringify([
      { title: 'Test gotcha', file: 'docs/gotchas/GENERAL.md', tags: ['test'], keywords: ['test'] },
    ], null, 2), 'utf8');
    const hits = searchGotchasIndex(tmpDir, 'test');
    assert.ok(hits.length >= 1, 'expected a hit');
    for (const h of hits) assert.equal(h.kind, 'gotcha', 'gotcha-index record must carry kind:gotcha');
  } finally { rmSync(tmpDir, { recursive: true, force: true }); }
});
