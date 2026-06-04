// createWorktree.js — Create a FORGE-managed git worktree for a run
//
// This is the core worktree operation. It:
// 1. Validates the run exists and doesn't already have a worktree
// 2. Creates a git worktree at .worktrees/<runId>/ with branch forge/<runId>
// 3. Copies .pipeline/ and docs/ into the worktree
// 4. Persists worktreePath and branchName onto the run
//
// No Claude dependency. No MCP dependency. Pure git + filesystem.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync, readFileSync, writeFileSync, symlinkSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRun } from './getRun.js';
import { updateRun } from './updateRun.js';
import { getGitExecutable } from './git-executable.js';

/**
 * Recursively copies a directory. Skips node_modules and .git.
 *
 * @param {string} src
 * @param {string} dst
 * @param {{ skipExisting?: boolean, excludeDirs?: string[] }} [opts]
 *   excludeDirs (default []): directory names to skip entirely (at any depth) — used by the
 *   worktree overlay to drop the per-run 'context' scratch so a fresh worktree is not seeded
 *   with the prior run's leftovers (607543b7 / r-6938359b stale-context confabulation vector).
 *   skipExisting (default false): when true, files whose destination already
 *   exists are NOT overwritten. Used by the docs/ and .pipeline/ overlays
 *   in createWorktree so that tracked files already checked out by
 *   `git worktree add` keep git's exact bytes — avoids the phantom line-
 *   ending modifications observed on Windows (10575378). Gitignored files
 *   absent in the fresh worktree still get copied (their destination
 *   doesn't exist, so the skip check doesn't fire).
 */
export function copyDirSync(src, dst, opts = {}) {
  const skipExisting = !!(opts && opts.skipExisting);
  const excludeDirs = (opts && Array.isArray(opts.excludeDirs)) ? opts.excludeDirs : [];
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    // excludeDirs (607543b7): skip named subdirs (e.g. the per-run 'context' scratch) at ANY
    // depth — the recursive call below passes opts through, so the name match propagates.
    if (entry.isDirectory() && excludeDirs.includes(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath, opts);
    } else if (!skipExisting || !existsSync(dstPath)) {
      copyFileSync(srcPath, dstPath);
    }
  }
}

// getGitExecutable now lives in the dependency-free leaf ./git-executable.js so it can
// be imported from a node_modules-less git worktree (covers-verify.mjs runs there and a
// zod-pulling chain crashed it — soak r-8c327c9a). Re-exported here for back-compat:
// callers historically import it from this module and via runs/index.js.
export { getGitExecutable };

/**
 * Runs a git command in a given cwd. Uses execFileSync to bypass shell
 * parsing entirely — the resolved executable is passed as a separate
 * argument, eliminating Windows cmd.exe quoting edge cases.
 *
 * @param {string[]} args - git args as an array (NO shell string, NO leading 'git')
 * @param {string} cwd - working directory for the command
 * @returns {string} stdout, trimmed
 */
function git(args, cwd) {
  const gitExe = getGitExecutable();
  return execFileSync(gitExe, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000, // 30s safety valve — prevents indefinite worker hang when a git call stalls (TODO 4db4d05c). On Windows, `git worktree add` has been observed to never return; a hung command throws ETIMEDOUT here, the caller propagates an error, and the worker gets a tool_result instead of freezing.
  }).trim();
}

/**
 * d5e63ffd: relative dirs (under the project root) that may hold their own node_modules.
 * This repo has no root install — deps live in per-package node_modules (mcp/, packages/*).
 * '' (root) is included for portability. createWorktree junctions each existing one into the
 * worktree; removeWorktree unlinks them first. Shared so the link and unlink sets never drift.
 *
 * @param {string} absRoot - absolute project root (main checkout)
 * @returns {string[]} relative dir paths to check for a node_modules child
 */
function nodeModulesParents(absRoot) {
  const rels = ['', 'mcp'];
  try {
    for (const e of readdirSync(join(absRoot, 'packages'), { withFileTypes: true })) {
      if (e.isDirectory()) rels.push(join('packages', e.name));
    }
  } catch (_) { /* no packages/ dir — fine */ }
  return rels;
}

