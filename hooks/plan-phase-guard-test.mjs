// @covers hooks/plan-phase-guard.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// Helpers

function runHook(input, env = {}, cwd) {
  const hookPath = new URL('./plan-phase-guard.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
  const spawnOpts = {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  };
  if (cwd !== undefined) spawnOpts.cwd = cwd;
  const result = spawnSync(process.execPath, [hookPath], spawnOpts);
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-phase-guard-test-'));
  await fs.mkdir(path.join(dir, '.pipeline'), { recursive: true });
  return dir;
}

async function writeRun(dir, runId, opts = {}) {
  const runDir = path.join(dir, '.pipeline', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  const run = {
    runId,
    status: opts.status || 'running',
    pipelineType: opts.pipelineType || 'plan',
    feature: opts.feature || 'test-feature',
    worktreePath: null,
    branchName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (opts.phases !== undefined) {
    run.phases = opts.phases;
  }
  await fs.writeFile(path.join(runDir, 'run.json'), JSON.stringify(run), 'utf8');
}

// Tests

test('exits 0 for non-Agent tool calls', () => {
  const result = runHook({ tool_name: 'Write', tool_input: {} });
  assert.equal(result.exitCode, 0, 'should exit 0 for Write tool');
});

test('exits 0 when tool_name is missing', () => {
  const result = runHook({});
  assert.equal(result.exitCode, 0);
});

test('deny (exit 2) when plan run + technical-skeptic + Phase C running', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan001', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A — feature interview', status: 'completed' },
      { index: 1, label: 'Phase B — brainstorm', status: 'completed' },
      { index: 2, label: 'Phase C — plan walkthrough', status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 2, 'should deny at exit 2 when Phase C is running');
  const parsed = JSON.parse(result.stdout.trim());
  assert.ok(parsed.hookSpecificOutput, 'deny must use the canonical hookSpecificOutput envelope');
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(
    parsed.hookSpecificOutput.permissionDecisionReason.includes('Phase C'),
    'deny reason must mention Phase C'
  );
  assert.ok(result.stderr.includes('Phase C'), 'stderr should mention Phase C');
});

test('deny (exit 2) when plan run + reviewer-boundary + Phase B completed, no Phase C', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan002', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A — feature interview', status: 'completed' },
      { index: 1, label: 'Phase B — planner', status: 'completed' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:reviewer-boundary' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 2, 'should deny when Phase B is completed but Phase C is absent');
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
});

test('allow (exit 0) when plan run + technical-skeptic + Phase C completed', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan003', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A — feature interview', status: 'completed' },
      { index: 1, label: 'Phase B — brainstorm', status: 'completed' },
      { index: 2, label: 'Phase C — plan walkthrough', status: 'completed' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should allow when Phase C is completed');
});

test('fail-open (exit 0) when non-plan run (implement) + reviewer-boundary + Phase C running', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-impl001', {
    pipelineType: 'implement',
    phases: [
      { index: 0, label: 'Phase A', status: 'completed' },
      { index: 1, label: 'Phase B', status: 'completed' },
      { index: 2, label: 'Phase C', status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:reviewer-boundary' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open (allow) for non-plan runs');
});

test('fail-open (exit 0) when plan run + non-reviewer agent + Phase C running', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan004', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A — feature interview', status: 'completed' },
      { index: 1, label: 'Phase B — brainstorm', status: 'completed' },
      { index: 2, label: 'Phase C — plan walkthrough', status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:gotcha-checker' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open for non-reviewer agents like gotcha-checker');
});

test('fail-open (exit 0) when plan run + reviewer + phases is null', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const runDir = path.join(dir, '.pipeline', 'runs', 'r-plan005');
  await fs.mkdir(runDir, { recursive: true });
  const run = {
    runId: 'r-plan005',
    status: 'running',
    pipelineType: 'plan',
    feature: 'test-feature',
    worktreePath: null,
    branchName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phases: null,
  };
  await fs.writeFile(path.join(runDir, 'run.json'), JSON.stringify(run), 'utf8');

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open when phases is null');
});

test('fail-open (exit 0) when plan run + reviewer + phases is empty array', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan006', {
    pipelineType: 'plan',
    phases: [],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open when phases is an empty array');
});

test('fail-open (exit 0) when plan run + reviewer + Phase C malformed (no status key)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan007', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A', status: 'completed' },
      { index: 1, label: 'Phase B', status: 'completed' },
      { index: 2, label: 'Phase C — plan walkthrough' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open when Phase C entry is malformed');
});

test('fail-open (exit 0) when plan run + reviewer + only Phase A present', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan008', {
    pipelineType: 'plan',
    phases: [
      { index: 0, label: 'Phase A — feature interview', status: 'completed' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should fail-open when Phase B/C progress is not yet observable');
});

test('no project state (conductor session, no active run)', () => {
  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:technical-skeptic' },
    cwd: os.tmpdir(),
  }, {}, os.tmpdir());

  assert.equal(result.exitCode, 0, 'should fail-open when no active run found');
});

test('phases array with index-based phase lookup (Phase C = index 2)', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan009', {
    pipelineType: 'plan',
    phases: [
      { index: 0, status: 'completed' },
      { index: 1, status: 'completed' },
      { index: 2, status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:reviewer-boundary' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 2, 'should deny when Phase C (index 2) is running, even without label');
});

test('reviewer-safety agent is treated as reviewer', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan010', {
    pipelineType: 'plan',
    phases: [
      { index: 0, status: 'completed' },
      { index: 1, status: 'completed' },
      { index: 2, label: 'Phase C', status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:reviewer-safety' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 2, 'should deny for reviewer-safety when Phase C is running');
});

test('non-reviewer Plan agents like planner are allowed', async (t) => {
  const dir = await makeProjectDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeRun(dir, 'r-plan011', {
    pipelineType: 'plan',
    phases: [
      { index: 0, status: 'completed' },
      { index: 1, status: 'completed' },
      { index: 2, label: 'Phase C', status: 'running' },
    ],
  });

  const result = runHook({
    tool_name: 'Agent',
    tool_input: { subagent_type: 'forge:planner' },
    cwd: dir,
  }, {}, dir);

  assert.equal(result.exitCode, 0, 'should allow non-reviewer agents like planner');
});
