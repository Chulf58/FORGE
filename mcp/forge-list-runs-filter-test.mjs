#!/usr/bin/env node
// Regression test: `forge_list_runs` honours the new `filter` object + `fields`
// projection added as part of Option B (ergonomic MCP tool extensions for runs).
// Ensures legacy no-argument / flat-field callers keep working unchanged.
//
// Run: node mcp/forge-list-runs-filter-test.mjs
//
// Integration-style test: spawns the real mcp/server.js over stdio using the
// same SDK Claude Code does, seeds 6 runs spanning status × pipelineType ×
// mode combinations, asserts the returned payload for each filter/projection
// case. Mirrors mcp/forge-read-board-filter-test.mjs in style.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

const ISO = '2026-04-15T00:00:00.000Z';

// 6 runs spanning every filter dimension we exercise.
const RUNS = [
  { runId: 'r-aaaa', pipelineType: 'plan',     mode: 'LEAN',     status: 'created',      feature: 'plan A',   updatedAt: '2026-04-15T01:00:00.000Z' },
  { runId: 'r-bbbb', pipelineType: 'implement',mode: 'STANDARD', status: 'running',      feature: 'impl B',   updatedAt: '2026-04-15T02:00:00.000Z' },
  { runId: 'r-cccc', pipelineType: 'implement',mode: 'FULL',     status: 'gate-pending', feature: 'impl C',   updatedAt: '2026-04-15T03:00:00.000Z' },
  { runId: 'r-dddd', pipelineType: 'plan',     mode: 'LEAN',     status: 'completed',    feature: 'plan D',   updatedAt: '2026-04-15T04:00:00.000Z' },
  { runId: 'r-eeee', pipelineType: 'debug',    mode: 'SPRINT',   status: 'failed',       feature: 'debug E',  updatedAt: '2026-04-15T05:00:00.000Z' },
  { runId: 'r-ffff', pipelineType: 'refactor', mode: 'LEAN',     status: 'discarded',    feature: 'refac F',  updatedAt: '2026-04-15T06:00:00.000Z' },
];

function writeRun(projectDir, run) {
  mkdirSync(join(projectDir, '.pipeline', 'runs', run.runId), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', run.runId, 'run.json'),
    JSON.stringify({
      runId: run.runId,
      sessionId: 'sess-' + run.runId,
      projectRoot: projectDir,
      worktreePath: null,
      branchName: null,
      pipelineType: run.pipelineType,
      mode: run.mode,
      feature: run.feature,
      status: run.status,
      createdAt: ISO,
      updatedAt: run.updatedAt,
      currentStep: null,
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }, null, 2)
  );
}

function seed() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-list-runs-filter-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });

  for (const r of RUNS) writeRun(projectDir, r);

  // Authoritative index — no lazy-heal surprises.
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', 'index.json'),
    JSON.stringify({
      runs: RUNS.map(r => ({
        runId: r.runId,
        pipelineType: r.pipelineType,
        feature: r.feature,
        status: r.status,
        createdAt: ISO,
        updatedAt: r.updatedAt,
      })),
    }, null, 2)
  );

  return projectDir;
}

