#!/usr/bin/env node
// Regression test: the sidecar dashboard HTTP server must respond to
// GET /api/dashboard-state with HTTP 200, content-type application/json,
// and a JSON body containing exactly the four expected top-level keys:
// activeRuns, gatesAwaiting, recentCompleted, boardSummary.
//
// Run: node scripts/dashboard-server-endpoint-test.mjs
//
// Spawns the real scripts/dashboard-server.mjs against a seeded temp
// project, waits for the server to become ready, issues one fetch, asserts
// the response, then tears down the server process and cleans up the
// fixture. No browser automation, no HTML page test — purely endpoint shape.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'dashboard-server.mjs');
const PORT = 17879; // high ephemeral port to avoid collisions

function seed() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dash-endpoint-test-'));
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });

  // Minimal board — enough for boardSummary to have non-zero counts.
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({
      todos: [
        { id: 't1', priority: 'high', text: 'First task' },
        { id: 't2', priority: 'low', text: 'Second task', done: true },
      ],
      planned: [{ id: 'p1', title: 'Planned item' }],
    }, null, 2)
  );

  // Minimal project.json for project identity.
  writeFileSync(
    join(projectDir, '.pipeline', 'project.json'),
    JSON.stringify({ name: 'test-project', techStacks: ['Node.js'], pipelineMode: 'lean' }, null, 2)
  );

  // No runs needed — the test asserts the shape, not specific run content.
  // activeRuns/gatesAwaiting/recentCompleted will be empty arrays, which is valid.

  return projectDir;
}

function fail(msg) {
  console.error('[dashboard-server-endpoint] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become ready within ' + timeoutMs + 'ms');
}

async function main() {
  const projectDir = seed();
  let serverProc = null;

  try {
    // Spawn the real server against the fixture.
    serverProc = spawn(process.execPath, [SERVER_PATH], {
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        FORGE_DASHBOARD_PORT: String(PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Drain stdout/stderr so the child doesn't block on buffer pressure.
    let serverStderr = '';
    serverProc.stdout.on('data', () => {});
    serverProc.stderr.on('data', d => { serverStderr += d; });

    const base = 'http://127.0.0.1:' + PORT;
    await waitForServer(base + '/api/dashboard-state', 8000);

    const res = await fetch(base + '/api/dashboard-state');

    // Assertion 1: HTTP 200
    if (res.status !== 200) {
      fail('expected HTTP 200, got ' + res.status);
    }

    // Assertion 2: content-type is JSON
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      fail('expected content-type application/json, got ' + ct);
    }

    // Assertion 3: body is valid JSON with at least the four core keys + project
    const body = await res.json();
    const required = ['activeRuns', 'boardSummary', 'gatesAwaiting', 'project', 'recentCompleted'];
    const actual = Object.keys(body).sort();
    for (const k of required) {
      if (!actual.includes(k)) fail('missing required key: ' + k);
    }

    // Assertion 4: each group has the right type
    if (!Array.isArray(body.activeRuns)) fail('activeRuns should be an array');
    if (!Array.isArray(body.gatesAwaiting)) fail('gatesAwaiting should be an array');
    if (!Array.isArray(body.recentCompleted)) fail('recentCompleted should be an array');
    if (typeof body.boardSummary !== 'object' || body.boardSummary === null) {
      fail('boardSummary should be a non-null object');
    }

    // Assertion 5: boardSummary reflects the seeded board
    if (body.boardSummary.todoCount !== 1) {
      fail('todoCount should be 1 (one open), got ' + body.boardSummary.todoCount);
    }
    if (body.boardSummary.plannedCount !== 1) {
      fail('plannedCount should be 1, got ' + body.boardSummary.plannedCount);
    }

    // Assertion 6: project identity is present and correct
    if (!body.project || typeof body.project !== 'object') fail('project should be a non-null object');
    if (body.project.name !== 'test-project') fail('project.name should be test-project, got ' + body.project.name);
    if (!body.project.dir) fail('project.dir should be set');

    console.log('[dashboard-server-endpoint] PASS');
    console.log('  HTTP 200, content-type application/json');
    console.log('  keys: ' + actual.join(', '));
    console.log('  boardSummary: todoCount=1, plannedCount=1');
    console.log('  project: name=test-project, dir set');

  } catch (err) {
    fail('test harness error: ' + (err && err.stack || String(err)));
  } finally {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      // Give a moment for cleanup, then force if needed.
      setTimeout(() => { try { serverProc.kill('SIGKILL'); } catch (_) {} }, 2000);
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(err => {
  console.error('[dashboard-server-endpoint] unexpected throw:', err);
  process.exit(1);
});
