#!/usr/bin/env node
// @covers mcp/lib/tools/run-lifecycle.js
// Regression test: forge_advance_stage sweep ordering race (TODO 9424e08a)
//
// Before the fix: sweepStalePids runs AFTER updateRun(status='running'), so an
// orphan PID from the prior stage can trigger markRunFailed against the newly
// advanced run — leaving run.json with status='failed' instead of 'running'.
//
// After the fix: sweepStalePids runs BEFORE the status flip, so the orphan PID
// is cleaned up while status is still 'gate-pending' and markRunFailed's guard
// (`runData.status === 'running'`) never fires.
//
// The test calls forge_advance_stage via the MCP server transport (same pattern
// as advance-stage-auto-complete-test.mjs) so it exercises the real handler.
//
// Run: node mcp/advance-stage-sweep-race-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');
const LABEL = '[advance-stage-sweep-race]';

function fail(msg) {
  console.error(LABEL + ' FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

function callTool(client, name, args) {
  return client.callTool({ name, arguments: args });
}

function parseToolResult(result) {
  if (result.isError) {
    throw new Error('tool returned isError=true: ' + JSON.stringify(result.content));
  }
  const block = (result.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no text content in tool result');
  return JSON.parse(block.text);
}

function readRunJson(projectDir, runId) {
  const p = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Returns a PID that is guaranteed to be dead.
 * Spawns and immediately exits a child node process; by the time spawnSync
 * returns, the OS has reaped the child so its PID is guaranteed dead.
 * @returns {number}
 */
function getDeadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 5000 });
  if (result.pid == null || result.pid <= 0) {
    return 2147483646;
  }
  return result.pid;
}

function seedStalePidFile(projectDir, runId, pid) {
  const pidsDir = join(projectDir, '.pipeline', 'worker-pids');
  mkdirSync(pidsDir, { recursive: true });
  const filePath = join(pidsDir, runId + '.json');
  writeFileSync(filePath, JSON.stringify({
    runId,
    pid,
    startedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

function seed(projectDir) {
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(
    join(projectDir, 'docs', 'PLAN.md'),
    '# PLAN\n\n### Feature: sweep-race-test\n\n- [ ] Task 1\n',
  );
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-sweep-race-test-'));
  seed(projectDir);

  // Explicitly exclude FORGE_WORKER_SESSION from the server env — if this test runs
  // inside a worker session, the MCP server would inherit that env var and
  // forge_advance_stage would return early (before sweepStalePids), hiding the race.
  const serverEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete serverEnv.FORGE_WORKER_SESSION;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: serverEnv,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-sweep-race-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);

    // ── Step 1: create a plan run with stages.plan.status='running' ───────────
    const planCreate = parseToolResult(await callTool(client, 'forge_create_run', {
      sessionId: 'sweep-race-test',
      pipelineType: 'plan',
      feature: 'sweep-race-test',
      spawnWorker: false,
      stages: { plan: { agents: ['planner'], status: 'running' } },
    }));
    const runId = planCreate.runId;
    if (!runId) {
      fail('plan create did not return runId');
      return;
    }

    // ── Step 2: pre-write gate-approval token + approve gate1 ────────────────
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    writeFileSync(
      join(projectDir, '.pipeline', 'action-approved.json'),
      JSON.stringify({ actions: ['gate-approve'], expiresAt }),
    );
    parseToolResult(await callTool(client, 'forge_set_gate', {
      gate: 'gate1',
      feature: 'sweep-race-test',
      status: 'approved',
      runId,
    }));

    // ── Step 3: plant a stale PID file from the "prior stage's worker" ───────
    // This simulates the race: the prior stage's worker exited but left its PID
    // file behind in worker-pids/. The run status is now 'gate-pending' (set by
    // forge_set_gate). The stale PID belongs to the same runId.
    const deadPid = getDeadPid();
    seedStalePidFile(projectDir, runId, deadPid);
    console.error(LABEL + ' step 3: seeded stale PID file, pid=' + deadPid + ', runId=' + runId);

    // ── Step 4: call forge_advance_stage (spawnWorker=false to isolate the bug) ──
    // Without the fix: updateRun(status='running') runs BEFORE sweepStalePids.
    // The sweep then sees status='running' + dead PID → calls markRunFailed.
    // The run ends up with status='failed' instead of 'running'.
    //
    // With the fix: sweepStalePids runs BEFORE the status flip.
    // Status is still 'gate-pending' when sweep executes → sweep's guard
    // (`runData.status === 'running'`) never fires → run stays 'running'.
    try {
      parseToolResult(await callTool(client, 'forge_advance_stage', {
        runId,
        targetStage: 'implement',
        agents: ['coder'],
        spawnWorker: false,
      }));
    } catch (err) {
      failure = 'forge_advance_stage threw unexpectedly: ' + err.message;
    }

    // ── Step 5: assert run.json status is 'running' after advance ─────────────
    // This is the key assertion. Pre-fix it will be 'failed' (race triggered).
    // Post-fix it will be 'running' (sweep ran first, no race).
    if (!failure) {
      const runData = readRunJson(projectDir, runId);
      if (runData.status !== 'running') {
        failure =
          'RACE DETECTED: expected run.json status="running" after forge_advance_stage, got: ' +
          runData.status +
          (runData.failureReason ? ' (failureReason: ' + runData.failureReason + ')' : '');
      } else {
        console.error(LABEL + ' step 5 PASS — run.json status="running" after advance (sweep ran before flip)');
      }
    }

    // ── Step 6: confirm stages.implement.status is 'running' ─────────────────
    if (!failure) {
      const runData = readRunJson(projectDir, runId);
      if (!runData.stages || !runData.stages.implement || runData.stages.implement.status !== 'running') {
        failure =
          'stages.implement.status should be "running" after advance, got: ' +
          (runData.stages && runData.stages.implement && runData.stages.implement.status);
      } else {
        console.error(LABEL + ' step 6 PASS — stages.implement.status="running"');
      }
    }

    if (!failure) {
      console.error(LABEL + ' PASS');
      console.error('  runId:   ' + runId);
      console.error('  deadPid: ' + deadPid);
      console.error('  result:  sweep ran before status flip — race not triggered');
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
  console.error(LABEL + ' unexpected throw:', err);
  process.exit(1);
});
