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
// Also: bypassPermissions requires allowDangerouslySkipPermissions: true
// (sdk.d.ts:1456).

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

test('bypassPermissions is set AND its required allowDangerouslySkipPermissions flag', () => {
  const o = sample().options;
  assert.equal(o.permissionMode, 'bypassPermissions');
  assert.equal(
    o.allowDangerouslySkipPermissions,
    true,
    'SDK requires allowDangerouslySkipPermissions:true for bypassPermissions (sdk.d.ts:1456)',
  );
});

test('model, systemPrompt, settingSources, cwd, mcpServers bind under options', () => {
  const o = sample().options;
  assert.equal(o.model, 'claude-haiku-4-5-20251001');
  assert.equal(o.systemPrompt, 'AGENT-SYSTEM-PROMPT');
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