/**
 * Creates a FORGE-managed worktree for an existing run.
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {string} runId - existing run ID
 * @returns {object} the updated Run object with worktreePath and branchName set
 * @throws {Error} if run not found, already has worktree, or git fails
 */
export function createWorktree(projectRoot, runId) {
  const absRoot = resolve(projectRoot);

  // Validate run exists
  const run = getRun(absRoot, runId);
  if (!run) {
    throw new Error('Run not found: ' + runId);
  }
  if (run.worktreePath) {
    throw new Error('Run ' + runId + ' already has a worktree: ' + run.worktreePath);
  }

  // Verify this is a git repo via filesystem check — avoids PATH dependency
  // on the `git` executable. The MCP server subprocess on Windows often lacks
  // the user's full PATH, so shelling out to `git rev-parse` can fail even
  // when the directory is a valid repo. A plain .git check works regardless.
  const gitPath = join(absRoot, '.git');
  if (!existsSync(gitPath)) {
    throw new Error('Not a git repository (no .git found at ' + absRoot + ')');
  }

  const worktreeDir = join(absRoot, '.worktrees');
  const wtPath = join(worktreeDir, runId);
  const branchName = 'forge/' + runId;

  // Create the worktree
  mkdirSync(worktreeDir, { recursive: true });

  if (existsSync(wtPath)) {
    // Directory exists (leftover from a crash?) — verify git knows about it.
    // If git worktree registration is gone (e.g. after `git worktree prune`),
    // remove the orphaned directory and recreate properly.
    try {
      const list = git(['worktree', 'list', '--porcelain'], absRoot);
      if (!list.includes(wtPath.replace(/\\/g, '/'))) {
        rmSync(wtPath, { recursive: true, force: true });
        git(['worktree', 'add', wtPath, '-b', branchName], absRoot);
      }
    } catch (_) {
      // If verification fails, proceed with existing directory — best effort
    }
  } else {
    // Surface the actual git error if worktree creation fails — could be
    // "branch already exists", permission denied, or a real git error.
    // Using execFileSync via git() bypasses the shell — no quoting concerns.
    try {
      git(['worktree', 'add', wtPath, '-b', branchName], absRoot);
    } catch (err) {
      const detail = (err && (err.stderr || err.message)) || String(err);
      throw new Error('git worktree add failed: ' + detail);
    }
  }

  // Phase-2 Task-9 (Option B): worktrees no longer carry a worker-specific CLAUDE.md.
  // Per-agent systemPrompts come from agents/<type>.md via mcp/lib/orchestrator/agent-dispatch.mjs,
  // and the SDK runs in isolation mode (settingSources: []) so no CLAUDE.md is auto-loaded.
  // The conductor CLAUDE.md that git checkout produces is left in place untouched (harmless —
  // no autonomous worker reads it).

  // Merge-copy directories: git checkout may have created these from tracked files,
  // but gitignored files (PLAN.md, board.json, etc.) still need copying from main.
  // skipExisting:true preserves git's checked-out bytes for tracked files — without
  // it, copyDirSync overwrites with main's working-tree bytes which may differ on
  // Windows due to line-ending conversion, causing phantom `M` status (10575378).
  // 607543b7 (approach B): exclude the per-run 'context' scratch from the overlay so a fresh
  // worktree is not seeded with the prior run's leftovers (the r-6938359b stale-context
  // confabulation vector). 'context' is name-matched at any depth — confirmed benign: the only
  // context/ dirs under .pipeline/ and docs/ are the per-run scratch (.pipeline/context,
  // docs/context, and the nested .pipeline/context/verdicts).
  const pipelineSrc = join(absRoot, '.pipeline');
  const pipelineDst = join(wtPath, '.pipeline');
  if (existsSync(pipelineSrc)) {
    copyDirSync(pipelineSrc, pipelineDst, { skipExisting: true, excludeDirs: ['context'] });
  }

  const docsSrc = join(absRoot, 'docs');
  const docsDst = join(wtPath, 'docs');
  if (existsSync(docsSrc)) {
    copyDirSync(docsSrc, docsDst, { skipExisting: true, excludeDirs: ['context'] });
  }

  // Recreate the (empty) context dirs after the overlay so they always EXIST in the worktree —
  // clean of stale scratch but present — and no writer trips on a missing parent. .pipeline/context
  // has no tracked keeper (git ls-files shows none), so without this it would be absent entirely;
  // docs/context survives via its tracked .gitkeep but we create both for symmetry.
  mkdirSync(join(wtPath, '.pipeline', 'context'), { recursive: true });
  mkdirSync(join(wtPath, 'docs', 'context'), { recursive: true });

  // d5e63ffd: junction main's node_modules into the worktree. `git worktree add` checks out only
  // tracked files, so a fresh worktree has NO node_modules — any worktree-run test that imports
  // forge-core (zod, in packages/forge-core/node_modules) or mcp deps would crash ERR_MODULE_NOT_FOUND.
  // Use a junction on Windows / dir symlink on POSIX (no admin needed). Fail-soft: a link error
  // (e.g. missing symlink privilege) logs nothing and leaves the worktree usable for non-dep work.
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  for (const rel of nodeModulesParents(absRoot)) {
    const srcNm = join(absRoot, rel, 'node_modules');
    const dstNm = join(wtPath, rel, 'node_modules');
    if (existsSync(srcNm) && !existsSync(dstNm)) {
      try {
        mkdirSync(join(wtPath, rel), { recursive: true });
        symlinkSync(srcNm, dstNm, linkType);
      } catch (_) { /* link unavailable — worktree still usable, just no resolvable deps */ }
    }
  }

  // Persist onto the run
  const updated = updateRun(absRoot, runId, {
    worktreePath: wtPath,
    branchName,
  });

  return updated;
}

