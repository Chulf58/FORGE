#!/usr/bin/env node
// Tests for the structured findings contract (Slice 1).
//
// Covers:
//   AC-1 — structured finding object shape (both classifyHandoff and classifyDiff code paths)
//   AC-2 — findings.json write path + worktree path validation
//   AC-3 — reviewer-prompt findings injection contract (SKILL.md text check)
//   AC-8 — end-to-end smoke test: classifier emits N findings, reviewer output has N FIND-<id>: lines
//
// Run: node --test scripts/findings-contract-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLASSIFY_SCRIPT = resolve(__dirname, 'lean-risk-classify.mjs');
const DISPATCH_SCRIPT = resolve(__dirname, 'reviewer-dispatch.mjs');
const SKILL_MD = resolve(__dirname, '..', 'skills', 'implement', 'SKILL.md');

// ─── Synthetic handoff fixtures ──────────────────────────────────────────────

// Triggers 'shell-spawn' rule via child_process.exec in a Files-to-create block.
const HANDOFF_SHELL_SPAWN = `# Handoff: Example with shell spawn

## Summary
Example change that spawns a shell.

## Files to create
### \`hooks/example.js\`
\`\`\`js
const cp = require('child_process');
cp.exec('ls', (err, stdout) => { console.log(stdout); });
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

// Triggers only path-based 'hook-script' rule (no content risk).
const HANDOFF_HOOK_PATH_ONLY = `# Handoff: Hook path only

## Summary
Adds a hook file.

