// git-executable.js — resolve the git executable, with ZERO forge-core deps.
//
// Extracted from createWorktree.js (soak r-8c327c9a): that module imports
// getRun/updateRun → schemas.js → zod. Spawned scripts that run from a git
// worktree (covers-verify.mjs) have NO node_modules, so importing getGitExecutable
// through any zod-pulling chain crashes them with ERR_MODULE_NOT_FOUND. This leaf
// depends on node builtins ONLY, so it is safe to import from a node_modules-less
// worktree. createWorktree.js and runs/index.js re-export from here for back-compat.
//
// Single source of truth for the PATH-probe-then-install-location fallback — the
// worker process spawned by the MCP server often lacks the user's full PATH on
// Windows, so a bare `execFile('git')` fails (soak r-29911e2c #7).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let _resolvedGit = null;
let _searchedPaths = [];

/**
 * Resolve a usable git executable. Tries PATH first, then common Git for Windows
 * install locations. Memoized. Throws an actionable error listing searched paths
 * if git cannot be found.
 *
 * @returns {string} the git executable (the literal 'git' or an absolute path)
 */
export function getGitExecutable() {
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
