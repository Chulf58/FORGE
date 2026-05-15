// @covers mcp/lib/tools/model-mgmt.js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Minimal stub server that records registered tool names
function makeStubServer() {
  const registeredTools = [];
  return {
    registerTool(name) {
      registeredTools.push(name);
    },
    registeredTools,
  };
}

// Minimal shared stub — only what model-mgmt.js uses
const sharedStub = {
  resolveProjectDir: () => '/fake/project',
  writeJsonSafe: () => {},
  errorResult: (msg) => ({ content: [{ type: 'text', text: msg }], isError: true }),
  textResult: (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
};

test('model-mgmt register exports a function', async () => {
  const mod = await import('./model-mgmt.js');
  assert.equal(typeof mod.register, 'function');
});

test('model-mgmt register registers exactly 8 tools', async () => {
  const { register } = await import('./model-mgmt.js');
  const server = makeStubServer();
  register(server, sharedStub);
  assert.equal(server.registeredTools.length, 8);
});

test('model-mgmt registers the correct 8 tool names', async () => {
  const { register } = await import('./model-mgmt.js');
  const server = makeStubServer();
  register(server, sharedStub);
  const expected = [
    'forge_get_model_recommendation',
    'forge_call_external',
    'forge_read_usage',
    'forge_reset_usage',
    'forge_update_agent_model',
    'forge_add_model',
    'forge_update_model',
    'forge_list_models',
  ];
  for (const name of expected) {
    assert.ok(server.registeredTools.includes(name), `missing tool: ${name}`);
  }
});
