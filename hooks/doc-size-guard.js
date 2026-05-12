'use strict';

// doc-size-guard.js — PostToolUse hook for Write/Edit
//
// Advisory (non-blocking): warns when a known doc file exceeds its size threshold.
// Thresholds are the source of truth — GENERAL.md just references this hook.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const THRESHOLDS = {
  'docs/PLAN.md': { max: 200, action: 'Remove completed sections — git history preserves them' },
  'docs/CHANGELOG.md': { max: 200, action: 'Archive to docs/archive/CHANGELOG_HISTORY.md' },
  'docs/ARCHITECTURE.md': { max: 800, action: 'Prune stale content' },
  'docs/gotchas/GENERAL.md': { max: 200, action: 'Trim — move reference material to FORGE-REFERENCE.md' },
};

function exitOk() { process.exit(0); }

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const toolName = payload.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { exitOk(); return; }

  const filePath = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path)) || '';
  if (!filePath) { exitOk(); return; }

  const normalized = filePath.replace(/\\/g, '/');

  let matchedKey = null;
  for (const key of Object.keys(THRESHOLDS)) {
    if (normalized.endsWith(key)) {
      matchedKey = key;
      break;
    }
  }
  if (!matchedKey) { exitOk(); return; }

  // Containment check: reject any path that resolves outside the project root.
  // path.resolve() strips traversal sequences (e.g. "../../") before comparison.
  // Also accept paths under process.cwd() (worktree root) for worktree worker sessions.
  const projectDir = resolveProjectDir(payload);
  const worktreeDir = process.cwd();
  const resolvedFilePath = path.resolve(filePath);
  if (
    !resolvedFilePath.startsWith(projectDir + path.sep) &&
    resolvedFilePath !== projectDir &&
    !resolvedFilePath.startsWith(worktreeDir + path.sep) &&
    resolvedFilePath !== worktreeDir
  ) {
    exitOk();
    return;
  }

  const threshold = THRESHOLDS[matchedKey];

  let lineCount = 0;
  try {
    const content = fs.readFileSync(resolvedFilePath, 'utf8');
    lineCount = content.split('\n').length;
  } catch (_) {
    exitOk();
    return;
  }

  if (lineCount > threshold.max) {
    console.error(
      '[doc-size-guard] ' + matchedKey + ' is ' + lineCount + ' lines (threshold: ' +
      threshold.max + '). ' + threshold.action + '.'
    );
  }

  exitOk();
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
