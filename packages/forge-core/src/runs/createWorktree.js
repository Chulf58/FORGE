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
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getRun } from './getRun.js';
import { updateRun } from './updateRun.js';

/**
 * Recursively copies a directory. Skips node_modules and .git.
 */
function copyDirSync(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
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

  // Copy .pipeline/ so the worktree has board, modules, project config, and runs
  const pipelineSrc = join(absRoot, '.pipeline');
  const pipelineDst = join(wtPath, '.pipeline');
  if (existsSync(pipelineSrc) && !existsSync(pipelineDst)) {
    copyDirSync(pipelineSrc, pipelineDst);
  }

  // Copy docs/ so the worktree has PLAN.md, handoff, gotchas
  const docsSrc = join(absRoot, 'docs');
  const docsDst = join(wtPath, 'docs');
  if (existsSync(docsSrc) && !existsSync(docsDst)) {
    copyDirSync(docsSrc, docsDst);
  }

  // Persist onto the run
  const updated = updateRun(absRoot, runId, {
    worktreePath: wtPath,
    branchName,
  });

  return updated;
}
