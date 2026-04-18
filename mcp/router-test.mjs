#!/usr/bin/env node
// Regression tests for mcp/lib/router.js — capability-cost primary path + tier-locked fallback.
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
// Models include 'analysis' to match the real capability taxonomy.
// Anthropic haiku has ['code','analysis']; sonnet adds 'reasoning'; opus adds 'agentic'.

const BASE_CONFIG = {
  providers: [
    { id: 'openai',     type: 'openai',     envVar: 'OPENAI_API_KEY',    enabled: true,  priority: 1 },
    { id: 'gemini',     type: 'gemini',     envVar: 'GEMINI_API_KEY',    enabled: true,  priority: 2 },
    { id: 'anthropic',  type: 'anthropic',  envVar: 'ANTHROPIC_API_KEY', enabled: true,  priority: 3 },
  ],
  models: [
    { id: 'gpt-5.4',                  providerId: 'openai',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic'], costTier: 'high'   },
    { id: 'gpt-4.1',                  providerId: 'openai',    reasoningTier: 'sonnet', capabilities: ['reasoning', 'code', 'analysis'],             costTier: 'medium' },
    { id: 'gemini-2.5-pro',           providerId: 'gemini',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic'], costTier: 'free'   },
    { id: 'gemini-2.5-flash',         providerId: 'gemini',    reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                 costTier: 'free'   },
    { id: 'gemini-2.5-flash-lite',    providerId: 'gemini',    reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                 costTier: 'free'   },
    { id: 'claude-opus-4-7',          providerId: 'anthropic', reasoningTier: 'opus',   capabilities: ['reasoning', 'code', 'analysis', 'agentic'], costTier: 'high'   },
    { id: 'claude-sonnet-4-6',        providerId: 'anthropic', reasoningTier: 'sonnet', capabilities: ['reasoning', 'code', 'analysis'],             costTier: 'medium' },
    { id: 'claude-haiku-4-5-20251001',providerId: 'anthropic', reasoningTier: 'haiku',  capabilities: ['code', 'analysis', 'fast'],                 costTier: 'low'    },
  ],
  agentModelMap: {
    // Supervisor: tier-locked external dispatch (unchanged)
    'supervisor': {
      preferred: 'gpt-5.4',
      allowedTiers: ['opus'],
      allowedVendors: ['openai'],
    },
    // Legacy tier-based agents (backward compat tests)
    'haiku-reviewer': {
      preferred: 'claude-haiku-4-5-20251001',
      allowedTiers: ['haiku'],
      allowedVendors: ['anthropic'],
    },
    'bad-preferred': {
      preferred: 'claude-haiku-4-5-20251001',
      allowedTiers: ['opus', 'sonnet'],
      allowedVendors: ['anthropic'],
    },
    'tier-beats-priority': {
      preferred: 'nonexistent-model',
      fallback: 'also-nonexistent',
      allowedTiers: ['opus', 'sonnet'],
      allowedVendors: ['openai', 'gemini'],
    },
    'vendor-restricted': {
      allowedTiers: ['sonnet'],
      allowedVendors: ['anthropic'],
    },
    'no-candidates': {
      allowedTiers: ['haiku'],
      allowedVendors: ['openai'],
    },
    // Capability-cost agents (new primary path — no allowedTiers)
    'cap-analysis': {
      requiredCapabilities: ['analysis'],
    },
    'cap-code-analysis': {
      requiredCapabilities: ['code', 'analysis'],
    },
    'cap-reasoning': {
      requiredCapabilities: ['reasoning', 'analysis'],
    },
    'cap-reasoning-code': {
      requiredCapabilities: ['reasoning', 'code'],
    },
    'cap-external': {
      requiredCapabilities: ['reasoning', 'agentic'],
      allowedVendors: ['openai'],
    },
    'cap-no-match': {
      requiredCapabilities: ['nonexistent-capability'],
    },
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

// 1. Preferred accepted when its tier is in allowedTiers
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'preferred' && r.modelId === 'gpt-5.4',
    'preferred accepted when tier (opus) is in allowedTiers');
}

// 2. Preferred rejected with config error when its tier violates allowedTiers
{
  const r = recommendModel('bad-preferred', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'error' && r.reason.includes('Config error') && r.reason.includes('bad-preferred'),
    'preferred outside allowedTiers returns config error');
}

// 3. Supervisor: preferred exhausted and no fallback → error (openai+opus only, no other candidates)
{
  const r = recommendModel('supervisor', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'error',
    'supervisor: preferred provider exhausted, no fallback → explicit error (use excludeModels rerouting instead)');
}

// 4. allowedTiers catalog scan: supervisor with gpt-5.4 exhausted falls to scan → error (no other openai+opus)
{
  const r = recommendModel('supervisor', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'error',
    'supervisor: preferred exhausted → allowedTiers scan finds no other openai+opus → error');
}

// 5. Catalog scan: tier preference beats provider priority
// openai has priority:1 (higher) but only gpt-4.1 (sonnet) available (gpt-5.4 removed)
// gemini has priority:2 (lower) but gemini-2.5-pro (opus) is available
// allowedTiers: ['opus', 'sonnet'] → opus index 0 wins over sonnet index 1
{
  const c = cfgWithoutModels('gpt-5.4');
  const r = recommendModel('tier-beats-priority', c, EMPTY_USAGE);
  assert(r.modelId === 'gemini-2.5-pro',
    'catalog: opus-gemini beats sonnet-openai despite openai having higher provider priority');
}

// 6. Provider priority tiebreaking within same tier
// Remove all opus models; both openai (gpt-4.1, priority:1) and gemini (gemini-2.5-flash, priority:2) have sonnet
// openai priority:1 should win
{
  const c = cfgWithoutModels('gpt-5.4', 'gemini-2.5-pro', 'claude-opus-4-7');
  const r = recommendModel('tier-beats-priority', c, EMPTY_USAGE);
  assert(r.modelId === 'gpt-4.1',
    'catalog: provider priority tiebreaks within same tier — openai (1) beats gemini (2)');
}

// 7. allowedVendors restricts catalog to declared vendors only
{
  const r = recommendModel('vendor-restricted', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'catalog' && r.modelId === 'claude-sonnet-4-6',
    'allowedVendors: catalog restricted to anthropic sonnet');
}

// 8. No valid candidate within allowedTiers fails clearly (never escalates/degrades)
{
  const r = recommendModel('no-candidates', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'error' && r.reason.includes('No available model') && r.modelId === null,
    'no valid candidate within allowedTiers+allowedVendors returns clear error');
}

// 9. Haiku reviewer stays haiku — never promoted to sonnet/opus even when unavailable
{
  const r1 = recommendModel('haiku-reviewer', BASE_CONFIG, EMPTY_USAGE);
  assert(r1.source === 'preferred' && r1.modelId === 'claude-haiku-4-5-20251001',
    'haiku reviewer: preferred haiku returned');
  const r2 = recommendModel('haiku-reviewer', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  assert(r2.source === 'error',
    'haiku reviewer: fails clearly when haiku unavailable, never promoted to sonnet/opus');
}

// ── Capability-cost primary path tests ───────────────────────────────────────

// 10. ['analysis'] → haiku (cheapest Anthropic with analysis); Gemini NOT returned (Anthropic scope)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'capability-cost: [analysis] → haiku (cheapest Anthropic)');
  assert(r.providerId === 'anthropic',
    'capability-cost: Anthropic-only scope by default (Gemini free models not returned)');
}

// 11. ['code', 'analysis'] → haiku (cheapest Anthropic with both)
{
  const r = recommendModel('cap-code-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'capability-cost: [code, analysis] → haiku');
}

// 12. ['reasoning', 'analysis'] → sonnet (cheapest Anthropic with reasoning)
//     This is the researcher fix: was haiku (no reasoning), now correctly sonnet
{
  const r = recommendModel('cap-reasoning', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-sonnet-4-6',
    'capability-cost: [reasoning, analysis] → sonnet (researcher fix — no longer haiku)');
}

// 13. ['reasoning', 'code'] → sonnet (reviewer-logic fix: no haiku pin, routing picks cheapest)
{
  const r = recommendModel('cap-reasoning-code', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-sonnet-4-6',
    'capability-cost: [reasoning, code] → sonnet (reviewer-logic fix — no longer haiku)');
}

// 14. External agent with allowedVendors → correct provider scope
{
  const r = recommendModel('cap-external', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-5.4',
    'capability-cost: [reasoning, agentic] with openai allowedVendors → gpt-5.4');
}

// 15. No model satisfies required capabilities → explicit error
{
  const r = recommendModel('cap-no-match', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'error' && r.modelId === null,
    'capability-cost: no model satisfies [nonexistent-capability] → explicit error');
}

// 16. Capability-cost with haiku exhausted → sonnet (next cheapest satisfying caps)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  assert(r.source === 'error',
    'capability-cost: all Anthropic exhausted → explicit error (no provider scope fallback)');
}

// 17. allowedTiers path still works as backward-compat fallback (supervisor)
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'preferred' && r.modelId === 'gpt-5.4',
    'backward compat: supervisor with allowedTiers → preferred gpt-5.4 (tier path)');
}

