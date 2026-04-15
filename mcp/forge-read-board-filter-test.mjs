#!/usr/bin/env node
// Regression test: `forge_read_board` honours the new `filter` object + `fields`
// projection added as part of Option B (ergonomic MCP tool extensions). Ensures
// that legacy no-argument / flat-field callers keep working unchanged.
//
// Run: node mcp/forge-read-board-filter-test.mjs
//
// Integration-style test: spawns the real mcp/server.js over stdio using the
// same SDK Claude Code does, seeds a fixture with 6 TODOs spanning
// done/open × high/medium/low × several tags, and asserts the returned
// payload for each filter/projection case.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

function seed() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-read-board-filter-test-'));
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });

  // 6 TODOs designed to exercise every filter dimension:
  //   - open × high   (alpha)             → t1
  //   - open × high   (beta)              → t2
  //   - open × medium (alpha + gamma)     → t3
  //   - open × low    (no tags)           → t4
  //   - done × high   (alpha)             → t5
  //   - done × medium (beta)              → t6
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({
      todos: [
        { id: 't1', priority: 'high',   text: 'Open high A',   tags: ['alpha'] },
        { id: 't2', priority: 'high',   text: 'Open high B',   tags: ['beta'] },
        { id: 't3', priority: 'medium', text: 'Open medium',   tags: ['alpha', 'gamma'] },
        { id: 't4', priority: 'low',    text: 'Open low',      tags: [] },
        { id: 't5', priority: 'high',   text: 'Done high',     tags: ['alpha'], done: true, doneAt: 1 },
        { id: 't6', priority: 'medium', text: 'Done medium',   tags: ['beta'],  done: true, doneAt: 2 },
      ],
      planned: [],
    }, null, 2)
  );

  return projectDir;
}

function fail(msg) {
  console.error('[forge-read-board-filter] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

function idsOf(arr) {
  return arr.map(x => x.id).sort();
}

async function callBoard(client, args) {
  const result = await client.callTool({ name: 'forge_read_board', arguments: args });
  if (result.isError) {
    throw new Error('tool returned isError=true: ' + JSON.stringify(result.content));
  }
  const block = (result.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no text content in result');
  return JSON.parse(block.text);
}

async function main() {
  const projectDir = seed();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-read-board-filter-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);

    // 1. New path: filter.done=false — open items only.
    {
      const items = await callBoard(client, { filter: { done: false } });
      const expect = ['t1', 't2', 't3', 't4'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.done=false: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 2. New path: filter.priority="high" — all high items, open AND done.
    if (!failure) {
      const items = await callBoard(client, { filter: { priority: 'high' } });
      const expect = ['t1', 't2', 't5'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.priority="high": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 3. New path: filter.tag="alpha" — any-of semantics; done + open both included.
    if (!failure) {
      const items = await callBoard(client, { filter: { tag: 'alpha' } });
      const expect = ['t1', 't3', 't5'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.tag="alpha": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 4. New path: filter.priority as an array — "high" or "low".
    if (!failure) {
      const items = await callBoard(client, { filter: { priority: ['high', 'low'] } });
      const expect = ['t1', 't2', 't4', 't5'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.priority=["high","low"]: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 5. Combined filter: high + not done → t1, t2.
    if (!failure) {
      const items = await callBoard(client, { filter: { priority: 'high', done: false } });
      const expect = ['t1', 't2'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'combined filter high+!done: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 6. Field projection: fields=["id","priority"] — response carries only those keys.
    if (!failure) {
      const items = await callBoard(client, { filter: { done: false }, fields: ['id', 'priority'] });
      if (items.length !== 4) {
        failure = 'fields projection: expected 4 items, got ' + items.length;
      } else {
        for (const item of items) {
          const keys = Object.keys(item).sort();
          if (JSON.stringify(keys) !== JSON.stringify(['id', 'priority'])) {
            failure = 'fields projection: expected keys ["id","priority"], got ' + JSON.stringify(keys);
            break;
          }
        }
      }
    }

    // 7. Empty-result edge case: low + done → no todos match (t4 is low-open; t5/t6 are high/medium done).
    if (!failure) {
      const items = await callBoard(client, { filter: { priority: 'low', done: true } });
      if (items.length !== 0) {
        failure = 'empty-result edge: expected 0, got ' + items.length + ' (' + JSON.stringify(idsOf(items)) + ')';
      }
    }

    // 8. Backward-compat: no arguments → legacy path, status default "open" → t1..t4 with full shape.
    if (!failure) {
      const items = await callBoard(client, {});
      const expect = ['t1', 't2', 't3', 't4'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'legacy no-args: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      } else {
        // Verify full shape preserved (at minimum id, priority, text, tags should exist on all items).
        for (const item of items) {
          for (const k of ['id', 'priority', 'text', 'tags']) {
            if (!(k in item)) {
              failure = 'legacy no-args: item ' + item.id + ' missing key ' + k;
              break;
            }
          }
          if (failure) break;
        }
      }
    }

    // 9. Backward-compat: legacy flat `priority: "high"` still works when `filter` absent.
    if (!failure) {
      const items = await callBoard(client, { priority: 'high' });
      // Legacy path: status default "open" + priority "high" → t1, t2 (not t5 because legacy filters open).
      const expect = ['t1', 't2'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'legacy flat priority="high": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    if (!failure) {
      console.log('[forge-read-board-filter] PASS');
      console.log('  filter.done=false      → 4 items');
      console.log('  filter.priority=high   → 3 items');
      console.log('  filter.tag=alpha       → 3 items');
      console.log('  filter.priority=[h,l]  → 4 items (array)');
      console.log('  combined high+!done    → 2 items');
      console.log('  fields=[id,priority]   → 4 items, 2 keys each');
      console.log('  empty-result edge      → 0 items');
      console.log('  legacy no-args         → 4 items, full shape');
      console.log('  legacy priority=high   → 2 items (legacy status=open default)');
    }
  } catch (err) {
    failure = 'test harness error: ' + (err && err.stack || String(err));
  } finally {
    try { await client.close(); } catch (_) {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failure) fail(failure);
  process.exit(0);
}

main().catch((err) => {
  console.error('[forge-read-board-filter] unexpected throw:', err);
  process.exit(1);
});
