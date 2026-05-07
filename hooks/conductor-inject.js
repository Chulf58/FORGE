'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const CONDUCTOR_CONTEXT = [
  'FORGE conductor: this session is the control plane. It orchestrates pipelines and manages workflow.',
  '',
  'RULE: Do NOT use the Agent tool for ad-hoc work (no Explore, no general-purpose, no claude-code-guide). Use Read/Grep/Glob for quick lookups.',
  '',
  'PIPELINE SKILLS: /forge:plan, /forge:implement, /forge:debug, /forge:refactor, /forge:research, /forge:explore — these invoke agents as in-session subagents. This is expected and allowed. The skill handles run creation, model routing, and agent dispatch.',
  '',
  'DIRECT EDITING (only when user is actively iterating on small, immediate changes): edit files directly here.',
  '',
  'Gate approvals are conversational ("yes", "go", "approved").',
  'The observer TUI shows worker status — keep interruptions to one line.',
].join('\n');

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  // Check durable worker marker (survives worker-task.json deletion by worker-task-inject.js)
  const workerSession = path.join(projectDir, '.pipeline', '.worker-session');
  const workerTask = path.join(projectDir, '.pipeline', 'worker-task.json');
  try { fs.accessSync(workerSession); process.exit(0); return; } catch (_) {}
  try { fs.accessSync(workerTask); process.exit(0); return; } catch (_) {}

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
