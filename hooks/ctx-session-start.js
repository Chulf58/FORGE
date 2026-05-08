'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_LONG, findActiveRun, TERMINAL_STATUSES, readRunStatus } = require('./hook-utils');

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

/**
 * Report-only recovery primitive: enumerates per-run active files and, when
 * a single non-terminal run has a non-null `currentUnit`, emits a stale-lock
 * notice via hookSpecificOutput.additionalContext.
 *
 * Resolution: calls findActiveRun to enumerate .pipeline/runs/*/run.json and
 * identify the single non-terminal run, then reads its per-run active file
 * (.pipeline/runs/<runId>/run-active.json). Returns null when zero or multiple
 * non-terminal runs exist (fail-open per RESEARCH.md line 49).
 *
 * Truthfulness step: if the referenced run's status is terminal
 * (completed / failed / discarded), the marker is stale-by-finish, not
 * stale-by-crash — so instead of surfacing a misleading notice on every
 * subsequent session, we quietly clear `currentUnit` in the per-run active
 * file and emit nothing.
 *
 * The singleton (.pipeline/run-active.json) is no longer read or deleted.
 * Never mutates anything except `currentUnit` on the narrow terminal path.
 * Never throws. Returns a Promise<boolean> — true iff a notice was emitted.
 */
async function emitStaleUnitNoticeIfAny(projectDir) {
  try {
    // Enumerate run.json files to find the single non-terminal run.
    const activeRun = await findActiveRun(projectDir);
    if (!activeRun) {
      // Zero or multiple non-terminal runs — fail open, nothing to surface.
      return false;
    }
    const { runId } = activeRun;

    // Read the per-run active file for the resolved run.
    const runActivePath = path.join(projectDir, '.pipeline', 'runs', runId, 'run-active.json');
    let data;
    try {
      const raw = await fs.promises.readFile(runActivePath, 'utf8');
      data = JSON.parse(raw);
    } catch (readErr) {
      if (readErr.code === 'ENOENT') {
        process.stderr.write(
          '[forge-stale-lock] per-run active file missing — cannot verify lock for run ' +
          runId + '\n'
        );
      }
      return false;
    }

    const unit = data && data.currentUnit;
    if (!unit || typeof unit !== 'object' || typeof unit.agent !== 'string' || !unit.agent) {
      return false;
    }

    // Terminal-run cleanup: only clear the marker when we can prove the
    // referenced run is already done. Unknown/unreadable → keep the notice
    // (defensive: never silently drop a marker we can't verify).
    const activeRunId = data && typeof data.runId === 'string' ? data.runId : runId;
    const runStatus = readRunStatus(projectDir, activeRunId);
    if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
      // Clear currentUnit in the per-run active file (no singleton to delete).
      try {
        data.currentUnit = null;
        const tmp = runActivePath + '.tmp.' + process.pid;
        await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
        await fs.promises.rename(tmp, runActivePath);
      } catch (_) {
        // Cleanup failed — fall through silently. The misleading notice is
        // still suppressed; the marker stays until the next cleanup attempt.
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
  await emitStaleUnitNoticeIfAny(projectDir);

  // Clean stale worker-session marker from prior sessions. If this is a worker,
  // worker-task-inject.js (runs later in the SessionStart chain) will recreate it.
  try { fs.unlinkSync(path.join(projectDir, '.pipeline', '.worker-session')); } catch (_) {}

  // Clean stale forge-agent-session-*.json sidecar files from prior sessions.
  // These are written by subagent-start.js to let the worker resolve agent_id → session_id.
  // Orphaned files from crashed sessions are harmless but accumulate over time.
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (/^forge-agent-session-[a-zA-Z0-9_-]+\.json$/.test(entry)) {
        try { fs.unlinkSync(path.join(tmpDir, entry)); } catch (_) {}
      }
    }
  } catch (_) {
    // Non-fatal — cleanup is best-effort
  }

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
