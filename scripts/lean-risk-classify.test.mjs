// Tests for scripts/lean-risk-classify.mjs
// Run: node --test scripts/lean-risk-classify.test.mjs
//
// The classifier is mode-agnostic. It returns skipReviewers:true only when ALL
// conditions are met: verification clean, no blockers, no risk-surface patterns.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHandoff } from './lean-risk-classify.mjs';

const HANDOFF_CLEAN_NON_RISK = `# Handoff: Shorten spinner label

## Summary
Shorten loading spinner text from full sentence to three dots.

## Files to modify
### \`src/ui/spinner.js\`
**Change:** shorter label.

**Find:**
\`\`\`js
const LABEL = 'Loading your data, please wait...';
\`\`\`

**Replace with:**
\`\`\`js
const LABEL = 'Loading...';
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_VERIFICATION_NOT_CLEAN = `# Handoff: Example

## Summary
Example change.

## Files to modify
### \`src/ui/widget.js\`
**Change:** tweak.

**Find:**
\`\`\`js
const x = 1;
\`\`\`

**Replace with:**
\`\`\`js
const x = 2;
\`\`\`

## Verification
- async await missed in handler; fixed.

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_VERIFICATION_MISSING = `# Handoff: Example

## Summary
Example change.

## Files to modify
### \`src/ui/widget.js\`
**Change:** tweak.

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_BLOCKERS_PRESENT = `# Handoff: Example

## Summary
Needs clarification before implementation.

## Files to modify
### \`src/ui/widget.js\`
**Change:** tweak.

## Blockers
- Schema for incoming event is ambiguous; need operator decision.

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_BLOCKERS_SECTION_EMPTY = `# Handoff: Example

## Summary
No blockers despite the heading.

## Files to modify
### \`src/ui/widget.js\`
**Change:** tweak.

**Find:**
\`\`\`js
const x = 1;
\`\`\`

**Replace with:**
\`\`\`js
const x = 2;
\`\`\`

## Blockers

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_RISK_PATH_HOOK = `# Handoff: New hook

## Summary
Add a new hook script for rate limit checks.

## Files to create
### \`hooks/rate-limit.js\`
\`\`\`js
module.exports = function ratelimit() {};
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: true
decision: false
`;

const HANDOFF_RISK_PATH_MCP = `# Handoff: New MCP tool

## Summary
Add MCP tool for reading alerts.

## Files to create
### \`mcp/tools/read-alerts.js\`
\`\`\`js
export function registerReadAlerts() {}
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: true
decision: false
`;

const HANDOFF_RISK_CONTENT_SHELL = `# Handoff: Spawn helper

## Summary
Add a helper that shells out to git.

## Files to modify
### \`src/git-helper.js\`
**Change:** add exec call.

**Find:**
\`\`\`js
// placeholder
\`\`\`

**Replace with:**
\`\`\`js
const { spawn } = require('child_process');
spawn('git', ['status']);
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_RISK_CONTENT_FETCH = `# Handoff: Pull remote config

## Summary
Fetch config from a remote URL.

## Files to modify
### \`src/config-loader.js\`
**Change:** add network fetch.

**Find:**
\`\`\`js
const config = {};
\`\`\`

**Replace with:**
\`\`\`js
const resp = await fetch('https://api.example.com/config');
const config = await resp.json();
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_RISK_CONTENT_SECRET = `# Handoff: Read token from env

## Summary
Wire up environment-based auth token.

## Files to modify
### \`src/auth.js\`
**Change:** read token.

**Find:**
\`\`\`js
const token = null;
\`\`\`

**Replace with:**
\`\`\`js
const token = process.env.OAUTH_SECRET;
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

const HANDOFF_FS_WRITE_IN_PIPELINE_OK = `# Handoff: Pipeline state write

## Summary
Persist a progress marker to the pipeline state dir.

## Files to modify
### \`src/progress.js\`
**Change:** write marker to pipeline dir only.

**Find:**
\`\`\`js
// placeholder
\`\`\`

**Replace with:**
\`\`\`js
fs.writeFileSync('.pipeline/progress.json', JSON.stringify(state));
\`\`\`

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
`;

// ---------------------------------------------------------------------------
// Core acceptance cases required by the slice brief
// ---------------------------------------------------------------------------

test('LEAN: clean verification + no blockers + non-risk diff -> reviewers skipped', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_CLEAN_NON_RISK });
  assert.equal(r.skipReviewers, true);
  assert.deepEqual(r.reasons, ['verification-clean', 'no-blockers', 'no-risk-surface-match']);
  assert.deepEqual(r.triggeredRules, []);
});

test('LEAN: risk-surface path (hook script) -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_RISK_PATH_HOOK });
  assert.equal(r.skipReviewers, false);
  assert.deepEqual(r.reasons, ['risk-surface-match']);
  assert.ok(r.triggeredRules.some((t) => t.rule === 'hook-script'));
});

test('LEAN: risk-surface path (mcp tool) -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_RISK_PATH_MCP });
  assert.equal(r.skipReviewers, false);
  assert.ok(r.triggeredRules.some((t) => t.rule === 'mcp-tool'));
});

test('LEAN: blockers present -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_BLOCKERS_PRESENT });
  assert.equal(r.skipReviewers, false);
  assert.deepEqual(r.reasons, ['blockers-present']);
});

test('LEAN: Blockers heading present but no bullets -> still eligible to skip', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_BLOCKERS_SECTION_EMPTY });
  assert.equal(r.skipReviewers, true);
});

test('LEAN: explicit force-review -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_CLEAN_NON_RISK, forceReview: true });
  assert.equal(r.skipReviewers, false);
  assert.deepEqual(r.reasons, ['force-review-requested']);
});

test('LEAN: verification body not "pre-flight clean" -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_VERIFICATION_NOT_CLEAN });
  assert.equal(r.skipReviewers, false);
  assert.deepEqual(r.reasons, ['verification-not-clean']);
});

test('LEAN: verification section missing -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_VERIFICATION_MISSING });
  assert.equal(r.skipReviewers, false);
  assert.deepEqual(r.reasons, ['verification-section-missing']);
});

test('LEAN: shell spawn in code content -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_RISK_CONTENT_SHELL });
  assert.equal(r.skipReviewers, false);
  assert.ok(r.triggeredRules.some((t) => t.rule === 'shell-spawn'));
});

test('LEAN: fetch / network boundary in code content -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_RISK_CONTENT_FETCH });
  assert.equal(r.skipReviewers, false);
  assert.ok(r.triggeredRules.some((t) => t.rule === 'network-boundary'));
});

test('LEAN: secret/token env var in code content -> reviewers dispatched', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_RISK_CONTENT_SECRET });
  assert.equal(r.skipReviewers, false);
  assert.ok(r.triggeredRules.some((t) => t.rule === 'auth-crypto-secrets'));
});

test('LEAN: fs write confined to .pipeline/ is not a risk match', () => {
  const r = classifyHandoff({ handoffContent: HANDOFF_FS_WRITE_IN_PIPELINE_OK });
  assert.equal(r.skipReviewers, true);
});

test('LEAN: empty or invalid handoff content -> reviewers dispatched', () => {
  const r1 = classifyHandoff({ handoffContent: '' });
  assert.equal(r1.skipReviewers, false);
  assert.deepEqual(r1.reasons, ['handoff-empty-or-invalid']);

  const r2 = classifyHandoff({ handoffContent: null });
  assert.equal(r2.skipReviewers, false);
  assert.deepEqual(r2.reasons, ['handoff-empty-or-invalid']);
});
