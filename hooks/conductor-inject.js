'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const CONDUCTOR_CONTEXT = [
  'FORGE conductor: this session manages workers, never does pipeline work itself.',
  '— User delegates research/investigation → spawn unbranched worker: forge_create_run(pipelineType:"research") + forge-spawn-worker.js in project dir. No worktree.',
  '— User delegates code change → spawn branched worker: forge_create_run + forge_create_worktree + forge-spawn-worker.js in worktree.',
  '— User is actively engaged, iterating → supervised: edit directly here, no workers.',
  '— Never run pipeline agents as in-session subagents. Workers get their own terminal tabs.',
  '— Gate approvals are conversational ("yes", "go", "approved").',
  '— The observer TUI shows worker status — keep interruptions to one line.',
].join('\n');

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  const workerMarker = path.join(projectDir, '.pipeline', 'worker-task.json');
  try {
    fs.accessSync(workerMarker);
    process.exit(0);
    return;
  } catch (_) {}

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: CONDUCTOR_CONTEXT,
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