function fail(msg) {
  console.error('[forge-list-runs-filter] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

function idsOf(arr) {
  return arr.map(x => x.runId).sort();
}

async function callList(client, args) {
  const result = await client.callTool({ name: 'forge_list_runs', arguments: args });
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
  const client = new Client({ name: 'forge-list-runs-filter-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);

    // 1. Single status filter.
    {
      const items = await callList(client, { filter: { status: 'running' } });
      const expect = ['r-bbbb'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.status="running": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 2. Multi-value status filter (array).
    if (!failure) {
      const items = await callList(client, { filter: { status: ['running', 'gate-pending'] } });
      const expect = ['r-bbbb', 'r-cccc'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.status=["running","gate-pending"]: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 3. pipelineType filter (single).
    if (!failure) {
      const items = await callList(client, { filter: { pipelineType: 'plan' } });
      const expect = ['r-aaaa', 'r-dddd'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.pipelineType="plan": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 4. mode filter (forces hydration).
    if (!failure) {
      const items = await callList(client, { filter: { mode: 'LEAN' } });
      const expect = ['r-aaaa', 'r-dddd', 'r-ffff'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'filter.mode="LEAN": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
      // Hydrated runs should carry the `mode` field.
      if (!failure && items.length > 0 && items[0].mode !== 'LEAN') {
        failure = 'filter.mode="LEAN": hydrated entries should carry mode field, got ' + JSON.stringify(Object.keys(items[0]));
      }
    }

    // 5. Combined filter: implement + running → r-bbbb.
    if (!failure) {
      const items = await callList(client, { filter: { pipelineType: 'implement', status: 'running' } });
      const expect = ['r-bbbb'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'combined impl+running: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    // 6. fields projection over no-filter set → 6 items, only requested keys.
    if (!failure) {
      const items = await callList(client, { fields: ['runId', 'status'] });
      if (items.length !== 6) {
        failure = 'fields projection: expected 6 items, got ' + items.length;
      } else {
        for (const item of items) {
          const keys = Object.keys(item).sort();
          if (JSON.stringify(keys) !== JSON.stringify(['runId', 'status'])) {
            failure = 'fields projection: expected keys ["runId","status"], got ' + JSON.stringify(keys);
            break;
          }
        }
      }
    }

    // 7. Empty-result edge: mode=FULL + status=completed → no run matches (r-cccc is FULL but gate-pending).
    if (!failure) {
      const items = await callList(client, { filter: { mode: 'FULL', status: 'completed' } });
      if (items.length !== 0) {
        failure = 'empty-result edge: expected 0, got ' + items.length + ' (' + JSON.stringify(idsOf(items)) + ')';
      }
    }

    // 8. mode filter + fields projection over a non-index key (`mode`) → projection has mode, hydration was needed.
    if (!failure) {
      const items = await callList(client, { filter: { mode: 'LEAN' }, fields: ['runId', 'mode'] });
      const expect = ['r-aaaa', 'r-dddd', 'r-ffff'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'mode+fields: expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      } else {
        for (const item of items) {
          const keys = Object.keys(item).sort();
          if (JSON.stringify(keys) !== JSON.stringify(['mode', 'runId'])) {
            failure = 'mode+fields: expected keys ["mode","runId"], got ' + JSON.stringify(keys);
            break;
          }
        }
      }
    }

    // 9. Backward-compat: no arguments → legacy path, all 6 entries with index-entry shape.
    if (!failure) {
      const items = await callList(client, {});
      if (items.length !== 6) {
        failure = 'legacy no-args: expected 6 items, got ' + items.length;
      } else {
        for (const item of items) {
          for (const k of ['runId', 'pipelineType', 'feature', 'status', 'createdAt', 'updatedAt']) {
            if (!(k in item)) {
              failure = 'legacy no-args: item ' + item.runId + ' missing key ' + k;
              break;
            }
          }
          if (failure) break;
        }
      }
    }

    // 10. Backward-compat: legacy flat status="running" still works when filter absent.
    if (!failure) {
      const items = await callList(client, { status: 'running' });
      const expect = ['r-bbbb'];
      if (JSON.stringify(idsOf(items)) !== JSON.stringify(expect)) {
        failure = 'legacy flat status="running": expected ' + JSON.stringify(expect) + ', got ' + JSON.stringify(idsOf(items));
      }
    }

    if (!failure) {
      console.log('[forge-list-runs-filter] PASS');
      console.log('  filter.status="running"          → 1 item');
      console.log('  filter.status=[run,gate-pend]    → 2 items (array)');
      console.log('  filter.pipelineType="plan"       → 2 items');
      console.log('  filter.mode="LEAN"               → 3 items (hydrated)');
      console.log('  combined impl+running            → 1 item');
      console.log('  fields=[runId,status]            → 6 items, 2 keys');
      console.log('  empty-result mode=FULL+completed → 0 items');
      console.log('  mode + fields=[runId,mode]       → 3 items, hydrated+projected');
      console.log('  legacy no-args                   → 6 items, index shape');
      console.log('  legacy flat status="running"     → 1 item');
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
  console.error('[forge-list-runs-filter] unexpected throw:', err);
  process.exit(1);
});
