// @covers packages/forge-core/src/runs/createWorktree.js
//
// 607543b7 (approach B): createWorktree must NOT seed a fresh worktree with the prior run's
// per-run scratch (docs/context, .pipeline/context) — that was the r-6938359b stale-context
// confabulation vector. But the context dirs must still EXIST (empty) so a later writer never
// hits a missing parent. Integration test: real `git worktree add` against a tmpdir repo.
// Runs from main (imports forge-core → zod, which resolves in main's node_modules; it cannot
// run in a node_modules-less worktree — that constraint is exactly why this feature exists).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { createRun, createWorktree } from '../packages/forge-core/src/runs/index.js';
import { getGitExecutable } from '../packages/forge-core/src/runs/git-executable.js';

const GIT = getGitExecutable();
const git = (args, cwd) => execFileSync(GIT, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

function setupMain() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-wt-ctx-'));
  git(['init'], tmp);
  git(['config', 'user.email', 't@t.t'], tmp);
  git(['config', 'user.name', 't'], tmp);
  // Tracked baseline (preserved paths)
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"t"}\n');
  writeFileSync(join(tmp, '.pipeline', 'board.json'), '{"todos":[]}\n');
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'PLAN.md'), '# Plan\n');
  writeFileSync(join(tmp, 'README.md'), '# t\n');
  git(['add', '.'], tmp);
  git(['commit', '-m', 'init'], tmp);
  // UNTRACKED per-run scratch (the contamination) — seeded AFTER the commit so it mirrors real
  // gitignored scratch that the overlay (not git) would otherwise carry into the worktree.
  mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'context', 'scout.json'), '{"stale":true}\n');
  mkdirSync(join(tmp, '.pipeline', 'context'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'context', 'phase-1-status.json'), '{"stale":true}\n');
  return tmp;
}

test('createWorktree excludes stale per-run context scratch yet keeps the context dirs present (607543b7)', () => {
  const tmp = setupMain();
  try {
    const run = createRun({ projectRoot: tmp, sessionId: 'ctx-test', pipelineType: 'implement', feature: 'ctx exclusion' });
    const updated = createWorktree(tmp, run.runId);
    const wt = updated.worktreePath;

    // AC-3: stale scratch FILES are absent from the worktree's context dirs
    assert.equal(existsSync(join(wt, 'docs', 'context', 'scout.json')), false,
      'stale docs/context/scout.json must NOT be copied into the worktree');
    assert.equal(existsSync(join(wt, '.pipeline', 'context', 'phase-1-status.json')), false,
      'stale .pipeline/context/phase-1-status.json must NOT be copied into the worktree');

    // AC-5: the context dirs themselves EXIST (clean-but-present) so writers don't hit a missing parent
    assert.equal(existsSync(join(wt, 'docs', 'context')), true,
      'docs/context dir must exist (empty) in the worktree');
    assert.equal(existsSync(join(wt, '.pipeline', 'context')), true,
      '.pipeline/context dir must exist (empty) in the worktree');

    // AC-4: preserved paths present
    assert.equal(existsSync(join(wt, 'docs', 'PLAN.md')), true, 'docs/PLAN.md preserved');
    assert.equal(existsSync(join(wt, '.pipeline', 'project.json')), true, '.pipeline/project.json preserved');
    assert.equal(existsSync(join(wt, '.pipeline', 'board.json')), true, '.pipeline/board.json preserved');
  } finally {
    try { execFileSync(GIT, ['worktree', 'prune'], { cwd: tmp, stdio: 'pipe' }); } catch (_) { /* best effort */ }
    rmSync(tmp, { recursive: true, force: true });
  }
});
