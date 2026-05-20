// @covers hooks/conductor-inject.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mod = require('./conductor-inject.js');

function makeTmpProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cinj-'));
  fs.mkdirSync(path.join(tmp, 'docs', 'solutions'), { recursive: true });
  return tmp;
}

// ---- loadSolutionsIndex ----

test('loadSolutionsIndex — exported', () => {
  assert.equal(typeof mod.loadSolutionsIndex, 'function',
    'loadSolutionsIndex must be exported for retrieval-side injection');
});

test('loadSolutionsIndex — returns entries from docs/solutions/index.json', () => {
  const tmp = makeTmpProject();
  try {
    const idxPath = path.join(tmp, 'docs', 'solutions', 'index.json');
    fs.writeFileSync(idxPath, JSON.stringify([
      { title: 'Foo', tags: ['a', 'b'], file: 'docs/solutions/foo.md' },
      { title: 'Bar', tags: ['c'], file: 'docs/solutions/bar.md' },
    ]));
    const result = mod.loadSolutionsIndex(tmp);
    assert.equal(Array.isArray(result), true, 'returns an array');
    assert.equal(result.length, 2, 'returns all entries');
    assert.equal(result[0].title, 'Foo');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadSolutionsIndex — returns empty array when index.json missing (fail-open)', () => {
  const tmp = makeTmpProject();
  try {
    const result = mod.loadSolutionsIndex(tmp);
    assert.deepEqual(result, [], 'missing index → empty array, never throws');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadSolutionsIndex — returns empty array on malformed JSON (fail-open)', () => {
  const tmp = makeTmpProject();
  try {
    const idxPath = path.join(tmp, 'docs', 'solutions', 'index.json');
    fs.writeFileSync(idxPath, '{ not valid json');
    const result = mod.loadSolutionsIndex(tmp);
    assert.deepEqual(result, [], 'malformed JSON → empty array, never throws');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- formatSolutionsSummary ----

test('formatSolutionsSummary — exported', () => {
  assert.equal(typeof mod.formatSolutionsSummary, 'function',
    'formatSolutionsSummary must be exported');
});

test('formatSolutionsSummary — empty array returns empty string', () => {
  const result = mod.formatSolutionsSummary([]);
  assert.equal(result, '', 'empty entries → empty string (no header injected)');
});

test('formatSolutionsSummary — formats one-line-per-entry with title and tags', () => {
  const entries = [
    { title: 'Cross-model critique', tags: ['plan-skeptic', 'cross-model'] },
    { title: 'Restore observer pane', tags: ['observer', 'recovery'] },
  ];
  const result = mod.formatSolutionsSummary(entries);
  assert.ok(result.includes('Cross-model critique'), 'title appears');
  assert.ok(result.includes('plan-skeptic'), 'tags appear');
  assert.ok(result.includes('Restore observer pane'), 'second entry appears');
  // One line per entry (plus header)
  const entryLines = result.split('\n').filter(l => l.startsWith('- '));
  assert.equal(entryLines.length, 2, 'one bullet per entry');
});

test('formatSolutionsSummary — tolerates missing tags field', () => {
  const entries = [{ title: 'Untagged entry' }];
  const result = mod.formatSolutionsSummary(entries);
  assert.ok(result.includes('Untagged entry'), 'title appears without tags');
});
