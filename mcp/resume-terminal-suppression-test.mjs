#!/usr/bin/env node
// Regression test: forge_resume_run must suppress `currentUnit` from its
// returned payload when the prior run-active.json.currentUnit belongs to a
// run that is already terminal (completed / failed / discarded).
//
// Run: node mcp/resume-terminal-suppression-test.mjs
//
// This is a narrow integration test: it spawns the real MCP server over
// stdio using the same SDK Claude Code does, seeds a fixture project with a
// terminal prior run + a non-terminal resume target, invokes the tool, and
// asserts the resume payload's currentUnit field.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

const ISO = '2026-04-13T00:00:00.000Z';

function seedProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-resume-term-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });

  // Prior run — already completed. Its currentUnit is what /forge:resume
  // would otherwise resurface as a misleading stale-lock signal.
  const priorRunId = 'r-prior01';
  mkdirSync(join(projectDir, '.pipeline', 'runs', priorRunId), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', priorRunId, 'run.json'),
    JSON.stringify({
      runId: priorRunId,
      sessionId: 'sess-prior',
      projectRoot: projectDir,
      worktreePath: null,
      branchName: null,
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'prior feature',
      status: 'completed',
      createdAt: ISO,
      updatedAt: ISO,
      currentStep: 'done',
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }, null, 2)
  );

  // Resume target — still running, so forge_resume_run will succeed.
  const newRunId = 'r-new00001';
  mkdirSync(join(projectDir, '.pipeline', 'runs', newRunId), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', newRunId, 'run.json'),
    JSON.stringify({
      runId: newRunId,
      sessionId: 'sess-new',
      projectRoot: projectDir,
      worktreePath: null,
      branchName: null,
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'new feature',
      status: 'running',
      createdAt: ISO,
      updatedAt: ISO,
      currentStep: 'coder',
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }, null, 2)
  );

  // run-active.json points at the PRIOR (terminal) run and carries the
  // stale currentUnit marker.
  writeFileSync(
    join(projectDir, '.pipeline', 'run-active.json'),
    JSON.stringify({
      startedAt: Date.now() - 60_000,
      runId: priorRunId,
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'prior feature',
      agents: [],
      currentUnit: { agent: 'coder', startedAt: Date.now() - 120_000 },
    }, null, 2)
  );

  return { projectDir, newRunId, priorRunId };
}

async function main() {
  const { projectDir, newRunId } = seedProject();
  let failure = null;

  // Spawn the real MCP server as a subprocess with the fixture as its
  // project root. CLAUDE_PROJECT_DIR makes resolveProjectDir() deterministic
  // regardless of the transport's cwd propagation.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'forge-resume-test', version: '0.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'forge_resume_run',
      arguments: { runId: newRunId },
    });

    if (result.isError) {
      failure = 'forge_resume_run returned isError=true: ' +
        JSON.stringify(result.content);
    } else {
      const textBlock = (result.content || []).find((c) => c.type === 'text');
      if (!textBlock) {
        failure = 'no text content block in tool result';
      } else {
        let parsed;
        try { parsed = JSON.parse(textBlock.text); }
        catch (e) { failure = 'tool text payload not JSON: ' + e.message; }
        if (!failure) {
          if (!('currentUnit' in parsed)) {
            failure = 'response missing currentUnit field: ' + JSON.stringify(parsed);
          } else if (parsed.currentUnit !== null) {
            failure = 'INVARIANT VIOLATED: currentUnit should be null for ' +
              'resume after a terminal prior run, got: ' +
              JSON.stringify(parsed.currentUnit);
          } else {
            console.log('[resume-terminal-suppression] PASS — currentUnit === null');
            console.log('  runId:', parsed.runId);
            console.log('  status:', parsed.status);
          }
        }
      }
    }
  } catch (err) {
    failure = 'test harness error: ' + (err && err.stack || String(err));
  } finally {
    try { await client.close(); } catch (_) {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failure) {
    console.error('[resume-terminal-suppression] FAIL');
    console.error('  ' + failure);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[resume-terminal-suppression] unexpected throw:', err);
  process.exit(1);
});
