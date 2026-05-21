// @covers mcp/lib/tools/run-lifecycle.js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('run-lifecycle no longer persists classification.json (SPECS surface removed)', () => {
  const src = readFileSync(join(__dirname, 'run-lifecycle.js'), 'utf8');
  assert.ok(
    !src.includes("'classification.json'"),
    'classification.json was a SPECS-only artifact and its write must be removed from forge_create_run',
  );
});

// AC-6: run-lifecycle.js exports register(server, shared) that registers exactly
// the 12 run-lifecycle tools.

const EXPECTED_TOOLS = [
  'forge_create_run',
  'forge_get_run',
  'forge_list_runs',
  'forge_update_run',
  'forge_classify_risk',
  'forge_create_worktree',
  'forge_escalate',
  'forge_resume_run',
  'forge_advance_stage',
  'forge_dashboard_state',
  'forge_kill_worker',
  'forge_respond_to_escalation',
];

test('run-lifecycle exports register function', async () => {
  const mod = await import('./run-lifecycle.js');
  assert.equal(typeof mod.register, 'function', 'register must be a function');
});

test('register() registers exactly the 12 run-lifecycle tools', async () => {
  const mod = await import('./run-lifecycle.js');

  const registered = [];
  const fakeServer = {
    registerTool: (name, _schema, _handler) => {
      registered.push(name);
    },
  };

  // shared param is unused by register() itself (helpers come from shared.js imports)
  mod.register(fakeServer, {});

  assert.deepEqual(
    registered.sort(),
    EXPECTED_TOOLS.slice().sort(),
    'registered tools must match exactly the 12 expected names',
  );
});

test('forge_escalate handler: responseRequested field accepted in schema', async () => {
  const mod = await import('./run-lifecycle.js');
  const registered = {};
  const fakeServer = {
    registerTool: (name, schema, handler) => { registered[name] = { schema, handler }; },
  };
  mod.register(fakeServer, {});
  assert.ok(registered['forge_escalate'], 'forge_escalate must be registered');
  const schema = registered['forge_escalate'].schema.inputSchema;
  // Zod parse must not throw when responseRequested, responseTimeoutMs, responseHints are absent
  const result = schema.safeParse({ runId: 'r-abc12345', type: 'question', message: 'test?' });
  assert.ok(result.success, 'forge_escalate schema must accept base fields without new fields: ' + JSON.stringify(result.error));
  // Must accept the new optional fields
  const result2 = schema.safeParse({ runId: 'r-abc12345', type: 'question', message: 'test?', responseRequested: true, responseTimeoutMs: 30000, responseHints: 'yes or no' });
  assert.ok(result2.success, 'forge_escalate schema must accept new optional fields: ' + JSON.stringify(result2.error));
});

test('forge_respond_to_escalation: tool registered', async () => {
  const mod = await import('./run-lifecycle.js');
  const registered = {};
  const fakeServer = {
    registerTool: (name, _schema, _handler) => { registered[name] = true; },
  };
  mod.register(fakeServer, {});
  assert.ok(registered['forge_respond_to_escalation'], 'forge_respond_to_escalation must be registered');
});

test('register() does not import from run-gate.js (safeguard)', async () => {
  // Verify the module source does not import from './run-gate.js'
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'run-lifecycle.js'),
    'utf8',
  );
  assert.ok(
    !src.includes("from './run-gate.js'") && !src.includes('from "./run-gate.js"'),
    'run-lifecycle.js must not import from run-gate.js',
  );
});
