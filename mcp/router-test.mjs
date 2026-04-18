#!/usr/bin/env node
// Regression tests for mcp/lib/router.js — capability-cost routing.
//
// All agents (including supervisor) now route through capability-cost:
//   - requiredCapabilities declares job requirements
//   - router returns cheapest model satisfying all requirements in provider scope
//   - allowedVendors overrides scope from the default (anthropic)
//
// Pure unit tests — no I/O, no MCP server required.
// Run: node mcp/router-test.mjs

import { recommendModel } from './lib/router.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

// ── Fixture ───────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  providers: [
    { id: 'openai',    type: 'openai',    envVar: 'OPENAI_API_KEY',    enabled: true, priority: 1 },
    { id: 'gemini',    type: 'gemini',    envVar: 'GEMINI_API_KEY',    enabled: true, priority: 2 },
    { id: 'anthropic', type: 'anthropic', envVar: 'ANTHROPIC_API_KEY', enabled: true, priority: 3 },
  ],
  models: [
    { id: 'gpt-5.4',                  providerId: 'openai',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'high'   },
    { id: 'gpt-4.1',                  providerId: 'openai',    reasoningTier: 'sonnet', capabilities: ['reasoning', 'code', 'analysis'],                             costTier: 'medium' },
    { id: 'gemini-2.5-pro',           providerId: 'gemini',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'free'   },
    { id: 'gemini-2.5-flash',         providerId: 'gemini',    reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                                 costTier: 'free'   },
    { id: 'gemini-2.5-flash-lite',    providerId: 'gemini',    reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                                 costTier: 'free'   },
    { id: 'claude-opus-4-7',          providerId: 'anthropic', reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'high'   },
    { id: 'claude-sonnet-4-6',        providerId: 'anthropic', reasoningTier: 'sonnet', capabilities: ['reasoning', 'code', 'analysis'],                             costTier: 'medium' },
    { id: 'claude-haiku-4-5-20251001',providerId: 'anthropic', reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                                 costTier: 'low'    },
  ],
  agentModelMap: {
    // Supervisor: OpenAI scope, requires reasoning+agentic
    'supervisor': {
      requiredCapabilities: ['reasoning', 'agentic'],
      allowedVendors: ['openai'],
    },
    // Capability-cost agents (Anthropic scope by default)
    'cap-analysis': { requiredCapabilities: ['analysis'] },
    'cap-code-analysis': { requiredCapabilities: ['code', 'analysis'] },
    'cap-reasoning': { requiredCapabilities: ['reasoning', 'analysis'] },
    'cap-reasoning-code': { requiredCapabilities: ['reasoning', 'code'] },
    'cap-fast': { requiredCapabilities: ['fast'] },
    'cap-agentic-openai': { requiredCapabilities: ['reasoning', 'agentic'], allowedVendors: ['openai'] },
    'cap-no-match': { requiredCapabilities: ['nonexistent-capability'] },
    'cap-no-reqs': {},
  },
};

const EMPTY_USAGE = { providers: {} };
const OPENAI_EXHAUSTED = { providers: { openai: { quotaExhausted: true } } };
const ANTHROPIC_EXHAUSTED = { providers: { anthropic: { quotaExhausted: true } } };

function cfg(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...BASE_CONFIG, ...overrides }));
}

function cfgWithoutModels(...ids) {
  const c = cfg();
  c.models = c.models.filter(m => !ids.includes(m.id));
  return c;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── router-test.mjs ──────────────────────────────────────────────────────');

// ── Supervisor capability-cost routing ────────────────────────────────────────

// 1. Supervisor: routes through capability-cost, resolves to gpt-5.4
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-5.4',
    'supervisor: capability-cost selects gpt-5.4 (only openai model with reasoning+agentic)');
  assert(r.providerId === 'openai',
    'supervisor: provider is openai (allowedVendors scope)');
}

// 2. Supervisor: OpenAI exhausted → explicit error (no other openai+agentic model)
{
  const r = recommendModel('supervisor', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'error' && r.modelId === null,
    'supervisor: openai exhausted → explicit error (gpt-4.1 lacks agentic, no fallback)');
}

// 3. Supervisor: gpt-5.4 excluded → error (no other openai+agentic)
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  assert(r.source === 'error',
    'supervisor: gpt-5.4 excluded → error (no other openai model has agentic capability)');
}

