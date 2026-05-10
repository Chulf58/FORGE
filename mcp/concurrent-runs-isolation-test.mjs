#!/usr/bin/env node
// Integration test: concurrent runs in different worktrees don't collide.
//
// Verifies the core post-singleton-elimination invariant from r-fcedb742
// Phase 4 (per-run pipeline state — TODO 902b0850):
//   - Two runs created back-to-back have distinct runIds
//   - Each gets its own worktree directory at .worktrees/<runId>/
//   - Per-run state files are isolated at .pipeline/runs/<runId>/run.json
//   - No collision-guard error blocks the second run when worktreePaths differ
//
// SCOPE NOTE: this test does not exercise the same-worktreePath collision
// case (worktree creation refuses duplicate paths at the git layer; tested
// by smoke-test-worktree.js) nor per-run-active cleanup at terminal status
// (no production mechanism currently deletes the per-run active file —
// flagged as follow-up).
//
// Run: node mcp/concurrent-runs-isolation-test.mjs
// Auto-discovered by scripts/run-tests.mjs via mcp/*-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import { createRun, getRun, createWorktree } from '../packages/forge-core/src/runs/index.js';

function git(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function fail(msg) {
  console.error('[concurrent-runs-isolation] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

function pass(line) {
  console.log('  PASS  ' + line);
}

function setupGitRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-concurrent-test-'));
  git('git init', tmp);
  git('git config user.email "test@test.com"', tmp);
  git('git config user.name "Test"', tmp);
  writeFileSync(join(tmp, 'README.md'), '# concurrent-runs-isolation test\n');
  git('git add .', tmp);
  git('git commit -m "init"', tmp);
  // Pre-create .pipeline + docs so createWorktree's copy logic has sources.
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"concurrent-test"}\n');
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'PLAN.md'), '# concurrent-runs-isolation test plan\n');
  return tmp;
}

console.log('\n── concurrent-runs-isolation-test.mjs ─────────────────────────────────');

const projectRoot = setupGitRepo();

try {
  // ── Setup: create two runs back-to-back ────────────────────────────────
  // Both pipelineType='plan' to skip the implement-pipeline guard at
  // mcp/server.js:1665-1683 (which requires an approved-plan precursor).
  const runA = createRun({
    projectRoot,
    sessionId: 'concurrent-test-A',
    pipelineType: 'plan',
    feature: 'concurrent-runs-isolation A',
  });
  const runB = createRun({
    projectRoot,
    sessionId: 'concurrent-test-B',
    pipelineType: 'plan',
    feature: 'concurrent-runs-isolation B',
  });

  // Distinct runIds.
  if (!runA.runId || !runB.runId) {
    fail('createRun did not return a runId for both runs');
  }
  if (runA.runId === runB.runId) {
    fail('runA.runId === runB.runId — runIds collided');
  }
  pass('two runs created with distinct runIds: ' + runA.runId + ' and ' + runB.runId);

  // Per-run state files exist at .pipeline/runs/<runId>/run.json (per the
  // singleton-elimination architecture from commit 8fc4f99c).
  const runAJson = join(projectRoot, '.pipeline', 'runs', runA.runId, 'run.json');
  const runBJson = join(projectRoot, '.pipeline', 'runs', runB.runId, 'run.json');
  if (!existsSync(runAJson)) fail('run A run.json missing at ' + runAJson);
  if (!existsSync(runBJson)) fail('run B run.json missing at ' + runBJson);
  pass('per-run state files isolated at .pipeline/runs/<runId>/run.json');

  // ── Worktree creation: each run gets its own worktree at .worktrees/<runId>/ ─
  const updatedA = createWorktree(projectRoot, runA.runId);
  const updatedB = createWorktree(projectRoot, runB.runId);

  if (!updatedA.worktreePath || !updatedB.worktreePath) {
    fail('createWorktree did not assign worktreePath to both runs');
  }
  if (updatedA.worktreePath === updatedB.worktreePath) {
    fail('worktreePath collision: both runs got ' + updatedA.worktreePath);
  }
  pass('worktreePaths distinct: ' + updatedA.worktreePath + ' vs ' + updatedB.worktreePath);

  // Worktree dirs exist on disk.
  if (!existsSync(updatedA.worktreePath)) {
    fail('worktree A dir missing on disk: ' + updatedA.worktreePath);
  }
  if (!existsSync(updatedB.worktreePath)) {
    fail('worktree B dir missing on disk: ' + updatedB.worktreePath);
  }
  pass('both worktree directories exist on disk');

  // Branch names are forge/<runId> and distinct.
  if (updatedA.branchName !== 'forge/' + runA.runId) {
    fail('branch A name mismatch: got ' + updatedA.branchName);
  }
  if (updatedB.branchName !== 'forge/' + runB.runId) {
    fail('branch B name mismatch: got ' + updatedB.branchName);
  }
  pass('branch names follow forge/<runId> convention and are distinct');

  // ── Registry consistency: getRun returns isolated state per runId ──────
  const fetchedA = getRun(projectRoot, runA.runId);
  const fetchedB = getRun(projectRoot, runB.runId);
  if (fetchedA.runId !== runA.runId) {
    fail('getRun(A) returned wrong runId: ' + fetchedA.runId);
  }
  if (fetchedB.runId !== runB.runId) {
    fail('getRun(B) returned wrong runId: ' + fetchedB.runId);
  }
  if (fetchedA.feature === fetchedB.feature) {
    fail('feature names crossed: A and B should be distinct');
  }
  if (fetchedA.worktreePath === fetchedB.worktreePath) {
    fail('worktreePath crossed in registry: A and B share ' + fetchedA.worktreePath);
  }
  pass('registry isolates per-run state across getRun() calls');

  console.log('\n[concurrent-runs-isolation] PASS');
  console.log('  runA: ' + runA.runId + ' (worktree: ' + updatedA.worktreePath + ')');
  console.log('  runB: ' + runB.runId + ' (worktree: ' + updatedB.worktreePath + ')');
  console.log('  Both runs created concurrently with full state isolation.');
} finally {
  // Cleanup: remove worktrees first (git worktree won't drop them on rm -rf
  // alone), then the project dir.
  try {
    git('git worktree prune', projectRoot);
  } catch (_) { /* best-effort */ }
  try { rmSync(projectRoot, { recursive: true, force: true }); } catch (_) {}
}