// ── excludeModels tests ───────────────────────────────────────────────────────

// 18. excludeModels removes preferred from consideration
{
  // supervisor has preferred: gpt-5.4 — exclude it, expect error (no other opus+allowedVendors candidates)
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  assert(r.source === 'error',
    'excludeModels: preferred model excluded → falls through to error (no remaining candidates)');
}

// 19. excludeModels removes a fallback from consideration
{
  // Add a test agent with preferred + fallback both excluded
  // Agent with allowedTiers+allowedVendors and preferred excluded — tier scan selects next best
  const c = cfg();
  c.agentModelMap['test-exclude'] = {
    preferred: 'gpt-5.4',
    allowedTiers: ['opus', 'sonnet'],
    allowedVendors: ['openai', 'gemini'],
  };
  const r = recommendModel('test-exclude', c, EMPTY_USAGE, {
    excludeModels: ['gpt-5.4'],
  });
  // Remaining opus/sonnet in openai+gemini: gpt-4.1 (sonnet, openai), gemini-2.5-pro (opus, gemini)
  // Tier preference: opus (index 0) beats sonnet (index 1) → gemini-2.5-pro
  assert(r.source === 'catalog' && r.modelId === 'gemini-2.5-pro',
    'excludeModels: preferred excluded → allowedTiers scan selects next best (opus gemini)');
}

