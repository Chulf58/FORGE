#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// Regression: dispatchAgent built the SDK query() call with options FLAT at the
// top level instead of nested under `options`. The SDK signature is
// query({ prompt, options? }) (sdk.d.ts:2165), so every flat field (model,
// permissionMode, systemPrompt, settingSources, mcpServers, cwd, maxTurns) was
// silently ignored and the agent ran on SDK defaults. Most visibly: default
// permission mode → every Write/Edit blocked ("you haven't granted it yet"),
// so coder-scout (no Bash escape hatch) wrote no scout.json (run r-15662c22).
// Update (81b8f299): the dispatch now uses permissionMode:'default' + a canUseTool
// callback (NOT bypassPermissions) — bypass disabled the SDK's cwd write-confinement
// AND skipped canUseTool, letting a dispatched agent write to the main project root.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildQueryParams } from './agent-dispatch.mjs';

function sample(overrides = {}) {
  return buildQueryParams({
    prompt: 'PROMPT-TEXT',
    agentModel: 'claude-haiku-4-5-20251001',
    agentBody: 'AGENT-SYSTEM-PROMPT',
    workDir: '/wt/r-test',
    pluginRoot: '/plugin',
    buildMcpServer: (wd) => ({ __stub: wd }),
    agentMaxTurns: 20,
    ...overrides,
  });
}

test('query params nest everything under options — top-level is only prompt + options', () => {
  const p = sample();
  assert.deepEqual(Object.keys(p).sort(), ['options', 'prompt']);
  assert.equal(p.prompt, 'PROMPT-TEXT');
  for (const k of ['model', 'permissionMode', 'systemPrompt', 'settingSources', 'mcpServers', 'cwd', 'maxTurns']) {
    assert.equal(k in p, false, `top-level must NOT contain "${k}" — it belongs under options`);
  }
});

test('permission mode is "default" with a canUseTool confinement callback (NOT bypassPermissions — 81b8f299)', () => {
  const o = sample().options;
  assert.equal(
    o.permissionMode,
    'default',
    'must be "default" so the SDK invokes canUseTool — bypassPermissions skips it AND disables cwd write-confinement (81b8f299)',
  );
  assert.equal(
    'allowDangerouslySkipPermissions' in o,
    false,
    'allowDangerouslySkipPermissions must be ABSENT — it was only required for bypassPermissions, which we no longer use',
  );
  assert.equal(
    typeof o.canUseTool,
    'function',
    'canUseTool is the worktree write-confinement boundary — the only permission gate that fires for query() dispatches',
  );
});

test('model, systemPrompt, settingSources, cwd, mcpServers bind under options', () => {
  const o = sample().options;
  assert.equal(o.model, 'claude-haiku-4-5-20251001');
  // R4: systemPrompt = the agent body PLUS the appended idempotency contract.
  assert.ok(o.systemPrompt.startsWith('AGENT-SYSTEM-PROMPT'), 'agent body binds as the systemPrompt prefix');
  assert.match(o.systemPrompt, /idempotent/i, 'R4 idempotency contract is appended to systemPrompt');
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.cwd, '/wt/r-test');
  assert.ok(o.mcpServers && o.mcpServers['forge-pipeline'], 'forge-pipeline MCP server wired');
  assert.deepEqual(o.mcpServers['forge-pipeline'], { __stub: '/wt/r-test' });
});

test('plugins load the local plugin root under options', () => {
  const o = sample().options;
  assert.deepEqual(o.plugins, [{ type: 'local', path: '/plugin' }]);
});

test('maxTurns included when a positive integer, omitted otherwise', () => {
  assert.equal(sample({ agentMaxTurns: 20 }).options.maxTurns, 20);
  assert.equal('maxTurns' in sample({ agentMaxTurns: NaN }).options, false);
  assert.equal('maxTurns' in sample({ agentMaxTurns: 0 }).options, false);
});

// Bug #2 (r-aa25fa1c): when a test-author wave ran, the coder must write NO test files (the
// red bar is test-author's domain — coder.md:258). That rule was PROSE-only and sonnet ignored
// it (the coder created implement-stage-phase-status-test.mjs despite the [test-author-output:]
// signal). ctx-pre-tool.js does NOT fire for headless query() dispatches, so canUseTool — the only
// boundary that DOES fire — must enforce it structurally. denyTestCreation=true => deny Write/Edit
// to a *-test path; source writes still land; non-wave (denyTestCreation falsey) coders still author.
test('bug #2: canUseTool DENIES a wave-coder Write to a *-test file (denyTestCreation=true)', async () => {
  const o = sample({ denyTestCreation: true }).options;
  const v = await o.canUseTool('Write', { file_path: '/wt/r-test/mcp/lib/orchestrator/foo-test.mjs' });
  assert.equal(v.behavior, 'deny', 'a wave-coder must NOT create a test file — test-author owns the red bar');
});

test('bug #2: canUseTool DENIES a wave-coder Edit to an existing *-test file (denyTestCreation=true)', async () => {
  const o = sample({ denyTestCreation: true }).options;
  const v = await o.canUseTool('Edit', { file_path: '/wt/r-test/scripts/thing-test.mjs' });
  assert.equal(v.behavior, 'deny', 'a wave-coder must not modify test files either');
});

test('bug #2: canUseTool ALLOWS a wave-coder Write to a SOURCE file (only tests blocked when a wave ran)', async () => {
  const o = sample({ denyTestCreation: true }).options;
  const v = await o.canUseTool('Write', { file_path: '/wt/r-test/mcp/lib/orchestrator/foo.mjs' });
  assert.equal(v.behavior, 'allow', 'source writes must still land — making the red tests green is the coder job');
});

test('bug #2: canUseTool ALLOWS a *-test Write when NO wave ran (denyTestCreation falsey — coder authors its own)', async () => {
  const o = sample().options; // denyTestCreation defaults falsey
  const v = await o.canUseTool('Write', { file_path: '/wt/r-test/foo-test.mjs' });
  assert.equal(v.behavior, 'allow', 'with no test-author wave the coder writes its own tests — must be allowed');
});

// Bug #2 wiring: the canUseTool deny above only protects anything if dispatchAgent actually DERIVES
// denyTestCreation (agentType===coder AND the [test-author-output:] wave signal in the prompt) and
// threads it into buildQueryParams. Source-grep mirrors the runWithRetry(attemptDispatch) wiring test.
test('bug #2 (wiring): dispatchAgent derives denyTestCreation from coder+wave-signal and passes it to buildQueryParams', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'agent-dispatch.mjs'), 'utf-8');
  assert.match(src, /denyTestCreation\s*=\s*agentType === 'coder'[\s\S]{0,160}test-author-output/,
    'dispatchAgent must derive denyTestCreation from agentType===coder AND the [test-author-output:] signal');
  assert.match(src, /query\(buildQueryParams\(\{[\s\S]*?\bdenyTestCreation\b[\s\S]*?\}\)\)/,
    'denyTestCreation must be threaded into the buildQueryParams CALL — query(buildQueryParams({…})) — not just the signature');
});