## Files to create
### \`hooks/my-hook.js\`
\`\`\`js
module.exports = function() { return true; };
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpWorktree() {
  const root = mkdtempSync(join(tmpdir(), 'findings-test-'));
  mkdirSync(join(root, 'docs', 'context'), { recursive: true });
  return root;
}

function runDispatch(args) {
  const result = spawnSync(process.execPath, [DISPATCH_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return result;
}

function runClassify(args) {
  const result = spawnSync(process.execPath, [CLASSIFY_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return result;
}

// ─── AC-1: structured finding object shape ───────────────────────────────────

test('AC-1a: classifyHandoff triggeredRules elements are objects with required keys (not strings)', async () => {
  // Import the classifier directly
  const { classifyHandoff } = await import('./lean-risk-classify.mjs');

  const result = classifyHandoff({ handoffContent: HANDOFF_SHELL_SPAWN });

  // Must have triggered rules (shell-spawn should fire)
  assert.ok(Array.isArray(result.triggeredRules), 'triggeredRules must be an array');
  assert.ok(result.triggeredRules.length > 0, 'triggeredRules must be non-empty for shell-spawn handoff');

  for (const finding of result.triggeredRules) {
    // Each finding must be an OBJECT, not a string
    assert.notEqual(typeof finding, 'string',
      `Expected object finding, got string: "${finding}"`);
    assert.equal(typeof finding, 'object',
      `finding must be an object, got ${typeof finding}`);
    assert.notEqual(finding, null, 'finding must not be null');

    // Must have all five required keys
    assert.ok('rule' in finding, 'finding must have "rule" key');
    assert.ok('file' in finding, 'finding must have "file" key');
    assert.ok('line' in finding, 'finding must have "line" key');
    assert.ok('snippet' in finding, 'finding must have "snippet" key');
    assert.ok('suggestedCheck' in finding, 'finding must have "suggestedCheck" key');

    // Type checks
    assert.equal(typeof finding.rule, 'string', 'finding.rule must be a string');
    assert.equal(typeof finding.file, 'string', 'finding.file must be a string');
    assert.ok(
      finding.line === null || (typeof finding.line === 'number' && finding.line > 0),
      `finding.line must be a positive integer or null, got: ${finding.line}`
    );
    assert.equal(typeof finding.snippet, 'string', 'finding.snippet must be a string');
    assert.equal(typeof finding.suggestedCheck, 'string', 'finding.suggestedCheck must be a string');
    assert.ok(finding.suggestedCheck.length > 0, 'finding.suggestedCheck must be non-empty');
  }
});

test('AC-1b: classifyHandoff returns triggeredRulesLegacy as array of strings in "rule:snippet" format', async () => {
  const { classifyHandoff } = await import('./lean-risk-classify.mjs');

  const result = classifyHandoff({ handoffContent: HANDOFF_SHELL_SPAWN });

  assert.ok('triggeredRulesLegacy' in result,
    'result must have triggeredRulesLegacy key');
  assert.ok(Array.isArray(result.triggeredRulesLegacy),
    'triggeredRulesLegacy must be an array');
  assert.ok(result.triggeredRulesLegacy.length > 0,
    'triggeredRulesLegacy must be non-empty');

  for (const entry of result.triggeredRulesLegacy) {
    assert.equal(typeof entry, 'string',
      `triggeredRulesLegacy entry must be a string, got ${typeof entry}`);
    assert.ok(entry.includes(':'),
      `triggeredRulesLegacy entry must be in "rule:snippet" format, got: "${entry}"`);
    const [rule] = entry.split(':');
    assert.ok(rule.length > 0, 'rule part of legacy string must be non-empty');
  }
});

test('AC-1c: classifyDiff triggeredRules elements are objects with required keys (not strings)', async () => {
  const { classifyDiff } = await import('./lean-risk-classify.mjs');

  // Synthetic unified diff that triggers shell-spawn
  const diffContent = [
    'diff --git a/hooks/example.js b/hooks/example.js',
    '--- a/hooks/example.js',
    '+++ b/hooks/example.js',
    '@@ -0,0 +1,3 @@',
    '+const cp = require(\'child_process\');',
    '+cp.exec(\'ls\', (err, stdout) => { console.log(stdout); });',
    '+module.exports = {};',
  ].join('\n');

  const coderStatus = { verificationClean: true, hasBlockers: false };
  const result = classifyDiff({ diffContent, coderStatus });

  assert.ok(Array.isArray(result.triggeredRules), 'triggeredRules must be an array');
  assert.ok(result.triggeredRules.length > 0, 'triggeredRules must be non-empty for shell-spawn diff');

  for (const finding of result.triggeredRules) {
    assert.notEqual(typeof finding, 'string',
      `Expected object finding, got string: "${finding}"`);
    assert.equal(typeof finding, 'object', 'finding must be an object');
    assert.notEqual(finding, null, 'finding must not be null');

    assert.ok('rule' in finding, 'finding must have "rule" key');
    assert.ok('file' in finding, 'finding must have "file" key');
    assert.ok('line' in finding, 'finding must have "line" key');
    assert.ok('snippet' in finding, 'finding must have "snippet" key');
    assert.ok('suggestedCheck' in finding, 'finding must have "suggestedCheck" key');

    assert.equal(typeof finding.rule, 'string', 'finding.rule must be a string');
    assert.equal(typeof finding.file, 'string', 'finding.file must be a string');
    assert.ok(
      finding.line === null || (typeof finding.line === 'number' && finding.line > 0),
      `finding.line must be a positive integer or null, got: ${finding.line}`
    );
    assert.equal(typeof finding.snippet, 'string', 'finding.snippet must be a string');
    assert.equal(typeof finding.suggestedCheck, 'string', 'finding.suggestedCheck must be a string');
    assert.ok(finding.suggestedCheck.length > 0, 'finding.suggestedCheck must be non-empty');
  }
});

test('AC-1d: classifyDiff returns triggeredRulesLegacy as array of strings', async () => {
  const { classifyDiff } = await import('./lean-risk-classify.mjs');

  const diffContent = [
    'diff --git a/hooks/example.js b/hooks/example.js',
    '--- a/hooks/example.js',
    '+++ b/hooks/example.js',
    '@@ -0,0 +1,2 @@',
    '+const cp = require(\'child_process\');',
    '+cp.exec(\'ls\');',
  ].join('\n');

  const coderStatus = { verificationClean: true, hasBlockers: false };
  const result = classifyDiff({ diffContent, coderStatus });

  assert.ok('triggeredRulesLegacy' in result,
    'result must have triggeredRulesLegacy key');
  assert.ok(Array.isArray(result.triggeredRulesLegacy),
    'triggeredRulesLegacy must be an array');

  for (const entry of result.triggeredRulesLegacy) {
    assert.equal(typeof entry, 'string',
      `triggeredRulesLegacy entry must be a string, got ${typeof entry}`);
    assert.ok(entry.includes(':'),
      `triggeredRulesLegacy entry must be in "rule:snippet" format`);
  }
});

test('AC-1e: handoff and diff classifiers emit findings with same five keys (shape equivalence)', async () => {
  const { classifyHandoff, classifyDiff } = await import('./lean-risk-classify.mjs');

  const handoffResult = classifyHandoff({ handoffContent: HANDOFF_SHELL_SPAWN });
  const diffContent = [
    'diff --git a/hooks/example.js b/hooks/example.js',
    '--- a/hooks/example.js',
    '+++ b/hooks/example.js',
    '@@ -0,0 +1,2 @@',
    '+const cp = require(\'child_process\');',
    '+cp.exec(\'ls\');',
  ].join('\n');
  const coderStatus = { verificationClean: true, hasBlockers: false };
  const diffResult = classifyDiff({ diffContent, coderStatus });

  const expectedKeys = ['rule', 'file', 'line', 'snippet', 'suggestedCheck'];

  // Both paths must produce object-shaped findings (not strings)
  for (const finding of handoffResult.triggeredRules) {
    const keys = Object.keys(finding).sort();
    for (const k of expectedKeys) {
      assert.ok(keys.includes(k),
        `Handoff finding missing key "${k}", has keys: ${keys.join(', ')}`);
    }
  }

  for (const finding of diffResult.triggeredRules) {
    const keys = Object.keys(finding).sort();
    for (const k of expectedKeys) {
      assert.ok(keys.includes(k),
        `Diff finding missing key "${k}", has keys: ${keys.join(', ')}`);
    }
  }
});

test('AC-1f: every RISK_CONTENT_PATTERNS entry has a non-empty static suggestedCheck string', async () => {
  // We verify this by reading the source file and checking that each pattern entry
  // has a suggestedCheck property. We import the module and check by running classify
  // against synthetic inputs that trigger each known rule — or by reading pattern source.
  //
  // Since the patterns are not exported, we verify indirectly: the emitted findings
  // must have suggestedCheck set from the static pattern table, not derived from match content.
  // We drive the classifier with multiple known risk patterns and assert the field is present
  // and non-empty on each finding.

  const { classifyHandoff } = await import('./lean-risk-classify.mjs');

  // Trigger multiple rules in one handoff
  const handoff = `# Handoff: multi-rule

