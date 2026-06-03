// Run registry — public API
// Usage: import { createRun, getRun, listRuns, updateRun } from '@forge/core/runs';

export { Run, RunStatus, RunAgent, GateState, RunIndex, RunIndexEntry } from './schemas.js';
export { createRun, generateRunId } from './createRun.js';
export { getRun } from './getRun.js';
export { listRuns } from './listRuns.js';
export { updateRun } from './updateRun.js';
export { createWorktree, removeWorktree, getGitExecutable } from './createWorktree.js';
export { rebuildIndex } from './rebuildIndex.js';

// -- Per-run active file helpers ---------------------------------------------
//
// Per-run active file lives at .pipeline/runs/<runId>/run-active.json — one
// file per run, never overwritten by a concurrent run. Readers fall back to
// the singleton .pipeline/run-active.json when the per-run file is absent.

import { join } from 'node:path';
import { runDir, writeJson } from './storage.js';

const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

/**
 * Returns the canonical path for a run's per-run active file.
 * Re-validates runId even though the MCP boundary validates first — defence-in-depth.
 * Throws TypeError for invalid runId to prevent path traversal.
 *
 * @param {string} projectDir - Absolute project root
 * @param {string} runId - Run ID matching ^r-[a-zA-Z0-9]+$
 * @returns {string} Absolute path to .pipeline/runs/<runId>/run-active.json
 */
export function getRunActivePath(projectDir, runId) {
  if (!RUN_ID_RE.test(runId)) {
    throw new TypeError('Invalid runId: must match ^r-[a-zA-Z0-9]+$ (got ' + runId + ')');
  }
  return join(runDir(projectDir, runId), 'run-active.json');
}

/**
 * Atomically writes per-run active file to .pipeline/runs/<runId>/run-active.json.
 * Uses storage.writeJson (temp-rename) — never direct writeFileSync.
 * Re-validates runId before constructing the path.
 *
 * @param {string} projectDir - Absolute project root
 * @param {string} runId - Run ID matching ^r-[a-zA-Z0-9]+$
 * @param {object} data - Active file payload (startedAt, runId, pipelineType, feature, agents, stages, worktreePath?)
 */
export function writeRunActive(projectDir, runId, data) {
  const filePath = getRunActivePath(projectDir, runId);
  writeJson(filePath, data);
}
