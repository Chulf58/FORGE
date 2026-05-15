// @covers mcp/lib/tools/modules.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// These tests are intentionally failing (red) until modules.js exists.
// Run with: node --test mcp/lib/tools/modules-test.mjs

describe('modules register()', () => {
  it('registers forge_read_modules tool on the server', async () => {
    const { register } = await import('./modules.js');
    const registered = [];
    const fakeServer = {
      registerTool: (name) => registered.push(name),
    };
    register(fakeServer, {});
    assert.ok(registered.includes('forge_read_modules'), 'forge_read_modules not registered');
  });

  it('registers forge_assign_module tool on the server', async () => {
    const { register } = await import('./modules.js');
    const registered = [];
    const fakeServer = {
      registerTool: (name) => registered.push(name),
    };
    register(fakeServer, {});
    assert.ok(registered.includes('forge_assign_module'), 'forge_assign_module not registered');
  });
});
