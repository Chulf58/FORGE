'use strict';

// PreToolUse hook: block Agent tool calls in conductor sessions.
//
// Conductor sessions should delegate work to workers, not dispatch
// in-session subagents. This hook enforces that by blocking all Agent
// calls when no .pipeline/worker-task.json exists (i.e., this is a
// conductor, not a worker).
//
// Exit 0 = allow, exit 2 = block.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;

function exitOk() { process.exit(0); }

function exitBlock(msg) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: msg,
      },
    }) + '\n'
  );
  console.error(msg);
  process.exit(2);
}

function isWorkerSession(projectDir) {
  try {
    fs.accessSync(path.join(projectDir, '.pipeline', 'worker-task.json'));
    return true;
  } catch (_) {
    return false;
  }
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  if (payload.tool_name !== 'Agent') { exitOk(); return; }

  const projectDir = resolveProjectDir(payload);

  if (isWorkerSession(projectDir)) { exitOk(); return; }

  const subagentType = (payload.tool_input && payload.tool_input.subagent_type) || 'general-purpose';

  exitBlock(
    '[conductor-guard] Blocked in-session Agent(' + subagentType + '). ' +
    'Conductor sessions delegate to workers — use forge_create_run + ' +
    'forge-spawn-worker.js instead. For quick lookups, use Read/Grep/Glob directly.'
  );
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
