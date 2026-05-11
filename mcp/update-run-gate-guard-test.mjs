#!/usr/bin/env node
// @covers mcp/server.js
//
// Tests for the gate-type-aware guard in forge_update_run.
// The guard must distinguish:
//   - gate2+approved → completed: BLOCKED (gate2 approval is a reviewer pass, not merge consent)
//   - commit+approved → completed: ALLOWED (commit gate approval = merge consent)
//   - no gateState + no token → BLOCKED
//   - gateState.status=pending → BLOCKED
//   - status:failed → bypasses gate check entirely (ALLOWED)
//
// Run: node mcp/update-run-gate-guard-test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
    pipelineType: 'implement',
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
  try { index = JSON.parse(readFileSync(indexPath, 'utf-8')); } catch (_) {}
  index.runs.push({
    runId,
    pipelineType: 'implement',
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
  const tmp = mkdtempSync(join(tmpdir(), 'update-run-gate-guard-test-'));
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

console.log('\n── update-run-gate-guard-test.mjs ───────────────────────────────────────');

await withServer(async (client, tmp, pipelineDir) => {

  // Scenario (a): gate2+approved → completed must be BLOCKED.
  // Under the current buggy code, gateAlreadyApproved = true for ANY approved gateState,
  // so this transition is incorrectly ALLOWED. The fixed guard must check gate === 'commit'.
  // Note: runId schema is /^r-[a-zA-Z0-9]+$/ — no internal hyphens allowed.
  seedRun(pipelineDir, 'r-gate2approved', 'gate-pending', {
    gate: 'gate2',
    status: 'approved',
    feature: 'test-feature',
    createdAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:01:00.000Z',
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-gate2approved', status: 'completed' },
    });
    assert(
      isBlocked(result),
      'gate2 with approved gateState → completed is BLOCKED',
    );
  }

  // Scenario (b): commit+approved → completed must be ALLOWED.
  // Commit gate approval is the merge-consent signal; this transition is legitimate.
  seedRun(pipelineDir, 'r-commitapproved', 'gate-pending', {
    gate: 'commit',
    status: 'approved',
    feature: 'test-feature',
    createdAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:01:00.000Z',
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-commitapproved', status: 'completed' },
    });
    assert(
      !isBlocked(result),
      'commit gate with approved gateState → completed is ALLOWED',
    );
  }

  // Scenario (c): no gateState + no token → BLOCKED.
  seedRun(pipelineDir, 'r-nogatestate', 'gate-pending', null);

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-nogatestate', status: 'completed' },
    });
    assert(
      isBlocked(result),
      'gate-pending with null gateState → completed is BLOCKED',
    );
  }

  // Scenario (d): gateState.status=pending → BLOCKED.
  seedRun(pipelineDir, 'r-gate2pending', 'gate-pending', {
    gate: 'gate2',
    status: 'pending',
    feature: 'test-feature',
    createdAt: '2026-01-01T00:00:00.000Z',
    approvedAt: null,
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-gate2pending', status: 'completed' },
    });
    assert(
      isBlocked(result),
      'gate2 with pending gateState → completed is BLOCKED',
    );
  }

  // Scenario (e): status:failed bypasses the gate check entirely → ALLOWED.
  // Cleanup transitions must never be gated.
  seedRun(pipelineDir, 'r-gate2fail', 'gate-pending', {
    gate: 'gate2',
    status: 'pending',
    feature: 'test-feature',
    createdAt: '2026-01-01T00:00:00.000Z',
    approvedAt: null,
  });

  {
    const result = await client.callTool({
      name: 'forge_update_run',
      arguments: { runId: 'r-gate2fail', status: 'failed' },
    });
    assert(
      !isBlocked(result),
      'status:failed bypasses gate check entirely → ALLOWED',
    );
  }

});

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
