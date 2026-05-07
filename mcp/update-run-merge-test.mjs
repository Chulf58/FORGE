#!/usr/bin/env node
// Unit test: updateRun core merge-by-key behavior.
//
// Verifies the merge logic in packages/forge-core/src/runs/updateRun.js:
//   - agents merge by agentId (upsert; preserve unmatched; last-write-wins)
//   - stages merge by stage name (forward-only status guard)
//   - phases merge by index (last-write-wins; result sorted)
//   - other fields use shallow replace as before
//
// Closes regression coverage for TODO 91e8d935 / c0892830 / 0e05f1ab — the
// wholesale-replace bug where direct callers (e.g. hooks/subagent-stop.js)
// would wipe earlier audit-trail records by passing a partial snapshot.
//
// Run: node mcp/update-run-merge-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { updateRun } from '../packages/forge-core/src/runs/updateRun.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-update-run-test-'));
  mkdirSync(join(dir, '.pipeline', 'runs'), { recursive: true });
  return dir;
}

function seedRun(projectDir, runId, overrides = {}) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const run = {
    runId,
    sessionId: 'test-session',
    projectRoot: projectDir,
    worktreePath: null,
    branchName: null,
    pipelineType: 'plan',
    feature: 'test feature',
    status: 'running',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    gateState: null,
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
    ...overrides,
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2) + '\n', 'utf-8');
  return run;
}

function readRun(projectDir, runId) {
  return JSON.parse(readFileSync(join(projectDir, '.pipeline', 'runs', runId, 'run.json'), 'utf-8'));
}

function withTempProject(fn) {
  const dir = makeTempProject();
  try {
    return fn(dir);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

// ─── agents merge ───────────────────────────────────────────────────

test('agents: insert into empty array', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-aaa', { agents: [] });
    updateRun(dir, 'r-aaa', { agents: [{ agentId: 'a1', agentType: 'planner', startedAt: 1000 }] });
    const after = readRun(dir, 'r-aaa');
    assert.equal(after.agents.length, 1);
    assert.equal(after.agents[0].agentId, 'a1');
  });
});

test('agents: preserve existing records not in patch (TODO 91e8d935 regression)', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-bbb', {
      agents: [
        { agentId: 'a1', agentType: 'planner', startedAt: 1000, completedAt: 1100, durationMs: 100, outcome: 'completed' },
        { agentId: 'a2', agentType: 'reviewer-safety', startedAt: 2000, completedAt: 2100, durationMs: 100, outcome: 'APPROVED' },
      ],
    });
    updateRun(dir, 'r-bbb', { agents: [{ agentId: 'a3', agentType: 'documenter', startedAt: 3000 }] });
    const after = readRun(dir, 'r-bbb');
    assert.equal(after.agents.length, 3, 'a1 and a2 must still be present after adding a3');
    const ids = after.agents.map((a) => a.agentId).sort();
    assert.deepEqual(ids, ['a1', 'a2', 'a3']);
  });
});

test('agents: last-write-wins on agentId collision (merges fields)', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-ccc', {
      agents: [{ agentId: 'a1', agentType: 'planner', startedAt: 1000, completedAt: null, durationMs: null, outcome: null }],
    });
    updateRun(dir, 'r-ccc', {
      agents: [{ agentId: 'a1', agentType: 'planner', startedAt: 1000, completedAt: 1500, outcome: 'completed', durationMs: 500 }],
    });
    const after = readRun(dir, 'r-ccc');
    assert.equal(after.agents.length, 1);
    assert.equal(after.agents[0].outcome, 'completed');
    assert.equal(after.agents[0].completedAt, 1500);
    assert.equal(after.agents[0].durationMs, 500);
  });
});

