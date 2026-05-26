#!/usr/bin/env node
// @covers scripts/discipline-drift-test.mjs
// Checks that conduct discipline notes have not been removed from key skill/config files.
// Exit 0: all pass. Exit 1: at least one fail.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function readFile(relPath) {
  const abs = join(root, relPath);
  if (!existsSync(abs)) return '';
  return readFileSync(abs, 'utf8');
}

function hasLine(content, prefix) {
  return content.split('\n').some(line => line.startsWith(prefix));
}

const checks = [
  {
    file: 'skills/grill-intent/SKILL.md',
    description: 'contains [user-prefilled] token reference',
    test: c => c.includes('[user-prefilled]'),
  },
  {
    file: 'skills/grill-plan/SKILL.md',
    description: 'contains Conductor invocation discipline',
    test: c => c.includes('Conductor invocation discipline'),
  },
  {
    file: 'skills/debug/SKILL.md',
    description: 'contains invocation discipline',
    test: c => c.includes('invocation discipline'),
  },
  {
    file: 'skills/apply/SKILL.md',
    description: 'has <!-- discipline-gate: feedback_conductor_handles_commits --> OR feedback_run_completion_timing OR feedback_no_duplicate_apply_worker',
    test: c => hasLine(c, '<!-- discipline-gate: feedback_conductor_handles_commits -->') ||
               hasLine(c, '<!-- discipline-gate: feedback_run_completion_timing -->') ||
               hasLine(c, '<!-- discipline-gate: feedback_no_duplicate_apply_worker -->'),
  },
  {
    file: 'skills/implement/SKILL.md',
    description: 'has <!-- discipline-gate: (any)',
    test: c => hasLine(c, '<!-- discipline-gate: '),
  },
  {
    file: 'skills/plan/SKILL.md',
    description: 'has <!-- discipline-gate: feedback_present_and_wait_sop -->',
    test: c => hasLine(c, '<!-- discipline-gate: feedback_present_and_wait_sop -->'),
  },
  {
    file: 'CLAUDE.md',
    description: 'contains Intent-capture skill invocation discipline',
    test: c => c.includes('Intent-capture skill invocation discipline'),
  },
];

let passed = 0;
let failed = 0;
for (const { file, description, test } of checks) {
  const content = readFile(file);
  if (test(content)) {
    passed++;
  } else {
    process.stderr.write(`[discipline-drift-test] FAIL: ${file} missing "${description}"\n`);
    failed++;
  }
}

if (failed === 0) {
  process.stdout.write(`[discipline-drift-test] ${passed}/${checks.length} OK\n`);
  process.exit(0);
} else {
  process.stdout.write(`[discipline-drift-test] ${passed}/${checks.length} OK, ${failed} FAIL\n`);
  process.exit(1);
}
