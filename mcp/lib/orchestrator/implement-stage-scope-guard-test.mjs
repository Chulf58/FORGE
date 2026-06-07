// @covers mcp/lib/orchestrator/implement-stage.mjs
//
// Soak r-15ef051e finding #2: reviewer-boundary CONFABULATED a different feature
// ("Feature 3 / tasks 11-13 / TODO 9a9d29b2") that it self-discovered from a STALE
// docs/context/git-diff.txt + handoff.md present in the worktree — even though its
// prompt carried the correct Feature + Active tasks. The documented fix (GENERAL.md
// stale-context gotcha) is to pass explicit scope AND instruct the agent NOT to
// self-discover the feature from in-worktree artifacts. This asserts every dispatched
// agent's prompt carries that scope guard.
//
// Run: node --test mcp/lib/orchestrator/implement-stage-scope-guard-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

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
    spawnScript: async () => ({ stdout: '{"reviewers":["reviewer-boundary"]}', exitCode: 0 }),
    buildInjectedKnowledge: () => '',
    readPlanMd: () => '## Active Plan\n### Feature: SessionStart cache-drift guard\n- [ ] 1. write the guard `hooks/cache-drift-guard-test.mjs` (red) then `hooks/cache-drift-guard.js`',
    commitWorktree: async () => ({ committed: true, sha: 'abc123' }),
    writeChangeSummary: async () => {},
    writeLog: () => {},
  };
}

test('soak #2: the reviewer prompt hard-scopes against stale self-discovery', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/proj/.worktrees/r-test');
  const rev = calls.find((c) => c.agentType === 'reviewer-boundary');
  assert.ok(rev, 'reviewer-boundary was dispatched');
  assert.match(rev.prompt, /stale/i, 'reviewer prompt must warn in-worktree artifacts may be stale');
  assert.match(rev.prompt, /trust the stated [Ff]eature/, 'must instruct to trust the stated Feature over self-discovered files');
});

test('soak #2: the coder prompt also carries the scope guard (any self-discovering agent)', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/proj/.worktrees/r-test');
  const coder = calls.find((c) => c.agentType === 'coder');
  assert.ok(coder, 'coder was dispatched');
  assert.match(coder.prompt, /stale/i, 'coder prompt must carry the same scope guard');
});

// a8de840b #1 — worktree-write-confinement: the orchestrator builders must explicitly
// tell agents to write ONLY under WorkDir and NEVER to the main project root (the skill
// path has this instruction and does not leak; the orchestrator relied only on cwd).
test('a8de840b #1: test-author prompt confines writes to the worktree (never main root)', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/proj/.worktrees/r-test');
  const ta = calls.find((c) => c.agentType === 'test-author');
  assert.ok(ta, 'test-author was dispatched');
  assert.match(ta.prompt, /main project root/i, 'must forbid writing to the main project root');
  assert.match(ta.prompt, /under (the )?WorkDir|absolute paths under/i, 'must instruct writes stay under WorkDir');
});

test('a8de840b #1: the coder prompt also carries the worktree-write-confinement instruction', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls), 'r-test', '/proj/.worktrees/r-test');
  const coder = calls.find((c) => c.agentType === 'coder');
  assert.match(coder.prompt, /main project root/i, 'coder prompt must forbid writing to main root');
});
