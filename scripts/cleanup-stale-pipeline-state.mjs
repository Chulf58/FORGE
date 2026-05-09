#!/usr/bin/env node
// Cleanup stale FORGE pipeline state from a project's .pipeline/ directory.
//
// Removes:
//   - .pipeline/run-active.json (the eliminated singleton) when its runId
//     points to a non-existent or terminal run
//   - .pipeline/run-agent-counts/<runId>.json files for runs whose run.json
//     either doesn't exist or shows a terminal status (completed/failed/discarded)
//
// Preserves:
//   - run-active.json when its runId points to a non-terminal run.json
//     (some old setups still write it; preservation is conservative)
//   - run-agent-counts/<runId>.json for any non-terminal run
//   - All other .pipeline/ files
//
// Usage:
//   node scripts/cleanup-stale-pipeline-state.mjs [--dry-run]
//
// Stdout: JSON summary
//   { singletonDeleted: bool, countersDeleted: string[], preserved: string[] }
// Exit code: 0 on success, 1 only on unexpected errors (not on no-op).
//
// Idempotent: running twice yields the same end state.

import fs from 'node:fs';
import path from 'node:path';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);
const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

function readJsonOrNull(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Returns one of:
 *   'missing'   — runs/<runId>/run.json does not exist
 *   'terminal'  — exists but status is in TERMINAL_STATUSES
 *   'active'    — exists and status is non-terminal (or unparseable, fail-open)
 *   'invalid'   — runId does not match RUN_ID_RE
 */
function classifyRun(projectDir, runId) {
  if (!runId || !RUN_ID_RE.test(runId)) return 'invalid';
  const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
  if (!fs.existsSync(runPath)) return 'missing';
  const data = readJsonOrNull(runPath);
  if (!data || typeof data.status !== 'string') return 'active';
  return TERMINAL_STATUSES.has(data.status) ? 'terminal' : 'active';
}

function cleanup(projectDir, { dryRun = false } = {}) {
  const result = {
    singletonDeleted: false,
    countersDeleted: [],
    preserved: [],
  };

  const pipelineDir = path.join(projectDir, '.pipeline');
  if (!fs.existsSync(pipelineDir)) {
    return result;
  }

  // 1. Singleton run-active.json — delete if runId is missing or terminal.
  const singletonPath = path.join(pipelineDir, 'run-active.json');
  if (fs.existsSync(singletonPath)) {
    const singleton = readJsonOrNull(singletonPath);
    const singletonRunId = singleton && typeof singleton.runId === 'string' ? singleton.runId : null;
    const classification = classifyRun(projectDir, singletonRunId);
    if (classification !== 'active') {
      // missing | terminal | invalid → orphan
      if (!dryRun) fs.unlinkSync(singletonPath);
      result.singletonDeleted = true;
    }
  }

  // 2. Counter files in run-agent-counts/ — delete for missing/terminal runs.
  const countsDir = path.join(pipelineDir, 'run-agent-counts');
  if (fs.existsSync(countsDir)) {
    const entries = fs.readdirSync(countsDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const runId = entry.slice(0, -'.json'.length);
      const classification = classifyRun(projectDir, runId);
      if (classification === 'active') {
        result.preserved.push(runId);
      } else {
        // missing | terminal | invalid
        if (!dryRun) {
          try {
            fs.unlinkSync(path.join(countsDir, entry));
          } catch (_) { /* best-effort */ }
        }
        result.countersDeleted.push(runId);
      }
    }
  }

  return result;
}

// CLI entry point
const dryRun = process.argv.slice(2).includes('--dry-run');
try {
  const result = cleanup(process.cwd(), { dryRun });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
} catch (err) {
  process.stderr.write('[cleanup] error: ' + err.message + '\n');
  process.exit(1);
}
