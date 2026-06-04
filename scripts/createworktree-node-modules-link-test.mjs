// @covers packages/forge-core/src/runs/createWorktree.js
//
// d5e63ffd: `git worktree add` checks out only tracked files, so a fresh worktree has no
// node_modules — any worktree-run test that imports forge-core (zod) or mcp deps crashes
// (ERR_MODULE_NOT_FOUND). createWorktree junctions main's node_modules dirs into the worktree
// so deps resolve. CRITICAL: removeWorktree must unlink those junctions FIRST, so neither
// `git worktree remove` nor the rmSync fallback can delete MAIN's node_modules through the link.
// Runs from main (imports forge-core → zod resolves in main's node_modules).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { createRun, createWorktree, removeWorktree } from '../packages/forge-core/src/runs/index.js';
import { getGitExecutable } from '../packages/forge-core/src/runs/git-executable.js';

const GIT = getGitExecutable();
const git = (args, cwd) => execFileSync(GIT, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

function setupMain() {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-wt-nm-'));
  git(['init'], tmp);
  git(['config', 'user.email', 't@t.t'], tmp);
  git(['config', 'user.name', 't'], tmp);
  // Tracked package dirs so `git worktree add` checks out mcp/ and packages/forge-core/.
  mkdirSync(join(tmp, '.pipeline'), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'project.json'), '{"name":"t"}\n');
  mkdirSync(join(tmp, 'mcp'), { recursive: true });
  writeFileSync(join(tmp, 'mcp', 'server.js'), '// mcp\n');
  mkdirSync(join(tmp, 'packages', 'forge-core'), { recursive: true });
  writeFileSync(join(tmp, 'packages', 'forge-core', 'index.js'), '// fc\n');
  writeFileSync(join(tmp, 'README.md'), '# t\n');
  git(['add', '.'], tmp);
  git(['commit', '-m', 'init'], tmp);
  // UNTRACKED node_modules in main (gitignored in the real repo) with sentinel files.
  mkdirSync(join(tmp, 'mcp', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(tmp, 'mcp', 'node_modules', 'dep', 'SENTINEL'), 'mcp-dep\n');
  mkdirSync(join(tmp, 'packages', 'forge-core', 'node_modules', 'zod'), { recursive: true });
  writeFileSync(join(tmp, 'packages', 'forge-core', 'node_modules', 'zod', 'SENTINEL'), 'fc-zod\n');
  return tmp;
}

function cleanup(tmp) {
  try { execFileSync(GIT, ['worktree', 'prune'], { cwd: tmp, stdio: 'pipe' }); } catch (_) { /* best effort */ }
  rmSync(tmp, { recursive: true, force: true });
}

test('d5e63ffd: createWorktree junctions main node_modules into the worktree (deps resolvable)', () => {
  const tmp = setupMain();
  try {
    const run = createRun({ projectRoot: tmp, sessionId: 'nm', pipelineType: 'implement', feature: 'nm' });
    const wt = createWorktree(tmp, run.runId).worktreePath;
    assert.equal(existsSync(join(wt, 'mcp', 'node_modules', 'dep', 'SENTINEL')), true,
      'worktree mcp/node_modules must resolve to main (junction) so deps are available');
    assert.equal(existsSync(join(wt, 'packages', 'forge-core', 'node_modules', 'zod', 'SENTINEL')), true,
      'worktree packages/forge-core/node_modules must resolve to main (junction) — zod resolvable');
    assert.equal(lstatSync(join(wt, 'packages', 'forge-core', 'node_modules')).isSymbolicLink(), true,
      'worktree node_modules must be a symlink/junction, not a copy');
  } finally { cleanup(tmp); }
});

test('d5e63ffd SAFETY: removeWorktree does NOT delete main node_modules through the junction', () => {
  const tmp = setupMain();
  try {
    const run = createRun({ projectRoot: tmp, sessionId: 'nm2', pipelineType: 'implement', feature: 'nm2' });
    const updated = createWorktree(tmp, run.runId);
    removeWorktree(tmp, run.runId, updated.worktreePath);
    // MAIN's node_modules sentinels MUST survive — the junction must be unlinked, never followed.
    assert.equal(existsSync(join(tmp, 'mcp', 'node_modules', 'dep', 'SENTINEL')), true,
      'main mcp/node_modules must survive removeWorktree (junction unlinked, not followed)');
    assert.equal(existsSync(join(tmp, 'packages', 'forge-core', 'node_modules', 'zod', 'SENTINEL')), true,
      'main packages/forge-core/node_modules must survive removeWorktree');
  } finally { cleanup(tmp); }
});
