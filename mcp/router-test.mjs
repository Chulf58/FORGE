#!/usr/bin/env node
// Regression tests for mcp/lib/router.js multi-vendor tier-locked routing.
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
    { id: 'openai',     type: 'openai',     envVar: 'OPENAI_API_KEY',    enabled: true,  priority: 1 },
    { id: 'gemini',     type: 'gemini',     envVar: 'GEMINI_API_KEY',    enabled: true,  priority: 2 },
    { id: 'anthropic',  type: 'anthropic',  envVar: 'ANTHROPIC_API_KEY', enabled: true,  priority: 3 },
  ],
  models: [
    { id: 'gpt-5.4',                  providerId: 'openai',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code'], costTier: 'high'   },
    { id: 'gpt-4.1',                  providerId: 'openai',    reasoningTier: 'sonnet', capabilities: ['reasoning', 'code'], costTier: 'medium' },
    { id: 'gemini-2.5-pro',           providerId: 'gemini',    reasoningTier: 'opus',   capabilities: ['reasoning', 'code'], costTier: 'free'   },
    { id: 'gemini-2.5-flash',         providerId: 'gemini',    reasoningTier: 'sonnet', capabilities: ['reasoning', 'code'], costTier: 'free'   },
    { id: 'gemini-2.5-flash-lite',    providerId: 'gemini',    reasoningTier: 'haiku',  capabilities: ['code'],              costTier: 'free'   },
    { id: 'claude-opus-4-7',          providerId: 'anthropic', reasoningTier: 'opus',   capabilities: ['reasoning', 'code'], costTier: 'high'   },
    { id: 'claude-sonnet-4-6',        providerId: 'anthropic', reasoningTier: 'sonnet', capabilities: ['reasoning', 'code'], costTier: 'medium' },
    { id: 'claude-haiku-4-5-20251001',providerId: 'anthropic', reasoningTier: 'haiku',  capabilities: ['code'],              costTier: 'low'    },
  ],
  agentModelMap: {
    'supervisor': {
      preferred: 'gpt-5.4',
      fallback: 'gemini-2.5-flash',
      allowedTiers: ['opus', 'sonnet'],
      allowedVendors: ['openai', 'gemini'],
    },
    'haiku-reviewer': {
      preferred: 'claude-haiku-4-5-20251001',
      allowedTiers: ['haiku'],
      allowedVendors: ['anthropic'],
    },
    'legacy-coder': {
      preferred: 'claude-sonnet-4-6',
      fallback: 'claude-opus-4-7',
      requiredCapabilities: ['reasoning', 'code'],
    },
    'bad-preferred': {
      preferred: 'claude-haiku-4-5-20251001',  // haiku tier, but allowedTiers is opus/sonnet
      allowedTiers: ['opus', 'sonnet'],
      allowedVendors: ['anthropic'],
    },
    'bad-fallback': {
      preferred: 'gpt-5.4',
      fallback: 'gemini-2.5-flash-lite',        // haiku tier, but allowedTiers is opus/sonnet
      allowedTiers: ['opus', 'sonnet'],
      allowedVendors: ['openai', 'gemini'],
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
      allowedVendors: ['openai'],               // openai has no haiku model
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

// 3. Fallback chosen when preferred is quota-exhausted and fallback tier is allowed
{
  const r = recommendModel('supervisor', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'fallback' && r.modelId === 'gemini-2.5-flash',
    'fallback chosen when preferred provider exhausted');
}

// 4. Fallback rejected with config error when its tier violates allowedTiers
{
  const r = recommendModel('bad-fallback', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'error' && r.reason.includes('Config error') && r.reason.includes('bad-fallback'),
    'fallback outside allowedTiers returns config error');
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

// 10. Legacy requiredCapabilities path still works for unmigrated entries
{
  const r = recommendModel('legacy-coder', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'preferred' && r.modelId === 'claude-sonnet-4-6',
    'legacy entry: preferred returned without allowedTiers');
}

// 11. Legacy catalog scan still functions when preferred + fallback exhausted
{
  const r = recommendModel('legacy-coder', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  // All anthropic exhausted → falls to non-anthropic catalog or default
  // legacy-coder has no allowedVendors, so catalog scans all providers
  // openai is enabled and has reasoning+code models
  assert(r.modelId !== null && r.source !== 'error',
    'legacy entry: catalog scan or default used when preferred+fallback provider exhausted');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
