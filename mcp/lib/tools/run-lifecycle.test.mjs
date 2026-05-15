// @covers mcp/lib/tools/run-lifecycle.js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// AC-6: run-lifecycle.js exports register(server, shared) that registers exactly
// the 11 run-lifecycle tools.

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
];

test('run-lifecycle exports register function', async () => {
  const mod = await import('./run-lifecycle.js');
  assert.equal(typeof mod.register, 'function', 'register must be a function');
});

test('register() registers exactly the 11 run-lifecycle tools', async () => {
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
    'registered tools must match exactly the 11 expected names',
  );
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
