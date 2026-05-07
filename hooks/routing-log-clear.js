'use strict';

// SessionStart hook: clear the FORGE routing-enforcement dispatch log.
//
// Bounds the session scope for dispatch logging mechanically. Without this,
// a forge_get_model_recommendation entry from a previous session could accidentally
// authorize a same-agent Agent spawn early in a new session (within the TTL window).
//
// Idempotent and defensive: missing .pipeline/ directory is fine (created if needed);
// write failures are swallowed because the PreToolUse hook treats a missing or
// malformed log as "no valid recommendation" and blocks by default.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;
const LOG_RELATIVE_PATH = path.join('.pipeline', 'session-dispatch-log.json');

function clearLog(projectDir) {
  const logPath = path.join(projectDir, LOG_RELATIVE_PATH);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      JSON.stringify({ entries: [], clearedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    );
  } catch (_) {
    // Best-effort: routing-enforcement treats an absent/unreadable log as empty,
    // which blocks by default — a failure here cannot weaken enforcement.
  }
}

async function main(_rawInput) {
  // Payload ignored — we only need process.cwd() as the project root.
  clearLog(process.cwd());
  process.exit(0);
}

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
