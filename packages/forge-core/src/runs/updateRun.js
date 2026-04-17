// updateRun.js — Patch a run and sync its index entry

import { Run, RunIndex } from './schemas.js';
import { runPath, indexPath, readJson, writeJson } from './storage.js';

/**
 * Applies a partial update to a run. Re-validates the full object after patching.
 * Updates the index entry's status and updatedAt to stay in sync.
 *
 * @param {string} projectRoot
 * @param {string} runId
 * @param {object} patch - partial Run fields to merge
 * @returns {object} the updated, validated Run object
 * @throws {Error} if the run doesn't exist
 */
export function updateRun(projectRoot, runId, patch) {
  const filePath = runPath(projectRoot, runId);
  const raw = readJson(filePath);
  if (!raw) {
    throw new Error('Run not found: ' + runId);
  }

  const now = new Date().toISOString();
  const merged = { ...raw, ...patch, updatedAt: now };
  const run = Run.parse(merged);

  writeJson(filePath, run);

  // Sync index entry
  const idxPath = indexPath(projectRoot);
  const rawIndex = readJson(idxPath);
  if (rawIndex) {
    const index = RunIndex.parse(rawIndex);
    const entry = index.runs.find(e => e.runId === runId);
    if (entry) {
      entry.status = run.status;
      entry.updatedAt = now;
      writeJson(idxPath, index);
    }
  }

  return run;
}
