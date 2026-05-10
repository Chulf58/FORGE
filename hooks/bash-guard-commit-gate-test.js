#!/usr/bin/env node
'use strict';

// Tests for hooks/bash-guard.js commit-gate hard-block logic.
//
// Background: when a commit gate is pending for a worktree-backed run,
// the hard-block at bash-guard.js currently fires for ANY git commit —
// including conductor commits to MAIN that have nothing to do with the
// gated worktree. This creates a chicken-and-egg: to merge the worktree
// (which clears the gate), the conductor needs to commit unrelated
// inline work first; but the inline commit is blocked by the gate.
//
// Fix (closes the regression): narrow the hard-block so it ONLY fires
// when the bash command targets the gated worktree's path. Main-root
// commits get allowed (the soft-block at lines 424-447 still requires
// the user to type "commit" — that authorization gate is preserved).
//
// Covers:
//   T1 — gate pending for worktree run, command targets MAIN, user
//        approval token present → ALLOW (currently BLOCKS — the bug)
//   T2 — gate pending for worktree run, command targets the WORKTREE
//        → BLOCK (preserve side-step prevention)
//   T3 — no gate pending, command is git commit → soft-block (no token)
//        BLOCKS as expected
//   T4 — gate pending for non-worktree run (worktreePath null), command
//        is git commit → ALLOW (worker already committed; conductor's
//        unrelated commits should not be blocked)
//
// Run: node hooks/bash-guard-commit-gate-test.js

const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');

const BASH_GUARD = join(__dirname, 'bash-guard.js');
const PLUGIN_ROOT = join(__dirname, '..');

function runHook(payload, projectDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BASH_GUARD], {
      cwd: projectDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
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
  const tmp = mkdtempSync(join(tmpdir(), 'bash-guard-cg-test-'));
  mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"test"}', 'utf8');
  return tmp;
}

function writeRun(projectDir, runId, opts) {
  const runDir = join(projectDir, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const run = {
    runId,
    status: opts.status || 'gate-pending',
    pipelineType: opts.pipelineType || 'plan',
    feature: opts.feature || 'test feature',
    worktreePath: opts.worktreePath || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
  // Per-run-active.json is required for findActiveRun resolution
  writeFileSync(
    join(runDir, 'run-active.json'),
    JSON.stringify({ runId, agents: [] }, null, 2),
    'utf8',
  );
}

function writePendingGate(projectDir, runId, feature) {
  writeFileSync(
    join(projectDir, '.pipeline', 'gate-pending.json'),
    JSON.stringify({
      runId,
      gate: 'commit',
      feature,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }, null, 2),
    'utf8',
  );
}

function writeApprovalToken(projectDir, actions, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (ttlMs || 120000));
  writeFileSync(
    join(projectDir, '.pipeline', 'action-approved.json'),
    JSON.stringify({
      actions,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      source: 'test',
    }, null, 2) + '\n',
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
  console.log('\n── bash-guard-commit-gate-test.js ───────────────────────────────────');

  // T1 — the bug: gate pending for worktree run, command targets MAIN
  {
    const dir = makeTmpProject();
    try {
      const runId = 'r-aaaaaaaa';
      const wtPath = join(dir, '.worktrees', runId);
      mkdirSync(wtPath, { recursive: true });
      writeRun(dir, runId, { worktreePath: wtPath, feature: 'gated feature' });
      writePendingGate(dir, runId, 'gated feature');
      writeApprovalToken(dir, ['commit']);
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "unrelated inline fix"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T1 main-root commit allowed when worktree commit-gate pending + token present (got code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T2 — preserve side-step prevention: command targets the gated worktree
  {
    const dir = makeTmpProject();
    try {
      const runId = 'r-bbbbbbbb';
      const wtPath = join(dir, '.worktrees', runId);
      mkdirSync(wtPath, { recursive: true });
      writeRun(dir, runId, { worktreePath: wtPath, feature: 'gated feature' });
      writePendingGate(dir, runId, 'gated feature');
      writeApprovalToken(dir, ['commit']);
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git -C ' + wtPath + ' commit -m "side-step"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 2,
        'T2 worktree-targeted commit BLOCKED when commit-gate pending (got code=' + res.code + ' stderr=' + res.stderr + ')');
      assert(res.stderr.includes('commit gate is pending') || res.stdout.includes('commit gate is pending'),
        'T2 block message mentions pending commit gate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T3 — no gate, no token, no active run → soft-block fires
  {
    const dir = makeTmpProject();
    try {
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "no token"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 2,
        'T3 soft-block fires when no token present (got code=' + res.code + ')');
      assert(res.stderr.includes('explicit user approval') || res.stdout.includes('explicit user approval'),
        'T3 soft-block message mentions user approval');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // T4 — gate pending for non-worktree run → unrelated main commit ALLOWED
  {
    const dir = makeTmpProject();
    try {
      const runId = 'r-cccccccc';
      writeRun(dir, runId, { worktreePath: null, feature: 'apply on main' });
      writePendingGate(dir, runId, 'apply on main');
      writeApprovalToken(dir, ['commit']);
      const payload = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "unrelated"' },
        cwd: dir,
      };
      const res = await runHook(payload, dir);
      assert(res.code === 0,
        'T4 non-worktree gate does not block unrelated main commit with token (got code=' + res.code + ' stderr=' + res.stderr + ')');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('\n  ' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed === 0 ? 0 : 1);
}

test().catch((err) => { console.error(err); process.exit(1); });