test('agents: simulate subagent-stop dual-write — partial snapshot does not wipe earlier records', () => {
  // Recreates the exact scenario from TODO 91e8d935: an earlier dual-write
  // recorded multiple agents, a later dual-write passes only the documenter
  // record, and the agents trail must NOT collapse.
  withTempProject((dir) => {
    seedRun(dir, 'r-ddd', {
      agents: [
        { agentId: 'planner-1', agentType: 'planner', startedAt: 1000, completedAt: 1100, durationMs: 100, outcome: 'completed' },
        { agentId: 'reviewer-safety-1', agentType: 'reviewer-safety', startedAt: 2000, completedAt: 2100, durationMs: 100, outcome: 'APPROVED' },
        { agentId: 'reviewer-boundary-1', agentType: 'reviewer-boundary', startedAt: 2050, completedAt: 2200, durationMs: 150, outcome: 'APPROVED' },
      ],
    });
    // Worker dual-write completes documenter — passes only the documenter record.
    updateRun(dir, 'r-ddd', {
      agents: [{ agentId: 'documenter-1', agentType: 'documenter', startedAt: 3000, completedAt: 3500, durationMs: 500, outcome: 'completed' }],
    });
    const after = readRun(dir, 'r-ddd');
    assert.equal(after.agents.length, 4, 'all four agents must be present (3 existing + 1 new)');
    const ids = after.agents.map((a) => a.agentId).sort();
    assert.deepEqual(ids, ['documenter-1', 'planner-1', 'reviewer-boundary-1', 'reviewer-safety-1']);
  });
});

test('agents: initialise from null existing array', () => {
  withTempProject((dir) => {
    // Manually construct a run.json with agents:null to exercise the null branch.
    // The Zod schema defaults null→[], so we rebuild the file post-write.
    seedRun(dir, 'r-eee', { agents: [] });
    const runPath = join(dir, '.pipeline', 'runs', 'r-eee', 'run.json');
    const raw = JSON.parse(readFileSync(runPath, 'utf-8'));
    raw.agents = null;
    writeFileSync(runPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');

    updateRun(dir, 'r-eee', { agents: [{ agentId: 'a1', agentType: 'planner', startedAt: 1000 }] });
    const after = readRun(dir, 'r-eee');
    assert.equal(after.agents.length, 1);
  });
});

// ─── stages merge ───────────────────────────────────────────────────

test('stages: initialise from null', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-fff', { stages: null });
    updateRun(dir, 'r-fff', { stages: { plan: { agents: ['planner'], status: 'pending' } } });
    const after = readRun(dir, 'r-fff');
    assert.deepEqual(after.stages, { plan: { agents: ['planner'], status: 'pending' } });
  });
});

test('stages: preserve existing keys when merging new keys (TODO c0892830 regression)', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-ggg', { stages: { plan: { agents: ['planner'], status: 'completed' } } });
    updateRun(dir, 'r-ggg', { stages: { implement: { agents: ['coder'], status: 'pending' } } });
    const after = readRun(dir, 'r-ggg');
    assert.deepEqual(after.stages.plan, { agents: ['planner'], status: 'completed' });
    assert.deepEqual(after.stages.implement, { agents: ['coder'], status: 'pending' });
  });
});

test('stages: forward-only status guard — completed cannot roll back to running', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-hhh', { stages: { plan: { agents: ['planner'], status: 'completed' } } });
    updateRun(dir, 'r-hhh', { stages: { plan: { agents: ['planner'], status: 'running' } } });
    const after = readRun(dir, 'r-hhh');
    assert.equal(after.stages.plan.status, 'completed', 'completed must not roll back to running');
  });
});

test('stages: forward-only status guard — skipped cannot roll back to pending', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-iii', { stages: { plan: { agents: ['planner'], status: 'skipped' } } });
    updateRun(dir, 'r-iii', { stages: { plan: { agents: ['planner'], status: 'pending' } } });
    const after = readRun(dir, 'r-iii');
    assert.equal(after.stages.plan.status, 'skipped');
  });
});

