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
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRun } from './getRun.js';
import { updateRun } from './updateRun.js';

/**
 * Recursively copies a directory. Skips node_modules and .git.
 *
 * @param {string} src
 * @param {string} dst
 * @param {{ skipExisting?: boolean }} [opts]
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
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath, opts);
    } else if (!skipExisting || !existsSync(dstPath)) {
      copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * Resolves the git executable path for the current process.
 * On Windows, the MCP server subprocess spawned by Claude Code often lacks
 * the user's full PATH, so `git` may not be directly invokable even when
 * Git for Windows is installed. This tries plain `git` first (via PATH
 * lookup), then falls back to common Windows Git install locations.
 *
 * Returns an UNQUOTED executable path/name — used as execFileSync's `file`
 * argument, not concatenated into a shell string.
 *
 * Cached per process — probed once, then reused.
 * Throws an actionable error listing searched paths if git cannot be found.
 */
let _resolvedGit = null;
let _searchedPaths = [];
function getGitExecutable() {
  if (_resolvedGit) return _resolvedGit;

  // Try PATH-based 'git' first — execFileSync's process-level PATH lookup
  // works on Linux/macOS and on Windows when PATH contains git
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    _resolvedGit = 'git';
    return _resolvedGit;
  } catch (_) {
    // Fall through to filesystem candidate search
  }

  // Fall back to common Git for Windows install locations.
  // Covers both system-wide installs (Program Files) and per-user installs
  // (LOCALAPPDATA\Programs\Git) used by the current Git for Windows installer.
  const candidates = ['PATH (git)'];
  const probePaths = [];
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] || (process.env['USERPROFILE'] ? process.env['USERPROFILE'] + '\\AppData\\Local' : null);

  for (const base of [programFiles, programFilesX86, localAppData && localAppData + '\\Programs']) {
    if (!base) continue;
    probePaths.push(base + '\\Git\\cmd\\git.exe');
    probePaths.push(base + '\\Git\\bin\\git.exe');
    probePaths.push(base + '\\Git\\mingw64\\bin\\git.exe');
  }

  for (const candidate of probePaths) {
    candidates.push(candidate);
    if (existsSync(candidate)) {
      // Return unquoted path — execFileSync takes it as a separate arg,
      // no shell parsing, no quoting concerns
      _resolvedGit = candidate;
      _searchedPaths = candidates;
      return _resolvedGit;
    }
  }

  _searchedPaths = candidates;
  throw new Error(
    'Git executable not found. Searched: ' + candidates.join(' | ') +
    '. Ensure Git for Windows is installed, or add git.exe to the MCP server process PATH.'
  );
}

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

  // Overwrite the conductor CLAUDE.md that git checked out with worker-specific instructions.
  // Claude Code loads <cwd>/CLAUDE.md before any hook additionalContext fires, so this must
  // happen at worktree-creation time — a hook-time write is too late.
  try {
    const pluginRoot = resolve(fileURLToPath(import.meta.url), '../../../../..');
    const workerMdContent = readFileSync(join(pluginRoot, 'CLAUDE-WORKER.md'), 'utf-8');
    writeFileSync(join(wtPath, 'CLAUDE.md'), workerMdContent, 'utf-8');
  } catch (_) {
    // Fail-open: if CLAUDE-WORKER.md is unreadable, leave the checked-out CLAUDE.md
    // in place. Worker will get conductor rules — degraded but not fatal.
  }

  // Merge-copy directories: git checkout may have created these from tracked files,
  // but gitignored files (PLAN.md, board.json, etc.) still need copying from main.
  // skipExisting:true preserves git's checked-out bytes for tracked files — without
  // it, copyDirSync overwrites with main's working-tree bytes which may differ on
  // Windows due to line-ending conversion, causing phantom `M` status (10575378).
  const pipelineSrc = join(absRoot, '.pipeline');
  const pipelineDst = join(wtPath, '.pipeline');
  if (existsSync(pipelineSrc)) {
    copyDirSync(pipelineSrc, pipelineDst, { skipExisting: true });
  }

  const docsSrc = join(absRoot, 'docs');
  const docsDst = join(wtPath, 'docs');
  if (existsSync(docsSrc)) {
    copyDirSync(docsSrc, docsDst, { skipExisting: true });
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
