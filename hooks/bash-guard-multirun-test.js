#!/usr/bin/env node
'use strict';

// Tests for hooks/bash-guard.js soft-block bypass under 2+ non-terminal runs.
//
// Background: workers run with FORGE_WORKER_RUN_ID set in their env (per
// mcp/server.js:1841). The bash-guard soft-block bypass uses
// getActivePipelineRun → findActiveRun, which is null when 2+ non-terminal
// runs exist (the f2f65ce9 ambiguity). When parallel pipelines are running,
// every worker's git commit fails the soft-block check, even though each
// worker's command unambiguously targets its OWN worktree.
//
// Live observation 2026-05-10 (this session): two parallel /forge:plan runs
// (r-d061655c + r-5e7fca5e) — both workers' plan-stage git commits got
// blocked. Worker A logged "[plan] commit skipped" and continued; Worker B's
// model interpreted the block as "stop and ask user" and the worker exited.
//
// Fix: bash-guard's bypass should read FORGE_WORKER_RUN_ID first (same
// precedence as resolveRunId step 1), so workers self-identify regardless
// of how many non-terminal runs exist.
//
// Covers:
//   T1 — 2 non-terminal runs, env var set, command targets the env-var run's
//        worktree → ALLOW (currently BLOCKS via soft-block)
//   T2 — 2 non-terminal runs, env var set, command does NOT target the
//        env-var run's worktree → fall through to soft-block (no token →
//        BLOCK)
//   T3 — no env var, 1 non-terminal run, worktree-targeting command → ALLOW
//        (existing behavior preserved)
//   T4 — env var set to invalid runId format → fall through (defense-in-
//        depth — no privilege escalation via env var injection)

const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const BASH_GUARD = join(__dirname, 'bash-guard.js');
const PLUGIN_ROOT = join(__dirname, '..');

function runHook(payload, projectDir, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BASH_GUARD], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function makeTmpProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'bash-guard-mr-test-'));
  mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"test"}', 'utf8');
  return tmp;
}

function writeRun(projectDir, runId, opts) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const run = {
    runId,
    status: opts.status || 'running',
    pipelineType: opts.pipelineType || 'plan',
    feature: opts.feature || 'test feature',
    worktreePath: opts.worktreePath || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
  writeFileSync(
    join(runDir, 'run-active.json'),
    JSON.stringify({ runId, agents: [] }, null, 2),
    'utf8',
  );
}

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

async function test() {
  console.log('\n── bash-guard-multirun-test.js ──────────────────────────────────────');

  // T1 — 2 non-terminal runs, env var resolves correctly, command targets that run's worktree
  {
    const dir = makeTmpProject();
    try {
      const wtA = join(dir, '.worktrees', 'r-aaaaaaaa');
      const wtB = join(dir, '.worktrees', 'r-bbbbbbbb');
      mkdirSync(wtA, { recursive: true });
      mkdirSync(wtB, { recursive: true });
      writeRun(dir, 'r-aaaaaaaa', { worktreePath: wtA });
      writeRun(dir, 'r-bbbbbbbb', { worktreePath: wtB });
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git -C ' + wtA + ' commit -m "phase commit"' },
        cwd: wtA,
      };
      const res = await runHook(payload, dir, { FORGE_WORKER_RUN_ID: 'r-aaaaaaaa' });
      assert(res.code === 0,
        'T1 worker commit ALLOWED when env-var resolves runId despite 2 non-terminal runs (got code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T2 — env var set, command targets a DIFFERENT worktree → no bypass
  {
    const dir = makeTmpProject();
    try {
      const wtA = join(dir, '.worktrees', 'r-aaaaaaaa');
      const wtB = join(dir, '.worktrees', 'r-bbbbbbbb');
      mkdirSync(wtA, { recursive: true });
      mkdirSync(wtB, { recursive: true });
      writeRun(dir, 'r-aaaaaaaa', { worktreePath: wtA });
      writeRun(dir, 'r-bbbbbbbb', { worktreePath: wtB });
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git -C ' + wtB + ' commit -m "wrong worktree"' },
        cwd: wtA,
      };
      const res = await runHook(payload, dir, { FORGE_WORKER_RUN_ID: 'r-aaaaaaaa' });
      assert(res.code === 2,
        'T2 commit targeting OTHER worktree must NOT bypass via env var (got code=' + res.code + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T3 — single-run, no env var: existing behavior preserved
  {
    const dir = makeTmpProject();
    try {
      const wtA = join(dir, '.worktrees', 'r-cccccccc');
      mkdirSync(wtA, { recursive: true });
      writeRun(dir, 'r-cccccccc', { worktreePath: wtA });
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git -C ' + wtA + ' commit -m "single run"' },
        cwd: wtA,
      };
      const res = await runHook(payload, dir, {});
      assert(res.code === 0,
        'T3 single-run worktree commit allowed without env var (got code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T4 — invalid runId format in env var → no bypass (defense-in-depth)
  {
    const dir = makeTmpProject();
    try {
      const wtA = join(dir, '.worktrees', 'r-aaaaaaaa');
      const wtB = join(dir, '.worktrees', 'r-bbbbbbbb');
      mkdirSync(wtA, { recursive: true });
      mkdirSync(wtB, { recursive: true });
      writeRun(dir, 'r-aaaaaaaa', { worktreePath: wtA });
      writeRun(dir, 'r-bbbbbbbb', { worktreePath: wtB });
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git -C ' + wtA + ' commit -m "bad env"' },
        cwd: wtA,
      };
      const res = await runHook(payload, dir, { FORGE_WORKER_RUN_ID: '../etc/passwd' });
      assert(res.code === 2,
        'T4 invalid env-var runId format must NOT bypass (got code=' + res.code + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed === 0 ? 0 : 1);
}

test().catch((err) => { console.error(err); process.exit(1); });
