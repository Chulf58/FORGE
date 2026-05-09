#!/usr/bin/env node
// Deterministic reviewer dispatch — replaces the reviewer-triage agent.
//
// Given a handoff.md (implement-stage) or PLAN.md (plan-stage), outputs a JSON
// object with `reviewers[]` — the exact list of reviewer agents to invoke.
//
// For implement-stage: extends lean-risk-classify.mjs by mapping triggeredRules
// to specific reviewers. For plan-stage: keyword-scans active task lines.
//
// Usage:
//   node scripts/reviewer-dispatch.mjs --handoff=<path> [--stage=implement|plan] [--pipeline=refactor] [--force-review]
//   node scripts/reviewer-dispatch.mjs --diff=<path> --coder-status=<path> [--stage=implement] [--pipeline=refactor] [--force-review]
//
// Output (JSON on stdout):
//   { "reviewers": ["reviewer-safety", "reviewer-boundary"], "reasons": [...], "classifiedBy": "diff"|"handoff" }

import fs from 'node:fs';
import path from 'node:path';
import { classifyHandoff, classifyDiff } from './lean-risk-classify.mjs';

// --- Rule-to-reviewer mapping ------------------------------------------------
const RULE_TO_REVIEWERS = {
  'shell-spawn': ['reviewer-safety'],
  'fs-write-outside-pipeline': ['reviewer-safety'],
  'auth-crypto-secrets': ['reviewer-safety'],
  'env-or-path-resolution': ['reviewer-safety'],
  'network-boundary': ['reviewer-safety', 'reviewer-boundary'],
  'schema-contract-change': ['reviewer-boundary'],
  'new-public-handler': ['reviewer-boundary'],
  'signal-format-change': ['reviewer-boundary'],
  'bin-script': ['reviewer-safety', 'reviewer-boundary'],
  'hook-script': ['reviewer-safety', 'reviewer-boundary'],
  'mcp-tool': ['reviewer-safety', 'reviewer-boundary'],
  'command': ['reviewer-boundary'],
  'plugin-manifest': ['reviewer-boundary'],
  'pipeline-state-schema': ['reviewer-boundary'],
  'merge-apply-worktree-boundary': ['reviewer-safety', 'reviewer-boundary'],
};

// Test-file pattern — matches test-file paths in +++ b/ diff headers.
// Used by addReviewerTestsIfNeeded to scope keyword detection to test hunks only (AC-7).
const TEST_FILE_PATTERN = /(?:\.test\.|_test\.|\.spec\.|\/tests\/|\/spec\/)/;

// Suppression keywords that trigger reviewer-tests when found on + lines in test-file hunks.
const TEST_SUPPRESSION_KEYWORDS = [
  'it.skip', 'describe.skip', 'xit(', 'xdescribe(', 'test.skip',
  'pytest.mark.skip', 'pytest.mark.xfail', 't.Skip(',
  'jest.mock(', 'vi.mock(', 'sinon.stub(', 'unittest.mock.patch', 'patch(',
  'eslint-disable', 'noqa', '@ts-ignore', '@ts-expect-error', 'type: ignore',
];

/**
 * Add reviewer-tests to the reviewer set when the diff touches test files
 * or adds suppression keywords inside test-file hunks (AC-7 narrowed).
 *
 * Rule (a): any +++ b/<path> header matching TEST_FILE_PATTERN → add reviewer-tests.
 * Rule (b): suppression keywords on `+` lines inside a test-file hunk → add reviewer-tests.
 * Keywords in non-test files do NOT trigger reviewer-tests.
 *
 * @param {Set<string>} reviewerSet
 * @param {string[]} reasons
 * @param {string} diffContent
 */
function addReviewerTestsIfNeeded(reviewerSet, reasons, diffContent) {
  if (!diffContent) return;

  const lines = diffContent.split('\n');
  let currentFileIsTestFile = false;
  let triggered = false;

  for (const line of lines) {
    // Detect file header lines (+++ b/<path>)
    if (line.startsWith('+++ b/')) {
      const filePath = line.slice(6); // strip '+++ b/'
      currentFileIsTestFile = TEST_FILE_PATTERN.test(filePath);
      if (currentFileIsTestFile && !triggered) {
        // Rule (a): test-file path present in diff
        reviewerSet.add('reviewer-tests');
        reasons.push('test-file-or-suppression-keyword → reviewer-tests');
        triggered = true;
      }
      continue;
    }

    // Rule (b): suppression keyword on a `+` line inside a test-file hunk
    if (!triggered && currentFileIsTestFile && line.startsWith('+') && !line.startsWith('+++')) {
      const lower = line.toLowerCase();
      for (const kw of TEST_SUPPRESSION_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) {
          reviewerSet.add('reviewer-tests');
          reasons.push('test-file-or-suppression-keyword → reviewer-tests');
          triggered = true;
          break;
        }
      }
    }
  }
}

