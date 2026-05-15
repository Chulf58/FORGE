// @covers mcp/lib/tools/board.js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('board.js exports a register function', async () => {
  const mod = await import('./board.js');
  assert.equal(typeof mod.register, 'function', 'register must be a function');
});

test('register registers exactly the 9 board tools', async () => {
  const { register } = await import('./board.js');
  const registered = [];
  const fakeServer = {
    registerTool: (name) => { registered.push(name); },
  };
  register(fakeServer, {});
  const expected = [
    'forge_read_board',
    'forge_add_todo',
    'forge_update_task',
    'forge_add_note',
    'forge_read_notes',
    'forge_delete_note',
    'forge_read_project',
    'forge_update_config',
    'forge_set_blocked_by',
  ];
  assert.deepEqual(registered.sort(), expected.sort());
});
