// Worker-side fallback that stamps orphan agent entries in run-active.json.
//
// An "orphan" is an agent record whose subagent-stop hook never wrote
// completedAt — either the hook didn't fire (Claude Code SDK reliability),
// the hook crashed silently, or its stderr was lost. The TODO 7fe538ee
// sub-bug 2 forensic shows the SDK emits task_notification status=completed
// for these agents (.pipeline/worker-logs/r-2329c669.log:334) but no
// [forge-subagent] hook stderr appears in the worker log.
//
// Strategy: at clean worker exit, scan run-active.json once and stamp every
// entry with startedAt set but completedAt absent/null with:
//   - completedAt: now
//   - durationMs: now - startedAt
//   - outcome: "orphan-stop"
//
// This is a safety net — when the hook fires normally, this function is a
// no-op. When the hook fails, the run record stays internally consistent
// for the dashboard, agent-count summaries, and downstream cleanup.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RUN_ID_RE = /^r-[a-zA-Z0-9]+$/;

/**
 * Scans run-active.json for the given run and stamps any orphan agent entry
 * (startedAt set, completedAt null/undefined) with outcome="orphan-stop".
 *
 * Fail-open: never throws. Absent file, malformed JSON, or write failures
 * all return silently. The caller (worker exit path) cannot tolerate a
 * cleanup error blocking process exit.
 *
 * @param {string} workDir - the worker's working directory (worktree or main root)
 * @param {string} runId   - the run ID (validated against ^r-[a-zA-Z0-9]+$)
 * @returns {{stamped: number, total: number}} count summary; {stamped:0,total:0} on any error
 */
export function stampOrphanAgents(workDir, runId) {
  if (!runId || !RUN_ID_RE.test(runId)) {
    return { stamped: 0, total: 0 };
  }

  const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');

  let raw;
  try {
    raw = readFileSync(runActivePath, 'utf8');
  } catch (_) {
    return { stamped: 0, total: 0 };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return { stamped: 0, total: 0 };
  }

  if (!data || !Array.isArray(data.agents)) {
    return { stamped: 0, total: 0 };
  }

  const now = Date.now();
  let stamped = 0;
  for (const agent of data.agents) {
    if (!agent || typeof agent.startedAt !== 'number') continue;
    const hasCompleted = typeof agent.completedAt === 'number';
    if (hasCompleted) continue;
    agent.completedAt = now;
    agent.durationMs = now - agent.startedAt;
    agent.outcome = 'orphan-stop';
    stamped++;
  }

  if (stamped === 0) {
    return { stamped: 0, total: data.agents.length };
  }

  try {
    writeFileSync(runActivePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (_) {
    return { stamped: 0, total: data.agents.length };
  }

  return { stamped, total: data.agents.length };
}
