'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS   = 10_000;
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
  if (!transcriptPath) return null;
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
 * Report-only recovery primitive: if .pipeline/run-active.json exists and
 * contains a non-null `currentUnit` with an `agent` field, emit a one-line
 * stale-lock notice via hookSpecificOutput.additionalContext. This means the
 * previous session ended (crashed / cleared) while a FORGE agent was in flight
 * — SubagentStop never fired to clear the marker. Report-only: we do NOT
 * clear the marker, mutate run state, or trigger any recovery workflow.
 * Returns true iff a notice was emitted (so callers can short-circuit
 * competing hookSpecificOutput writes on this same hook invocation).
 */
function emitStaleUnitNoticeIfAny(projectDir) {
  try {
    const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');
    const raw = fs.readFileSync(runActivePath, 'utf8');
    const data = JSON.parse(raw);
    const unit = data && data.currentUnit;
    if (!unit || typeof unit !== 'object' || typeof unit.agent !== 'string' || !unit.agent) {
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
    // File absent / unreadable / unparseable — fail silently. Report-only.
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
  const projectDir = (payload.cwd && typeof payload.cwd === 'string' && payload.cwd.trim())
    ? payload.cwd.trim()
    : process.cwd();
  emitStaleUnitNoticeIfAny(projectDir);

  if (!sessionId) { exitOk(); return; }

  const usage     = await getLastUsage(transcriptPath);
  const remaining = computeRemainingPct(usage);

  if (remaining === null) { exitOk(); return; }

  // Only write bridge file when context is actually concerning — PostToolUse hook
  // only acts at ≤35% (warning) and ≤25% (critical), so writing at 80% remaining
  // is wasted I/O and leaves a stale file on disk for 60 seconds.
  if (remaining <= 50) {
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
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
