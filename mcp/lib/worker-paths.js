import { join } from 'node:path';

/**
 * Validates a runId against the canonical pattern.
 * Defense-in-depth: this module does not rely on callers to pre-validate.
 * @param {string} runId
 * @throws {Error} if runId does not match ^r-[a-zA-Z0-9]+$
 */
function assertRunId(runId) {
  if (!/^r-[a-zA-Z0-9]+$/.test(runId)) {
    throw new Error('Invalid runId: must match r-<alnum> format (e.g. r-a1b2c3d4), got: ' + runId);
  }
}

/**
 * Returns the absolute path of the worker log file.
 *
 * @param {string} projectRoot - The MAIN project root (never a worktree path).
 *   For non-worktree runs this equals workDir. For worktree-backed runs this is
 *   the main repo root resolved via the .git gitdir file — NOT the worktree path.
 * @param {string} runId - The run ID (must match ^r-[a-zA-Z0-9]+$).
 * @returns {string} Absolute path: <projectRoot>/.pipeline/worker-logs/<runId>.log
 */
export function workerLogPath(projectRoot, runId) {
  assertRunId(runId);
  return join(projectRoot, '.pipeline', 'worker-logs', runId + '.log');
}

/**
 * Returns the absolute path of the kill-pill sentinel file.
 *
 * The conductor writes this file to request graceful worker shutdown.
 * The worker watches this path and sets poisonPillDetected = true on detection.
 *
 * @param {string} projectRoot - The MAIN project root (never a worktree path).
 *   Must be the same root used by forge_kill_worker in mcp/server.js so that
 *   the file written by the conductor is the same file watched by the worker.
 * @param {string} runId - The run ID (must match ^r-[a-zA-Z0-9]+$).
 * @returns {string} Absolute path: <projectRoot>/.pipeline/worker-kill/<runId>
 */
export function killPillPath(projectRoot, runId) {
  assertRunId(runId);
  return join(projectRoot, '.pipeline', 'worker-kill', runId);
}

/**
 * Returns the absolute path of the reset-pill sentinel file.
 *
 * The implement skill writes this file inside the WORKTREE after each phase
 * commit to reset the worker's 60-minute safety-valve timer. The worker reads
 * it from the same worktree directory. This file MUST remain in the worktree —
 * moving it to projectRoot would break the implement-skill timer reset because
 * the skill always operates inside the worktree.
 *
 * @param {string} worktreePath - The WORKTREE path (NOT the main project root).
 *   For non-worktree runs workDir === projectRoot, so the path is identical.
 *   For worktree-backed runs this must be the worktree directory (process.cwd()
 *   in the worker, or run.worktreePath in the conductor).
 * @param {string} runId - The run ID (must match ^r-[a-zA-Z0-9]+$).
 * @returns {string} Absolute path: <worktreePath>/.pipeline/worker-reset/<runId>
 */
export function resetPillPath(worktreePath, runId) {
  assertRunId(runId);
  return join(worktreePath, '.pipeline', 'worker-reset', runId);
}
