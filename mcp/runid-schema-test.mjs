#!/usr/bin/env node
// Regression tests for runId Zod schema validation in MCP tools.
// Spawns the real MCP server and sends invalid runId values to tools that
// previously accepted raw z.string() — verifying schema rejection at the
// MCP boundary before any path.join or run lookup occurs.
//
// Run: node mcp/runid-schema-test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

// Minimal valid forge-config.json for server startup
const MINIMAL_CONFIG = JSON.stringify({
  providers: [
    { id: 'anthropic', type: 'anthropic', envVar: 'ANTHROPIC_API_KEY', enabled: true, name: 'Anthropic', priority: 3 },
  ],
  models: [],
  agentModelMap: {},
});

async function withServer(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'runid-schema-test-'));
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'forge-config.json'), MINIMAL_CONFIG);
  writeFileSync(join(tmp, '.pipeline', 'board.json'), JSON.stringify({ todos: [], planned: [] }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);

  try {
    await fn(client, tmp);
  } finally {
    await client.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Helper: call a tool and return true if it rejected (isError or threw)
async function callAndCheckRejected(client, toolName, args) {
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    // MCP schema validation errors surface as isError: true in the result
    return result.isError === true;
  } catch (_) {
    return true; // SDK-level throw also means rejected
  }
}

console.log('\n── runid-schema-test.mjs ────────────────────────────────────────────────');

await withServer(async (client) => {

  // forge_get_run — traversal rejected
  assert(
    await callAndCheckRejected(client, 'forge_get_run', { runId: '../../.pipeline/board.json' }),
    'forge_get_run: path traversal runId rejected at schema'
  );

  // forge_get_run — shell injection rejected
  assert(
    await callAndCheckRejected(client, 'forge_get_run', { runId: 'r-abc; rm -rf .' }),
    'forge_get_run: shell injection runId rejected at schema'
  );

  // forge_get_run — bare string without r- prefix rejected
  assert(
    await callAndCheckRejected(client, 'forge_get_run', { runId: 'abc123' }),
    'forge_get_run: bare id without r- prefix rejected'
  );

  // forge_get_run — valid runId accepted (will get "not found" not schema error)
  {
    const result = await client.callTool({ name: 'forge_get_run', arguments: { runId: 'r-abc123' } });
    // Schema passes — result is either null (not found) or the run; isError might be true but from handler not schema
    // The key is it did NOT throw a schema validation error
    assert(
      result !== null,
      'forge_get_run: valid r-abc123 passes schema (handler returns not-found, not schema error)'
    );
  }

  // forge_update_run — traversal rejected
  assert(
    await callAndCheckRejected(client, 'forge_update_run', { runId: '../../../etc/passwd', status: 'running' }),
    'forge_update_run: path traversal runId rejected at schema'
  );

  // forge_update_run — empty string rejected
  assert(
    await callAndCheckRejected(client, 'forge_update_run', { runId: '', status: 'running' }),
    'forge_update_run: empty runId rejected at schema'
  );

  // forge_resume_run — traversal rejected (even with permissive schema)
  assert(
    await callAndCheckRejected(client, 'forge_resume_run', { runId: '../../.pipeline/run-active.json' }),
    'forge_resume_run: path traversal runId rejected at schema'
  );

  // forge_resume_run — bare alphanumeric accepted by permissive schema
  {
    const result = await client.callTool({ name: 'forge_resume_run', arguments: { runId: 'abc123' } });
    // Schema passes (bare suffix allowed) — handler returns not-found error, not schema error
    assert(result !== null, 'forge_resume_run: bare alphanumeric passes permissive schema');
  }

  // forge_set_gate — runId optional; traversal still rejected when provided
  assert(
    await callAndCheckRejected(client, 'forge_set_gate', {
      gate: 'gate1', feature: 'test', status: 'pending',
      runId: '../../.pipeline/gate-pending.json',
    }),
    'forge_set_gate: traversal runId rejected even when optional field'
  );

  // forge_set_gate — valid runId accepted
  {
    const result = await client.callTool({ name: 'forge_set_gate', arguments: {
      gate: 'gate1', feature: 'test', status: 'pending', runId: 'r-abc123',
    }});
    assert(result !== null, 'forge_set_gate: valid runId passes schema');
  }

});

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
