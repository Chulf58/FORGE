// @covers mcp/lib/decisions-index.mjs
// Tests for decisions-index — in-place index over docs/DECISIONS.md (Task 18 / AC-18).
//
// Two exports (mirroring the gotchas-index / solutions-index pattern):
//   buildDecisionsIndex(projectDir) -> { date, title, tags, keywords, anchor }[]
//       parses docs/DECISIONS.md, one record per `## [date]` entry (chronological file
//       is never reordered or deleted — the index is additive/derived).
//   searchDecisionsIndex(projectDir, keyword) -> matching records[]
//       reads docs/decisions-index.json; case-insensitive substring match over
//       title/keywords/tags; fail-open [] on missing/malformed.
//
// Run: node --test mcp/lib/decisions-index-test.mjs
//
// RED BAR: until mcp/lib/decisions-index.mjs exists, both exports are null and every
// behavior test fails. Once implemented per AC-18 these become GREEN.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// docs/DECISIONS.md and docs/decisions-index.json are THIS-project content (gitignored —
// not distributed). On a fresh plugin checkout they are absent, so the content-dependent
// assertions below are skipped; they run fully in a working tree that has the content.
let decisionsText = null;
try { decisionsText = readFileSync(join(projectDir, 'docs', 'DECISIONS.md'), 'utf8'); } catch { /* absent on clean checkout */ }
const hasDecisions = decisionsText !== null;
let hasIndex = false;
try { readFileSync(join(projectDir, 'docs', 'decisions-index.json'), 'utf8'); hasIndex = true; } catch { /* absent on clean checkout */ }
const datedEntryCount = decisionsText ? (decisionsText.match(/^## \[\d{4}-\d{2}-\d{2}\]/gm) || []).length : 0;

let buildDecisionsIndex, searchDecisionsIndex;
try {
  ({ buildDecisionsIndex, searchDecisionsIndex } = await import('./decisions-index.mjs'));
} catch {
  buildDecisionsIndex = null;
  searchDecisionsIndex = null;
}

test('module exports buildDecisionsIndex + searchDecisionsIndex functions', () => {
  assert.equal(typeof buildDecisionsIndex, 'function', 'buildDecisionsIndex export missing');
  assert.equal(typeof searchDecisionsIndex, 'function', 'searchDecisionsIndex export missing');
});

test('record count: one record per `## [date]` entry in DECISIONS.md', { skip: hasDecisions ? false : 'DECISIONS.md absent (clean checkout)' }, () => {
  assert.ok(datedEntryCount > 0, 'sanity: DECISIONS.md should have dated entries');
  const records = buildDecisionsIndex(projectDir);
  assert.ok(Array.isArray(records), 'buildDecisionsIndex must return an array');
  assert.equal(records.length, datedEntryCount,
    `index record count (${records.length}) must equal dated-entry count (${datedEntryCount})`);
});

test('persisted decisions-index.json matches the built record count', { skip: (hasDecisions && hasIndex) ? false : 'decisions content absent (clean checkout)' }, () => {
  // The committed artifact must be in sync with DECISIONS.md.
  const raw = readFileSync(join(projectDir, 'docs', 'decisions-index.json'), 'utf8');
  const persisted = JSON.parse(raw);
  assert.ok(Array.isArray(persisted), 'decisions-index.json must be a JSON array');
  assert.equal(persisted.length, datedEntryCount,
    `persisted index length (${persisted.length}) must equal dated-entry count (${datedEntryCount})`);
});

test('each record carries { date, title, tags, keywords, anchor }', { skip: hasDecisions ? false : 'DECISIONS.md absent (clean checkout)' }, () => {
  const records = buildDecisionsIndex(projectDir);
  for (const r of records) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `record.date must be YYYY-MM-DD, got ${r.date}`);
    assert.equal(typeof r.title, 'string', 'record.title must be a string');
    assert.ok(r.title.length > 0, 'record.title must be non-empty');
    assert.ok(Array.isArray(r.tags), 'record.tags must be an array');
    assert.ok(Array.isArray(r.keywords), 'record.keywords must be an array');
    assert.equal(typeof r.anchor, 'string', 'record.anchor must be a string');
    assert.ok(r.anchor.length > 0, 'record.anchor must be non-empty (resolvable)');
  }
});

test('keyword query returns the matching entry', { skip: hasIndex ? false : 'decisions-index.json absent (clean checkout)' }, () => {
  // "worktree" appears in several decision titles (e.g. project-root-to-main, plan-worktrees).
  const hits = searchDecisionsIndex(projectDir, 'worktree');
  assert.ok(Array.isArray(hits), 'must return an array');
  assert.ok(hits.length >= 1, 'expected at least one decision matching "worktree"');
  for (const h of hits) {
    const hay = (h.title + ' ' + (h.keywords || []).join(' ')).toLowerCase();
    assert.ok(hay.includes('worktree'), 'each hit should actually relate to the keyword');
  }
});

test('empty / null / whitespace keyword returns empty array without throwing', () => {
  assert.deepEqual(searchDecisionsIndex(projectDir, ''), []);
  assert.deepEqual(searchDecisionsIndex(projectDir, '   '), []);
  assert.deepEqual(searchDecisionsIndex(projectDir, null), []);
});
