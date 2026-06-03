#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// R1→R2→R3 end-to-end recovery proof (deterministic, offline). Drives the REAL
// dispatchAgent with an injected fault-injecting `query` (a test seam — production
// uses the real SDK) so a forced stream abort actually flows through drainStream (R1)
// → runWithRetry (R2) → a recovered second attempt → validateArtifactContent (R3) →
// classifyOutcome 'completed'. This exercises dispatchAgent's real composition rather
// than re-implementing it in the test (the "tests pass on broken dispatch" trap).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'agent-dispatch.mjs'), 'utf-8');

// ── Test-seam wiring (structural) ─────────────────────────────────────────
test('dispatchAgent accepts an injectable query, defaulting to the real SDK', () => {
  assert.match(SRC, /query:\s*injectedQuery/, 'dispatchAgent must destructure an injectable query');
  assert.match(SRC, /injectedQuery\s*\|\|/, 'must fall back to the real SDK query when not injected');
});

test('dispatchAgent threads retryOptions into runWithRetry', () => {
  assert.match(SRC, /runWithRetry\(attemptDispatch, retryOptions\)/, 'must pass retryOptions to runWithRetry');
});

// ── Fault-injection recovery (behavioral, drives the REAL dispatchAgent) ───
import { dispatchAgent } from './agent-dispatch.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(here, '..', '..', '..'); // pluginRoot: where agents/coder-scout.md lives

// A fault-injecting `query`: each call (= one dispatch attempt) follows the next entry
// in `plan`. An entry may write a scout.json to the worktree before yielding its SDK
// `result` event. Mirrors the SDK contract (query(params) → async iterable of messages).
function faultInjectingQuery(workDir, plan) {
  const calls = { count: 0 };
  const fn = () => {
    const behavior = plan[Math.min(calls.count, plan.length - 1)];
    calls.count++;
    return (async function* () {
      if (behavior.write !== undefined) {
        const dir = join(workDir, 'docs', 'context');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'scout.json'), JSON.stringify(behavior.write));
      }
      yield behavior.result;
    })();
  };
  return { fn, calls };
}

const ERR_RESULT = { type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' };
const OK_RESULT = { type: 'result', subtype: 'success', is_error: false };
const NOOP_RETRY = { sleep: async () => {}, delayFn: () => 0 };

function withWorktree(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-recovery-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runScout(workDir, query) {
  return dispatchAgent({
    agentType: 'coder-scout',
    promptLines: ['scope: deterministic recovery test', 'map the files'],
    workDir,
    pluginRoot: REPO_ROOT,
    systemPromptPath: '',
    buildMcpServer: () => ({}),
    query,
    retryOptions: NOOP_RETRY,
  });
}

test('R1→R2→R3: a stream abort on attempt 1, then a valid write on attempt 2 → completed', async () => {
  await withWorktree(async (workDir) => {
    const { fn, calls } = faultInjectingQuery(workDir, [
      { result: ERR_RESULT },                                   // attempt 1: abort, no artifact
      { write: { files_to_read: ['src/a.ts'] }, result: OK_RESULT }, // attempt 2: valid scout.json
    ]);
    const r = await runScout(workDir, fn);
    assert.equal(calls.count, 2, 'must retry exactly once');
    assert.equal(r.outcome, 'completed', 'a recovered valid artifact on attempt 2 → completed');
    assert.equal(r.attempts, 2);
  });
});

test('R2 cap: a stream abort on BOTH attempts → uncertain (retryable), stops at 2', async () => {
  await withWorktree(async (workDir) => {
    const { fn, calls } = faultInjectingQuery(workDir, [{ result: ERR_RESULT }, { result: ERR_RESULT }]);
    const r = await runScout(workDir, fn);
    assert.equal(calls.count, 2, 'must not exceed maxAttempts=2');
    assert.equal(r.outcome, 'uncertain');
    assert.match(r.reason, /dispatch error/);
    assert.equal(r.attempts, 2);
  });
});

test('R3 non-retryable: a clean stream but DEGENERATE artifact → uncertain, NO retry', async () => {
  await withWorktree(async (workDir) => {
    // No stream error; scout.json written but files_to_read:[] (agent had no real task).
    const { fn, calls } = faultInjectingQuery(workDir, [{ write: { files_to_read: [] }, result: OK_RESULT }]);
    const r = await runScout(workDir, fn);
    assert.equal(calls.count, 1, 'a completed-but-degenerate run must NOT retry');
    assert.equal(r.outcome, 'uncertain');
    assert.match(r.reason, /content invalid/);
    assert.equal(r.attempts, 1);
  });
});
