// getRun.js — Read a single run by ID

import { Run } from './schemas.js';
import { runPath, readJson } from './storage.js';

/**
 * Returns a validated Run object, or null if the run doesn't exist.
 *
 * @param {string} projectRoot
 * @param {string} runId
 * @returns {object|null}
 */
export function getRun(projectRoot, runId) {
  const raw = readJson(runPath(projectRoot, runId));
  if (!raw) return null;
  return Run.parse(raw);
}
