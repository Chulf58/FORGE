'use strict';
// Regression test for hooks/hook-utils.js resolveProjectDir() — monorepo-subdir
// promotion. Closes TODO 250553e5: conductor cwd in a workspace subdir (e.g.
// packages/forge-core) must resolve to the project root so hook-written
// approval tokens land where the MCP server reads them.
//
// Run: node hooks/hook-utils-monorepo-test.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolveProjectDir } = require('./hook-utils');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

const originalCwd = process.cwd();
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-monorepo-test-'));

function cleanup() {
  try { process.chdir(originalCwd); } catch (_) {}
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n── hook-utils-monorepo-test.js ─────────────────────────────────────────');

try {
  // Set up fake monorepo:
  //   <tmp>/repo/.git/                  (root marker)
  //   <tmp>/repo/packages/forge-core/   (workspace subdir, no .git of its own)
  //   <tmp>/repo/packages/deep/a/b/c/   (deeper subdir for depth test)
  const repoRoot = path.join(tmpBase, 'repo');
  const subdir = path.join(repoRoot, 'packages', 'forge-core');
  const deepDir = path.join(repoRoot, 'packages', 'deep', 'a', 'b', 'c');
  fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
  fs.mkdirSync(subdir, { recursive: true });
  fs.mkdirSync(deepDir, { recursive: true });

  // 1. cwd = monorepo subdir → resolveProjectDir returns repo root
  {
    process.chdir(subdir);
    const result = resolveProjectDir({ cwd: subdir });
    assert(
      result === repoRoot,
      'cwd in monorepo subdir → returns repo root (expected ' + repoRoot + ', got ' + result + ')'
    );
  }

  // 2. cwd = repo root → resolveProjectDir returns repo root unchanged
  {
    process.chdir(repoRoot);
    const result = resolveProjectDir({ cwd: repoRoot });
    assert(
      result === repoRoot,
      'cwd at repo root → returns repo root unchanged'
    );
  }

  // 3. cwd = deep subdir (4 levels) → resolveProjectDir returns repo root
  {
    process.chdir(deepDir);
    const result = resolveProjectDir({ cwd: deepDir });
    assert(
      result === repoRoot,
      'cwd 4 levels deep → returns repo root via walk-up'
    );
  }

  // 4. cwd outside any .git tree → returns cwd unchanged (no false promotion)
  //    Use the tmp base itself (no .git anywhere).
  {
    process.chdir(tmpBase);
    const result = resolveProjectDir({ cwd: tmpBase });
    assert(
      result === tmpBase,
      'cwd outside any .git tree → returns cwd unchanged (no false promotion)'
    );
  }

  // 5. Worktree-suffix-strip still wins over monorepo walk-up
  //    Set up <tmp>/repo/.worktrees/r-test/ as a worktree-shaped path.
  {
    const wtPath = path.join(repoRoot, '.worktrees', 'r-test');
    fs.mkdirSync(wtPath, { recursive: true });
    process.chdir(wtPath);
    const result = resolveProjectDir({ cwd: wtPath });
    assert(
      result === path.normalize(repoRoot),
      'cwd in .worktrees/r-<id> → worktree-strip returns repo root (precedes monorepo walk)'
    );
  }

  // 6. Walk-up has a depth cap — exceeding it returns cwd unchanged.
  //    Build a chain deeper than MONOREPO_WALK_MAX_DEPTH (10) WITHOUT any .git.
  {
    let deep = path.join(tmpBase, 'orphan');
    for (let i = 0; i < 12; i++) deep = path.join(deep, 'd' + i);
    fs.mkdirSync(deep, { recursive: true });
    process.chdir(deep);
    const result = resolveProjectDir({ cwd: deep });
    assert(
      result === deep,
      'cwd 12 levels deep with no .git anywhere → returns cwd unchanged (depth cap honored)'
    );
  }

} finally {
  cleanup();
}

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
