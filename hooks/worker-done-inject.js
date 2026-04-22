'use strict';

// worker-done-inject.js — UserPromptSubmit hook
// Checks .pipeline/worker-done/ for completed worker signals and injects
// notifications into the conductor conversation. Marks signals as injected
// so they only fire once.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;
const DONE_DIR = '.pipeline/worker-done';

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);

  // Skip if this is a worker session — done notifications are for the conductor only
  const markerPath = path.join(projectDir, '.pipeline', '.worker-session');
  try { fs.accessSync(markerPath); process.exit(0); return; } catch (_) {}

  const doneDir = path.join(projectDir, DONE_DIR);

  let files;
  try { files = fs.readdirSync(doneDir).filter(f => f.endsWith('.json')); } catch (_) {
    process.exit(0);
    return;
  }

  const safe = (s) => String(s || '?').replace(/[\r\n]/g, ' ').trim();

  const MAX_PER_PROMPT = 3;
  const notifications = [];
  for (const f of files) {
    if (notifications.length >= MAX_PER_PROMPT) break;
    try {
      const fp = path.join(doneDir, f);
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (data.injected) continue;

      // Mark as injected BEFORE adding to output — if write fails, skip this
      // notification to prevent re-injection on next prompt
      data.injected = true;
      data.injectedAt = new Date().toISOString();
      fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');

      notifications.push(data);
    } catch (_) {}
  }

  if (notifications.length === 0) {
    process.exit(0);
    return;
  }

  const lines = [];
  for (const n of notifications) {
    lines.push('Worker ' + safe(n.runId) + ' finished: ' + safe(n.feature));
    if (n.researchFile) lines.push('  Findings: ' + safe(n.researchFile));
    if (n.pipelineType === 'research') {
      lines.push('  Discuss the findings with the user. After you do, call forge_update_run(' + safe(n.runId) + ', { acknowledged: true }) to clear the card from the observer.');
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
