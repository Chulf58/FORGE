#!/usr/bin/env node
// Regression tests for mcp/lib/router.js — capability-cost routing.
//
// Routing architecture:
//   - Default scope = ALL enabled providers (vendor-agnostic)
//   - allowedVendors is a force-override (locks scope to specific vendors)
//   - Router returns cheapest model satisfying ALL requiredCapabilities in scope
//   - Capabilities are domain-level only: reasoning, code, analysis, fast, agentic, long-context
//   - Execution mechanics (tool access, subagent vs forge_call_external) are a
//     skill-layer concern — NOT a routing-config capability
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
    // OpenAI
    { id: 'gpt-5.4', providerId: 'openai', reasoningTier: 'opus',
      capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'high' },
    { id: 'gpt-4.1', providerId: 'openai', reasoningTier: 'sonnet',
      capabilities: ['reasoning', 'code', 'analysis'], costTier: 'medium' },
    // Gemini
    { id: 'gemini-2.5-pro', providerId: 'gemini', reasoningTier: 'opus',
      capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'free' },
    { id: 'gemini-2.5-flash', providerId: 'gemini', reasoningTier: 'haiku',
      capabilities: ['code', 'analysis', 'fast'], costTier: 'free' },
    { id: 'gemini-2.5-flash-lite', providerId: 'gemini', reasoningTier: 'haiku',
      capabilities: ['code', 'analysis', 'fast'], costTier: 'free' },
    // Anthropic
    { id: 'claude-opus-4-7', providerId: 'anthropic', reasoningTier: 'opus',
      capabilities: ['reasoning', 'code', 'analysis', 'agentic', 'long-context'], costTier: 'high' },
    { id: 'claude-sonnet-4-6', providerId: 'anthropic', reasoningTier: 'sonnet',
      capabilities: ['reasoning', 'code', 'analysis'], costTier: 'medium' },
    { id: 'claude-haiku-4-5-20251001', providerId: 'anthropic', reasoningTier: 'haiku',
      capabilities: ['code', 'analysis', 'fast'], costTier: 'low' },
  ],
  agentModelMap: {
    // Supervisor: OpenAI scope force-override (intentional: Gemini tested as haiku-quality)
    'supervisor': {
      requiredCapabilities: ['reasoning', 'agentic'],
      allowedVendors: ['openai'],
    },
    // Representative agents using only domain capabilities
    'cap-analysis':         { requiredCapabilities: ['analysis'] },
    'cap-code-analysis':    { requiredCapabilities: ['code', 'analysis'] },
    'cap-reasoning':        { requiredCapabilities: ['reasoning', 'analysis'] },
    'cap-reasoning-code':   { requiredCapabilities: ['reasoning', 'code'] },
    'cap-fast':             { requiredCapabilities: ['fast'] },
    'cap-reasoning-agentic':{ requiredCapabilities: ['reasoning', 'agentic'] },
    // Edge cases
    'cap-agentic-openai':   { requiredCapabilities: ['reasoning', 'agentic'], allowedVendors: ['openai'] },
    'cap-no-match':         { requiredCapabilities: ['nonexistent-capability'] },
    'cap-no-reqs':          {},
  },
};

const EMPTY_USAGE         = { providers: {} };
const OPENAI_EXHAUSTED    = { providers: { openai:    { quotaExhausted: true } } };
const GEMINI_EXHAUSTED    = { providers: { gemini:    { quotaExhausted: true } } };
const ANTHROPIC_EXHAUSTED = { providers: { anthropic: { quotaExhausted: true } } };
const ALL_EXHAUSTED       = { providers: {
  openai:    { quotaExhausted: true },
  gemini:    { quotaExhausted: true },
  anthropic: { quotaExhausted: true },
}};

function cfg(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...BASE_CONFIG, ...overrides }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── router-test.mjs ──────────────────────────────────────────────────────');

// ── Supervisor: allowedVendors force-override ────────────────────────────────

// 1. Supervisor routes to gpt-5.4 (only OpenAI model with reasoning+agentic)
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-5.4',
    'supervisor: allowedVendors force-override → gpt-5.4 (only openai with reasoning+agentic)');
  assert(r.providerId === 'openai',
    'supervisor: provider is openai (force-override via allowedVendors)');
}

// 2. Supervisor: OpenAI exhausted → error (force-override has no cross-provider fallback)
{
  const r = recommendModel('supervisor', BASE_CONFIG, OPENAI_EXHAUSTED);
  assert(r.source === 'error' && r.modelId === null,
    'supervisor: openai exhausted → error (allowedVendors lock prevents fallback)');
}

// 3. Supervisor: gpt-5.4 excluded → error (gpt-4.1 lacks agentic)
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  assert(r.source === 'error',
    'supervisor: gpt-5.4 excluded → error (no other openai model has agentic)');
}

// ── Vendor-agnostic capability-cost routing ──────────────────────────────────

