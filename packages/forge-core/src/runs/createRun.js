// createRun.js — Create a new run and persist it

import { randomBytes } from 'node:crypto';
import { Run, RunIndex, RunIndexEntry } from './schemas.js';
import { indexPath, runDir, runPath, ensureDir, readJson, writeJson } from './storage.js';

/**
 * Generates a short, collision-resistant run ID.
 * Format: "r-" + 8 hex chars (4 bytes = 4 billion possibilities).
 * Short enough for filenames and log output.
 */
export function generateRunId() {
  return 'r-' + randomBytes(4).toString('hex');
}

/**
 * Creates a new run, persists it to disk, and updates the index.
 *
 * @param {object} params
 * @param {string} params.projectRoot - absolute path to the project
 * @param {string} params.sessionId - Claude session ID
 * @param {string} params.pipelineType - one of: plan, implement, apply, debug, refactor
 * @param {string} params.mode - one of: SPRINT, LEAN, STANDARD, FULL
 * @param {string} [params.feature] - feature name / description
 * @param {string} [params.runId] - optional explicit run ID (for testing)
 * @returns {object} the validated Run object
 */
export function createRun({ projectRoot, sessionId, pipelineType, mode, feature, runId }) {
  const id = runId || generateRunId();
  const now = new Date().toISOString();

  const run = Run.parse({
    runId: id,
    sessionId,
    projectRoot,
    pipelineType,
    mode,
    feature: feature || '',
    status: 'created',
    createdAt: now,
    updatedAt: now,
  });

  // Write run.json
  ensureDir(runDir(projectRoot, id));
  writeJson(runPath(projectRoot, id), run);

  // Update index
  const indexFile = indexPath(projectRoot);
  ensureDir(indexFile.replace(/[/\\][^/\\]+$/, '')); // ensure parent dir
  const rawIndex = readJson(indexFile);
  const index = rawIndex ? RunIndex.parse(rawIndex) : { runs: [] };

  const entry = RunIndexEntry.parse({
    runId: id,
    pipelineType,
    feature: run.feature,
    status: run.status,
    createdAt: now,
    updatedAt: now,
  });

  index.runs.push(entry);
  writeJson(indexFile, index);

  return run;
}
