'use strict';

// worker-task-inject.js — SessionStart hook
// Reads .pipeline/worker-task.json (written by forge-spawn-worker.js) and injects
// the task context so the worker session knows what to do on first prompt.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;
const TASK_FILE = '.pipeline/worker-task.json';

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);
  const taskPath = path.join(projectDir, TASK_FILE);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  } catch (_) {
    process.exit(0);
    return;
  }

  try { fs.unlinkSync(taskPath); } catch (_) {}

  process.stderr.write('[worker-task] injecting task for run ' + (data.runId || '?') + '\n');

  const skill = data.pipelineType || 'plan';
  const lines = [];
  lines.push('You are a FORGE worker session spawned to execute a pipeline task.');
  lines.push('');
  lines.push('Run: ' + (data.runId || '?'));
  lines.push('Feature: ' + (data.feature || '?'));
  lines.push('Pipeline: ' + skill);
  lines.push('');
  lines.push('When the user types their first message (even just "go"), execute:');
  lines.push('  /forge:' + skill + ' ' + (data.feature || ''));

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
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