// --- Plan-stage keyword mapping ----------------------------------------------
const PLAN_REVIEWER_KEYWORDS = {
  'reviewer-safety': [
    'shell', 'exec', 'spawn', 'child_process', 'auth', 'token',
    'credential', 'secret', 'password', 'crypto', 'hash', 'jwt',
    'fs.write', 'fs.unlink', 'fs.rm', 'readfile', 'writefile',
    'user input', 'injection', 'sanitiz', 'webhook', 'endpoint',
    'http', 'fetch', 'request', 'api key', 'env var', 'process.env',
  ],
  'reviewer-boundary': [
    'boundary', 'module', 'contract', 'interface', 'cross-module',
    'public api', 'export', 'schema', 'migration', 'rename across',
    'shared state', 'store', 'handler', 'route', 'mcp', 'hook',
    'plugin', 'tool', 'signal',
  ],
  'reviewer-logic': [
    'async', 'await', 'state mutation', 'event handler', 'conditional',
    're-entrancy', 'race', 'debounce', 'throttle', 'guard', 'reactive',
    'effect', 'derived',
  ],
  'reviewer-performance': [
    'loop', 'foreach', 'map', 'filter', 'collection', 'array',
    'file read', 'dom update', 'reactive', 'large dataset', 'batch',
  ],
};

function dispatchForImplementStage(handoffContent, forceReview, pipeline, diffContent, coderStatus) {
  const classification = (diffContent !== undefined && coderStatus !== undefined)
    ? classifyDiff({ diffContent, coderStatus, forceReview })
    : classifyHandoff({ handoffContent, forceReview });

  // reviewer-tests: always evaluated before skipReviewers short-circuit.
  // A clean diff that touches test files still needs reviewer-tests even if
  // no other risk-surface rules triggered (AC-7 narrowed).
  const reviewerTestsSet = new Set();
  const reviewerTestsReasons = [];
  const diffForTests = diffContent !== undefined ? diffContent : '';
  addReviewerTestsIfNeeded(reviewerTestsSet, reviewerTestsReasons, diffForTests);
  const hasReviewerTests = reviewerTestsSet.has('reviewer-tests');

  if (classification.skipReviewers && pipeline !== 'refactor') {
    // Even on a clean diff, reviewer-tests may be needed for test-file changes.
    if (hasReviewerTests) {
      return {
        reviewers: Array.from(reviewerTestsSet).sort(),
        reasons: [...classification.reasons, ...reviewerTestsReasons],
        classifiedBy: classification.classifiedBy,
      };
    }
    return { reviewers: [], reasons: classification.reasons };
  }

  if (classification.skipReviewers && pipeline === 'refactor') {
    const refactorSet = new Set(['reviewer-style']);
    if (hasReviewerTests) refactorSet.add('reviewer-tests');
    return {
      reviewers: Array.from(refactorSet).sort(),
      reasons: hasReviewerTests
        ? ['refactor-style-mandatory', ...reviewerTestsReasons]
        : ['refactor-style-mandatory'],
    };
  }

  const reviewerSet = new Set();
  const reasons = [];

  for (const rule of classification.triggeredRules) {
    const ruleName = rule.split(':')[0];
    const mapped = RULE_TO_REVIEWERS[ruleName];
    if (mapped) {
      for (const r of mapped) reviewerSet.add(r);
      reasons.push(`${ruleName} → ${mapped.join(', ')}`);
    }
  }

  // Merge reviewer-tests findings into the main reviewer set.
  if (hasReviewerTests) {
    reviewerSet.add('reviewer-tests');
    for (const r of reviewerTestsReasons) reasons.push(r);
  }

  // Fallback: classifier said "don't skip" but no rules mapped to reviewers.
  // This covers: verification-section-missing, verification-not-clean,
  // blockers-present, or unmapped triggered rules.
  if (reviewerSet.size === 0) {
    reviewerSet.add('reviewer-safety');
    reviewerSet.add('reviewer-boundary');
    reasons.push(classification.triggeredRules.length > 0
      ? 'unmapped-rules-fallback'
      : `classifier-no-skip:${classification.reasons.join(',')}`);
  }

  if (pipeline === 'refactor') reviewerSet.add('reviewer-style');

  const result = {
    reviewers: Array.from(reviewerSet).sort(),
    reasons,
    triggeredRules: classification.triggeredRules,
  };

  if (classification.classifiedBy === 'diff') {
    result.classifiedBy = 'diff';
  }

  return result;
}

