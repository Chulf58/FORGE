// @covers hooks/conductor-inject.js
'use strict';

// TDD guard entry-point for hooks/conductor-inject.js.
// Full test coverage lives in conductor-inject-test.js.
// This file exists so the TDD guard's resolveTestFile() can locate a .test.js
// for the source module. Mirrors the pattern used by mcp-deps-install.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./conductor-inject.js');

test('loadSolutionsIndex — exported', () => {
  assert.equal(typeof mod.loadSolutionsIndex, 'function',
    'loadSolutionsIndex must be exported for retrieval-side injection');
});

test('formatSolutionsSummary — exported', () => {
  assert.equal(typeof mod.formatSolutionsSummary, 'function',
    'formatSolutionsSummary must be exported');
});