test('stages: pending → running transition allowed', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-jjj', { stages: { plan: { agents: ['planner'], status: 'pending' } } });
    updateRun(dir, 'r-jjj', { stages: { plan: { agents: ['planner'], status: 'running' } } });
    const after = readRun(dir, 'r-jjj');
    assert.equal(after.stages.plan.status, 'running');
  });
});

test('stages: running → completed transition allowed', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-kkk', { stages: { plan: { agents: ['planner'], status: 'running' } } });
    updateRun(dir, 'r-kkk', { stages: { plan: { agents: ['planner'], status: 'completed' } } });
    const after = readRun(dir, 'r-kkk');
    assert.equal(after.stages.plan.status, 'completed');
  });
});

// ─── phases merge ───────────────────────────────────────────────────

test('phases: initialise from null', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-lll', { phases: null });
    updateRun(dir, 'r-lll', { phases: [{ index: 0, label: 'Phase 1', status: 'pending' }] });
    const after = readRun(dir, 'r-lll');
    assert.equal(after.phases.length, 1);
    assert.equal(after.phases[0].index, 0);
  });
});

test('phases: insert new index, preserve existing', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-mmm', {
      phases: [{ index: 0, label: 'Phase 1', status: 'completed', committedAt: '2026-05-06T01:00:00.000Z', reviewerVerdict: 'approved' }],
    });
    updateRun(dir, 'r-mmm', { phases: [{ index: 1, label: 'Phase 2', status: 'running' }] });
    const after = readRun(dir, 'r-mmm');
    assert.equal(after.phases.length, 2);
    assert.equal(after.phases[0].index, 0);
    assert.equal(after.phases[0].status, 'completed');
    assert.equal(after.phases[1].index, 1);
    assert.equal(after.phases[1].status, 'running');
  });
});

test('phases: last-write-wins on index collision', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-nnn', { phases: [{ index: 0, label: 'Phase 1', status: 'running' }] });
    updateRun(dir, 'r-nnn', {
      phases: [{ index: 0, label: 'Phase 1', status: 'completed', committedAt: '2026-05-06T01:00:00.000Z', reviewerVerdict: 'approved' }],
    });
    const after = readRun(dir, 'r-nnn');
    assert.equal(after.phases.length, 1);
    assert.equal(after.phases[0].status, 'completed');
    assert.equal(after.phases[0].reviewerVerdict, 'approved');
  });
});

test('phases: result sorted by index', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-ooo', { phases: [{ index: 2, label: 'Phase 3', status: 'pending' }] });
    updateRun(dir, 'r-ooo', {
      phases: [
        { index: 0, label: 'Phase 1', status: 'pending' },
        { index: 1, label: 'Phase 2', status: 'pending' },
      ],
    });
    const after = readRun(dir, 'r-ooo');
    assert.deepEqual(after.phases.map((p) => p.index), [0, 1, 2]);
  });
});

// ─── other fields shallow-replace as before ─────────────────────────

test('non-merge fields: status replaces', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-ppp', { status: 'running' });
    updateRun(dir, 'r-ppp', { status: 'completed' });
    const after = readRun(dir, 'r-ppp');
    assert.equal(after.status, 'completed');
  });
});

test('non-merge fields: failureReason replaces', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-qqq', { status: 'failed', failureReason: 'old reason' });
    updateRun(dir, 'r-qqq', { failureReason: 'new reason' });
    const after = readRun(dir, 'r-qqq');
    assert.equal(after.failureReason, 'new reason');
  });
});

test('updatedAt is bumped on every update', () => {
  withTempProject((dir) => {
    seedRun(dir, 'r-rrr', { updatedAt: '2026-05-06T00:00:00.000Z' });
    updateRun(dir, 'r-rrr', { feature: 'updated' });
    const after = readRun(dir, 'r-rrr');
    assert.notEqual(after.updatedAt, '2026-05-06T00:00:00.000Z');
  });
});

test('throws when run not found', () => {
  withTempProject((dir) => {
    assert.throws(() => updateRun(dir, 'r-nonexistent', { status: 'completed' }), /Run not found/);
  });
});
