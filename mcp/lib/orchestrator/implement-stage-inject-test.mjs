// @covers mcp/lib/orchestrator/implement-stage.mjs
// AC-13 (Gap-1 wiring): the implement orchestrator prepends task-relevant injected
// knowledge (from deps.buildInjectedKnowledge) to each dispatched agent's prompt.
//
// RED BAR until the orchestrator wires injection: the coder is currently dispatched
// with only its generic prompt lines, so the injected marker is absent.
//
// Run: node --test mcp/lib/orchestrator/implement-stage-inject-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runImplementStageOrchestrator } from './implement-stage.mjs';

const INJECT_MARKER = 'INJECT-MARKER-13';

/** Minimal deps that drive a clean APPROVED path (no reviewers), capturing dispatches. */
function makeDeps(calls, injected) {
  const run = {
    runId: 'r-test',
    status: 'running',
    feature: 'dispatch primitive rebuild',
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
    buildInjectedKnowledge: () => injected,
    writeLog: () => {},
  };
}

test('AC-13: injected knowledge from buildInjectedKnowledge is prepended to the dispatched coder prompt', async () => {
  const calls = [];
  const injected = `## Relevant project knowledge\n### Some gotcha\n${INJECT_MARKER}`;
  await runImplementStageOrchestrator(makeDeps(calls, injected), 'r-test', '/proj/.worktrees/r-test');

  const coderCall = calls.find((c) => c.agentType === 'coder');
  assert.ok(coderCall, 'coder was dispatched');
  assert.match(
    coderCall.prompt,
    new RegExp(INJECT_MARKER),
    'coder prompt must include injected knowledge returned by deps.buildInjectedKnowledge',
  );
});

test('AC-13: empty injection (no match) produces no stray injection artifact in the coder prompt', async () => {
  const calls = [];
  await runImplementStageOrchestrator(makeDeps(calls, ''), 'r-test', '/proj/.worktrees/r-test');

  const coderCall = calls.find((c) => c.agentType === 'coder');
  assert.ok(coderCall, 'coder was dispatched');
  assert.doesNotMatch(
    coderCall.prompt,
    /Relevant project knowledge/,
    'empty injection must not add a blank "Relevant project knowledge" header',
  );
});
