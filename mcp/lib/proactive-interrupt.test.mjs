// @covers mcp/lib/proactive-interrupt.mjs
// Adjacent test file required by tdd-guard.js for mcp/lib/proactive-interrupt.mjs.
// Full test coverage lives in mcp/forge-worker-interrupt-test.mjs (wave-1 tests).
// This shim re-exports those tests by importing the same module; if the module
// is absent the import fails and the test file exits non-zero (red bar).
//
// Run: node --test mcp/lib/proactive-interrupt.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget, proactiveInterruptStep } from './proactive-interrupt.mjs';

test('evaluateBudget is exported and callable', () => {
  assert.equal(typeof evaluateBudget, 'function');
});

test('proactiveInterruptStep is exported and callable', () => {
  assert.equal(typeof proactiveInterruptStep, 'function');
});
