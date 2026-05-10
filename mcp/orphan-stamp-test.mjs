#!/usr/bin/env node
// Tests for mcp/lib/stamp-orphan-agents.js — worker-side fallback that
// stamps any agent entry whose subagent-stop hook never wrote completedAt.
//
// Closes 7fe538ee sub-bug 2 (orphan agent — SubagentStop didn't fire).
//
// Strategy: regardless of why the hook didn't fire (SDK reliability, hook
// stderr lost, hook crashed silently), the worker scans run-active.json one
// final time before clean exit and stamps every entry with startedAt set
// but completedAt null with `outcome: "orphan-stop"`.
//
// Covers:
//   T1 — normal completed entry preserved (completedAt + outcome unchanged)
//   T2 — orphan entry (startedAt + null completedAt) stamped with
//        outcome="orphan-stop", completedAt=now, durationMs=now-startedAt
//   T3 — mixed case: completed and orphan in same file, only orphan stamped
//   T4 — entry with startedAt but no completedAt field at all (undefined)
//        treated as orphan and stamped
//   T5 — file absent → no error, no throw (fail-open)
//   T6 — file present but agents array empty → no-op
//
// Run: node --test mcp/orphan-stamp-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { stampOrphanAgents } from './lib/stamp-orphan-agents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeRun(runId, agents) {
  const tmp = mkdtempSync(join(tmpdir(), 'orphan-stamp-test-'));
  const runDir = join(tmp, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run-active.json'),
    JSON.stringify({ runId, agents }, null, 2),
    'utf8',
  );
  return tmp;
}

function readRunActive(workDir, runId) {
  return JSON.parse(readFileSync(
    join(workDir, '.pipeline', 'runs', runId, 'run-active.json'),
    'utf8',
  ));
}

test('T1 — completed entry preserved unchanged', () => {
  const runId = 'r-t1';
  const startedAt = Date.now() - 60_000;
  const completedAt = startedAt + 30_000;
  const work = makeRun(runId, [
    {
      agent_id: 'a1', agent_type: 'forge:planner',
      startedAt, completedAt, durationMs: 30_000, outcome: 'completed',
    },
  ]);
  try {
    stampOrphanAgents(work, runId);
    const data = readRunActive(work, runId);
    assert.equal(data.agents[0].outcome, 'completed');
    assert.equal(data.agents[0].completedAt, completedAt);
    assert.equal(data.agents[0].durationMs, 30_000);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('T2 — orphan entry stamped with outcome=orphan-stop, completedAt, durationMs', () => {
  const runId = 'r-t2';
  const startedAt = Date.now() - 60_000;
  const work = makeRun(runId, [
    {
      agent_id: 'a1', agent_type: 'forge:reviewer-boundary',
      startedAt, completedAt: null, durationMs: null, outcome: null,
    },
  ]);
  try {
    const beforeStamp = Date.now();
    stampOrphanAgents(work, runId);
    const afterStamp = Date.now();
    const data = readRunActive(work, runId);
    const a = data.agents[0];
    assert.equal(a.outcome, 'orphan-stop',
      'orphan should be stamped outcome=orphan-stop, got: ' + JSON.stringify(a));
    assert.ok(typeof a.completedAt === 'number',
      'completedAt should be a number, got: ' + typeof a.completedAt);
    assert.ok(a.completedAt >= beforeStamp && a.completedAt <= afterStamp,
      'completedAt should be set to current time');
    assert.equal(a.durationMs, a.completedAt - startedAt,
      'durationMs should be completedAt - startedAt');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('T3 — mixed case: only orphan stamped, completed entry unchanged', () => {
  const runId = 'r-t3';
  const t0 = Date.now() - 120_000;
  const work = makeRun(runId, [
    {
      agent_id: 'a1', agent_type: 'forge:planner',
      startedAt: t0, completedAt: t0 + 30_000, durationMs: 30_000, outcome: 'completed',
    },
    {
      agent_id: 'a2', agent_type: 'forge:reviewer-boundary',
      startedAt: t0 + 60_000, completedAt: null, durationMs: null, outcome: null,
    },
  ]);
  try {
    stampOrphanAgents(work, runId);
    const data = readRunActive(work, runId);
    assert.equal(data.agents[0].outcome, 'completed');
    assert.equal(data.agents[0].completedAt, t0 + 30_000);
    assert.equal(data.agents[1].outcome, 'orphan-stop');
    assert.ok(typeof data.agents[1].completedAt === 'number');
    assert.ok(data.agents[1].durationMs > 0);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('T4 — entry with startedAt only (completedAt field absent) treated as orphan', () => {
  const runId = 'r-t4';
  const startedAt = Date.now() - 30_000;
  const work = makeRun(runId, [
    { agent_id: 'a1', agent_type: 'forge:coder', startedAt },
  ]);
  try {
    stampOrphanAgents(work, runId);
    const data = readRunActive(work, runId);
    assert.equal(data.agents[0].outcome, 'orphan-stop');
    assert.ok(typeof data.agents[0].completedAt === 'number');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('T5 — file absent → no throw, no error', () => {
  const runId = 'r-t5';
  const tmp = mkdtempSync(join(tmpdir(), 'orphan-stamp-test-'));
  try {
    // No run-active.json written — must be a no-op
    stampOrphanAgents(tmp, runId); // must not throw
    const expectedPath = join(tmp, '.pipeline', 'runs', runId, 'run-active.json');
    assert.equal(existsSync(expectedPath), false,
      'should not create the file when absent');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T6 — empty agents array → no-op', () => {
  const runId = 'r-t6';
  const work = makeRun(runId, []);
  try {
    stampOrphanAgents(work, runId);
    const data = readRunActive(work, runId);
    assert.deepEqual(data.agents, []);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
