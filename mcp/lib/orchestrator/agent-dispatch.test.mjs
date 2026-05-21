// @covers mcp/lib/orchestrator/agent-dispatch.mjs
// TDD wave-1 red-bar: agent-dispatch module

import { test } from 'node:test';
import assert from 'node:assert/strict';

let dispatchAgent;
try {
  const mod = await import('./agent-dispatch.mjs');
  dispatchAgent = mod.dispatchAgent;
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
    test('T0 — agent-dispatch.mjs must exist and export dispatchAgent', () => {
      assert.fail(
        'mcp/lib/orchestrator/agent-dispatch.mjs does not exist yet. ' +
        'Original error: ' + err.message
      );
    });
    process.exit(1);
  }
  throw err;
}

test('AC-0: dispatchAgent is exported as a function', () => {
  assert.equal(typeof dispatchAgent, 'function', 'dispatchAgent must be exported as a function');
});
