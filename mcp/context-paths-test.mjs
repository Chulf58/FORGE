#!/usr/bin/env node
// Unit tests for mcp/lib/context-paths.js — the per-run context path helper.
//
// Pure deterministic functions, no I/O. Verifies that all three helpers resolve
// under <worktreePath>/.pipeline/context/ and that verdictPath assembles the
// expected <runId>-<reviewer>-<phase>.md filename for both single-pass and
// phased runs.
//
// Run: node mcp/context-paths-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import {
  reviewerOutputDir,
  researcherStatusPath,
  verdictPath,
} from './lib/context-paths.js';

const WT = sep === '\\' ? 'C:\\wt' : '/wt';
const join = (...parts) => parts.join(sep);

test('reviewerOutputDir resolves under <wt>/.pipeline/context/reviewer-output', () => {
  assert.equal(
    reviewerOutputDir(WT),
    join(WT, '.pipeline', 'context', 'reviewer-output'),
  );
});

test('researcherStatusPath resolves under <wt>/.pipeline/context/researcher-status.json', () => {
  assert.equal(
    researcherStatusPath(WT),
    join(WT, '.pipeline', 'context', 'researcher-status.json'),
  );
});

test('verdictPath assembles <runId>-<reviewer>-<phase>.md for single-pass run', () => {
  assert.equal(
    verdictPath(WT, 'r-abc123', 'reviewer-safety', 'implement'),
    join(WT, '.pipeline', 'context', 'verdicts', 'r-abc123-reviewer-safety-implement.md'),
  );
});

test('verdictPath assembles phase-indexed filename for phased run', () => {
  assert.equal(
    verdictPath(WT, 'r-def456', 'reviewer-boundary', 'phase-2'),
    join(WT, '.pipeline', 'context', 'verdicts', 'r-def456-reviewer-boundary-phase-2.md'),
  );
});

test('verdictPath supports debug and refactor phase labels', () => {
  assert.equal(
    verdictPath(WT, 'r-ghi789', 'reviewer-logic', 'debug'),
    join(WT, '.pipeline', 'context', 'verdicts', 'r-ghi789-reviewer-logic-debug.md'),
  );
  assert.equal(
    verdictPath(WT, 'r-jkl012', 'reviewer-performance', 'refactor'),
    join(WT, '.pipeline', 'context', 'verdicts', 'r-jkl012-reviewer-performance-refactor.md'),
  );
});

test('all three helpers share the same <wt>/.pipeline/context/ root', () => {
  const root = join(WT, '.pipeline', 'context');
  assert.ok(reviewerOutputDir(WT).startsWith(root + sep));
  assert.ok(researcherStatusPath(WT).startsWith(root + sep));
  assert.ok(verdictPath(WT, 'r-x', 'reviewer-safety', 'implement').startsWith(root + sep));
});

test('different worktrees produce non-overlapping paths (parallel-runs isolation)', () => {
  const wtA = sep === '\\' ? 'C:\\worktrees\\r-aaa' : '/worktrees/r-aaa';
  const wtB = sep === '\\' ? 'C:\\worktrees\\r-bbb' : '/worktrees/r-bbb';
  assert.notEqual(reviewerOutputDir(wtA), reviewerOutputDir(wtB));
  assert.notEqual(researcherStatusPath(wtA), researcherStatusPath(wtB));
  assert.notEqual(
    verdictPath(wtA, 'r-aaa', 'reviewer-safety', 'implement'),
    verdictPath(wtB, 'r-bbb', 'reviewer-safety', 'implement'),
  );
});
