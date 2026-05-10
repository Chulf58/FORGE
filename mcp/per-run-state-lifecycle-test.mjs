#!/usr/bin/env node
// Integration test: per-run stages lifecycle contract through the real MCP server.
//
// Exercises forge_create_run (with stages) → forge_advance_stage → forge_update_run
// and verifies that run.json and index.json reflect the expected state at each step.
//
// Run: node mcp/per-run-state-lifecycle-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

// Inline stageLabelFromStages — mirrors bin/forge-status.js lines 90–99 and
// mcp/lib/stage-labels.js. Kept local to avoid a cross-package import from CJS.
const STAGE_DISPLAY = {
  plan: 'planning', implement: 'implementing', review: 'reviewing',
  apply: 'applying', debug: 'debugging', refactor: 'refactoring', research: 'researching',
};

function stageLabelFromStages(stages) {
  if (!stages || typeof stages !== 'object') return null;
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === 'running') return STAGE_DISPLAY[key] || key;
  }
  for (const [key, val] of Object.entries(stages)) {
    if (val && val.status === 'completed') return STAGE_DISPLAY[key] || key;
  }
  return null;
}

function fail(msg) {
  console.error('[per-run-state-lifecycle] FAIL');
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
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function seed(projectDir) {
  // Seed a minimal PLAN.md so forge_create_run with pipelineType=implement passes
  // its plan-exists guard (checks docs/PLAN.md as fallback).
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(join(projectDir, 'docs', 'PLAN.md'), '# PLAN\n\n### Feature: lifecycle-test\n\n- [ ] Task 1\n');
  // Seed the pipeline directory so index.json writes succeed.
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-lifecycle-test-'));
  seed(projectDir);

  // forge_advance_stage spawns a worker subprocess. Setting FORGE_TEST_NO_SPAWN
  // would suppress it if supported; currently no such env var exists in server.js.
  // However, the run.json update in forge_advance_stage happens synchronously
  // BEFORE any spawn attempt, so our assertion completes before worker side-effects
  // can interfere. The spawn guard also fires when a worker-task file already
  // exists — in this test environment that file is absent, so the spawn will be
  // attempted but will fail harmlessly (no claude binary in PATH in CI).
  // The test still passes because we assert run state, not worker execution.

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-lifecycle-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;
  let runId = null;

  try {
    await client.connect(transport);

    // ── Setup: seed an approved plan run so the implement-create guard at
    //    mcp/server.js:1665-1683 passes. The guard requires at least one
    //    plan run with gateState.gate === 'gate1' && gateState.status === 'approved'.
    //    Without this seeding, forge_create_run for pipelineType='implement'
    //    rejects with "implement pipeline requires a completed plan (gate1 approved)".
    const planCreate = parseToolResult(await callTool(client, 'forge_create_run', {
      sessionId: 'sess-lifecycle-test',
      pipelineType: 'plan',
      feature: 'lifecycle-test-feature',
      spawnWorker: false,
    }));
    const planRunId = planCreate.runId;
    if (!planRunId) {
      failure = 'forge_create_run (plan) did not return a runId';
    } else {
      // Pre-write the gate-approval token (.pipeline/action-approved.json) so
      // forge_set_gate's hasGateApprovalToken guard at mcp/server.js:134-146 + 839
      // accepts the test's approval call. Without this, the guard rejects with
      // "Gate approval requires explicit user authorization" — which is correct
      // behavior in production but blocks integration tests that need to seed an
      // approved-plan state.
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      writeFileSync(
        join(projectDir, '.pipeline', 'action-approved.json'),
        JSON.stringify({ actions: ['gate-approve'], expiresAt }),
      );
      parseToolResult(await callTool(client, 'forge_set_gate', {
        gate: 'gate1',
        feature: 'lifecycle-test-feature',
        status: 'approved',
        runId: planRunId,
      }));
    }

    // ── Step 1: forge_create_run with stages populated ────────────────────
    const createResult = failure ? null : parseToolResult(await callTool(client, 'forge_create_run', {
      sessionId: 'sess-lifecycle-test',
      pipelineType: 'implement',
      feature: 'lifecycle-test-feature',
      spawnWorker: false,
      stages: {
        implement: { agents: ['coder'], status: 'pending' },
      },
    }));

    runId = createResult ? createResult.runId : null;
    if (!failure && !runId) {
      failure = 'forge_create_run did not return a runId';
    }

    if (!failure) {
      // Assert run.json exists with correct stages shape
      const runData = readRunJson(projectDir, runId);
      if (!runData) {
        failure = 'run.json not found after forge_create_run';
      } else if (!runData.stages || !runData.stages.implement) {
        failure = 'run.json missing stages.implement after forge_create_run';
      } else if (runData.stages.implement.status !== 'pending') {
        failure = 'stages.implement.status should be "pending", got: ' + runData.stages.implement.status;
      } else if (!Array.isArray(runData.stages.implement.agents) ||
                 runData.stages.implement.agents[0] !== 'coder') {
        failure = 'stages.implement.agents should be ["coder"], got: ' +
          JSON.stringify(runData.stages.implement.agents);
      } else {
        console.error('[per-run-state-lifecycle] step 1 PASS — run created with stages.implement=pending');
      }
    }

    // ── Step 2: forge_advance_stage → assert stage is running ─────────────
    if (!failure) {
      const advanceResult = parseToolResult(await callTool(client, 'forge_advance_stage', {
        runId,
        targetStage: 'implement',
        agents: ['coder'],
      }));

      // The result contains { runId, targetStage, workerSpawned, logFile }
      if (advanceResult.runId !== runId) {
        failure = 'forge_advance_stage returned unexpected runId: ' + advanceResult.runId;
      }
    }

    if (!failure) {
      // Assert run.json reflects running status
      const runData = readRunJson(projectDir, runId);
      if (!runData) {
        failure = 'run.json not found after forge_advance_stage';
      } else if (runData.stages.implement.status !== 'running') {
        failure = 'stages.implement.status should be "running" after advance, got: ' +
          runData.stages.implement.status;
      } else {
        // Assert stageLabelFromStages returns the correct label
        const label = stageLabelFromStages(runData.stages);
        if (label !== 'implementing') {
          failure = 'stageLabelFromStages should return "implementing", got: ' + label;
        } else {
          console.error('[per-run-state-lifecycle] step 2 PASS — stage advanced to running, label=implementing');
        }
      }
    }

    // ── Step 2b: forge_update_run agents merge-by-agentId ─────────────────
    // Verifies upsert semantics: two non-overlapping calls produce both
    // records; an overlapping agentId merges the matching record while
    // preserving all others. Regression guard against wholesale-replace.
    if (!failure) {
      // First call: insert agent-A.
      parseToolResult(await callTool(client, 'forge_update_run', {
        runId,
        agents: [
          { agentId: 'agent-A', agentType: 'coder', startedAt: 1000, completedAt: 2000, durationMs: 1000, outcome: 'completed' },
        ],
      }));

      // Second call: insert agent-B (non-overlapping).
      parseToolResult(await callTool(client, 'forge_update_run', {
        runId,
        agents: [
          { agentId: 'agent-B', agentType: 'reviewer-safety', startedAt: 3000, completedAt: 4000, durationMs: 1000, outcome: 'completed' },
        ],
      }));

      const runAfterTwo = readRunJson(projectDir, runId);
      if (!runAfterTwo || !Array.isArray(runAfterTwo.agents)) {
        failure = 'run.agents missing or not an array after two non-overlapping updates';
      } else if (runAfterTwo.agents.length !== 2) {
        failure = 'run.agents should contain 2 records after two non-overlapping updates, got: ' + runAfterTwo.agents.length;
      } else {
        const ids = runAfterTwo.agents.map(a => a.agentId).sort();
        if (ids[0] !== 'agent-A' || ids[1] !== 'agent-B') {
          failure = 'run.agents should contain agent-A and agent-B, got: ' + ids.join(',');
        }
      }
    }

    if (!failure) {
      // Third call: overlapping agentId — agent-A updated, agent-B preserved.
      parseToolResult(await callTool(client, 'forge_update_run', {
        runId,
        agents: [
          { agentId: 'agent-A', agentType: 'coder', startedAt: 1000, completedAt: 5000, durationMs: 4000, outcome: 'failed' },
        ],
      }));

      const runAfterMerge = readRunJson(projectDir, runId);
      if (!runAfterMerge || !Array.isArray(runAfterMerge.agents)) {
        failure = 'run.agents missing after overlapping-agentId update';
      } else if (runAfterMerge.agents.length !== 2) {
        failure = 'run.agents should still contain 2 records after overlapping update (got wholesale-replace behaviour?), got: ' + runAfterMerge.agents.length;
      } else {
        const a = runAfterMerge.agents.find(x => x.agentId === 'agent-A');
        const b = runAfterMerge.agents.find(x => x.agentId === 'agent-B');
        if (!a) {
          failure = 'agent-A missing after merge update';
        } else if (a.outcome !== 'failed') {
          failure = 'agent-A.outcome should be "failed" after merge, got: ' + a.outcome;
        } else if (a.durationMs !== 4000) {
          failure = 'agent-A.durationMs should be 4000 after merge, got: ' + a.durationMs;
        } else if (!b) {
          failure = 'agent-B should remain after overlapping update on agent-A (wholesale-replace regression)';
        } else if (b.outcome !== 'completed') {
          failure = 'agent-B.outcome should be unchanged ("completed"), got: ' + b.outcome;
        } else {
          console.error('[per-run-state-lifecycle] step 2b PASS — agents merged by agentId (upsert + preserve)');
        }
      }
    }

    // ── Step 3: forge_update_run with status=completed ────────────────────
    // Note on "index reflects completed": updateRun() deliberately does NOT
    // write status back to index.json (see packages/forge-core/src/runs/
    // listRuns.js:46-58 — that was a race source). Instead, listRuns() lazy-
    // merges live status from each run.json at read time. So we assert via
    // forge_list_runs (the user-visible registry view) rather than the raw
    // index.json file. This matches AC-1's intent: the registry surface
    // observers and tools see must reflect the completed status.
    if (!failure) {
      const updateResult = parseToolResult(await callTool(client, 'forge_update_run', {
        runId,
        status: 'completed',
      }));
      if (updateResult.status !== 'completed') {
        failure = 'forge_update_run did not return status="completed", got: ' + updateResult.status;
      }
    }

    if (!failure) {
      // Authoritative run.json: check the canonical store directly.
      const runData = readRunJson(projectDir, runId);
      if (!runData) {
        failure = 'run.json missing after forge_update_run';
      } else if (runData.status !== 'completed') {
        failure = 'run.json status should be "completed" after forge_update_run, got: ' + runData.status;
      }
    }

    if (!failure) {
      // Live registry view via forge_list_runs (which lazy-merges run.json status).
      const listResult = parseToolResult(await callTool(client, 'forge_list_runs', {
        status: 'completed',
      }));
      const entries = Array.isArray(listResult) ? listResult : (listResult.runs || []);
      const entry = entries.find(r => r.runId === runId);
      if (!entry) {
        failure = 'runId ' + runId + ' not found in forge_list_runs(status=completed) result';
      } else if (entry.status !== 'completed') {
        failure = 'forge_list_runs entry.status should be "completed", got: ' + entry.status;
      } else {
        console.error('[per-run-state-lifecycle] step 3 PASS — registry view reflects completed status');
      }
    }

    if (!failure) {
      console.error('[per-run-state-lifecycle] PASS');
      console.error('  runId:   ' + runId);
      console.error('  stages:  implement(pending → running)');
      console.error('  index:   status=completed');
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
  console.error('[per-run-state-lifecycle] unexpected throw:', err);
  process.exit(1);
});
