// mcp/lib/orchestrator/commit-worktree.mjs
// Commits the worktree's source changes — the orchestrated implement path's
// equivalent of the prose worker's apply Step 3c. The deterministic orchestrator
// calls this ONLY on the all-APPROVED gate2 path (the only state that flows to
// apply/merge); a BLOCK or unresolved-revise is a stop-for-the-human state and is
// intentionally NOT committed (task 94302649).
//
// Stages each changed file individually (never `git add -A`), commits with the
// given message, and returns { committed, sha?, reason? }. Never throws on a
// nothing-to-commit diff. All git is run via an args-array exec (no shell), so the
// message and filenames are never shell-interpreted — injection-safe by construction.
// Forbidden ops (--force/--amend/--no-verify/reset/clean/stash) are never issued.

import { execFile } from 'node:child_process';

/**
 * Default exec — runs a command (no shell), captures stdout/stderr/exitCode.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
function defaultExec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
      });
    });
  });
}

/**
 * Stage + commit the worktree's changed source files.
 *
 * @param {string} workDir - the worktree path (git runs with cwd=workDir)
 * @param {string} message - commit message (passed verbatim as a single arg — no shell)
 * @param {{ exec?: function }} [deps] - injectable exec for testing; defaults to a child_process runner
 * @returns {Promise<{ committed: boolean, sha?: string, reason?: string }>}
 */
export async function commitWorktree(workDir, message, { exec = defaultExec } = {}) {
  const opts = { cwd: workDir };

  // 1. List changed tracked files (vs HEAD). args[0] === 'diff' so callers/mocks can key on it.
  const diff = await exec('git', ['diff', '--name-only', 'HEAD'], opts);
  const files = String(diff.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  if (files.length === 0) {
    return { committed: false, reason: 'nothing to commit: no changed files in worktree' };
  }

  // 2. Stage each file INDIVIDUALLY — never `git add -A` / `.` / `--all`
  //    (matches apply Step 3c discipline; avoids sweeping in unintended paths).
  for (const file of files) {
    await exec('git', ['add', file], opts);
  }

  // 3. Commit. Message passed verbatim as one arg (execFile, no shell → injection-safe).
  const commit = await exec('git', ['commit', '-m', message], opts);
  if (typeof commit.exitCode === 'number' && commit.exitCode !== 0) {
    return { committed: false, reason: 'git commit failed: ' + (commit.stderr || ('exit ' + commit.exitCode)) };
  }

  return { committed: true, sha: String(commit.stdout || '').trim() || undefined };
}
