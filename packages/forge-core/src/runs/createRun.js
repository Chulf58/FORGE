// createRun.js — Create a new run and persist it

import { randomBytes } from 'node:crypto';
import { Run, RunIndex, RunIndexEntry } from './schemas.js';
import { indexPath, runDir, runPath, ensureDir, readJson, writeJson, withIndexLock } from './storage.js';

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
 * @param {string} [params.feature] - feature name / description
 * @param {string} [params.runId] - optional explicit run ID (for testing)
 * @param {string|null} [params.parentRunId] - optional run ID of the originating run
 * @param {Record<string,string>|null} [params.stages] - initial stage map (null = no stages yet)
 * @param {string|null} [params.classificationId] - risk classification ID from forge_classify_risk
 * @param {string[]} [params.reviewerOverrides] - explicit reviewer list overriding classification
 * @returns {object} the validated Run object
 */
export function createRun({ projectRoot, sessionId, pipelineType, feature, runId, parentRunId = null, stages = null, classificationId = null, reviewerOverrides = [] }) {
  const id = runId || generateRunId();
  const now = new Date().toISOString();

  const run = Run.parse({
    runId: id,
    sessionId,
    projectRoot,
    pipelineType,
    feature: feature || '',
    status: 'created',
    createdAt: now,
    updatedAt: now,
    parentRunId,
    stages,
    classificationId,
    reviewerOverrides,
  });

  // Write run.json
  ensureDir(runDir(projectRoot, id));
  writeJson(runPath(projectRoot, id), run);

  // Update index (locked to prevent concurrent read-modify-write races)
  const indexFile = indexPath(projectRoot);
  ensureDir(indexFile.replace(/[/\\][^/\\]+$/, '')); // ensure parent dir
  withIndexLock(projectRoot, () => {
    const rawIndex = readJson(indexFile);
    const index = rawIndex ? RunIndex.parse(rawIndex) : { runs: [] };

    const entry = RunIndexEntry.parse({
      runId: id,
      pipelineType,
      feature: run.feature,
      status: run.status,
      createdAt: now,
      updatedAt: now,
      parentRunId: run.parentRunId,
      classificationId: run.classificationId ?? null,
    });

    index.runs.push(entry);
    writeJson(indexFile, index);
  });

  return run;
}
