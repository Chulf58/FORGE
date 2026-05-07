// rebuildIndex.js — Reconstruct index.json from authoritative r-*/run.json files
//
// Called lazily by listRuns when index.json is missing or empty but run
// directories exist on disk. Scans .pipeline/runs/ for r-* directories,
// reads each run.json, projects to index entry fields, and writes index.json.
//
// Malformed or missing run.json files are silently skipped — a partial
// rebuild is better than zero visibility.

import { readdirSync } from 'node:fs';
import { Run, RunIndex, RunIndexEntry } from './schemas.js';
import { runsDir, indexPath, runPath, readJson, writeJson, ensureDir, withIndexLock } from './storage.js';

/**
 * Scans r-* directories under .pipeline/runs/, reads each run.json,
 * and rebuilds index.json from them.
 *
 * @param {string} projectRoot - absolute path to the project
 * @returns {object[]} array of RunIndexEntry objects (may be empty)
 */
export function rebuildIndex(projectRoot) {
  const dir = runsDir(projectRoot);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return []; // runs/ directory doesn't exist
  }

  const runDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('r-'));
  const indexEntries = [];

  for (const d of runDirs) {
    try {
      const raw = readJson(runPath(projectRoot, d.name));
      if (!raw) continue;
      const run = Run.parse(raw);
      const entry = RunIndexEntry.parse({
        runId: run.runId,
        pipelineType: run.pipelineType,
        feature: run.feature,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        parentRunId: run.parentRunId,
        classificationId: run.classificationId ?? null,
      });
      indexEntries.push(entry);
    } catch (_) {
      // Malformed run.json — skip silently
    }
  }

  // Write the rebuilt index (locked to prevent racing with createRun)
  const idxPath = indexPath(projectRoot);
  ensureDir(idxPath.replace(/[/\\][^/\\]+$/, '')); // ensure parent dir
  withIndexLock(projectRoot, () => {
    const index = RunIndex.parse({ runs: indexEntries });
    writeJson(idxPath, index);
  });

  return indexEntries;
}
