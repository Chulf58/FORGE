#!/usr/bin/env node
// @covers mcp/server.js
// Integration tests for forge_create_run (taskBrief flow).
//
// Run: node mcp/server-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

function fail(msg) {
  console.error('[server-test] FAIL');
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

function seed(projectDir) {
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(join(projectDir, 'docs', 'PLAN.md'), '# PLAN\n\n### Feature: server-test\n\n- [ ] Task 1\n');
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
}

async function seedApprovedPlanRun(client, projectDir) {
  const planCreate = parseToolResult(await callTool(client, 'forge_create_run', {
    sessionId: 'sess-server-test',
    pipelineType: 'plan',
    feature: 'server-test-feature',
    spawnWorker: false,
  }));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, '.pipeline', 'action-approved.json'),
    JSON.stringify({ actions: ['gate-approve'], expiresAt }),
  );
  parseToolResult(await callTool(client, 'forge_set_gate', {
    gate: 'gate1',
    feature: 'server-test-feature',
    status: 'approved',
    runId: planCreate.runId,
  }));
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-server-test-'));
  seed(projectDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-server-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);
    await seedApprovedPlanRun(client, projectDir);

    // ── Test: taskBrief flows through to worker-task JSON ──────────────────
    // Exercises the additive taskBrief parameter on forge_create_run.
    // Uses spawnWorker:true to trigger the worker-task write at mcp/server.js,
    // then kills the worker immediately to avoid API token cost.
    if (!failure) {
      // Re-seed an approved plan so the implement-pipeline guard passes.
      await seedApprovedPlanRun(client, projectDir);
      const briefText = 'Test brief content\nLine two of brief';
      const createResult3 = parseToolResult(await callTool(client, 'forge_create_run', {
        sessionId: 'sess-server-test',
        pipelineType: 'implement',
        feature: 'task-brief-feature',
        spawnWorker: true,
        useWorktree: false,
        taskBrief: briefText,
      }));
      const runId3 = createResult3.runId;
      // Kill the spawned worker immediately to limit cost. The worker-task JSON
      // is written synchronously by the MCP process BEFORE the child spawn, so
      // it is already on disk regardless of the kill.
      try {
        await callTool(client, 'forge_kill_worker', { runId: runId3 });
      } catch (_) { /* best-effort cleanup */ }
      if (!runId3) {
        failure = 'forge_create_run (taskBrief) did not return a runId';
      } else {
        const taskJsonPath = join(projectDir, '.pipeline', 'worker-task-' + runId3 + '.json');
        // The worker-task file may be unlinked by the spawned worker's
        // worker-task-inject.js hook on SessionStart. To make the assertion
        // deterministic we read it synchronously after forge_create_run returns —
        // before the spawned worker has had time to start its hooks.
        if (!existsSync(taskJsonPath)) {
          failure = 'worker-task JSON not written at ' + taskJsonPath + ' (forge_create_run with spawnWorker:true should write it synchronously)';
        } else {
          const taskJson = JSON.parse(readFileSync(taskJsonPath, 'utf-8'));
          if (taskJson.taskBrief !== briefText) {
            failure = 'taskBrief missing or mismatched in worker-task JSON. Expected: ' + JSON.stringify(briefText) + '. Got: ' + JSON.stringify(taskJson.taskBrief);
          } else {
            console.error('[server-test] PASS — taskBrief persisted to worker-task JSON');
          }
        }
      }
    }

    if (!failure) {
      console.error('[server-test] PASS');
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
  console.error('[server-test] unexpected throw:', err);
  process.exit(1);
});
