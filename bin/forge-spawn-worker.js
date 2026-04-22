#!/usr/bin/env node
'use strict';

// forge-spawn-worker.js — Spawns a Claude Code worker session in a new Windows Terminal tab.
//
// Usage:
//   node forge-spawn-worker.js <working-dir> <run-id> <feature> [pipeline-type]
//
// working-dir: worktree path (branched) or project dir (unbranched research)

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const workDir = process.argv[2];
const runId = process.argv[3];
const feature = process.argv[4];
const pipelineType = process.argv[5] || 'plan';

if (!workDir || !runId || !feature) {
  console.error('Usage: forge-spawn-worker.js <working-dir> <run-id> <feature> [pipeline-type]');
  process.exit(1);
}

if (!/^r-[a-f0-9]+$/.test(runId)) {
  console.error('[forge-spawn-worker] invalid run ID: ' + runId);
  process.exit(1);
}

if (!fs.existsSync(workDir)) {
  console.error('[forge-spawn-worker] directory does not exist: ' + workDir);
  process.exit(1);
}

try {
  execFileSync('where', ['wt.exe'], { stdio: 'ignore', timeout: 2000 });
} catch (_) {
  console.error('[forge-spawn-worker] wt.exe not found on PATH');
  process.exit(1);
}

const taskFile = path.join(workDir, '.pipeline', 'worker-task.json');
const taskDir = path.dirname(taskFile);
if (!fs.existsSync(taskDir)) {
  fs.mkdirSync(taskDir, { recursive: true });
}

const task = {
  runId,
  feature,
  pipelineType,
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(taskFile, JSON.stringify(task, null, 2) + '\n', 'utf8');

const workerName = 'worker-' + runId;
const tabTitle = feature.replace(/[\r\n"\\`$]/g, ' ').slice(0, 60);
const args = [
  '-w', '0',
  'nt',
  '-d', workDir,
  '--title', tabTitle,
  '--',
  'claude', '--name', workerName,
];

try {
  const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(JSON.stringify({ ok: true, workerName, taskFile, tab: tabTitle }));
} catch (err) {
  console.error('[forge-spawn-worker] spawn failed: ' + err.message);
  process.exit(1);
}
