// @covers mcp/forge-worker-reset-reproducer.mjs
// TDD gate test — must be red (failing) before the reproducer source is written.
// After the reproducer source exists, this test imports and exercises it.
// Running this file directly: node --test mcp/forge-worker-reset-reproducer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Phase 1 (red): the reproducer module does not exist yet — import will throw.
// Once the source exists (Phase 2+), this test validates the module loads cleanly.
test('forge-worker-reset-reproducer module exists and exports createTimerController', async () => {
  const mod = await import('./forge-worker-reset-reproducer.mjs');
  assert.strictEqual(typeof mod.createTimerController, 'function', 'createTimerController must be exported');
});