// 4. [analysis] → Gemini free tier (cheapest across all providers)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.providerId === 'gemini',
    'vendor-agnostic: [analysis] → gemini (free < low < medium < high)');
  assert(r.modelId === 'gemini-2.5-flash' || r.modelId === 'gemini-2.5-flash-lite',
    'vendor-agnostic: [analysis] → gemini-2.5-flash or flash-lite (alphabetical tiebreak)');
}

// 5. [code, analysis] → Gemini flash/flash-lite (free, has both caps)
{
  const r = recommendModel('cap-code-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.providerId === 'gemini',
    'vendor-agnostic: [code, analysis] → gemini (free tier)');
}

// 6. [reasoning, analysis] → Gemini 2.5 Pro (free, only free-tier model with reasoning)
{
  const r = recommendModel('cap-reasoning', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gemini-2.5-pro',
    'vendor-agnostic: [reasoning, analysis] → gemini-2.5-pro (free + has reasoning)');
}

// 7. [reasoning, code] → Gemini 2.5 Pro
{
  const r = recommendModel('cap-reasoning-code', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gemini-2.5-pro',
    'vendor-agnostic: [reasoning, code] → gemini-2.5-pro');
}

// 8. [fast] → Gemini flash/flash-lite (free + has fast)
{
  const r = recommendModel('cap-fast', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.providerId === 'gemini',
    'vendor-agnostic: [fast] → gemini free tier');
}

// 9. [reasoning, agentic] without allowedVendors → Gemini 2.5 Pro (free) over gpt-5.4 (high)
{
  const r = recommendModel('cap-reasoning-agentic', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gemini-2.5-pro',
    'vendor-agnostic: [reasoning, agentic] → gemini-2.5-pro (free < gpt-5.4 high)');
}

// ── Provider exhaustion and cross-provider fallback ─────────────────────────

// 10. Gemini exhausted + [analysis] → Anthropic haiku (next cheapest with analysis)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, GEMINI_EXHAUSTED);
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'fallback: gemini exhausted + [analysis] → claude-haiku (low < medium < high)');
}

// 11. Gemini + Anthropic exhausted + [analysis] → gpt-4.1 (OpenAI, medium)
{
  const usage = { providers: {
    gemini:    { quotaExhausted: true },
    anthropic: { quotaExhausted: true },
  }};
  const r = recommendModel('cap-analysis', BASE_CONFIG, usage);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-4.1',
    'fallback: gemini+anthropic exhausted + [analysis] → gpt-4.1 (only remaining with analysis)');
}

// 12. Anthropic exhausted + [analysis] → still Gemini (vendor-agnostic, no Anthropic dependency)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, ANTHROPIC_EXHAUSTED);
  assert(r.source === 'capability-cost' && r.providerId === 'gemini',
    'fallback: anthropic exhausted → gemini (still cheapest, no Anthropic fallback needed)');
}

// 13. All providers exhausted → error
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, ALL_EXHAUSTED);
  assert(r.source === 'error',
    'all exhausted: explicit error');
}

// ── excludeModels (per-call) ─────────────────────────────────────────────────

// 14. Exclude cheapest flash models → next cheapest free (gemini-2.5-pro has analysis)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, {
    excludeModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  });
  assert(r.source === 'capability-cost' && r.modelId === 'gemini-2.5-pro',
    'excludeModels: flash excluded → gemini-2.5-pro (still free tier, has analysis)');
}

// 15. Exclude all Gemini → Anthropic haiku (next cheapest)
{
  const r = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, {
    excludeModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  });
  assert(r.source === 'capability-cost' && r.modelId === 'claude-haiku-4-5-20251001',
    'excludeModels: all gemini excluded → claude-haiku (next cheapest)');
}

// 16. excludeModels is per-call — second call returns cheapest without exclusion
{
  const r1 = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE, {
    excludeModels: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
  });
  const r2 = recommendModel('cap-analysis', BASE_CONFIG, EMPTY_USAGE);
  assert(r1.modelId === 'claude-haiku-4-5-20251001',
    'excludeModels per-call: first call excludes gemini → anthropic haiku');
  assert(r2.providerId === 'gemini',
    'excludeModels per-call: second call returns gemini normally (exclusion not persisted)');
}

// 17. excludeModels on supervisor: gpt-5.4 excluded → error
{
  const r = recommendModel('supervisor', BASE_CONFIG, EMPTY_USAGE, { excludeModels: ['gpt-5.4'] });
  assert(r.source === 'error',
    'excludeModels: supervisor gpt-5.4 excluded → error (no other openai+agentic)');
}

// ── Unknown / no-requirement cases ───────────────────────────────────────────

// 18. No requirements → hardcoded default
{
  const r = recommendModel('cap-no-reqs', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'default',
    'no requirements: hardcoded default returned');
}