function dispatchForPlanStage(planContent) {
  const taskLines = planContent
    .split('\n')
    .filter((l) => /^\s*-\s*\[ \]/.test(l))
    .map((l) => l.toLowerCase());

  const reviewerSet = new Set();
  const reasons = [];

  for (const [reviewer, keywords] of Object.entries(PLAN_REVIEWER_KEYWORDS)) {
    for (const keyword of keywords) {
      if (taskLines.some((line) => line.includes(keyword))) {
        reviewerSet.add(reviewer);
        reasons.push(`keyword "${keyword}" → ${reviewer}`);
        break;
      }
    }
  }

  // reviewer-tests plan-stage: only dispatch if a task line contains BOTH
  // the word "test" AND at least one suppression keyword.
  // Bare keyword match without "test" does NOT trigger.
  // Note: taskLines is already lowercased upstream (see line ~211); keywords below MUST stay lowercase.
  const testSuppressionPlanKeywords = ['skip', 'mock', 'eslint-disable', 'noqa', '@ts-ignore'];
  const hasTestAndKeyword = taskLines.some((line) =>
    line.includes('test') &&
    testSuppressionPlanKeywords.some((kw) => line.includes(kw)),
  );
  if (hasTestAndKeyword) {
    reviewerSet.add('reviewer-tests');
    reasons.push('plan-task contains "test" + suppression keyword → reviewer-tests');
  }

  return { reviewers: Array.from(reviewerSet).sort(), reasons };
}

// --- CLI ---------------------------------------------------------------------
function isMainModule() {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  return path.basename(scriptPath) === 'reviewer-dispatch.mjs';
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    out[k] = v === undefined ? true : v;
  }
  return out;
}

if (isMainModule()) {
  const args = parseArgs(process.argv);
  const stage = args.stage || 'implement';
  const pipeline = args.pipeline || 'implement';
  const forceReview = Boolean(args['force-review']);

  // Diff-first path: --diff= and optionally --coder-status=
  if (args.diff && stage !== 'plan') {
    let diffContent;
    try {
      diffContent = fs.readFileSync(args.diff, 'utf8');
    } catch (err) {
      process.stdout.write(JSON.stringify({
        reviewers: ['reviewer-safety', 'reviewer-boundary'],
        reasons: ['diff-unreadable-fallback'],
        classifiedBy: 'diff',
        error: err.message,
      }, null, 2) + '\n');
      process.exit(1);
    }

    let coderStatus = null;
    if (args['coder-status']) {
      try {
        coderStatus = JSON.parse(fs.readFileSync(args['coder-status'], 'utf8'));
      } catch (err) {
        process.stdout.write(JSON.stringify({
          reviewers: ['reviewer-safety', 'reviewer-boundary'],
          reasons: ['coder-status-unreadable-fallback'],
          classifiedBy: 'diff',
          error: err.message,
        }, null, 2) + '\n');
        process.exit(1);
      }
    }

    const result = dispatchForImplementStage(
      '', // handoffContent unused when diff+coderStatus provided
      forceReview,
      pipeline,
      diffContent,
      coderStatus,
    );
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  }

  // Fallback: handoff path (or plan path for plan-stage)
  const filePath = args.handoff || args.plan || (stage === 'plan' ? 'docs/PLAN.md' : 'docs/context/handoff.md');

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stdout.write(JSON.stringify({
      reviewers: stage === 'plan'
        ? ['reviewer-boundary', 'reviewer-safety']
        : ['reviewer-safety', 'reviewer-boundary'],
      reasons: ['file-unreadable-fallback'],
      error: err.message,
    }, null, 2) + '\n');
    process.exit(1);
  }

  const result = stage === 'plan'
    ? dispatchForPlanStage(content)
    : dispatchForImplementStage(content, forceReview, pipeline);

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
