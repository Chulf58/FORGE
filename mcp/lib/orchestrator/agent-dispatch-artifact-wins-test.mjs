#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// artifact-wins-over-stream-error: a WRITER agent whose expected artifact is
// present + fresh (mtimeResult.ok) must be classified 'completed' even if the
// SDK stream errored afterwards. classifyOutcome previously checked the error
// path FIRST, so an intermittent late stream abort marked completed work
// 'uncertain' and blocked gate2 (run r-074b94ba: the coder wrote a full
// handoff.md, the stream aborted ~5s later → uncertain → covers-verify never
// ran). A landed artifact proves the work happened; covers-verify is the net
// that still catches a broken implementation afterwards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcome } from './agent-dispatch.mjs';

const PAT = /\[done\]/;

test('writer + fresh artifact + stream error → completed (artifact wins)', () => {
  const r = classifyOutcome({
    agentKind: 'writer',
    mtimeResult: { ok: true, reason: '' },
    streamText: '',
    completionPattern: PAT,
    error: new Error('aborted_streaming'),
  });
  assert.equal(r.outcome, 'completed', 'a landed artifact must win over a late stream abort');
});

test('writer + NO artifact + stream error → uncertain (nothing landed)', () => {
  const r = classifyOutcome({
    agentKind: 'writer',
    mtimeResult: { ok: false, reason: 'absent' },
    streamText: '',
    completionPattern: PAT,
    error: new Error('aborted_streaming'),
  });
  assert.equal(r.outcome, 'uncertain');
});

test('writer + fresh artifact + no error → completed (unchanged)', () => {
  const r = classifyOutcome({
    agentKind: 'writer', mtimeResult: { ok: true }, streamText: '', completionPattern: PAT, error: null,
  });
  assert.equal(r.outcome, 'completed');
});

test('writer + stale/absent artifact + no error → uncertain (unchanged)', () => {
  const r = classifyOutcome({
    agentKind: 'writer', mtimeResult: { ok: false, reason: 'stale' }, streamText: '', completionPattern: PAT, error: null,
  });
  assert.equal(r.outcome, 'uncertain');
});

test('readonly + stream error → uncertain (no artifact to trust)', () => {
  const r = classifyOutcome({
    agentKind: 'readonly', mtimeResult: null, streamText: '[done]', completionPattern: PAT, error: new Error('boom'),
  });
  assert.equal(r.outcome, 'uncertain', 'readonly keeps the error→uncertain path');
});
