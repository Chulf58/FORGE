// listRuns.js — List all runs from the index, with optional filters
//
// Lazy healing: if index.json is missing or empty but r-* run directories
// exist on disk, rebuildIndex() reconstructs the index from authoritative
// run.json files before returning results.

import { RunIndex } from './schemas.js';
import { indexPath, runsDir, readJson } from './storage.js';
import { rebuildIndex } from './rebuildIndex.js';
import { readdirSync } from 'node:fs';

/**
 * Returns all run index entries, optionally filtered.
 *
 * @param {string} projectRoot
 * @param {object} [filters]
 * @param {string} [filters.status] - filter by status
 * @param {string} [filters.pipelineType] - filter by pipeline type
 * @returns {object[]} array of RunIndexEntry objects
 */
export function listRuns(projectRoot, filters = {}) {
  const raw = readJson(indexPath(projectRoot));
  let entries;

  if (raw) {
    const index = RunIndex.parse(raw);
    entries = index.runs;
  } else {
    entries = [];
  }

  // Lazy heal: if index is missing or empty, check for orphaned run directories
  if (entries.length === 0) {
    let hasRunDirs = false;
    try {
      const dirEntries = readdirSync(runsDir(projectRoot), { withFileTypes: true });
      hasRunDirs = dirEntries.some(e => e.isDirectory() && e.name.startsWith('r-'));
    } catch (_) {
      // runs/ directory doesn't exist — no healing needed
    }
    if (hasRunDirs) {
      entries = rebuildIndex(projectRoot);
    }
  }

  if (filters.status) {
    entries = entries.filter(e => e.status === filters.status);
  }
  if (filters.pipelineType) {
    entries = entries.filter(e => e.pipelineType === filters.pipelineType);
  }

  return entries;
}
