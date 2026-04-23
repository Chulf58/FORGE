'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_LONG } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_LONG;
const STALE_MS = 300_000;
const SIGNAL_FILE = '.pipeline/observer-selected.json';

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { payload = {}; }

  const projectDir = resolveProjectDir(payload);
  const signalPath = path.join(projectDir, SIGNAL_FILE);

  process.stderr.write('[observer-inject] checking ' + signalPath + '\n');

  let data;
  try {
    const stat = fs.statSync(signalPath);
    const age = Date.now() - stat.mtimeMs;
    process.stderr.write('[observer-inject] found, age=' + Math.round(age / 1000) + 's\n');
    if (age > STALE_MS) {
      process.stderr.write('[observer-inject] stale, skipping\n');
      process.exit(0);
      return;
    }
    data = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
  } catch (err) {
    process.stderr.write('[observer-inject] no signal: ' + err.code + '\n');
    process.exit(0);
    return;
  }

  try { fs.unlinkSync(signalPath); } catch (_) {}

  let context;

  if (data.type === 'todo') {
    process.stderr.write('[observer-inject] injecting TODO context\n');
    const safe = (s) => String(s || '').replace(/[\r\n]/g, ' ').trim();
    const parts = [];
    parts.push(`The user is looking at this TODO in the FORGE Observer (split-screen TUI). It is their current focus.`);
    parts.push(`TODO: ${safe(data.text)}`);
    if (data.priority) parts.push(`Priority: ${safe(data.priority)}`);
    if (Array.isArray(data.tags) && data.tags.length > 0) parts.push(`Tags: ${data.tags.map(t => '#' + safe(t)).join(' ')}`);
    if (data.createdAt) parts.push(`Added: ${safe(data.createdAt)}`);
    context = parts.join('\n');
  } else {
    process.stderr.write('[observer-inject] injecting context for ' + (data.runId || '?') + '\n');
    const parts = [];
    parts.push(`The user is looking at this run in the FORGE Observer (split-screen TUI). It is their current focus.`);
    parts.push(`Run: ${data.runId || '?'}  Feature: ${data.feature || '?'}`);
    parts.push(`Pipeline: ${data.pipelineType || '?'} (${data.mode || '?'})  Status: ${data.status || '?'}`);
    if (data.gateState) parts.push(`Gate: ${data.gateState.gate} — ${data.gateState.status}`);
    if (data.actionNeeded) parts.push(`Action needed: ${data.actionNeeded}`);
    if (data.branchName) parts.push(`Branch: ${data.branchName}`);

    if (data.summary) {
      const s = data.summary;
      if (s.diffStat) parts.push(`\nChanges: ${s.diffStat}`);
      if (s.commits && s.commits.length > 0) {
        parts.push(`\nCommits:`);
        for (const cm of s.commits) parts.push(`  ${cm}`);
      }
      if (s.handoffLines && s.handoffLines.length > 0) {
        parts.push(`\nHandoff summary:`);
        for (const hl of s.handoffLines) parts.push(`  ${hl}`);
      }
    }
    context = parts.join('\n');
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
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
