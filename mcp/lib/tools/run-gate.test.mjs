// @covers mcp/lib/tools/run-gate.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Smoke test: register export exists and is a function
describe('run-gate register', () => {
  it('exports a register function', async () => {
    const mod = await import('./run-gate.js');
    assert.strictEqual(typeof mod.register, 'function');
  });

  it('register registers exactly forge_get_active_run, forge_check_gate, forge_set_gate', async () => {
    const { register } = await import('./run-gate.js');
    const registered = [];
    const fakeServer = {
      registerTool: (name) => registered.push(name),
    };
    register(fakeServer, {});
    assert.deepStrictEqual(registered.sort(), [
      'forge_check_gate',
      'forge_get_active_run',
      'forge_set_gate',
    ]);
  });
});
