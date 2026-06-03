// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Soak r-053032de finding #6 (root cause of the coder miss): parsePlanContent extracted
// only the task TITLE line + Verify:/AC-N: lines — it DROPPED the task's `Intent:` line.
// In PLAN.md Task 2 the "emit via additionalContext" requirement lived ONLY in Intent
// (the ACs check the warning STRING, not the channel), so the coder never received it,
// emitted via stderr instead, and reviewer-boundary correctly BLOCKED. The Intent prose
// is the HOW an implementer needs; it must reach the coder (and coder-scout) prompt.
//
// Run: node --test mcp/lib/orchestrator/implement-stage-intent-extraction-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

const INTENT_MARKER = 'emit via the additionalContext channel INTENT-MARKER-6';

const PLAN = `## Active Plan

### Feature: SessionStart cache-drift guard

#### Phase 1 — implement

- [ ] 1. Implement the SessionStart hook (hooks/x.js) (wave: 1)
  Depends: none
  Intent: ${INTENT_MARKER} — mirror hooks/ctx-session-start.js:130-138; do NOT use stderr.
  Verify: AC-1: WHEN node x is run THEN it exits 0; oracle: node x; observable: exit 0.
`;

function makeDeps(calls) {
  const run = {
    runId: 'r-test',
    status: 'running',
    feature: 'SessionStart cache-drift guard',
    orchestratorState: {},
  };
  return {
    dispatch: async (agentType, promptLines) => {
      calls.push({ agentType, prompt: promptLines.join('\n') });
      return { exitCode: 0, stdout: '{}', stderr: '' };
    },
    readRunJson: async () => ({ ...run }),
    writeRunJson: async () => {},
    writeGateFile: async () => {},
    clearReviewerOutput: async () => {},
    readReviewerOutput: async () => ({ verdict: 'APPROVED' }),
    spawnScript: async () => ({ stdout: '{"reviewers":[]}', exitCode: 0 }),
    buildInjectedKnowledge: () => '',
    readPlanMd: () => PLAN,
    commitWorktree: async () => ({ committed: true, sha: 'abc123' }),
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
}

test('soak #6: the task Intent (the HOW) reaches the coder prompt, not just title + ACs', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/work/dir');
  const coder = calls.find((c) => c.agentType === 'coder');
  assert.ok(coder, 'coder was dispatched');
  assert.match(
    coder.prompt,
    /INTENT-MARKER-6/,
    'coder prompt must carry the task Intent — the additionalContext requirement lived ONLY there',
  );
});

test('soak #6: the Intent also reaches coder-scout (it maps files from the HOW)', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/work/dir');
  const scout = calls.find((c) => c.agentType === 'coder-scout');
  assert.ok(scout, 'coder-scout was dispatched');
  assert.match(scout.prompt, /INTENT-MARKER-6/, 'coder-scout prompt must carry the task Intent');
});

test('soak #6: Verify:/AC- lines are still carried (no regression to existing extraction)', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/work/dir');
  const coder = calls.find((c) => c.agentType === 'coder');
  assert.match(coder.prompt, /AC-1: WHEN node x is run/, 'Verify/AC extraction must remain intact');
});
