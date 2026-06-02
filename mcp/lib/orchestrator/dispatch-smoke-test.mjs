#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// REAL end-to-end dispatch smoke test (opt-in: set FORGE_SMOKE_DISPATCH=1).
//
// WHY THIS EXISTS: unit/mock tests verify the SHAPE of the dispatch call but
// cannot see whether the SDK actually honors it. Every integration bug this
// project hit — empty prompts, conductor-framing of dispatched agents, and the
// flat-options bug that left every Write/Edit permission-blocked — was invisible
// to mocks and surfaced ONLY on a live run (and was once even misread as success
// because the agent "ran for 3 minutes"). Duration, call-count, and
// file-existence are proxies; this test checks the actual written artifact and
// its content. It dispatches ONE real cheap agent (Haiku coder-scout) against a
// throwaway worktree and asserts it WROTE a non-empty scout.json.
//
// Skipped unless FORGE_SMOKE_DISPATCH=1 (it makes a real Anthropic API call and
// needs ambient Claude Code / API auth) — keep the default regression offline.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '../../../');

const SKIP = process.env.FORGE_SMOKE_DISPATCH !== '1'
  ? 'set FORGE_SMOKE_DISPATCH=1 to run (makes a real Anthropic API call)'
  : false;

test('SMOKE: real coder-scout dispatch writes a non-empty scout.json', { skip: SKIP, timeout: 300000 }, async () => {
  const { dispatchAgent } = await import('./agent-dispatch.mjs');
  const buildMcpServer = (await import('../../forge-worker-mcp.mjs')).default;

  // Throwaway worktree-like dir holding one real file the task references, so a
  // correct scout yields a NON-EMPTY files_to_read. (Degenerate empty output is
  // precisely the dispatch-broken signal we want to catch.)
  const wt = mkdtempSync(join(tmpdir(), 'forge-dispatch-smoke-'));
  mkdirSync(join(wt, 'hooks'), { recursive: true });
  mkdirSync(join(wt, 'docs', 'context'), { recursive: true });
  writeFileSync(join(wt, 'hooks', 'sample-hook.js'), '// sample hook\nmodule.exports = {};\n', 'utf8');

  // Mirror the real worker (forge-worker.mjs:481): mark the process as a worker
  // session so the plugin's SessionStart hooks (conductor-inject, forge-banner)
  // stay silent in the dispatched agent.
  const prevWorkerSession = process.env.FORGE_WORKER_SESSION;
  process.env.FORGE_WORKER_SESSION = '1';

  try {
    const promptLines = [
      'You are the coder-scout agent.',
      'WorkDir: ' + wt,
      'RunId: r-smoke0001',
      'Feature: dispatch smoke test',
      '',
      'Active tasks from PLAN.md:',
      '- [ ] 1. Add a guard clause to the sample hook (`hooks/sample-hook.js`) (wave: 1)',
    ];

    const result = await dispatchAgent({
      agentType: 'coder-scout',
      promptLines,
      workDir: wt,
      pluginRoot: PLUGIN_ROOT,
      systemPromptPath: '',
      buildMcpServer,
    });

    // Decisive assertions — REAL output, never a proxy:
    const scoutPath = join(wt, 'docs', 'context', 'scout.json');
    assert.ok(
      existsSync(scoutPath),
      'coder-scout must WRITE docs/context/scout.json — its absence means the dispatch ' +
        'options did not bind (Write permission-blocked / empty prompt / conductor framing). ' +
        'outcome=' + JSON.stringify(result),
    );
    const parsed = JSON.parse(readFileSync(scoutPath, 'utf8'));
    assert.ok(
      Array.isArray(parsed.files_to_read) && parsed.files_to_read.length > 0,
      'scout.json files_to_read must be a NON-EMPTY array (empty = degenerate no-task output); got: ' +
        JSON.stringify(parsed.files_to_read),
    );
    assert.equal(
      result.outcome,
      'completed',
      'dispatch outcome must be "completed" (artifact mtime-verified), got "' + result.outcome + '"' +
        (result && result.reason ? ' — ' + result.reason : ''),
    );
  } finally {
    if (prevWorkerSession === undefined) delete process.env.FORGE_WORKER_SESSION;
    else process.env.FORGE_WORKER_SESSION = prevWorkerSession;
    rmSync(wt, { recursive: true, force: true });
  }
});
