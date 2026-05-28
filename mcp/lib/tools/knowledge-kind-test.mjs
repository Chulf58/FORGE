// @covers mcp/lib/knowledge-store.js
// @covers mcp/lib/gotchas-index.mjs
// @covers mcp/lib/decisions-index.mjs
// Phase 5 red bar (Tasks 20-22): expose `kind` on every retrieval reader (gotcha/solution/
// decision) + append-evidence-on-conflict in the knowledge store.
//
// Data-layer test (no MCP server spin-up) so it stays fast and cannot destabilize the
// existing MCP-integration suite in knowledge-test.mjs. AC-20's [refine-on-arrival] note
// explicitly permits a new @covers-tagged test file. Auto-discovered by run-tests.mjs.
//
// Run: node --test mcp/lib/tools/knowledge-kind-test.mjs
//
// RED BAR until Tasks 21-22 land: `kind` is absent on results and `appendEvidence` is not
// exported → every assertion below fails.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as store from '../knowledge-store.js';
import { searchGotchasIndex } from '../gotchas-index.mjs';
import { searchDecisionsIndex } from '../decisions-index.mjs';

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-kind-'));
  mkdirSync(join(dir, 'docs', 'gotchas'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });

  // gotcha source + gotchas index
  writeFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'),
    '# GENERAL\n\n## Widget timeout\n\nThe widget times out after 30s. Original body line.\n', 'utf8');
  writeFileSync(join(dir, 'docs', 'gotchas', 'index.json'), JSON.stringify([
    { title: 'Widget timeout', file: 'docs/gotchas/GENERAL.md', tags: ['widget'], keywords: ['widget', 'timeout'] },
  ], null, 2), 'utf8');

  // solution doc + solutions index (array form)
  writeFileSync(join(dir, 'docs', 'solutions', 'widget-fix.md'),
    '# Widget Fix\n\nHow we fixed the widget.\n', 'utf8');
  writeFileSync(join(dir, 'docs', 'solutions', 'index.json'), JSON.stringify([
    { title: 'Widget Fix', file: 'docs/solutions/widget-fix.md', tags: ['widget'], keywords: ['widget', 'fix'] },
  ], null, 2), 'utf8');

  // decisions index
  writeFileSync(join(dir, 'docs', 'decisions-index.json'), JSON.stringify([
    { date: '2026-01-01', title: 'Use widgets everywhere', tags: [], keywords: ['widget', 'everywhere'], anchor: '2026-01-01-use-widgets-everywhere' },
  ], null, 2), 'utf8');

  return dir;
}

test('searchConstraints results carry kind:"gotcha"', () => {
  const dir = makeProject();
  try {
    const hits = store.searchConstraints(dir, 'widget');
    assert.ok(hits.length >= 1, 'expected a gotcha hit');
    for (const h of hits) assert.equal(h.kind, 'gotcha', 'constraint result must carry kind:gotcha');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('searchPatterns results carry kind:"solution"', () => {
  const dir = makeProject();
  try {
    const hits = store.searchPatterns(dir, 'widget', null);
    assert.ok(hits.length >= 1, 'expected a solution hit');
    for (const h of hits) assert.equal(h.kind, 'solution', 'pattern result must carry kind:solution');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('searchGotchasIndex results carry kind:"gotcha"', () => {
  const dir = makeProject();
  try {
    const hits = searchGotchasIndex(dir, 'widget');
    assert.ok(hits.length >= 1, 'expected a gotcha-index hit');
    for (const h of hits) assert.equal(h.kind, 'gotcha', 'gotcha-index result must carry kind:gotcha');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('searchDecisionsIndex results carry kind:"decision"', () => {
  const dir = makeProject();
  try {
    const hits = searchDecisionsIndex(dir, 'widget');
    assert.ok(hits.length >= 1, 'expected a decision hit');
    for (const h of hits) assert.equal(h.kind, 'decision', 'decision result must carry kind:decision');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendEvidence merges new evidence into an existing gotcha without dropping content', () => {
  const dir = makeProject();
  try {
    assert.equal(typeof store.appendEvidence, 'function', 'appendEvidence export missing');
    const res = store.appendEvidence(dir, { type: 'gotcha', title: 'Widget timeout', sourceEvidence: 'run r-merge-123' });
    assert.ok(res && res.merged === true, 'appendEvidence should report merged:true on success');
    const general = readFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
    assert.ok(general.includes('Original body line.'), 'existing content must NOT be dropped');
    assert.ok(general.includes('run r-merge-123'), 'new evidence must be merged into the entry');
    // No duplicate heading created
    const headingCount = (general.match(/^## Widget timeout$/gm) || []).length;
    assert.equal(headingCount, 1, 'must not create a duplicate section heading');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendEvidence rejects empty sourceEvidence (quality gate not bypassed)', () => {
  const dir = makeProject();
  try {
    const before = readFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
    let threwOrRefused = false;
    try {
      const res = store.appendEvidence(dir, { type: 'gotcha', title: 'Widget timeout', sourceEvidence: '' });
      if (!res || res.merged !== true) threwOrRefused = true;
    } catch { threwOrRefused = true; }
    assert.ok(threwOrRefused, 'empty sourceEvidence must be refused (throw or merged:false)');
    const after = readFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
    assert.equal(after, before, 'file must be unchanged when evidence is empty');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