## Summary
Multiple risk patterns.

## Files to create
### \`hooks/multi.js\`
\`\`\`js
const cp = require('child_process');
cp.exec('ls');
const jwt = require('jsonwebtoken');
const token = jwt.sign({}, process.env.SECRET_KEY);
fetch('https://api.example.com/data');
\`\`\`

## Files to modify
### \`mcp/tool.js\`
\`\`\`js
registerTool('myTool', {});
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

  const result = classifyHandoff({ handoffContent: handoff });
  assert.ok(result.triggeredRules.length > 0, 'Must trigger at least one rule');

  for (const finding of result.triggeredRules) {
    assert.ok(typeof finding.suggestedCheck === 'string' && finding.suggestedCheck.length > 0,
      `finding for rule "${finding.rule}" must have non-empty suggestedCheck`);
  }
});

// ─── AC-2: findings.json write path + worktree validation ────────────────────

test('AC-2a: dispatch writes findings.json to <worktreePath>/docs/context/ with correct schema', () => {
  const tmp = makeTmpWorktree();
  try {
    // Write a diff file that triggers shell-spawn
    const diffContent = [
      'diff --git a/hooks/example.js b/hooks/example.js',
      '--- /dev/null',
      '+++ b/hooks/example.js',
      '@@ -0,0 +1,3 @@',
      '+const cp = require(\'child_process\');',
      '+cp.exec(\'ls\', (err, stdout) => { console.log(stdout); });',
      '+module.exports = {};',
    ].join('\n');
    const diffPath = join(tmp, 'diff.txt');
    writeFileSync(diffPath, diffContent, 'utf8');

    const coderStatus = { verificationClean: true, hasBlockers: false };
    const coderStatusPath = join(tmp, 'coder-status.json');
    writeFileSync(coderStatusPath, JSON.stringify(coderStatus), 'utf8');

    const result = runDispatch([
      `--diff=${diffPath}`,
      `--coder-status=${coderStatusPath}`,
      '--stage=implement',
      `--worktree=${tmp}`,
    ]);

    // Dispatch script must exit 0
    assert.equal(result.status, 0,
      `Dispatch script must exit 0, got ${result.status}. stderr: ${result.stderr}`);

    // findings.json must exist
    const findingsPath = join(tmp, 'docs', 'context', 'findings.json');
    assert.ok(existsSync(findingsPath),
      `findings.json must be written to ${findingsPath}`);

    const findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
    assert.ok(Array.isArray(findings), 'findings.json must contain a JSON array');
    assert.ok(findings.length > 0, 'findings.json array must be non-empty');

    for (const finding of findings) {
      assert.equal(typeof finding, 'object', 'Each finding must be an object');
      assert.notEqual(finding, null, 'Finding must not be null');
      assert.ok('rule' in finding, 'finding must have "rule" key');
      assert.ok('file' in finding, 'finding must have "file" key');
      assert.ok('line' in finding, 'finding must have "line" key');
      assert.ok('snippet' in finding, 'finding must have "snippet" key');
      assert.ok('suggestedCheck' in finding, 'finding must have "suggestedCheck" key');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2b: dispatch does NOT write findings.json when worktreePath is a non-directory', () => {
  const tmp = makeTmpWorktree();
  try {
    const diffContent = [
      'diff --git a/hooks/example.js b/hooks/example.js',
      '--- /dev/null',
      '+++ b/hooks/example.js',
      '@@ -0,0 +1,2 @@',
      '+const cp = require(\'child_process\');',
      '+cp.exec(\'ls\');',
    ].join('\n');
    const diffPath = join(tmp, 'diff.txt');
    writeFileSync(diffPath, diffContent, 'utf8');

    const coderStatus = { verificationClean: true, hasBlockers: false };
    const coderStatusPath = join(tmp, 'coder-status.json');
    writeFileSync(coderStatusPath, JSON.stringify(coderStatus), 'utf8');

    const nonexistentWorktree = join(tmp, 'nonexistent-dir');

    const result = runDispatch([
      `--diff=${diffPath}`,
      `--coder-status=${coderStatusPath}`,
      '--stage=implement',
      `--worktree=${nonexistentWorktree}`,
    ]);

    // Must still exit 0 (fail-open)
    assert.equal(result.status, 0,
      `Dispatch must exit 0 (fail-open) even for invalid worktree, got ${result.status}`);

    // findings.json must NOT be written inside the nonexistent worktree
    const findingsPath = join(nonexistentWorktree, 'docs', 'context', 'findings.json');
    assert.ok(!existsSync(findingsPath),
      'findings.json must NOT be written when worktreePath is non-directory');

    // Must log the rejection message to stderr
    assert.ok(
      result.stderr.includes('[reviewer-dispatch] findings.json write rejected'),
      `stderr must contain "[reviewer-dispatch] findings.json write rejected", got: ${result.stderr}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC-2c: dispatch rejects path-traversal worktree path', () => {
  const tmp = makeTmpWorktree();
  try {
    const diffContent = [
      'diff --git a/hooks/example.js b/hooks/example.js',
      '--- /dev/null',
      '+++ b/hooks/example.js',
      '@@ -0,0 +1,2 @@',
      '+const cp = require(\'child_process\');',
      '+cp.exec(\'ls\');',
    ].join('\n');
    const diffPath = join(tmp, 'diff.txt');
    writeFileSync(diffPath, diffContent, 'utf8');

    const coderStatus = { verificationClean: true, hasBlockers: false };
    const coderStatusPath = join(tmp, 'coder-status.json');
    writeFileSync(coderStatusPath, JSON.stringify(coderStatus), 'utf8');

    // Create a worktree dir, but pass a traversal path that escapes it
    // We point --worktree to tmp itself, but the dispatch script must validate
    // that the resolved findings.json path stays inside the worktree.
    // To test path-traversal: pass a --worktree arg that would cause the resolved
    // findings path to escape. We simulate by writing a custom worktree path
    // with embedded traversal (the script should normalize and reject).
    const traversalWorktree = join(tmp, '..', 'escaped-path');

    const result = runDispatch([
      `--diff=${diffPath}`,
      `--coder-status=${coderStatusPath}`,
      '--stage=implement',
      `--worktree=${traversalWorktree}`,
    ]);

    // Must still exit 0 (fail-open)
    assert.equal(result.status, 0,
      `Dispatch must exit 0 (fail-open) for path-traversal worktree, got ${result.status}`);

    // findings.json must NOT be written to the traversal-escaped path
    const traversalFindingsPath = join(traversalWorktree, 'docs', 'context', 'findings.json');
    assert.ok(!existsSync(traversalFindingsPath),
      'findings.json must NOT be written for path-traversal worktree');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── AC-3: reviewer-prompt findings injection contract ───────────────────────

test('AC-3: skills/implement/SKILL.md contains [findings: injection adjacent to reviewer-output-dir', () => {
  const skillContent = readFileSync(SKILL_MD, 'utf8');

  // The literal token [findings: must be present in SKILL.md
  assert.ok(
    skillContent.includes('[findings:'),
    'skills/implement/SKILL.md must contain "[findings:" injection token. ' +
    'This test fails (red bar) until the coder adds the [findings: <path>] prefix injection.'
  );
});

// ─── AC-8: end-to-end smoke test (order-independent) ─────────────────────────

test('AC-8: smoke test — classifier emits 3 findings, simulated reviewer output has 3 FIND-<id>: lines (order-independent)', async () => {
  const { classifyHandoff } = await import('./lean-risk-classify.mjs');

  // Synthetic handoff triggering exactly 3 distinct rules:
  //   1. shell-spawn (child_process.exec)
  //   2. network-boundary (fetch)
  //   3. auth-crypto-secrets (jsonwebtoken)
  const handoff = `# Handoff: Three-rule smoke test

## Summary
Smoke test handoff with three distinct risk patterns.

## Files to create
### \`hooks/smoke-test.js\`
\`\`\`js
const cp = require('child_process');
cp.exec('ls');
fetch('https://api.example.com/data');
const jwt = require('jsonwebtoken');
jwt.sign({}, process.env.SECRET_KEY);
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

  const result = classifyHandoff({ handoffContent: handoff });

  // Classifier must return structured findings (not strings)
  assert.ok(Array.isArray(result.triggeredRules), 'triggeredRules must be an array');

  // Expecting at least 3 findings for the three patterns
  assert.ok(result.triggeredRules.length >= 3,
    `Expected at least 3 findings, got ${result.triggeredRules.length}. ` +
    `Findings: ${JSON.stringify(result.triggeredRules)}`);

  // Each finding must be an object with the required keys
  for (const finding of result.triggeredRules) {
    assert.equal(typeof finding, 'object',
      `Finding must be object, got ${typeof finding}: ${JSON.stringify(finding)}`);
    assert.ok('rule' in finding && 'file' in finding && 'line' in finding &&
              'snippet' in finding && 'suggestedCheck' in finding,
      `Finding missing required keys: ${JSON.stringify(finding)}`);
  }

  // Simulate that findings.json was written with IDs FIND-1, FIND-2, FIND-3
  // (the coder will assign sequential IDs; here we construct a simulated reviewer output)
  const findingsWithIds = result.triggeredRules.slice(0, 3).map((f, i) => ({
    ...f,
    id: `FIND-${i + 1}`,
  }));

  // Synthesize a fake reviewer output with three FIND-<id>: verdict lines
  // (one CONFIRMED, one DISMISSED, one NEEDS-INVESTIGATION — order doesn't matter)
  const simulatedReviewerOutput = `
## Reviewer Safety Analysis

Reviewing the findings from findings.json:

FIND-1: CONFIRMED — child_process.exec is used without input sanitization.
FIND-2: DISMISSED — fetch call targets a known-safe external endpoint.
FIND-3: NEEDS-INVESTIGATION — JWT secret source requires audit.

[reviewer-verdict] REVISE
`;

  // Parse FIND-<N>: <VERDICT> lines — order-independent
  const findLineRegex = /FIND-(\d+):\s+(CONFIRMED|DISMISSED|NEEDS-INVESTIGATION)/g;
  const matches = [];
  let m;
  while ((m = findLineRegex.exec(simulatedReviewerOutput)) !== null) {
    matches.push({ id: parseInt(m[1], 10), verdict: m[2] });
  }

  // Assert exactly 3 matches
  assert.equal(matches.length, 3,
    `Expected exactly 3 FIND-<id>: lines, got ${matches.length}`);

  // Assert the set of IDs equals {1, 2, 3}
  const idSet = new Set(matches.map(m => m.id));
  assert.deepEqual(idSet, new Set([1, 2, 3]),
    `Expected ID set {1, 2, 3}, got {${[...idSet].sort().join(', ')}}`);

  // Assert the set of verdicts equals {CONFIRMED, DISMISSED, NEEDS-INVESTIGATION}
  const verdictSet = new Set(matches.map(m => m.verdict));
  assert.deepEqual(verdictSet, new Set(['CONFIRMED', 'DISMISSED', 'NEEDS-INVESTIGATION']),
    `Expected verdict set {CONFIRMED, DISMISSED, NEEDS-INVESTIGATION}, got {${[...verdictSet].join(', ')}}`);

  // This test itself should PASS (it's a smoke-test of the assertion machinery
  // against simulated data). The RED BAR for AC-8 comes from AC-1 and AC-2 tests
  // above failing (classifyHandoff returns strings, not objects; no findings.json written).
  // Once wave 2 lands (classifier upgraded, dispatch writes findings.json),
  // this test validates the end-to-end contract passes.
});

test('AC-8b: smoke test via dispatch CLI — 3 rules trigger, findings.json written with 3 entries', () => {
  const tmp = makeTmpWorktree();
  try {
    // Synthetic diff triggering 3 distinct rules:
    //   shell-spawn, network-boundary, auth-crypto-secrets
    const diffContent = [
      'diff --git a/hooks/smoke.js b/hooks/smoke.js',
      '--- /dev/null',
      '+++ b/hooks/smoke.js',
      '@@ -0,0 +1,5 @@',
      '+const cp = require(\'child_process\');',
      '+cp.exec(\'ls\');',
      '+fetch(\'https://api.example.com/data\');',
      '+const jwt = require(\'jsonwebtoken\');',
      '+jwt.sign({}, process.env.SECRET_KEY);',
    ].join('\n');

    const diffPath = join(tmp, 'diff.txt');
    writeFileSync(diffPath, diffContent, 'utf8');

    const coderStatus = { verificationClean: true, hasBlockers: false };
    const coderStatusPath = join(tmp, 'coder-status.json');
    writeFileSync(coderStatusPath, JSON.stringify(coderStatus), 'utf8');

    const result = runDispatch([
      `--diff=${diffPath}`,
      `--coder-status=${coderStatusPath}`,
      '--stage=implement',
      `--worktree=${tmp}`,
    ]);

    assert.equal(result.status, 0,
      `Dispatch must exit 0. stderr: ${result.stderr}`);

    const findingsPath = join(tmp, 'docs', 'context', 'findings.json');
    assert.ok(existsSync(findingsPath),
      `findings.json must be written to ${findingsPath}`);

    const findings = JSON.parse(readFileSync(findingsPath, 'utf8'));
    assert.ok(Array.isArray(findings), 'findings.json must be a JSON array');
    assert.ok(findings.length >= 3,
      `Expected at least 3 findings, got ${findings.length}`);

    // Simulate reviewer output referencing FIND-1, FIND-2, FIND-3
    const simulatedOutput = findings.slice(0, 3).map((f, i) => {
      const verdicts = ['CONFIRMED', 'DISMISSED', 'NEEDS-INVESTIGATION'];
      return `FIND-${i + 1}: ${verdicts[i]} — review note for ${f.rule}`;
    }).join('\n');

    const findRegex = /FIND-(\d+):\s+(CONFIRMED|DISMISSED|NEEDS-INVESTIGATION)/g;
    const parsedMatches = [];
    let fm;
    while ((fm = findRegex.exec(simulatedOutput)) !== null) {
      parsedMatches.push({ id: parseInt(fm[1], 10), verdict: fm[2] });
    }

    assert.equal(parsedMatches.length, 3, `Expected 3 FIND-<id>: lines, got ${parsedMatches.length}`);
    assert.deepEqual(new Set(parsedMatches.map(m => m.id)), new Set([1, 2, 3]));
    assert.deepEqual(
      new Set(parsedMatches.map(m => m.verdict)),
      new Set(['CONFIRMED', 'DISMISSED', 'NEEDS-INVESTIGATION'])
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
