import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Validates a runId against the canonical pattern.
 * @param {string} runId
 * @returns {boolean}
 */
function isValidRunId(runId) {
  return typeof runId === 'string' && /^r-[a-zA-Z0-9]+$/.test(runId);
}

/**
 * Reads and parses a PID file, returning the content or null on error.
 * @param {string} filePath
 * @returns {{ runId: string, pid: number, startedAt: string } | null}
 */
function readPidFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

/**
 * Reads run.json for a given run, returning the parsed object or null on error.
 * @param {string} projectDir
 * @param {string} runId
 * @returns {{ status: string, [key: string]: unknown } | null}
 */
function readRunJson(projectDir, runId) {
  try {
    const runPath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    return JSON.parse(readFileSync(runPath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

/**
 * Writes an updated run.json, marking the run as failed.
 * @param {string} projectDir
 * @param {string} runId
 * @param {{ status: string, [key: string]: unknown }} runData
 * @returns {boolean} true on success, false on error
 */
function markRunFailed(projectDir, runId, runData) {
  try {
    const runPath = join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const updated = {
      ...runData,
      status: 'failed',
      failureReason: 'worker process no longer alive (swept)',
    };
    writeFileSync(runPath, JSON.stringify(updated, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[worker-pids] failed to update run.json for ' + runId + ':', err.message);
    return false;
  }
}

/**
 * Probes whether a PID is alive using process.kill(pid, 0).
 *
 * Return values:
 *   'dead'    — ESRCH: process does not exist, safe to sweep
 *   'alive'   — no error: process exists and same user owns it
 *   'cross'   — EPERM: process exists but owned by another user — treat as live
 *   'unknown' — any other error: fail-open, skip this entry
 *
 * @param {number} pid
 * @returns {'dead' | 'alive' | 'cross' | 'unknown'}
 */
function probePid(pid) {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'cross';
    return 'unknown';
  }
}

/**
 * Sweeps stale PID files from `.pipeline/worker-pids/` in the given project directory.
 *
 * For each PID file found:
 * 1. Validates the PID value (must be a finite positive integer).
 * 2. Probes the PID with process.kill(pid, 0):
 *    - ESRCH → dead: if run status is 'running', marks run as failed, then deletes PID file.
 *    - EPERM → cross-user alive: do NOT sweep (avoid false-positive sweeps).
 *    - no error → alive: do NOT sweep.
 *    - other error → fail-open: log and skip.
 * 3. Order per dead PID is deterministic: read run.json → write run.json → delete PID file.
 *    This ensures run.json is durable before the PID file delete that signals "swept".
 *
 * After the liveness sweep, applies a retention policy: if worker-pids/ still contains
 * > 200 entries, deletes the oldest (by mtime) until the count is ≤ 200.
 *
 * @param {string} projectDir - Absolute path to the project root (main repo, not a worktree).
 * @returns {{ swept: number, alive: number, errors: number }}
 */
export function sweepStalePids(projectDir) {
  const pidsDir = join(projectDir, '.pipeline', 'worker-pids');

  let swept = 0;
  let alive = 0;
  let errors = 0;

  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(pidsDir).filter(name => name.endsWith('.json'));
  } catch (err) {
    // Directory absent or unreadable — no PID files to sweep.
    const code = /** @type {{ code?: string }} */ (err).code;
    if (code !== 'ENOENT') {
      console.error('[worker-pids] could not read worker-pids dir:', err.message);
    }
    return { swept: 0, alive: 0, errors: 0 };
  }

  for (const fileName of entries) {
    const filePath = join(pidsDir, fileName);

    // Parse PID file.
    const pidData = readPidFile(filePath);
    if (pidData === null) {
      console.error('[worker-pids] could not parse PID file, skipping:', filePath);
      errors++;
      continue;
    }

    // Validate runId.
    const { runId, pid } = pidData;
    if (!isValidRunId(runId)) {
      console.error('[worker-pids] invalid runId in PID file, skipping:', filePath, 'runId:', runId);
      errors++;
      continue;
    }

    // Validate PID value.
    const pidInt = typeof pid === 'number' ? pid : parseInt(String(pid), 10);
    if (!Number.isFinite(pidInt) || pidInt <= 0 || !Number.isInteger(pidInt)) {
      console.error('[worker-pids] invalid PID value in file, skipping:', filePath, 'pid:', pid);
      errors++;
      continue;
    }

    // Probe liveness.
    const probe = probePid(pidInt);

    if (probe === 'alive' || probe === 'cross') {
      // Cross-user processes are treated as live to avoid false-positive sweeps.
      alive++;
      continue;
    }

    if (probe === 'unknown') {
      // Unexpected error probing — fail-open.
      console.error('[worker-pids] unexpected error probing PID', pidInt, 'in', filePath, '— skipping');
      errors++;
      continue;
    }

    // probe === 'dead': process no longer alive.
    // Order: read run.json → conditionally write run.json → delete PID file.
    const runData = readRunJson(projectDir, runId);

    if (runData !== null && runData.status === 'running') {
      // Mark run as failed before deleting the PID file (durability before signal).
      const updated = markRunFailed(projectDir, runId, runData);
      if (updated) {
        console.error('[worker-pids] marked run ' + runId + ' as failed (worker PID ' + pidInt + ' is dead)');
      }
    }

    // Delete the stale PID file.
    try {
      unlinkSync(filePath);
      console.error('[worker-pids] deleted stale PID file:', filePath);
      swept++;
    } catch (err) {
      console.error('[worker-pids] failed to delete stale PID file:', filePath, err.message);
      errors++;
    }
  }

  // Retention policy: cap worker-pids/ to ≤ 200 entries.
  // Re-read directory after sweep to get current state.
  let remaining;
  try {
    remaining = readdirSync(pidsDir).filter(name => name.endsWith('.json'));
  } catch (_) {
    // If we can't re-read, skip retention enforcement — already swept above.
    return { swept, alive, errors };
  }

  if (remaining.length > 200) {
    // Sort by mtime ascending (oldest first).
    /** @type {Array<{ name: string, mtime: number }>} */
    const withMtime = [];
    for (const name of remaining) {
      try {
        const st = statSync(join(pidsDir, name));
        withMtime.push({ name, mtime: st.mtimeMs });
      } catch (_) {
        // Can't stat — skip this entry during retention sort.
      }
    }
    withMtime.sort((a, b) => a.mtime - b.mtime);

    const toDelete = withMtime.slice(0, withMtime.length - 200);
    for (const { name } of toDelete) {
      try {
        unlinkSync(join(pidsDir, name));
        console.error('[worker-pids] retention policy: deleted old PID file:', name);
      } catch (err) {
        console.error('[worker-pids] retention policy: could not delete:', name, err.message);
      }
    }
  }

  return { swept, alive, errors };
}
