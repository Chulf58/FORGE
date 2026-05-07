#!/usr/bin/env node
// Tests for gate-pending → completed transition guard in forge_update_run.
//
// Scenario A: gate-pending run with gateState.status === "approved" → completed ALLOWED
// Scenario B: gate-pending run with gateState.status === "pending" → completed BLOCKED
// Scenario C: gate-pending run with no gateState → completed BLOCKED
//
// Run: node mcp/gate-pending-guard-test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

const MINIMAL_CONFIG = JSON.stringify({
  providers: [
    { id: 'anthropic', type: 'anthropic', envVar: 'ANTHROPIC_API_KEY', enabled: true, name: 'Anthropic', priority: 3 },
  ],
  models: [],
  agentModelMap: {},
});

function seedRun(pipelineDir, runId, status, gateState) {
  const runsDir = join(pipelineDir, 'runs');
  mkdirSync(runsDir, { recursive: true });
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });

  const run = {
    runId,
    sessionId: 'test',
    projectRoot: 'C:\\fake',
    worktreePath: null,
    branchName: null,
    pipelineType: 'debug',
    feature: 'test-feature',
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    gateState: gateState || null,
    agents: [],
    artifacts: { plan: null, handoff: null, scout: null },
    mergeBlocked: null,
    failureReason: null,
    parentRunId: null,
    stages: null,
    classificationId: null,
    reviewerOverrides: [],
    phases: null,
    acknowledged: false,
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2));

  // Update index
  const indexPath = join(runsDir, 'index.json');
  let index = { runs: [] };
  try { index = JSON.parse(require('fs').readFileSync(indexPath, 'utf-8')); } catch (_) {}
  index.runs.push({
    runId,
    pipelineType: 'debug',
    feature: 'test-feature',
    status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    parentRunId: null,
    classificationId: null,
  });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

async function withServer(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'gate-guard-test-'));
  const pipelineDir = join(tmp, '.pipeline');
  mkdirSync(pipelineDir, { recursive: true });
  writeFileSync(join(pipelineDir, 'forge-config.json'), MINIMAL_CONFIG);
  writeFileSync(join(pipelineDir, 'board.json'), JSON.stringify({ todos: [], planned: [] }));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);

  try {
    await fn(client, tmp, pipelineDir);
  } finally {
    await client.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function isBlocked(result) {
  if (!result || !result.content) return false;
  const text = result.content.map(c => c.text || '').join('');
  return text.includes('Cannot transition run from gate-pending');
}

console.log('\n── gate-pending-guard-test.mjs ──────────────────────────────────────────');

await withServer(async (client, tmp, pipelineDir) => {

  // Scenario A: gate approved → completed should be ALLOWED
  seedRun(pipelineDir, 'r-approved1', 'gate-pending', {
    gate: 'commit', status: 'approved', feature: 'test',
    createdAt: '2026-01-01T00:00:00.000Z', approvedAt: '2026-01-01T00:01:00.000Z',
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-approved1', status: 'completed' },
    });
    assert(
      !isBlocked(result),
      'gate-pending with approved gateState → completed is ALLOWED'
    );
  }

  // Scenario B: gate pending → completed should be BLOCKED (no token)
  seedRun(pipelineDir, 'r-pending1', 'gate-pending', {
    gate: 'gate2', status: 'pending', feature: 'test',
    createdAt: '2026-01-01T00:00:00.000Z', approvedAt: null,
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-pending1', status: 'completed' },
    });
    assert(
      isBlocked(result),
      'gate-pending with pending gateState → completed is BLOCKED'
    );
  }

  // Scenario C: gate-pending with null gateState → completed should be BLOCKED
  seedRun(pipelineDir, 'r-nullgate1', 'gate-pending', null);

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-nullgate1', status: 'completed' },
    });
    assert(
      isBlocked(result),
      'gate-pending with null gateState → completed is BLOCKED'
    );
  }

  // Scenario D: gate-pending → failed should always be ALLOWED (not guarded)
  seedRun(pipelineDir, 'r-failtest', 'gate-pending', {
    gate: 'gate1', status: 'pending', feature: 'test',
    createdAt: '2026-01-01T00:00:00.000Z', approvedAt: null,
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-failtest', status: 'failed' },
    });
    assert(
      !isBlocked(result),
      'gate-pending → failed is ALLOWED (bypass for cleanup)'
    );
  }

  // ── forge_check_gate runId targeting ──────────────────────────────────

  // Scenario E: check_gate with runId returns that run's gate from main-root
  // (seed a gate file in main root with a specific runId)
  writeFileSync(
    join(pipelineDir, 'gate-pending.json'),
    JSON.stringify({ gate: 'gate1', status: 'pending', feature: 'run-A-feature', runId: 'r-approved1' })
  );

  {
    const result = await client.callTool({
      name: 'forge_check_gate',
      arguments: { runId: 'r-approved1' },
    });
    const data = JSON.parse(result.content[0].text);
    assert(
      data && data.runId === 'r-approved1',
      'forge_check_gate(runId) returns matching gate from main-root'
    );
  }

  // Scenario F: check_gate with wrong runId returns null (not the other run's gate)
  {
    const result = await client.callTool({
      name: 'forge_check_gate',
      arguments: { runId: 'r-pending1' },
    });
    const data = JSON.parse(result.content[0].text);
    assert(
      data === null,
      'forge_check_gate(runId) returns null when main-root gate belongs to a different run'
    );
  }

  // Scenario G: check_gate without runId still returns the main-root gate (legacy)
  {
    const result = await client.callTool({
      name: 'forge_check_gate',
      arguments: {},
    });
    const data = JSON.parse(result.content[0].text);
    assert(
      data && data.feature === 'run-A-feature',
      'forge_check_gate() without runId returns main-root gate (legacy behavior)'
    );
  }

});

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
