#!/usr/bin/env node
// Regression test: `forge_dashboard_state` returns a read-only control-plane
// snapshot with four top-level groups (activeRuns, gatesAwaiting,
// recentCompleted, boardSummary) whose shape and membership reflect the
// on-disk registry + board files at call time.
//
// Run: node mcp/dashboard-state-shape-test.mjs
//
// Integration-style test: spawns the real mcp/server.js over stdio using the
// same SDK Claude Code does, seeds a fixture with one running run, one
// gate-pending run, and three completed runs, plus a minimal board.json, and
// asserts the returned payload.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

const ISO = '2026-04-13T00:00:00.000Z';

function writeRun(projectDir, runId, overrides) {
  mkdirSync(join(projectDir, '.pipeline', 'runs', runId), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', runId, 'run.json'),
    JSON.stringify({
      runId,
      sessionId: 'sess-' + runId,
      projectRoot: projectDir,
      worktreePath: null,
      branchName: null,
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'feature ' + runId,
      status: 'running',
      createdAt: ISO,
      updatedAt: ISO,
      currentStep: 'coder',
      gateState: null,
      agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
      ...overrides,
    }, null, 2)
  );
}

function seed() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-dash-state-test-'));
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });

  // running run — active, no gate
  writeRun(projectDir, 'r-run-aaaa', {
    status: 'running',
    feature: 'running feature A',
    updatedAt: '2026-04-13T12:00:00.000Z',
  });

  // gate-pending run — should show up in gatesAwaiting
  writeRun(projectDir, 'r-gate-bbbb', {
    status: 'gate-pending',
    feature: 'feature awaiting gate2',
    currentStep: 'gate2',
    gateState: {
      gate: 'gate2',
      status: 'pending',
      feature: 'feature awaiting gate2',
      createdAt: '2026-04-13T13:00:00.000Z',
      approvedAt: null,
    },
    updatedAt: '2026-04-13T13:00:00.000Z',
  });

  // three completed / terminal runs — recentCompleted should hold all three
  writeRun(projectDir, 'r-done-cccc', {
    status: 'completed',
    feature: 'done feature C',
    currentStep: 'done',
    updatedAt: '2026-04-12T09:00:00.000Z',
  });
  writeRun(projectDir, 'r-done-dddd', {
    status: 'failed',
    feature: 'failed feature D',
    currentStep: 'reviewers',
    updatedAt: '2026-04-12T10:00:00.000Z',
  });
  writeRun(projectDir, 'r-done-eeee', {
    status: 'discarded',
    feature: 'discarded feature E',
    currentStep: 'gate1',
    updatedAt: '2026-04-12T11:00:00.000Z',
  });

  // Index pointer so listRuns sees everything without lazy-heal surprises.
  writeFileSync(
    join(projectDir, '.pipeline', 'runs', 'index.json'),
    JSON.stringify({
      runs: [
        { runId: 'r-run-aaaa',  pipelineType: 'implement', feature: 'running feature A',       status: 'running',      createdAt: ISO, updatedAt: '2026-04-13T12:00:00.000Z' },
        { runId: 'r-gate-bbbb', pipelineType: 'implement', feature: 'feature awaiting gate2',  status: 'gate-pending', createdAt: ISO, updatedAt: '2026-04-13T13:00:00.000Z' },
        { runId: 'r-done-cccc', pipelineType: 'implement', feature: 'done feature C',          status: 'completed',    createdAt: ISO, updatedAt: '2026-04-12T09:00:00.000Z' },
        { runId: 'r-done-dddd', pipelineType: 'implement', feature: 'failed feature D',        status: 'failed',       createdAt: ISO, updatedAt: '2026-04-12T10:00:00.000Z' },
        { runId: 'r-done-eeee', pipelineType: 'implement', feature: 'discarded feature E',     status: 'discarded',    createdAt: ISO, updatedAt: '2026-04-12T11:00:00.000Z' },
      ],
    }, null, 2)
  );

  // Minimal board: two open todos (one high, one low, one blocked), one done, one planned.
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({
      todos: [
        { id: 'top-high', priority: 'high', text: 'Implement X', tags: [] },
        { id: 'low-open', priority: 'low', text: 'Tidy Y', tags: [] },
        { id: 'blocked-one', priority: 'medium', text: 'Do Z (blocked)', tags: [], blockedBy: ['top-high'] },
        { id: 'closed-one', priority: 'high', text: 'Finished thing', done: true },
      ],
      planned: [
        { id: 'planned-1', title: 'Future feature', priority: 'medium' },
      ],
    }, null, 2)
  );

  // run-active.json pointed at the running run, with a currentUnit marker so
  // activeRuns[running].currentUnit is surfaced for that row (and null for others).
  writeFileSync(
    join(projectDir, '.pipeline', 'run-active.json'),
    JSON.stringify({
      startedAt: Date.now(),
      runId: 'r-run-aaaa',
      pipelineType: 'implement',
      mode: 'LEAN',
      feature: 'running feature A',
      agents: [],
      currentUnit: { agent: 'coder', startedAt: Date.now() - 5000 },
    }, null, 2)
  );

  return projectDir;
}

