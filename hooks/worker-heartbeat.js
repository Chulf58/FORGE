'use strict';

// worker-heartbeat.js — PostToolUse hook
// Writes a heartbeat timestamp so the observer can detect orphaned workers.
// Only writes if there's an active run (run-active.json exists).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;

function findMainProjectDir(projectDir) {
  const gitFile = path.join(projectDir, '.git');
  try {
    const content = fs.readFileSync(gitFile, 'utf8').trim();
    if (content.startsWith('gitdir:')) {
      const gitdir = content.replace('gitdir:', '').trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return match[1];
    }
  } catch (_) {}
  return projectDir;
}

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');
  let runId;
  try {
    const data = JSON.parse(fs.readFileSync(runActivePath, 'utf8'));
    runId = data.runId;
  } catch (_) {
    process.exit(0);
    return;
  }

  if (!runId) { process.exit(0); return; }

  const mainDir = findMainProjectDir(projectDir);
  const hbDir = path.join(mainDir, '.pipeline', 'heartbeats');
  try {
    if (!fs.existsSync(hbDir)) fs.mkdirSync(hbDir, { recursive: true });
    const hbFile = path.join(hbDir, runId + '.json');
    const tmpFile = hbFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ runId, timestamp: Date.now() }) + '\n', 'utf8');
    fs.renameSync(tmpFile, hbFile);
  } catch (_) {}

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
