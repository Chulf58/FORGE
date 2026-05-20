#!/usr/bin/env node
// Structural smoke test: worker CLAUDE.md swap health + forge-worker.mjs options patch.
//
// Two-part check:
//   (a) Swap health: CLAUDE.md in projectRoot starts with the worker sentinel line,
//       confirming bin/forge-worktree.js:126 copied CLAUDE-WORKER.md over the worktree
//       CLAUDE.md. Distinguishes hypothesis 1 (swap failure) from hypothesis 2 (external
//       CLAUDE.md leak) before the fix lands.
//   (b) Options patch: mcp/forge-worker.mjs query() options block contains
//       `settingSources: []` and a `systemPrompt` sourced from CLAUDE-WORKER.md.
//
// Before fix: (a) passes, (b) fails → exits 1, stderr contains:
//   [worker-claude-md-test] FAIL: options not patched
//
// After fix:  both pass → exits 0, stdout contains:
//   [worker-claude-md-test] PASS: options patched and swap healthy
//
// Run: node scripts/worker-claude-md-test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// The first line of CLAUDE-WORKER.md — the definitive worker sentinel.
const WORKER_SENTINEL = '# FORGE Worker — Runtime Instructions';

// ── Part (a): Swap health check ──────────────────────────────────────────────
// Reads <projectRoot>/CLAUDE.md and asserts it starts with the worker sentinel.
// When running inside a worktree, this confirms the swap produced correct content.
const claudeMdPath = join(projectRoot, 'CLAUDE.md');
let swapHealthy = false;
let swapError = '';

try {
  const content = readFileSync(claudeMdPath, 'utf-8');
  if (content.trimStart().startsWith(WORKER_SENTINEL)) {
    swapHealthy = true;
  } else {
    const firstLine = content.split('\n')[0];
    swapError = `CLAUDE.md first line is not worker sentinel. Got: "${firstLine}"`;
  }
} catch (err) {
  swapError = `CLAUDE.md not readable: ${err.message}`;
}

// ── Part (b): Options patch check ────────────────────────────────────────────
// Reads mcp/forge-worker.mjs and checks that the query() options block contains:
//   settingSources: []   — disables automatic CLAUDE.md loading via the SDK
//   systemPrompt         — supplies CLAUDE-WORKER.md content explicitly
// Both must be present and CLAUDE-WORKER must be referenced in the systemPrompt assignment.
const workerMjsPath = join(projectRoot, 'mcp', 'forge-worker.mjs');
let optionsPatched = false;
let optionsError = '';

try {
  const content = readFileSync(workerMjsPath, 'utf-8');

  // settingSources: [] — the exact form expected in the options object literal.
  const hasSettingSources = content.includes('settingSources: []');

  // systemPrompt sourced from CLAUDE-WORKER.md — both the field name and the
  // path reference must appear in the file.
  const hasSystemPrompt = content.includes('systemPrompt') && content.includes('CLAUDE-WORKER');

  if (hasSettingSources && hasSystemPrompt) {
    optionsPatched = true;
  } else {
    const missing = [];
    if (!hasSettingSources) missing.push('settingSources: []');
    if (!hasSystemPrompt) missing.push('systemPrompt sourced from CLAUDE-WORKER.md');
    optionsError = `missing: ${missing.join(', ')}`;
  }
} catch (err) {
  optionsError = `mcp/forge-worker.mjs not readable: ${err.message}`;
}

// ── Report ────────────────────────────────────────────────────────────────────
if (swapHealthy && optionsPatched) {
  process.stdout.write('[worker-claude-md-test] PASS: options patched and swap healthy\n');
  process.exit(0);
}

if (!swapHealthy) {
  process.stderr.write(`[worker-claude-md-test] FAIL: swap not healthy — ${swapError}\n`);
}

if (!optionsPatched) {
  process.stderr.write(`[worker-claude-md-test] FAIL: options not patched — ${optionsError}\n`);
}

process.exit(1);
