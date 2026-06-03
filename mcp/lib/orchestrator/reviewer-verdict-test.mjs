#!/usr/bin/env node
// @covers mcp/lib/orchestrator/reviewer-verdict.mjs
//
// Soak r-15ef051e finding #1: the orchestrator's readReviewerOutput judged a reviewer
// verdict by content.split('\n')[0] — the FIRST LINE only. Real reviewer files put the
// verdict under a "### Verdict" heading several lines down (line 1 is often a blockquote
// or per-criterion preamble), so a genuine BLOCK was silently read as APPROVED and the
// orchestrator took the all-APPROVED path. parseReviewerVerdict anchors on the Verdict
// section and is fail-safe (BLOCK wins) so a block is never silently dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewerVerdict } from './reviewer-verdict.mjs';

// The exact failure: BLOCK verdict NOT on line 1 (real reviewer-boundary shape from the soak).
const BOUNDARY_BLOCK = `> Removed inherited Features 1 (conductor-managed dispatch context, r-31711ab4 plan-leak) and 2 (apply worktree resolution) from this run's PLAN.md after gate1 reviewers approved. Implementer must execute Feature 3 (tasks 11-13) only.

### Verdict
**BLOCKED** — Cannot review. Dispatcher must re-invoke reviewer-boundary with the correct feature name and task scope.
`;

const SAFETY_APPROVED = `### Per-criterion verdicts

- Input validation: OK
- Path traversal: guarded

### Verdict
APPROVED — no safety issues found. The implementation correctly validates all inputs.
`;

test('THE BUG: a BLOCK under a later "### Verdict" heading is detected (not misread as APPROVED)', () => {
  assert.equal(parseReviewerVerdict(BOUNDARY_BLOCK), 'BLOCK');
});

test('a clean APPROVED verdict under a later heading is APPROVED', () => {
  assert.equal(parseReviewerVerdict(SAFETY_APPROVED), 'APPROVED');
});

test('REVISE under the Verdict heading is detected', () => {
  assert.equal(parseReviewerVerdict('# Review\n\n### Verdict\nREVISE — fix the off-by-one in the loop bound.\n'), 'REVISE');
});

test('no false-positive: prose "no blocking issues" before an APPROVED verdict stays APPROVED', () => {
  const c = 'Analysis: I found no blocking issues and nothing to revise.\n\n### Verdict\nAPPROVED — ship it.\n';
  assert.equal(parseReviewerVerdict(c), 'APPROVED', '"blocking"/"revise" in prose must not flip the verdict');
});

test('back-compat: a verdict token on line 1 (old format) still parses', () => {
  assert.equal(parseReviewerVerdict('BLOCKED — found a real bug.\n...details...'), 'BLOCK');
  assert.equal(parseReviewerVerdict('[verdict] APPROVED\n...'), 'APPROVED');
});

test('fail-safe: BLOCK wins when both BLOCK and APPROVED appear in the verdict region', () => {
  const c = '### Verdict\nBLOCKED. (An earlier draft said APPROVED but this supersedes it.)\n';
  assert.equal(parseReviewerVerdict(c), 'BLOCK', 'never silently drop a BLOCK');
});

test('"### Per-criterion verdicts" (plural) is NOT treated as the Verdict section anchor', () => {
  // Only the singular "Verdict" heading anchors; plural "verdicts" must not.
  const c = '### Per-criterion verdicts\nsome text\n\n### Verdict\nAPPROVED\n';
  assert.equal(parseReviewerVerdict(c), 'APPROVED');
});

test('empty / garbage input defaults to APPROVED (documented current behavior)', () => {
  assert.equal(parseReviewerVerdict(''), 'APPROVED');
  assert.equal(parseReviewerVerdict(null), 'APPROVED');
});
