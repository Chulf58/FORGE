'use strict';

// worker-done-inject.js — UserPromptSubmit hook
// Checks .pipeline/worker-done/ for completed worker signals and injects
// notifications into the conductor conversation. Marks signals as injected
// so they only fire once.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 5000;
const DONE_DIR = '.pipeline/worker-done';

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);
  const doneDir = path.join(projectDir, DONE_DIR);

  let files;
  try { files = fs.readdirSync(doneDir).filter(f => f.endsWith('.json')); } catch (_) {
    process.exit(0);
    return;
  }

  const notifications = [];
  for (const f of files) {
    try {
      const fp = path.join(doneDir, f);
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (data.injected) continue;

      notifications.push(data);

      data.injected = true;
      data.injectedAt = new Date().toISOString();
      fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    } catch (_) {}
  }

  if (notifications.length === 0) {
    process.exit(0);
    return;
  }

  const lines = [];
  for (const n of notifications) {
    lines.push('Worker ' + (n.runId || '?') + ' finished: ' + (n.feature || '?'));
    if (n.researchFile) lines.push('  Findings: ' + n.researchFile);
    if (n.pipelineType === 'research') {
      lines.push('  Discuss the findings with the user. After you do, call forge_update_run(' + n.runId + ', { acknowledged: true }) to clear the card from the observer.');
    }
  }

  process.stderr.write('[worker-done] injecting ' + notifications.length + ' completion(s)\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
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
