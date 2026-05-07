'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS   = STDIN_TIMEOUT_LONG;
const CONTEXT_WINDOW     = 200_000;
const AUTOCOMPACT_FACTOR = 0.835; // usable fraction of context window

function exitOk() {
  process.exit(0);
}

function computeRemainingPct(usageObj) {
  if (!usageObj || typeof usageObj !== 'object') return null;
  const input  = Number(usageObj.input_tokens                ?? 0);
  const cached = Number(usageObj.cache_read_input_tokens     ?? 0);
  const create = Number(usageObj.cache_creation_input_tokens ?? 0);
  const total  = input + cached + create;
  if (total === 0) return null;
  const usable = CONTEXT_WINDOW * AUTOCOMPACT_FACTOR;
  return Math.max(0, (1 - total / usable) * 100);
}

async function getLastUsage(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  // Reject non-absolute paths — a forged payload.transcript_path could otherwise
  // trigger arbitrary file reads relative to the hook's working directory.
  if (!path.isAbsolute(transcriptPath)) return null;
  try {
    await fs.promises.access(transcriptPath);
  } catch (_) {
    return null;
  }
  try {
    const raw = await fs.promises.readFile(transcriptPath, 'utf8');
    const lines = raw.split('\n');
    // Iterate in reverse so we stop at the first (most recent) match
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      if (entry.isSidechain === true) continue;
      if (entry.isApiErrorMessage === true) continue;
      if (entry.message && entry.message.usage) {
        return entry.message.usage;
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

const { TERMINAL_STATUSES, readRunStatus } = require('./hook-utils');

/**
 * Report-only recovery primitive: if .pipeline/run-active.json exists and
 * contains a non-null `currentUnit` with an `agent` field, emit a one-line
 * stale-lock notice via hookSpecificOutput.additionalContext.
 *
 * Per-run path resolution: when the singleton carries a valid runId, the
 * authoritative state lives at .pipeline/runs/<runId>/run-active.json.
 * Read from there if the file exists; when the per-run file is absent emit
 * "per-run file missing — cannot verify lock" rather than reading stale
 * singleton data. Fall back to singleton only when runId is absent or
 * invalid (projects not yet migrated).
 *
 * Truthfulness step: if the referenced run's status is terminal
 * (completed / failed / discarded), the marker is stale-by-finish, not
 * stale-by-crash — so instead of surfacing a misleading notice on every
 * subsequent session, we quietly clear `currentUnit` in the active file
 * and emit nothing. All other cases (unknown run, missing registry file,
 * non-terminal status) preserve the prior notice behavior.
 *
 * Never mutates anything except `currentUnit` on the narrow terminal path.
 * Never throws. Returns true iff a notice was emitted.
 */
function emitStaleUnitNoticeIfAny(projectDir) {
  try {
    const singletonPath = path.join(projectDir, '.pipeline', 'run-active.json');

    // Read singleton to discover the runId steering pointer.
    let singletonData;
    try {
      const raw = fs.readFileSync(singletonPath, 'utf8');
      singletonData = JSON.parse(raw);
    } catch (_) {
      // Singleton absent / unreadable / unparseable — nothing to check.
      return false;
    }

    const rawRunId = singletonData && typeof singletonData.runId === 'string'
      ? singletonData.runId
      : null;
    const validRunId = rawRunId && /^r-[a-zA-Z0-9]+$/.test(rawRunId) ? rawRunId : null;
    const perRunPath = validRunId
      ? path.join(projectDir, '.pipeline', 'runs', validRunId, 'run-active.json')
      : null;

    let runActivePath;
    let data;

    if (perRunPath) {
      // Per-run path known — attempt to read it.
      try {
        const raw = fs.readFileSync(perRunPath, 'utf8');
        data = JSON.parse(raw);
        runActivePath = perRunPath;
      } catch (readErr) {
        // Per-run file absent or unreadable — cannot verify lock state.
        if (readErr.code === 'ENOENT') {
          process.stderr.write(
            '[forge-stale-lock] per-run file missing — cannot verify lock for run ' +
            validRunId + '\n'
          );
        }
        // Fail-open: do not fall back to potentially stale singleton data.
        return false;
      }
    } else {
      // No valid runId — legacy / not-yet-migrated project: read singleton.
      data = singletonData;
      runActivePath = singletonPath;
    }

    const unit = data && data.currentUnit;
    if (!unit || typeof unit !== 'object' || typeof unit.agent !== 'string' || !unit.agent) {
      return false;
    }

    // Terminal-run cleanup: only clear the marker when we can prove the
    // referenced run is already done. Unknown/unreadable → keep the notice
    // (defensive: never silently drop a marker we can't verify).
    const runId = data && typeof data.runId === 'string' ? data.runId : null;
    const runStatus = readRunStatus(projectDir, runId);
    if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
      try {
        fs.unlinkSync(runActivePath);
      } catch (_) {
        // Cleanup failed — fall through silently. We deliberately do NOT
        // emit the misleading notice in this case either; the marker just
        // stays on disk until the next cleanup attempt or a successful
        // start/stop cycle.
      }
      return false;
    }

    const notice = 'FORGE notice: the previous session ended while ' + unit.agent + ' was in flight.';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          'Display the following FORGE notice to the user on its own line, exactly as written, before any other response. Do not paraphrase, do not add advice, do not offer to restart or resume the run:\n\n' +
          notice,
      },
    }) + '\n');
    return true;
  } catch (_) {
    // Unexpected error — fail silently. Report-only.
    return false;
  }
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const sessionId      = payload.session_id;
  const transcriptPath = payload.transcript_path;

  // Stale-lock notice is independent of context-window logic and session_id —
  // fire it first so it appears even when we exit early below.
  const projectDir = resolveProjectDir(payload);
  emitStaleUnitNoticeIfAny(projectDir);

  // Clean stale worker-session marker from prior sessions. If this is a worker,
  // worker-task-inject.js (runs later in the SessionStart chain) will recreate it.
  try { fs.unlinkSync(path.join(projectDir, '.pipeline', '.worker-session')); } catch (_) {}

  if (!sessionId) { exitOk(); return; }

  const usage     = await getLastUsage(transcriptPath);
  const remaining = computeRemainingPct(usage);

  if (remaining === null) { exitOk(); return; }

  // Only write bridge file when context is actually concerning — PostToolUse hook
  // only acts at ≤35% (warning) and ≤25% (critical), so writing at 80% remaining
  // is wasted I/O and leaves a stale file on disk for 60 seconds.
  if (remaining <= 50) {
    const safeSessionId = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${safeSessionId}.json`);
    try {
      await fs.promises.writeFile(bridgePath, JSON.stringify({ remaining, timestamp: Date.now() }), 'utf8');
    } catch (_) {
      // Non-fatal — PostToolUse hook will exit silently if bridge file is absent.
    }
  }

  exitOk();
}

// Read stdin with timeout guard
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
