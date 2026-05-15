#!/usr/bin/env node
// @covers mcp/server.js
// Integration tests for forge_create_run classification persistence (task 1).
//
// AC-1: When forge_create_run is called with a non-null classificationId,
// classification.json is written to .pipeline/runs/<runId>/classification.json.
// The file is absent when classificationId is null.
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

    // ── Test 1: classificationId non-null → classification.json written ───
    const classifyResult = parseToolResult(await callTool(client, 'forge_classify_risk', {
      feature: 'server-test-feature',
      filePaths: ['mcp/server.js'],
    }));
    const classificationId = classifyResult.classificationId;
    if (!classificationId) {
      failure = 'forge_classify_risk did not return a classificationId';
    }

    if (!failure) {
      const createResult = parseToolResult(await callTool(client, 'forge_create_run', {
        sessionId: 'sess-server-test',
        pipelineType: 'implement',
        feature: 'server-test-feature',
        spawnWorker: false,
        classificationId,
      }));
      const runId = createResult.runId;
      if (!runId) {
        failure = 'forge_create_run did not return a runId';
      } else {
        const classPath = join(projectDir, '.pipeline', 'runs', runId, 'classification.json');
        if (!existsSync(classPath)) {
          failure = 'classification.json not found at ' + classPath + ' after forge_create_run with classificationId';
        } else {
          const saved = JSON.parse(readFileSync(classPath, 'utf-8'));
          if (saved.classificationId !== classificationId) {
            failure = 'classification.json classificationId mismatch: expected ' + classificationId + ', got ' + saved.classificationId;
          } else {
            console.error('[server-test] test 1 PASS — classification.json written with correct classificationId');
          }
        }
      }
    }

    // ── Test 2: classificationId null → classification.json NOT written ───
    if (!failure) {
      const createResult2 = parseToolResult(await callTool(client, 'forge_create_run', {
        sessionId: 'sess-server-test',
        pipelineType: 'implement',
        feature: 'server-test-feature',
        spawnWorker: false,
        classificationId: null,
      }));
      const runId2 = createResult2.runId;
      if (!runId2) {
        failure = 'forge_create_run (null classificationId) did not return a runId';
      } else {
        const classPath2 = join(projectDir, '.pipeline', 'runs', runId2, 'classification.json');
        if (existsSync(classPath2)) {
          failure = 'classification.json should NOT exist when classificationId is null, but found at ' + classPath2;
        } else {
          console.error('[server-test] test 2 PASS — classification.json absent when classificationId is null');
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
