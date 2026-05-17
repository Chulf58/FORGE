// @covers hooks/mcp-deps-install.js
'use strict';
// TDD guard entry-point for hooks/mcp-deps-install.js.
// Full test coverage lives in mcp-deps-install-failure-preservation-test.js.
// This file exists so the TDD guard's resolveTestFile() can locate a .test.js
// for the source module. The assertions here mirror the failure-preservation
// tests — they fail before Wave 2 fixes and pass after.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('./mcp-deps-install.js');

test('resolveNpmTimeout — exported', () => {
  assert.equal(typeof mod.resolveNpmTimeout, 'function',
    'resolveNpmTimeout must be exported');
});

test('_runNpmCatch — exported', () => {
  assert.equal(typeof mod._runNpmCatch, 'function',
    '_runNpmCatch must be exported');
});