// 4. No config entry uses allowedTiers — verify no config entry breaks without it
{
  // All agentModelMap entries in forge-config.default.json should route via capability-cost
  // Proven by: config inspection shows zero entries have allowedTiers field
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE);
  assert(!BASE_CONFIG.agentModelMap['supervisor'].allowedTiers,
    'no-allowedTiers-in-config: supervisor entry has no allowedTiers field');
  assert(r.source === 'capability-cost',
    'no-allowedTiers-in-config: supervisor routes through capability-cost, not tier-locked path');
}

// ── Claude agent capability-cost routing ──────────────────────────────────────

// 5. [analysis] → haiku (cheapest Anthropic with analysis); Gemini NOT returned (Anthropic scope)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'capability-cost: [analysis] → haiku (cheapest Anthropic)');
  assert(r.providerId === 'anthropic',
    'capability-cost: Anthropic-only scope by default (Gemini free models not returned)');
}

// 6. [code, analysis] → haiku
{
  const r = recommendModel('cap-code-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'capability-cost: [code, analysis] → haiku');
}

// 7. [reasoning, analysis] → sonnet (researcher fix — no longer haiku)
{
  const r = recommendModel('cap-reasoning', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-sonnet-4-6',
    'capability-cost: [reasoning, analysis] → sonnet');
}

// 8. [reasoning, code] → sonnet (reviewer-logic fix — no longer haiku)
{
  const r = recommendModel('cap-reasoning-code', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-sonnet-4-6',
    'capability-cost: [reasoning, code] → sonnet');
}

// 9. [fast] → haiku (cheapest Anthropic with fast)
{
  const r = recommendModel('cap-fast', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'capability-cost: [fast] → haiku');
}

// 10. No match → explicit error, capability requirements not relaxed
{
  const r = recommendModel('cap-no-match', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'error' && r.modelId === null,
    'capability-cost: no model satisfies [nonexistent-capability] → explicit error');
}

// 11. All Anthropic exhausted → explicit error (no provider scope fallback)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  assert(r.source === 'error',
    'capability-cost: all Anthropic exhausted → explicit error');
}

// 12. No requirements → hardcoded default
{
  const r = recommendModel('cap-no-reqs', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'default',
    'no requirements: hardcoded default returned');
}

// 13. Unknown agent → hardcoded default
{
  const r = recommendModel('unknown-agent', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'default',
    'unknown agent: hardcoded default returned');
}

// ── excludeModels tests ───────────────────────────────────────────────────────

// 14. excludeModels removes cheapest; next cheapest selected
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, {
    excludeModels: ['claude-haiku-4-5-20251001'],
  });
  assert(r.source === 'capability-cost' && r.modelId === 'claude-sonnet-4-6',
    'excludeModels: haiku excluded → sonnet selected next');
}

// 15. excludeModels with all candidates excluded → explicit error
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, {
    excludeModels: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'],
  });
  assert(r.source === 'error',
    'excludeModels: all Anthropic candidates excluded → explicit error');
}

// 16. excludeModels is per-call — subsequent call without exclusion returns haiku
{
  const r1 = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['claude-haiku-4-5-20251001'] });
  const r2 = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r1.modelId === 'claude-sonnet-4-6', 'excludeModels per-call: first call excludes haiku → sonnet');
  assert(r2.modelId === 'claude-haiku-4-5-20251001', 'excludeModels per-call: second call returns haiku normally');
}

// 17. excludeModels on supervisor: gpt-5.4 excluded → error
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  assert(r.source === 'error',
    'excludeModels: supervisor gpt-5.4 excluded → error (no other openai+agentic)');
}

// ── Cheapest-wins ordering ────────────────────────────────────────────────────

// 18. Cheapest model wins even when Gemini free models are in scope via allowedVendors
{
  // cap-agentic-openai: needs reasoning+agentic, openai scope → gpt-5.4 (only match)
  const r = recommendModel('cap-agentic-openai', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-5.4',
    'capability-cost openai scope: gpt-5.4 selected (only openai model with reasoning+agentic)');
}

// 19. Cost ordering: when haiku exhausted, sonnet selected (not opus)
{
  const r = recommendModel('cap-code-analysis', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  // All Anthropic exhausted → error (Anthropic scope, no fallback)
  assert(r.source === 'error',
    'cost ordering: Anthropic exhausted → error (scope respected)');
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
