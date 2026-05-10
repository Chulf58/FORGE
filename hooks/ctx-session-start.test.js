'use strict';
// @covers hooks/ctx-session-start.js
// TDD wave 1 — red bar stub for cleanupStaleDispatchContext (AC-4).
// This file exists solely to satisfy the tdd-guard.js test-file resolver,
// which only recognises the .test.js suffix pattern for ctx-session-start.js.
// The canonical AC-4 tests live in hooks/dispatch-context-test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('ctx-session-start exports cleanupStaleDispatchContext (red — not yet implemented)', () => {
  // Will fail until cleanupStaleDispatchContext is exported from ctx-session-start.js.
  const mod = require('./ctx-session-start.js');
  assert.equal(typeof mod.cleanupStaleDispatchContext, 'function',
    'cleanupStaleDispatchContext must be exported from ctx-session-start.js');
});