/**
 * Removes a FORGE-managed worktree for a run.
 *
 * Safe to call when:
 * - The worktree directory does not exist (no-op, returns false).
 * - Git does not know about the worktree (rmSync fallback only).
 *
 * Does NOT touch the run record — caller is responsible for any
 * run.json cleanup (pruneTerminalRuns deletes the whole run dir).
 *
 * @param {string} projectRoot - absolute path to the project
 * @param {string} runId - run ID whose worktree should be removed
 * @param {string|null} worktreePath - path recorded on the run (may be null)
 * @returns {boolean} true if a worktree was removed, false if nothing to do
 */
export function removeWorktree(projectRoot, runId, worktreePath) {
  const absRoot = resolve(projectRoot);
  // Derive path from runId as a fallback when worktreePath is missing
  const wtPath = worktreePath || join(absRoot, '.worktrees', runId);
  const branchName = 'forge/' + runId;

  if (!existsSync(wtPath)) {
    // Nothing on disk — still attempt git prune in case git metadata is stale
    try { git(['worktree', 'prune'], absRoot); } catch (_) {}
    return false;
  }

  // d5e63ffd DATA-LOSS GUARD: unlink the node_modules junctions FIRST, before git/rmSync touch
  // the worktree. createWorktree junctions main's node_modules into the worktree; if a junction
  // is still live when `git worktree remove --force` or the recursive rmSync fallback runs, it
  // could be FOLLOWED into MAIN's node_modules and delete it. rmSync(recursive:false) removes the
  // LINK only, never the target. (Verified by the create→remove survival test — main survives.)
  for (const rel of nodeModulesParents(absRoot)) {
    const j = join(wtPath, rel, 'node_modules');
    try {
      if (existsSync(j) && lstatSync(j).isSymbolicLink()) {
        rmSync(j, { recursive: false, force: true });
      }
    } catch (_) { /* best effort — if it lingers, git/rmSync handle it (link, not target) */ }
  }

  // Ask git to deregister and remove the worktree.
  // --force handles the case where the worktree has uncommitted changes
  // (prune always runs after terminal runs, so this is intentional).
  try { git(['worktree', 'remove', wtPath, '--force'], absRoot); } catch (_) {}

  // Delete the branch. -D (force-delete) is safe here: the run is terminal,
  // meaning it was either merged (completed) or abandoned (failed/discarded).
  try { git(['branch', '-D', branchName], absRoot); } catch (_) {}

  // Clean up any stale git metadata
  try { git(['worktree', 'prune'], absRoot); } catch (_) {}

  // Belt-and-suspenders: if git worktree remove left the dir behind, remove it
  if (existsSync(wtPath)) {
    try { rmSync(wtPath, { recursive: true, force: true }); } catch (_) {}
  }

  return true;
}
