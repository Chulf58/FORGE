#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// R4 (research 2026-06-02, docs/RESEARCH/dispatcher-reliability-2026-06-02.md §R4):
// make the idempotent-retry contract explicit in dispatch prompts. R2 makes a retry
// HAPPEN (re-dispatch on a transient stream error); R4 makes it SAFE. A retry re-runs
// the agent from scratch in the same worktree, so a non-idempotent agent (one that
// appends/duplicates/incrementally extends a file it may already have written) would
// corrupt its own output on the second attempt. Every dispatched agent flows through
// buildQueryParams (the single seam), so the contract is appended to systemPrompt there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryParams, IDEMPOTENCY_CONTRACT } from './agent-dispatch.mjs';

test('IDEMPOTENCY_CONTRACT is a non-empty string naming the contract', () => {
  assert.equal(typeof IDEMPOTENCY_CONTRACT, 'string');
  assert.ok(IDEMPOTENCY_CONTRACT.trim().length > 0);
  assert.match(IDEMPOTENCY_CONTRACT, /retri/i, 'must say the dispatch may be retried');
  assert.match(IDEMPOTENCY_CONTRACT, /idempotent/i);
  assert.match(IDEMPOTENCY_CONTRACT, /rewrite the same files/i);
  assert.match(IDEMPOTENCY_CONTRACT, /append|duplicate/i, 'must forbid append/duplicate');
});

test('buildQueryParams appends the idempotency contract to the agent systemPrompt', () => {
  const agentBody = 'You are the coder. Implement the planned task.';
  const { options } = buildQueryParams({
    prompt: 'do the thing',
    agentModel: 'claude-opus-4-8',
    agentBody,
    workDir: '/w',
    pluginRoot: '/p',
    buildMcpServer: () => ({}),
    agentMaxTurns: 10,
  });
  // The agent's own body must be preserved...
  assert.ok(options.systemPrompt.includes(agentBody), 'agent body must be preserved');
  // ...AND the idempotency contract appended (so EVERY dispatched agent gets it).
  assert.ok(options.systemPrompt.includes(IDEMPOTENCY_CONTRACT), 'contract must be appended to systemPrompt');
  assert.match(options.systemPrompt, /rewrite the same files/i);
});

test('buildQueryParams still nests options correctly with the contract (R-prior regressions intact)', () => {
  const { prompt, options } = buildQueryParams({
    prompt: 'p', agentModel: 'm', agentBody: 'b', workDir: '/w', pluginRoot: '/p',
    buildMcpServer: () => ({}), agentMaxTurns: 5,
  });
  assert.equal(prompt, 'p');
  assert.equal(options.permissionMode, 'default');
  assert.equal(typeof options.canUseTool, 'function');
  assert.equal(options.cwd, '/w');
});
