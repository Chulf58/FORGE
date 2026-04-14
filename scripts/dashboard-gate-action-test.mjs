#!/usr/bin/env node
// Regression test: POST /api/gate-action must approve a pending gate,
// transition the run to completed, and return correct error codes for
// invalid / missing / non-gate-pending inputs.
//
// Run: node scripts/dashboard-gate-action-test.mjs
//
// Spawns the real scripts/dashboard-server.mjs against a seeded temp
// project, exercises the action endpoint, and asserts both immediate
// responses and the resulting dashboard-state transitions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'dashboard-server.mjs');
const PORT = 17883;
const ISO = '2026-04-14T00:00:00.000Z';

function writeRun(dir, runId, overrides) {
  mkdirSync(join(dir, '.pipeline', 'runs', runId), { recursive: true });
  writeFileSync(
    join(dir, '.pipeline', 'runs', runId, 'run.json'),
    JSON.stringify({
      runId, sessionId: 'sess-test', projectRoot: dir,
      worktreePath: null, branchName: null,
      pipelineType: 'plan', mode: 'LEAN', feature: 'test feature',
      status: 'gate-pending', createdAt: ISO, updatedAt: ISO,
      currentStep: 'gate1',
      gateState: { gate: 'gate1', status: 'pending', feature: 'test feature', createdAt: ISO, approvedAt: null },
      agents: [], artifacts: { plan: null, handoff: null, scout: null },
      ...overrides,
    }, null, 2)
  );
}

function seed() {
  const p = mkdtempSync(join(tmpdir(), 'forge-gate-action-test-'));
  mkdirSync(join(p, '.pipeline', 'runs'), { recursive: true });
  writeRun(p, 'r-gate01', {});
  writeFileSync(join(p, '.pipeline', 'runs', 'index.json'), JSON.stringify({
    runs: [{ runId: 'r-gate01', pipelineType: 'plan', feature: 'test feature', status: 'gate-pending', createdAt: ISO, updatedAt: ISO }],
  }, null, 2));
  writeFileSync(join(p, '.pipeline', 'gate-pending.json'), JSON.stringify({
    gate: 'gate1', feature: 'test feature', status: 'pending', createdAt: ISO, runId: 'r-gate01',
  }, null, 2));
  writeFileSync(join(p, '.pipeline', 'board.json'), JSON.stringify({ todos: [], planned: [] }, null, 2));
  return p;
}

function fail(msg) {
  console.error('[dashboard-gate-action] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function waitForServer(base, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { const r = await fetch(base + '/api/dashboard-state'); if (r.ok) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server did not become ready within ' + ms + 'ms');
}

async function post(base, body) {
  const r = await fetch(base + '/api/gate-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function main() {
  const projectDir = seed();
  let proc = null;

  try {
    proc = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, FORGE_DASHBOARD_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});

    const base = 'http://127.0.0.1:' + PORT;
    await waitForServer(base, 8000);

    // --- Assertion 1: approve succeeds with HTTP 200 and ok: true ---
    const approve = await post(base, { runId: 'r-gate01', action: 'approve' });
    if (approve.status !== 200) fail('approve: expected 200, got ' + approve.status);
    if (!approve.body.ok) fail('approve: expected ok=true, got ' + JSON.stringify(approve.body));

    // --- Assertion 2: post-action state reflects the transition ---
    const state = await (await fetch(base + '/api/dashboard-state')).json();
    if (state.gatesAwaiting.length !== 0)
      fail('post-approve gatesAwaiting should be empty, got ' + state.gatesAwaiting.length);
    if (state.recentCompleted.length !== 1)
      fail('post-approve recentCompleted should have 1 entry, got ' + state.recentCompleted.length);
    if (state.recentCompleted[0].status !== 'completed')
      fail('approved run should be completed, got ' + state.recentCompleted[0].status);

    // --- Assertion 3: re-approve returns 409 (non-gate-pending) ---
    const reApprove = await post(base, { runId: 'r-gate01', action: 'approve' });
    if (reApprove.status !== 409) fail('re-approve: expected 409, got ' + reApprove.status);

    // --- Assertion 4: unknown run returns 404 ---
    const unknown = await post(base, { runId: 'r-nonexist', action: 'discard' });
    if (unknown.status !== 404) fail('unknown run: expected 404, got ' + unknown.status);

    // --- Assertion 5: missing runId returns 400 ---
    const noId = await post(base, { action: 'approve' });
    if (noId.status !== 400) fail('missing runId: expected 400, got ' + noId.status);

    // --- Assertion 6: invalid action returns 400 ---
    const badAction = await post(base, { runId: 'r-gate01', action: 'restart' });
    if (badAction.status !== 400) fail('bad action: expected 400, got ' + badAction.status);

    console.log('[dashboard-gate-action] PASS');
    console.log('  approve: 200 ok=true');
    console.log('  post-action state: gatesAwaiting=0, recentCompleted=1 (completed)');
    console.log('  re-approve: 409');
    console.log('  unknown run: 404');
    console.log('  missing runId: 400');
    console.log('  bad action: 400');

  } catch (err) {
    fail('test harness error: ' + (err && err.stack || String(err)));
  } finally {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 2000);
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(err => {
  console.error('[dashboard-gate-action] unexpected throw:', err);
  process.exit(1);
});
