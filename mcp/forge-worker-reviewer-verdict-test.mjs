#!/usr/bin/env node
// @covers mcp/forge-worker.mjs
//
// Soak r-15ef051e finding #1 wiring: forge-worker's orchDeps.readReviewerOutput must
// delegate verdict classification to the robust parseReviewerVerdict (which anchors on
// the "### Verdict" section), NOT the old first-line-only match that silently dropped a
// BLOCK appearing on a later line. The verdict-parsing behavior itself is covered by
// reviewer-verdict-test.mjs; this guarantees the worker actually uses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'forge-worker.mjs'), 'utf-8');

test('readReviewerOutput delegates to parseReviewerVerdict', () => {
  assert.match(SRC, /parseReviewerVerdict/, 'forge-worker must import + use parseReviewerVerdict');
});

test('the first-line-only verdict antipattern is gone', () => {
  assert.doesNotMatch(SRC, /firstLine\.includes\('BLOCK'\)/,
    'the line-1-only BLOCK match (the soak #1 bug) must be removed');
});
