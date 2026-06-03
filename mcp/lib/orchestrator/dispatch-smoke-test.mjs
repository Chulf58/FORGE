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

// ── Shared harness ──────────────────────────────────────────────────────────
// Mirror the real worker: a throwaway workDir + FORGE_WORKER_SESSION=1 so the
// plugin's SessionStart hooks stay silent in the dispatched agent.
async function withRealDispatch(fn) {
  const { dispatchAgent } = await import('./agent-dispatch.mjs');
  const buildMcpServer = (await import('../../forge-worker-mcp.mjs')).default;
  const wt = mkdtempSync(join(tmpdir(), 'forge-dispatch-smoke-'));
  mkdirSync(join(wt, 'docs', 'context'), { recursive: true });
  mkdirSync(join(wt, '.pipeline', 'context'), { recursive: true });
  const prevWorkerSession = process.env.FORGE_WORKER_SESSION;
  process.env.FORGE_WORKER_SESSION = '1';
  try {
    return await fn({ wt, dispatchAgent, buildMcpServer });
  } finally {
    if (prevWorkerSession === undefined) delete process.env.FORGE_WORKER_SESSION;
    else process.env.FORGE_WORKER_SESSION = prevWorkerSession;
    rmSync(wt, { recursive: true, force: true });
  }
}

// R3 (greenfield): a purely-additive task reads no existing files but identifies new
// files to create. The fix (agent-dispatch.mjs) makes that a VALID scout (degenerate =
// neither files_to_read NOR new_files). This is the live confirmation of soak r-1dc3d1fb:
// a greenfield scout must classify 'completed', not 'uncertain' (which fired the G8 block).
test('SMOKE: greenfield coder-scout (new files only) classifies completed, not uncertain (R3)', { skip: SKIP, timeout: 300000 }, async () => {
  await withRealDispatch(async ({ wt, dispatchAgent, buildMcpServer }) => {
    const promptLines = [
      'You are the coder-scout agent.',
      'WorkDir: ' + wt,
      'RunId: r-smoke-r3',
      'Feature: greenfield clampInt helper',
      '',
      'Active tasks from PLAN.md (these files DO NOT exist yet — they are to be created):',
      '- [ ] 1. Write a failing test for clampInt (`scripts/probe-clamp-test.mjs`) (wave: 1)',
      '- [ ] 2. Implement the pure clampInt helper (`scripts/probe-clamp.mjs`) (wave: 2)',
    ];
    const result = await dispatchAgent({
      agentType: 'coder-scout', promptLines, workDir: wt,
      pluginRoot: PLUGIN_ROOT, systemPromptPath: '', buildMcpServer,
    });
    const scoutPath = join(wt, 'docs', 'context', 'scout.json');
    assert.ok(existsSync(scoutPath), 'coder-scout must WRITE scout.json. outcome=' + JSON.stringify(result));
    const parsed = JSON.parse(readFileSync(scoutPath, 'utf8'));
    const newFiles = Array.isArray(parsed.new_files) ? parsed.new_files : [];
    assert.ok(newFiles.length > 0, 'a greenfield scout must populate new_files; got ' + JSON.stringify(parsed.new_files));
    assert.equal(
      result.outcome, 'completed',
      'R3: a greenfield scout (new_files populated, files_to_read possibly empty) must be ' +
      '"completed" — the pre-fix code marked it "uncertain" and tripped the G8 block ' +
      '(soak r-1dc3d1fb). got "' + result.outcome + '"' + (result.reason ? ' — ' + result.reason : ''),
    );
  });
});

// G7: test-author writes .pipeline/context/test-author-output.json. The expectedArtifact
// mapping makes its outcome REAL (mtime-verified) instead of always-uncertain-and-discarded.
// Live confirmation that test-author dispatches and its outcome classifies 'completed'.
test('SMOKE: real test-author dispatch writes test-author-output.json → completed (G7)', { skip: SKIP, timeout: 300000 }, async () => {
  await withRealDispatch(async ({ wt, dispatchAgent, buildMcpServer }) => {
    const promptLines = [
      'You are the test-author agent.',
      'WorkDir: ' + wt,
      'RunId: r-smoke-g7',
      'Feature: clampInt helper',
      '',
      'Write the red-bar test for this task (the implementation does NOT exist yet — the test',
      'must fail/error, which is the expected red bar):',
      '- [ ] 1. Write a failing test for clampInt at `scripts/probe-clamp-test.mjs` asserting',
      '  clampInt(5,0,10)===5, clampInt(-3,0,10)===0, clampInt(99,0,10)===10 — importing the',
      '  not-yet-existent `scripts/probe-clamp.mjs`.',
    ];
    const result = await dispatchAgent({
      agentType: 'test-author', promptLines, workDir: wt,
      pluginRoot: PLUGIN_ROOT, systemPromptPath: '', buildMcpServer,
    });
    const outPath = join(wt, '.pipeline', 'context', 'test-author-output.json');
    assert.ok(
      existsSync(outPath),
      'test-author must WRITE .pipeline/context/test-author-output.json (its expectedArtifact). ' +
      'outcome=' + JSON.stringify(result),
    );
    assert.equal(
      result.outcome, 'completed',
      'G7: test-author outcome must be mtime-verified "completed" (not the pre-fix always-' +
      '"uncertain"); got "' + result.outcome + '"' + (result.reason ? ' — ' + result.reason : ''),
    );
  });
});
