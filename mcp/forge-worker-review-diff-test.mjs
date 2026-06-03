// @covers mcp/forge-worker.mjs
//
// G2 wiring: forge-worker.mjs must provide a buildReviewDiff dep to the implement
// orchestrator so reviewer-dispatch receives a real diff (incl. untracked test files).
// The dep's synthesis logic lives in (and is unit-tested via) review-diff.mjs; this
// file asserts the worker actually WIRES it — forge-worker.mjs has module-load side
// effects (readline/exit) and can't be unit-imported, so we assert against its source
// (same approach as forge-worker-reviewer-verdict-test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'forge-worker.mjs'), 'utf-8');

test('forge-worker imports synthesizeReviewDiff from the orchestrator review-diff module', () => {
  assert.match(SRC, /synthesizeReviewDiff[^\n]*review-diff\.mjs/,
    'forge-worker must import synthesizeReviewDiff from ./lib/orchestrator/review-diff.mjs');
});

test('forge-worker wires a buildReviewDiff dep into the implement orchestrator', () => {
  assert.match(SRC, /buildReviewDiff\s*:/,
    'orchDeps must include a buildReviewDiff dep so the orchestrator can thread --tests-diff');
});

test('buildReviewDiff resolves git via getGitExecutable and calls synthesizeReviewDiff', () => {
  // The dep must build the diff through the resolved git executable, not a bare `git`
  // (the worker process PATH omits git on Windows — same fix as snapshotMainStrays / #7),
  // and assemble the patch via the unit-tested synthesizer.
  const body = SRC.slice(SRC.indexOf('buildReviewDiff'));
  const window = body.slice(0, 1500);
  assert.match(window, /getGitExecutable\(\)/,
    'buildReviewDiff must invoke getGitExecutable() to resolve git');
  assert.match(window, /synthesizeReviewDiff\(/,
    'buildReviewDiff must call synthesizeReviewDiff() to assemble the patch');
});
