#!/usr/bin/env node
// Integration test: forge_advance_stage auto-completes prior running stage
// when the run is gate-pending with gateState approved (closes 7fe538ee
// sub-bug 3).
//
// Without auto-complete, the conductor must manually patch
// stages.<prior>.status = "completed" via forge_update_run before every
// forge_advance_stage call, because the worker doesn't update stage status
// on exit. Hit on every gate1 approval today.
//
// Run: node mcp/advance-stage-auto-complete-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

function fail(msg) {
  console.error('[advance-stage-auto-complete] FAIL');
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

function seed(projectDir) {
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(join(projectDir, 'docs', 'PLAN.md'), '# PLAN\n\n### Feature: auto-complete-test\n\n- [ ] Task 1\n');
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-autocomplete-test-'));
  seed(projectDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-autocomplete-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);

    // ── Step 1: create a plan run with stages.plan.status='running' ───────
    const planCreate = parseToolResult(await callTool(client, 'forge_create_run', {
      sessionId: 'autocomplete-test',
      pipelineType: 'plan',
      feature: 'auto-complete-test',
      spawnWorker: false,
      stages: { plan: { agents: ['planner'], status: 'running' } },
    }));
    const runId = planCreate.runId;
    if (!runId) failure = 'plan create did not return runId';

    // ── Step 2: pre-write gate-approval token + approve gate1 ─────────────
    if (!failure) {
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      writeFileSync(
        join(projectDir, '.pipeline', 'action-approved.json'),
        JSON.stringify({ actions: ['gate-approve'], expiresAt }),
      );
      parseToolResult(await callTool(client, 'forge_set_gate', {
        gate: 'gate1',
        feature: 'auto-complete-test',
        status: 'approved',
        runId,
      }));
    }

    // ── Step 3: confirm prior state — stages.plan.status is still 'running' ──
    if (!failure) {
      const runData = readRunJson(projectDir, runId);
      if (!runData.stages || !runData.stages.plan) {
        failure = 'run.json missing stages.plan after gate1 approval';
      } else if (runData.stages.plan.status !== 'running') {
        failure = 'precondition: stages.plan.status should still be "running" before advance, got: ' + runData.stages.plan.status;
      } else {
        console.error('[advance-stage-auto-complete] step 3 PASS — precondition: plan.status="running" before advance');
      }
    }

    // ── Step 4: forge_advance_stage to implement WITHOUT pre-patching plan.status ──
    // This is the auto-complete behavior under test. Pre-fix, this errors with
    // "Stage `plan` is still running — complete it before advancing". Post-fix,
    // it auto-completes plan and proceeds.
    if (!failure) {
      try {
        parseToolResult(await callTool(client, 'forge_advance_stage', {
          runId,
          targetStage: 'implement',
          agents: ['coder'],
        }));
      } catch (err) {
        failure = 'forge_advance_stage failed when prior stage running + gate approved: ' + err.message;
      }
    }

    // ── Step 5: confirm stages.plan.status auto-flipped to 'completed' ────
    if (!failure) {
      const runData = readRunJson(projectDir, runId);
      if (!runData.stages || !runData.stages.plan) {
        failure = 'run.json missing stages.plan after advance';
      } else if (runData.stages.plan.status !== 'completed') {
        failure = 'INVARIANT: stages.plan.status should be auto-completed by advance, got: ' + runData.stages.plan.status;
      } else if (!runData.stages.implement || runData.stages.implement.status !== 'running') {
        failure = 'stages.implement.status should be "running" after advance, got: ' + (runData.stages.implement && runData.stages.implement.status);
      } else {
        console.error('[advance-stage-auto-complete] step 5 PASS — plan auto-completed, implement running');
      }
    }

    if (!failure) {
      console.error('[advance-stage-auto-complete] PASS');
      console.error('  runId: ' + runId);
      console.error('  stages: plan(running -> auto-completed) + implement(pending -> running)');
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
  console.error('[advance-stage-auto-complete] unexpected throw:', err);
  process.exit(1);
});
