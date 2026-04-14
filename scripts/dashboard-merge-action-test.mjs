#!/usr/bin/env node
// Regression test: POST /api/merge-action must return the expected failure
// response for a merge-blocked run (no actual worktree to merge), refresh
// the mergeBlocked marker on the run, and return correct error codes for
// invalid / missing / non-blocked inputs.
//
// Run: node scripts/dashboard-merge-action-test.mjs
//
// Spawns the real scripts/dashboard-server.mjs against a seeded temp
// project (git-initialised so forge-worktree.js doesn't reject it outright),
// exercises the action endpoint, and asserts both immediate responses and the
// resulting dashboard-state transitions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'dashboard-server.mjs');
const PORT = 17885;
const ISO = '2026-04-14T00:00:00.000Z';

function seed() {
  const p = mkdtempSync(join(tmpdir(), 'forge-merge-action-test-'));

  // Git repo required — forge-worktree.js calls ensureGitRepo().
  execSync('git init', { cwd: p, stdio: 'pipe' });
  writeFileSync(join(p, 'README.md'), '# test\n');
  execSync('git add -A && git commit -m "init"', { cwd: p, stdio: 'pipe' });

  mkdirSync(join(p, '.pipeline', 'runs', 'r-blocked'), { recursive: true });
  writeFileSync(join(p, '.pipeline', 'runs', 'r-blocked', 'run.json'), JSON.stringify({
    runId: 'r-blocked', sessionId: 'sess-test', projectRoot: p,
    worktreePath: join(p, '.worktrees', 'r-blocked'), branchName: 'forge/r-blocked',
    pipelineType: 'apply', mode: 'LEAN', feature: 'blocked feature',
    status: 'completed', createdAt: ISO, updatedAt: ISO,
    currentStep: 'done', gateState: null, agents: [],
    artifacts: { plan: null, handoff: null, scout: null },
    mergeBlocked: { reason: 'Merge failed — conflicts.', detectedAt: ISO },
  }, null, 2));

  mkdirSync(join(p, '.pipeline', 'runs', 'r-normal'), { recursive: true });
  writeFileSync(join(p, '.pipeline', 'runs', 'r-normal', 'run.json'), JSON.stringify({
    runId: 'r-normal', sessionId: 'sess-test', projectRoot: p,
    worktreePath: null, branchName: null,
    pipelineType: 'plan', mode: 'LEAN', feature: 'normal feature',
    status: 'completed', createdAt: ISO, updatedAt: ISO,
    currentStep: 'done', gateState: null, agents: [],
    artifacts: { plan: null, handoff: null, scout: null },
  }, null, 2));

  writeFileSync(join(p, '.pipeline', 'runs', 'index.json'), JSON.stringify({
    runs: [
      { runId: 'r-blocked', pipelineType: 'apply', feature: 'blocked feature', status: 'completed', createdAt: ISO, updatedAt: ISO },
      { runId: 'r-normal', pipelineType: 'plan', feature: 'normal feature', status: 'completed', createdAt: ISO, updatedAt: ISO },
    ],
  }, null, 2));

  writeFileSync(join(p, '.pipeline', 'board.json'), JSON.stringify({ todos: [], planned: [] }, null, 2));
  return p;
}

function fail(msg) {
  console.error('[dashboard-merge-action] FAIL');
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
  const r = await fetch(base + '/api/merge-action', {
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

    // --- Assertion 1: retry returns 409 (merge fails — no worktree on disk) ---
    const retry = await post(base, { runId: 'r-blocked', action: 'retry' });
    if (retry.status !== 409) fail('retry: expected 409, got ' + retry.status);
    if (retry.body.ok !== false) fail('retry: expected ok=false, got ' + JSON.stringify(retry.body));

    // --- Assertion 2: post-retry state shows mergeBlocked refreshed ---
    const state = await (await fetch(base + '/api/dashboard-state')).json();
    const blocked = state.recentCompleted.find(r => r.runId === 'r-blocked');
    if (!blocked || !blocked.mergeBlocked)
      fail('post-retry: mergeBlocked should still be present');
    if (blocked.mergeBlocked.detectedAt === ISO)
      fail('post-retry: detectedAt should be refreshed, still has original ' + ISO);

    // --- Assertion 3: non-merge-blocked run returns 409 ---
    const notBlocked = await post(base, { runId: 'r-normal', action: 'retry' });
    if (notBlocked.status !== 409) fail('not-blocked: expected 409, got ' + notBlocked.status);

    // --- Assertion 4: unknown run returns 404 ---
    const unknown = await post(base, { runId: 'r-nonexist', action: 'retry' });
    if (unknown.status !== 404) fail('unknown: expected 404, got ' + unknown.status);

    // --- Assertion 5: discard returns 200 and clears merge-blocked ---
    const discard = await post(base, { runId: 'r-blocked', action: 'discard' });
    if (discard.status !== 200) fail('discard: expected 200, got ' + discard.status);
    if (discard.body.ok !== true) fail('discard: expected ok=true, got ' + JSON.stringify(discard.body));

    // --- Assertion 6: post-discard state shows run as discarded, no mergeBlocked ---
    const stateAfterDiscard = await (await fetch(base + '/api/dashboard-state')).json();
    const discardedRun = stateAfterDiscard.recentCompleted.find(r => r.runId === 'r-blocked');
    if (!discardedRun) fail('post-discard: r-blocked should still appear in recentCompleted');
    if (discardedRun.status !== 'discarded') fail('post-discard: expected status=discarded, got ' + discardedRun.status);
    if (discardedRun.mergeBlocked) fail('post-discard: mergeBlocked should be null/cleared');

    // --- Assertion 7: re-discard returns 409 (no longer merge-blocked) ---
    const reDiscard = await post(base, { runId: 'r-blocked', action: 'discard' });
    if (reDiscard.status !== 409) fail('re-discard: expected 409, got ' + reDiscard.status);

    // --- Assertion 8: invalid action returns 400 ---
    const badAction = await post(base, { runId: 'r-normal', action: 'nuke' });
    if (badAction.status !== 400) fail('bad action: expected 400, got ' + badAction.status);

    // --- Assertion 9: missing runId returns 400 ---
    const noId = await post(base, { action: 'retry' });
    if (noId.status !== 400) fail('missing runId: expected 400, got ' + noId.status);

    console.log('[dashboard-merge-action] PASS');
    console.log('  retry (no worktree): 409 ok=false');
    console.log('  post-retry state: mergeBlocked refreshed (detectedAt > original)');
    console.log('  not-blocked: 409');
    console.log('  unknown run: 404');
    console.log('  discard: 200 ok=true');
    console.log('  post-discard: status=discarded, mergeBlocked=null');
    console.log('  re-discard: 409 (no longer merge-blocked)');
    console.log('  bad action: 400');
    console.log('  missing runId: 400');

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
  console.error('[dashboard-merge-action] unexpected throw:', err);
  process.exit(1);
});
