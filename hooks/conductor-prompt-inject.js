'use strict';

// UserPromptSubmit hook — conductor role reminder.
//
// Fires on every user prompt in conductor sessions (no worker-task.json).
// Injects a short reminder to spawn workers instead of using Agent.
// Skipped silently in worker sessions.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const CONDUCTOR_REMINDER =
  'FORGE conductor rule (always applies):\n' +
  'You are a conductor session. Do NOT use the Agent tool for ad-hoc work (no Explore, no general-purpose, no claude-code-guide — none).\n' +
  'Exception: FORGE pipeline skills (/forge:plan, /forge:implement, /forge:debug, /forge:refactor, /forge:research, /forge:explore) invoke agents as subagents — this is expected and allowed.\n' +
  'Quick lookups (1-2 tool calls): use Read/Grep/Glob directly, no worker needed.';

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  const workerMarker = path.join(projectDir, '.pipeline', 'worker-task.json');
  try {
    fs.accessSync(workerMarker);
    process.exit(0);
    return;
  } catch (_) {
    // Not a worker — this is a conductor session, inject the reminder
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: CONDUCTOR_REMINDER,
    },
  }) + '\n');

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