function fail(msg) {
  console.error('[dashboard-state-shape] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  const projectDir = seed();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-dashboard-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'forge_dashboard_state', arguments: {} });

    if (result.isError) {
      failure = 'tool returned isError=true: ' + JSON.stringify(result.content);
    } else {
      const block = (result.content || []).find(c => c.type === 'text');
      if (!block) { failure = 'no text content'; }
      else {
        const p = JSON.parse(block.text);

        // Top-level shape
        for (const key of ['activeRuns', 'gatesAwaiting', 'recentCompleted', 'boardSummary']) {
          if (!(key in p)) { failure = 'missing top-level key: ' + key; break; }
        }

        if (!failure) {
          // activeRuns: two non-terminal runs, sorted by updatedAt desc.
          if (!Array.isArray(p.activeRuns) || p.activeRuns.length !== 2) {
            failure = 'activeRuns should have 2 entries, got ' + (p.activeRuns && p.activeRuns.length);
          } else {
            const ids = p.activeRuns.map(r => r.runId);
            if (ids[0] !== 'r-gate-bbbb' || ids[1] !== 'r-run-aaaa') {
              failure = 'activeRuns not sorted by updatedAt desc: ' + JSON.stringify(ids);
            }
            const runningEntry = p.activeRuns.find(r => r.runId === 'r-run-aaaa');
            if (!runningEntry || !runningEntry.currentUnit || runningEntry.currentUnit.agent !== 'coder') {
              failure = 'running row should carry currentUnit { agent: "coder" }, got ' +
                JSON.stringify(runningEntry && runningEntry.currentUnit);
            }
            const gateEntry = p.activeRuns.find(r => r.runId === 'r-gate-bbbb');
            if (!gateEntry || gateEntry.currentUnit !== null) {
              failure = 'non-active-run row should have currentUnit === null, got ' +
                JSON.stringify(gateEntry && gateEntry.currentUnit);
            }
          }
        }

        if (!failure) {
          // gatesAwaiting: exactly the gate-pending run.
          if (!Array.isArray(p.gatesAwaiting) || p.gatesAwaiting.length !== 1 ||
              p.gatesAwaiting[0].runId !== 'r-gate-bbbb') {
            failure = 'gatesAwaiting should contain only r-gate-bbbb, got ' + JSON.stringify(p.gatesAwaiting);
          }
        }

        if (!failure) {
          // recentCompleted: three terminal runs, bounded by limit (5 > 3), sorted desc.
          if (!Array.isArray(p.recentCompleted) || p.recentCompleted.length !== 3) {
            failure = 'recentCompleted should have 3 entries, got ' +
              (p.recentCompleted && p.recentCompleted.length);
          } else {
            const expectedOrder = ['r-done-eeee', 'r-done-dddd', 'r-done-cccc']; // by updatedAt desc
            const actual = p.recentCompleted.map(e => e.runId);
            if (JSON.stringify(actual) !== JSON.stringify(expectedOrder)) {
              failure = 'recentCompleted order wrong: expected ' +
                JSON.stringify(expectedOrder) + ', got ' + JSON.stringify(actual);
            }
          }
        }

        if (!failure) {
          const b = p.boardSummary;
          if (!b || typeof b !== 'object') failure = 'boardSummary missing/not-object';
          else if (b.todoCount !== 3) failure = 'todoCount should be 3 (three open), got ' + b.todoCount;
          else if (b.plannedCount !== 1) failure = 'plannedCount should be 1, got ' + b.plannedCount;
          else if (b.blockedTodoCount !== 1) failure = 'blockedTodoCount should be 1, got ' + b.blockedTodoCount;
          else if (!Array.isArray(b.topPriorityTodos) || b.topPriorityTodos.length < 1) {
            failure = 'topPriorityTodos should be non-empty';
          } else if (b.topPriorityTodos.length > 5) {
            failure = 'topPriorityTodos should be bounded (<=5), got ' + b.topPriorityTodos.length;
          } else if (b.topPriorityTodos[0].id !== 'top-high' ||
                     b.topPriorityTodos[0].priority !== 'high') {
            failure = 'topPriorityTodos should lead with the open high-priority item, got ' +
              JSON.stringify(b.topPriorityTodos[0]);
          }
        }

        if (!failure) {
          console.log('[dashboard-state-shape] PASS');
          console.log('  activeRuns:       ' + p.activeRuns.length + ' (sorted desc)');
          console.log('  gatesAwaiting:    ' + p.gatesAwaiting.length);
          console.log('  recentCompleted:  ' + p.recentCompleted.length + ' (<=' + 5 + ')');
          console.log('  boardSummary:     todos=' + p.boardSummary.todoCount +
            ', blocked=' + p.boardSummary.blockedTodoCount +
            ', planned=' + p.boardSummary.plannedCount +
            ', top=' + p.boardSummary.topPriorityTodos.length);
        }
      }
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
  console.error('[dashboard-state-shape] unexpected throw:', err);
  process.exit(1);
});