// 19. Unknown agent → hardcoded default
{
  const r = recommendModel('unknown-agent', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'default',
    'unknown agent: hardcoded default returned');
}

// 20. No match → error
{
  const r = recommendModel('cap-no-match', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'error' && r.modelId === null,
    'no match: [nonexistent-capability] → explicit error');
}

// ── Force-override: allowedVendors ───────────────────────────────────────────

// 21. allowedVendors: [openai] forces scope; gpt-5.4 wins over free gemini-2.5-pro
{
  const r = recommendModel('cap-agentic-openai', BASE_CONFIG, EMPTY_USAGE);
  assert(r.source === 'capability-cost' && r.modelId === 'gpt-5.4',
    'force-override: allowedVendors [openai] → gpt-5.4 (gemini-2.5-pro excluded from scope)');
  assert(r.providerId === 'openai', 'force-override: provider is openai');
}

// ── Provider enabled flag ────────────────────────────────────────────────────

// 22. Disabled provider excluded from default scope
{
  const cfgGeminiDisabled = cfg();
  cfgGeminiDisabled.providers.find(p => p.id === 'gemini').enabled = false;
  const r = recommendModel('cap-analysis', cfgGeminiDisabled, EMPTY_USAGE);
  assert(r.providerId === 'anthropic' && r.modelId === 'claude-haiku-4-5-20251001',
    'disabled provider: gemini disabled → anthropic haiku (next cheapest with analysis)');
}

// 23. Only one provider enabled → routes within that scope
{
  const cfgAnthropicOnly = cfg();
  cfgAnthropicOnly.providers.find(p => p.id === 'gemini').enabled = false;
  cfgAnthropicOnly.providers.find(p => p.id === 'openai').enabled = false;
  const r = recommendModel('cap-reasoning', cfgAnthropicOnly, EMPTY_USAGE);
  assert(r.providerId === 'anthropic' && r.modelId === 'claude-sonnet-4-6',
    'single provider: only anthropic enabled → claude-sonnet (cheapest anthropic with reasoning)');
}

// ── Per-model quota exhaustion ───────────────────────────────────────────────

// 24. Model-level exhaustion: Pro exhausted but Flash still available
{
  const proExhausted = { providers: { gemini: { models: { 'gemini-2.5-pro': { quotaExhausted: true } } } } };
  const r = recommendModel('cap-analysis', BASE_CONFIG, proExhausted);
  assert(r.providerId === 'gemini' && (r.modelId === 'gemini-2.5-flash' || r.modelId === 'gemini-2.5-flash-lite'),
    'per-model exhaustion: gemini-2.5-pro exhausted → Flash still reachable (no provider-wide poisoning)');
}

// 25. Model-level exhaustion on Pro + [reasoning, code]: Flash lacks reasoning → Anthropic
{
  const proExhausted = { providers: { gemini: { models: { 'gemini-2.5-pro': { quotaExhausted: true } } } } };
  const r = recommendModel('cap-reasoning-code', BASE_CONFIG, proExhausted);
  assert(r.modelId === 'claude-sonnet-4-6',
    'per-model exhaustion: Pro exhausted + [reasoning, code] → anthropic sonnet (Flash lacks reasoning)');
}

// 26. Backward compat: old-format usage (provider-level only) still blocks whole provider
{
  const oldFormat = { providers: { gemini: { quotaExhausted: true } } };
  const r = recommendModel('cap-analysis', BASE_CONFIG, oldFormat);
  assert(r.providerId !== 'gemini',
    'backward compat: old-format usage (provider-only flag) still blocks all gemini models');
}

// 27. Combined: provider- AND model-level flags set → provider-wide still wins
{
  const both = {
    providers: {
      gemini: {
        quotaExhausted: true,
        models: { 'gemini-2.5-pro': { quotaExhausted: true } },
      },
    },
  };
  const r = recommendModel('cap-analysis', BASE_CONFIG, both);
  assert(r.providerId !== 'gemini',
    'combined exhaustion: provider-wide takes precedence, all gemini models blocked');
}

// 28. Empty models map: no model flagged exhausted → gemini Flash still reachable
{
  const emptyModels = { providers: { gemini: { models: {} } } };
  const r = recommendModel('cap-analysis', BASE_CONFIG, emptyModels);
  assert(r.providerId === 'gemini',
    'per-model exhaustion: empty models map does not block the provider');
}

// 29. Multiple model-level flags: Pro + Flash exhausted → Flash-lite still reachable
{
  const multiExhausted = {
    providers: {
      gemini: {
        models: {
          'gemini-2.5-pro':   { quotaExhausted: true },
          'gemini-2.5-flash': { quotaExhausted: true },
        },
      },
    },
  };
  const r = recommendModel('cap-analysis', BASE_CONFIG, multiExhausted);
  assert(r.modelId === 'gemini-2.5-flash-lite',
    'per-model exhaustion: Pro + Flash exhausted → Flash-lite still reachable (per-model granularity)');
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