// 20. excludeModels is per-call — subsequent call without exclusion returns original model
{
  const r1 = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  const r2 = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE); // no exclusion
  assert(r1.source === 'error', 'excludeModels per-call: first call with exclusion returns error');
  assert(r2.source === 'preferred' && r2.modelId === 'gpt-5.4',
    'excludeModels per-call: second call without exclusion returns preferred model normally');
}

// 21. excludeModels in catalog scan removes model from tier-locked candidates
{
  const c = cfgWithoutModels('gpt-5.4'); // only gpt-4.1 remains for openai sonnet
  const r = recommendModel('tier-beats-priority', c, EMPTY_USAGE, { excludeModels: ['gpt-4.1'] });
  // gpt-4.1 excluded, gemini-2.5-flash is haiku so allowedTiers ['opus','sonnet'] skips it
  // gemini-2.5-pro is opus → first match after exclusion
  assert(r.modelId === 'gemini-2.5-pro',
    'excludeModels in catalog: excluded sonnet model, opus gemini selected next');
}

// 22. excludeModels does not relax capability requirements (error if no remaining candidate satisfies caps)
{
  const c = cfg();
  c.agentModelMap['test-caps-exclude'] = {
    allowedTiers: ['haiku'],
    allowedVendors: ['anthropic'],
  };
  // All haiku anthropic models excluded
  const r = recommendModel('test-caps-exclude', c, EMPTY_USAGE, {
    excludeModels: ['claude-haiku-4-5-20251001'],
  });
  assert(r.source === 'error',
    'excludeModels: no candidates remaining after exclusion → explicit error, no capability relaxation');
}

console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
