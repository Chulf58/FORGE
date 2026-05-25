// Regression test for mcp/lib/tools/shared.js resolveProjectDir() — monorepo
// subdir promotion. Mirrors hooks/hook-utils-monorepo-test.js. Closes TODO
// 250553e5: MCP server cwd in a workspace subdir must promote to the project
// root so the gate-approval token written by the hook is found.
//
// Run: node mcp/shared-resolve-project-dir-test.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { resolveProjectDir } from './lib/tools/shared.js';

const originalCwd = process.cwd();
const tmpBase = mkdtempSync(join(tmpdir(), 'forge-mcp-monorepo-test-'));

function cleanup() {
  try { process.chdir(originalCwd); } catch { /* ignore */ }
  try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Set up fake monorepo (same shape as the hook-utils test):
//   <tmp>/repo/.git/
//   <tmp>/repo/packages/forge-core/
//   <tmp>/repo/packages/deep/a/b/c/
const repoRoot = join(tmpBase, 'repo');
const subdir = join(repoRoot, 'packages', 'forge-core');
const deepDir = join(repoRoot, 'packages', 'deep', 'a', 'b', 'c');
mkdirSync(join(repoRoot, '.git'), { recursive: true });
mkdirSync(subdir, { recursive: true });
mkdirSync(deepDir, { recursive: true });

// Ensure CLAUDE_PROJECT_DIR doesn't override cwd-driven detection during tests.
const savedClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;

test('cwd in monorepo subdir → returns repo root', () => {
  process.chdir(subdir);
  assert.equal(resolveProjectDir(), normalize(repoRoot));
});

test('cwd at repo root → returns repo root unchanged', () => {
  process.chdir(repoRoot);
  assert.equal(resolveProjectDir(), normalize(repoRoot));
});

test('cwd 4 levels deep → returns repo root via walk-up', () => {
  process.chdir(deepDir);
  assert.equal(resolveProjectDir(), normalize(repoRoot));
});

test('cwd outside any .git tree → returns cwd unchanged (no false promotion)', () => {
  process.chdir(tmpBase);
  assert.equal(resolveProjectDir(), normalize(tmpBase));
});

test('CLAUDE_PROJECT_DIR override still gets monorepo-promoted', () => {
  process.chdir(originalCwd);
  process.env.CLAUDE_PROJECT_DIR = subdir;
  try {
    assert.equal(resolveProjectDir(), normalize(repoRoot));
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
  }
});

test('cwd deeper than MONOREPO_WALK_MAX_DEPTH with no .git → returns cwd unchanged', () => {
  let deep = join(tmpBase, 'orphan');
  for (let i = 0; i < 12; i++) deep = join(deep, 'd' + i);
  mkdirSync(deep, { recursive: true });
  process.chdir(deep);
  assert.equal(resolveProjectDir(), normalize(deep));
});

test('cleanup', () => {
  if (savedClaudeProjectDir !== undefined) {
    process.env.CLAUDE_PROJECT_DIR = savedClaudeProjectDir;
  }
  cleanup();
});
