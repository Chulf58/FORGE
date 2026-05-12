#!/usr/bin/env node
// Unit tests for proactive interrupt logic — Phase 1 (TDD red bar).
// Tests target mcp/lib/proactive-interrupt.mjs which does NOT yet exist.
// All tests must FAIL until the implementation is written.
//
// AC-1: threshold calculation fires at the correct consumed fraction,
//       checkpoint.md is written before stream.interrupt() is called,
//       run-active.json entry has outcome:'checkpoint' after stamp.
//
// AC-2: two proactive interrupt+resume cycles increment cap counter to 2;
//       a third call stamps outcome:'context-exhausted' and does NOT push
//       a resume message to the channel.
//
// Run: node --test mcp/forge-worker-interrupt-test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// The module under test — does not exist yet; will trigger MODULE_NOT_FOUND.
// ---------------------------------------------------------------------------
import {
  evaluateBudget,
  proactiveInterruptStep,
} from './lib/proactive-interrupt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal tempdir with a .pipeline/runs/<runId>/ subtree. */
function makeWorkDir(runId, agents) {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-proactive-interrupt-test-'));
  const runDir = join(tmp, '.pipeline', 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  // Also create docs/context/ so checkpoint.md can be written there.
  mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
  writeFileSync(
    join(runDir, 'run-active.json'),
    JSON.stringify({ runId, agents }, null, 2),
    'utf8',
  );
  return tmp;
}

function readRunActive(workDir, runId) {
  return JSON.parse(
    readFileSync(join(workDir, '.pipeline', 'runs', runId, 'run-active.json'), 'utf8'),
  );
}

// ---------------------------------------------------------------------------
// AC-1 Tests
// ---------------------------------------------------------------------------

test('AC-1a: evaluateBudget returns interrupt:false below threshold', () => {
  // 0.84 * usable where usable = 200000 * 0.835 = 167000
  // total = 0.84 * 167000 = 140280  → consumedFraction ≈ 0.84 which is below 0.85
  const usable = 200_000 * 0.835;
  const total = Math.floor(0.84 * usable);
  const result = evaluateBudget(
    { input_tokens: total, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { window: 200_000, autocompactFactor: 0.835, interruptThreshold: 0.85 },
  );
  assert.equal(result.interrupt, false, 'should not interrupt below threshold');
  assert.ok(result.consumedFraction < 0.85, 'consumedFraction should be below threshold');
});

test('AC-1a: evaluateBudget returns interrupt:true at or above threshold', () => {
  // total = 0.86 * 167000 = 143620 → consumedFraction ≈ 0.86 which is ≥ 0.85
  const usable = 200_000 * 0.835;
  const total = Math.ceil(0.86 * usable);
  const result = evaluateBudget(
    { input_tokens: total, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { window: 200_000, autocompactFactor: 0.835, interruptThreshold: 0.85 },
  );
  assert.equal(result.interrupt, true, 'should interrupt at or above threshold');
  assert.ok(result.consumedFraction >= 0.85, 'consumedFraction should be at or above threshold');
});

test('AC-1a: evaluateBudget splits token types correctly (cache_creation + cache_read counted)', () => {
  const usable = 200_000 * 0.835;
  // Spread across all three token fields so total is above threshold.
  const third = Math.ceil(0.86 * usable / 3);
  const result = evaluateBudget(
    {
      input_tokens: third,
      cache_creation_input_tokens: third,
      cache_read_input_tokens: third,
    },
    { window: 200_000, autocompactFactor: 0.835, interruptThreshold: 0.85 },
  );
  assert.equal(result.interrupt, true, 'all three token fields contribute to total');
});

test('AC-1a: evaluateBudget returns interrupt:false when total is 0', () => {
  const result = evaluateBudget(
    { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { window: 200_000, autocompactFactor: 0.835, interruptThreshold: 0.85 },
  );
  assert.equal(result.interrupt, false, 'zero usage must never trigger interrupt');
});

test('AC-1b+c: proactiveInterruptStep writes checkpoint.md before calling stream.interrupt and stamps outcome:checkpoint', async () => {
  const runId = 'r-ac1bc';
  const agentId = 'ag-001';
  const agentType = 'forge:coder';
  const normType = 'coder';

  const workDir = makeWorkDir(runId, [
    { agent_id: agentId, agent_type: agentType, startedAt: Date.now(), completedAt: null, outcome: null },
  ]);

  try {
    // Track call ordering.
    const callLog = [];
    let checkpointWrittenBeforeInterrupt = false;

    const fakeStream = {
      interrupt: async () => {
        // At the moment interrupt() fires, checkpoint.md must already exist.
        const cpPath = join(workDir, 'docs', 'context', 'checkpoint.md');
        if (existsSync(cpPath)) {
          checkpointWrittenBeforeInterrupt = true;
        }
        callLog.push('interrupt');
      },
    };

    const channel = [];
    const counters = new Map();

    const result = await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap: 2,
    });

    // AC-1b: checkpoint.md written before interrupt()
    assert.ok(
      checkpointWrittenBeforeInterrupt,
      'checkpoint.md must exist on disk before stream.interrupt() is called',
    );

    // Verify interrupt() was actually called.
    assert.ok(callLog.includes('interrupt'), 'stream.interrupt() must be called');

    // AC-1c: run-active.json entry has outcome:'checkpoint'
    const data = readRunActive(workDir, runId);
    const agent = data.agents.find((a) => a.agent_id === agentId);
    assert.ok(agent, 'agent entry must still exist in run-active.json');
    assert.equal(agent.outcome, 'checkpoint', "agent outcome must be 'checkpoint' after stamp");

    // Resume message pushed to channel for first interrupt.
    assert.ok(
      channel.length > 0,
      'resume message should be pushed to channel on first proactive interrupt',
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-2 Tests
// ---------------------------------------------------------------------------

test('AC-2: two proactive interrupt cycles increment cap counter to 2; third stamps context-exhausted and does not push resume', async () => {
  const runId = 'r-ac2';
  const agentId = 'ag-002';
  const agentType = 'forge:coder';
  const normType = 'coder';
  const cap = 2;

  const workDir = makeWorkDir(runId, [
    { agent_id: agentId, agent_type: agentType, startedAt: Date.now(), completedAt: null, outcome: null },
  ]);

  try {
    const fakeStream = { interrupt: async () => {} };
    const channel = [];
    const counters = new Map();

    // --- First proactive interrupt ---
    await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap,
    });

    assert.equal(counters.get(normType), 1, 'counter should be 1 after first interrupt');
    const channelLengthAfterFirst = channel.length;
    assert.ok(channelLengthAfterFirst > 0, 'resume message pushed after first interrupt');

    // Reset agent outcome so second call is not blocked by an existing terminal outcome.
    // (The implementation is expected to update run-active.json; we reset for the test.)
    {
      const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');
      const data = JSON.parse(readFileSync(runActivePath, 'utf8'));
      data.agents[0].outcome = null;
      writeFileSync(runActivePath, JSON.stringify(data, null, 2), 'utf8');
    }

    // --- Second proactive interrupt ---
    await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap,
    });

    assert.equal(counters.get(normType), 2, 'counter should be 2 after second interrupt');
    assert.ok(channel.length > channelLengthAfterFirst, 'resume message pushed after second interrupt');

    // Reset agent outcome again for the third call.
    {
      const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');
      const data = JSON.parse(readFileSync(runActivePath, 'utf8'));
      data.agents[0].outcome = null;
      writeFileSync(runActivePath, JSON.stringify(data, null, 2), 'utf8');
    }

    // --- Third proactive interrupt — cap hit ---
    const channelLengthBefore = channel.length;

    await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap,
    });

    // Counter must NOT exceed cap (stays at 2, not incremented to 3).
    assert.equal(
      counters.get(normType),
      2,
      'counter must not exceed cap after cap-hit call',
    );

    // No new resume message pushed.
    assert.equal(
      channel.length,
      channelLengthBefore,
      'no resume message should be pushed when cap is exhausted',
    );

    // run-active.json entry stamped with context-exhausted.
    const data = readRunActive(workDir, runId);
    const agent = data.agents.find((a) => a.agent_id === agentId);
    assert.ok(agent, 'agent entry must exist');
    assert.equal(
      agent.outcome,
      'context-exhausted',
      "agent outcome must be 'context-exhausted' when cap is exhausted",
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('AC-2: proactive interrupts use the same cap counter normalization as reactive checkpoints (forge: prefix stripped)', async () => {
  // Both 'forge:coder' and 'coder' should map to the same counter entry.
  const runId = 'r-ac2-norm';
  const agentId = 'ag-003';
  const cap = 2;

  const workDir = makeWorkDir(runId, [
    { agent_id: agentId, agent_type: 'forge:coder', startedAt: Date.now(), completedAt: null, outcome: null },
  ]);

  try {
    const fakeStream = { interrupt: async () => {} };
    const channel = [];
    // Pre-populate counter as if a reactive checkpoint already consumed one slot
    // under the normalized key 'coder'.
    const counters = new Map([['coder', 1]]);

    // One proactive interrupt for 'forge:coder' (normType = 'coder') should hit counter=2.
    await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType: 'coder' },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap,
    });

    assert.equal(
      counters.get('coder'),
      2,
      'proactive interrupt should share the same counter key as reactive checkpoints',
    );

    // Now the cap is exhausted — next call should yield context-exhausted.
    {
      const runActivePath = join(workDir, '.pipeline', 'runs', runId, 'run-active.json');
      const data = JSON.parse(readFileSync(runActivePath, 'utf8'));
      data.agents[0].outcome = null;
      writeFileSync(runActivePath, JSON.stringify(data, null, 2), 'utf8');
    }

    const channelBefore = channel.length;
    await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType: 'coder' },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap,
    });

    assert.equal(channel.length, channelBefore, 'no resume pushed when shared cap exhausted');
    const data = readRunActive(workDir, runId);
    assert.equal(data.agents[0].outcome, 'context-exhausted', 'outcome must be context-exhausted');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AC-7 — End-to-end smoke (TDD wave 3): evaluateBudget at artificially low
// threshold fires immediately and proactiveInterruptStep produces all four
// expected artefacts (checkpoint.md, outcome stamp, resume message, sidecar).
// ---------------------------------------------------------------------------

test('AC-7 smoke: artificially low threshold (0.01) fires evaluateBudget, and proactiveInterruptStep produces checkpoint.md, outcome:checkpoint, and [resume-from-checkpoint] message', async () => {
  // 1. evaluateBudget with threshold 0.01 fires immediately on small non-zero usage
  //    once the consumedFraction crosses 0.01 (≥ ~1670 tokens against the 167000-token
  //    usable window).
  const dec = evaluateBudget(
    { input_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    { window: 200_000, autocompactFactor: 0.835, interruptThreshold: 0.01 },
  );
  assert.equal(dec.interrupt, true, 'low-threshold evaluateBudget must fire on small usage above 1670 tokens');

  // 2. proactiveInterruptStep produces the full E2E artefacts.
  const runId = 'r-ac7-smoke';
  const agentId = 'ag-007';
  const normType = 'researcher';
  const workDir = makeWorkDir(runId, [
    { agent_id: agentId, agent_type: 'forge:researcher', startedAt: Date.now(), completedAt: null, outcome: null },
  ]);

  try {
    const fakeStream = { interrupt: async () => {} };
    const channel = [];
    const counters = new Map();
    const lastText = 'Partial researcher output: investigating SDK interrupt semantics — last paragraph before truncation.';

    const result = await proactiveInterruptStep({
      directive: { interrupt: true, agentId, normType },
      runId,
      workDir,
      stream: fakeStream,
      channel,
      counters,
      cap: 2,
      lastAssistantText: lastText,
    });

    assert.equal(result.capped, false, 'first proactive interrupt should not be capped');

    // checkpoint.md exists and contains the last assistant text + auto-interrupt note.
    const cpPath = join(workDir, 'docs', 'context', 'checkpoint.md');
    assert.ok(existsSync(cpPath), 'checkpoint.md must exist after proactiveInterruptStep');
    const cpBody = readFileSync(cpPath, 'utf8');
    assert.ok(cpBody.includes('Partial researcher output'), 'checkpoint.md should contain last assistant text');
    assert.ok(cpBody.includes('auto-interrupted'), 'checkpoint.md should contain auto-interrupt note');

    // run-active.json outcome stamp.
    const active = readRunActive(workDir, runId);
    assert.equal(active.agents[0].outcome, 'checkpoint', 'agent outcome must be stamped to checkpoint');

    // Resume message in channel.
    assert.equal(channel.length, 1, 'exactly one resume message should be pushed');
    const msg = channel[0];
    assert.equal(msg.type, 'user', 'resume message envelope shape: type=user');
    assert.equal(msg.parent_tool_use_id, null, 'parent_tool_use_id=null');
    assert.ok(msg.message.content.startsWith('[resume-from-checkpoint]'),
      'resume message body must begin with [resume-from-checkpoint]');
    assert.ok(msg.message.content.includes(normType),
      'resume message should reference the agent normType for re-dispatch');

    // Counter incremented.
    assert.equal(counters.get(normType), 1, 'counter incremented for proactive interrupt');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
