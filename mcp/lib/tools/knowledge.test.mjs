// @covers mcp/lib/tools/knowledge.js
// TDD guard shim — ensures a failing test exists before knowledge.js is modified.
// The authoritative integration tests are in mcp/knowledge-link-test.mjs.
//
// Run: node --test mcp/lib/tools/knowledge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('forge_get_linked is registered on the MCP server', async () => {
  const modulePath = pathToFileURL(resolve(__dirname, 'knowledge.js')).href;
  const mod = await import(modulePath);

  // Build a minimal server stub that records registered tool names
  const registeredTools = [];
  const stubServer = {
    registerTool: (name, _schema, _handler) => {
      registeredTools.push(name);
    },
  };

  mod.register(stubServer, {});

  assert.ok(
    registeredTools.includes('forge_get_linked'),
    'forge_get_linked not registered — implement the tool first',
  );
});
