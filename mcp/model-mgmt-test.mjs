#!/usr/bin/env node
// Regression tests for mcp/lib/model-validation.js and the round-trip behavior
// expected of forge_add_model / forge_update_model MCP tool handlers.
//
// Pure validators are tested directly. Round-trip tests use a tmpdir config
// to exercise readForgeConfig → mutate helper → writeForgeConfig → re-read.
//
// Run: node mcp/model-mgmt-test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MODEL_CAPABILITY_ALLOWLIST,
  MODEL_COST_TIERS,
  MODEL_REASONING_TIERS,
  validateId,
  validateProviderId,
  validateCapabilities,
  validateCostTier,
  validatePricing,
  validateReasoningTier,
  validateContextWindow,
  validateNotes,
  addModelToConfig,
  updateModelInConfig,
} from './lib/model-validation.js';
import { readForgeConfig, writeForgeConfig, invalidateConfigCache } from './lib/config-store.js';

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

// ── Fixture helpers ──────────────────────────────────────────────────────────

function baseConfig() {
  return {
    providers: [
      { id: 'openai', type: 'openai', envVar: 'OPENAI_API_KEY', enabled: true, priority: 1 },
      { id: 'anthropic', type: 'anthropic', envVar: 'ANTHROPIC_API_KEY', enabled: true, priority: 3 },
    ],
    models: [
      {
        id: 'claude-sonnet-4-6',
        providerId: 'anthropic',
        capabilities: ['reasoning', 'code', 'analysis'],
        costTier: 'medium',
        pricing: { input: 3.0, output: 15.0, cached: 0.3 },
        reasoningTier: 'sonnet',
      },
      {
        id: 'gpt-4.1',
        providerId: 'openai',
        capabilities: ['code', 'analysis', 'fast'],
        costTier: 'medium',
        pricing: { input: 2.0, output: 8.0, cached: 0.2 },
        reasoningTier: 'sonnet',
      },
    ],
    agentModelMap: {},
  };
}

function validAddParams(overrides = {}) {
  return {
    id: 'sonar-large',
    providerId: 'openai',
    capabilities: ['reasoning', 'code', 'analysis'],
    costTier: 'medium',
    pricing: { input: 1.0, output: 3.0, cached: 0.1 },
    contextWindow: 128000,
    reasoningTier: 'sonnet',
    notes: 'test-entry',
    ...overrides,
  };
}

function makeTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-mm-test-'));
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n── model-mgmt-test.mjs ──────────────────────────────────────────────────');

// ── Allowlists are frozen and contain the documented values ──────────────────

// 1. Capability allowlist contains the expected six values, nothing more
{
  const expected = ['reasoning', 'code', 'analysis', 'fast', 'agentic', 'long-context'];
  const actual = [...MODEL_CAPABILITY_ALLOWLIST].sort();
  assert(actual.length === expected.length && expected.every(c => MODEL_CAPABILITY_ALLOWLIST.has(c)),
    'capability allowlist contains exactly the documented six values');
}

// 2. Cost tiers and reasoning tiers have the documented values
{
  assert(MODEL_COST_TIERS.has('free') && MODEL_COST_TIERS.has('low') && MODEL_COST_TIERS.has('medium') && MODEL_COST_TIERS.has('high'),
    'cost tiers: free, low, medium, high');
  assert(MODEL_REASONING_TIERS.has('haiku') && MODEL_REASONING_TIERS.has('sonnet') && MODEL_REASONING_TIERS.has('opus'),
    'reasoning tiers: haiku, sonnet, opus');
}

// ── Field validators ─────────────────────────────────────────────────────────

// 3. validateId
{
  assert(validateId('claude-x') === null, 'validateId: non-empty string passes');
  assert(typeof validateId('') === 'string', 'validateId: empty string rejected');
  assert(typeof validateId(123) === 'string', 'validateId: non-string rejected');
  assert(typeof validateId(undefined) === 'string', 'validateId: undefined rejected');
}

// 4. validateProviderId
{
  const cfg = baseConfig();
  assert(validateProviderId('openai', cfg) === null, 'validateProviderId: known provider passes');
  assert(validateProviderId('anthropic', cfg) === null, 'validateProviderId: another known provider passes');
  assert(typeof validateProviderId('gemini', cfg) === 'string', 'validateProviderId: retired provider (gemini) rejected');
  assert(typeof validateProviderId('', cfg) === 'string', 'validateProviderId: empty string rejected');
}

// 5. validateCapabilities
{
  assert(validateCapabilities(['analysis']) === null, 'validateCapabilities: single known cap passes');
  assert(validateCapabilities(['reasoning', 'code', 'analysis']) === null, 'validateCapabilities: multiple known caps pass');
  assert(typeof validateCapabilities([]) === 'string', 'validateCapabilities: empty array rejected');
  assert(typeof validateCapabilities(null) === 'string', 'validateCapabilities: null rejected');
  assert(typeof validateCapabilities(['analysis', 'reasonng']) === 'string', 'validateCapabilities: typo in array rejected');
  assert(typeof validateCapabilities(['vision']) === 'string', 'validateCapabilities: unknown cap not in allowlist rejected');
}

// 6. validateCostTier
{
  assert(validateCostTier('free') === null, 'validateCostTier: free passes');
  assert(validateCostTier('high') === null, 'validateCostTier: high passes');
  assert(typeof validateCostTier('cheap') === 'string', 'validateCostTier: unknown tier rejected');
  assert(typeof validateCostTier(undefined) === 'string', 'validateCostTier: undefined rejected (required field)');
}

// 7. validatePricing
{
  assert(validatePricing({ input: 1, output: 2, cached: 0.1 }) === null, 'validatePricing: valid shape passes');
  assert(validatePricing({ input: 0, output: 0, cached: 0 }) === null, 'validatePricing: zero values allowed');
  assert(typeof validatePricing(null) === 'string', 'validatePricing: null rejected');
  assert(typeof validatePricing({ input: 1, output: 2 }) === 'string', 'validatePricing: missing cached rejected');
  assert(typeof validatePricing({ input: -1, output: 2, cached: 0 }) === 'string', 'validatePricing: negative rejected');
  assert(typeof validatePricing({ input: 'cheap', output: 2, cached: 0 }) === 'string', 'validatePricing: non-numeric rejected');
  assert(typeof validatePricing({ input: Infinity, output: 2, cached: 0 }) === 'string', 'validatePricing: Infinity rejected');
  assert(typeof validatePricing([1, 2, 3]) === 'string', 'validatePricing: array rejected (not object)');
}

// 8. validateReasoningTier
{
  assert(validateReasoningTier(undefined) === null, 'validateReasoningTier: undefined passes (optional)');
  assert(validateReasoningTier(null) === null, 'validateReasoningTier: null passes (optional)');
  assert(validateReasoningTier('haiku') === null, 'validateReasoningTier: haiku passes');
  assert(typeof validateReasoningTier('small') === 'string', 'validateReasoningTier: unknown rejected');
}

// 9. validateContextWindow
{
  assert(validateContextWindow(undefined) === null, 'validateContextWindow: undefined passes (optional)');
  assert(validateContextWindow(128000) === null, 'validateContextWindow: positive integer passes');
  assert(typeof validateContextWindow(0) === 'string', 'validateContextWindow: zero rejected');
  assert(typeof validateContextWindow(-1) === 'string', 'validateContextWindow: negative rejected');
  assert(typeof validateContextWindow(1.5) === 'string', 'validateContextWindow: non-integer rejected');
}

// 10. validateNotes
{
  assert(validateNotes(undefined) === null, 'validateNotes: undefined passes');
  assert(validateNotes('hello') === null, 'validateNotes: string passes');
  assert(typeof validateNotes(123) === 'string', 'validateNotes: non-string rejected');
}

// ── addModelToConfig ─────────────────────────────────────────────────────────

// 11. Successful add with all required + optional fields
{
  const cfg = baseConfig();
  const before = cfg.models.length;
  const res = addModelToConfig(cfg, validAddParams());
  assert(res.ok === true, 'addModelToConfig: returns ok:true on success');
  assert(cfg.models.length === before + 1, 'addModelToConfig: appends to models array');
  const added = cfg.models.find(m => m.id === 'sonar-large');
  assert(added && added.providerId === 'openai', 'addModelToConfig: entry stored with correct providerId');
  assert(added.pricing.input === 1.0 && added.pricing.output === 3.0 && added.pricing.cached === 0.1,
    'addModelToConfig: pricing stored correctly');
  assert(added.contextWindow === 128000, 'addModelToConfig: optional contextWindow stored');
  assert(added.reasoningTier === 'sonnet', 'addModelToConfig: optional reasoningTier stored');
  assert(added.notes === 'test-entry', 'addModelToConfig: optional notes stored');
}

// 12. Duplicate id rejection
{
  const cfg = baseConfig();
  const res = addModelToConfig(cfg, validAddParams({ id: 'claude-sonnet-4-6' }));
  assert(res.ok === false, 'addModelToConfig: duplicate id rejected');
  assert(res.error.includes('already exists'), 'addModelToConfig: duplicate error mentions "already exists"');
}

// 13. Unknown providerId rejection
{
  const cfg = baseConfig();
  const res = addModelToConfig(cfg, validAddParams({ providerId: 'perplexity' }));
  assert(res.ok === false, 'addModelToConfig: unknown provider rejected');
  assert(res.error.includes('perplexity'), 'addModelToConfig: error names the unknown provider');
  assert(cfg.models.length === 2, 'addModelToConfig: rejection does not mutate models');
}

// 14. Invalid capability (typo) rejection
{
  const cfg = baseConfig();
  const res = addModelToConfig(cfg, validAddParams({ capabilities: ['reasonng', 'code'] }));
  assert(res.ok === false, 'addModelToConfig: typo capability rejected');
  assert(res.error.includes('reasonng'), 'addModelToConfig: error names the unknown capability');
}

// 15. Invalid pricing rejection
{
  const cfg = baseConfig();
  const res1 = addModelToConfig(cfg, validAddParams({ pricing: { input: -0.5, output: 1, cached: 0 } }));
  assert(res1.ok === false, 'addModelToConfig: negative pricing rejected');
  const res2 = addModelToConfig(cfg, validAddParams({ pricing: { input: 1, output: 1 } }));
  assert(res2.ok === false, 'addModelToConfig: missing cached field rejected');
  const res3 = addModelToConfig(cfg, validAddParams({ pricing: null }));
  assert(res3.ok === false, 'addModelToConfig: null pricing rejected');
}

// 16. Missing required field rejection
{
  const cfg = baseConfig();
  const params = validAddParams();
  delete params.id;
  const res = addModelToConfig(cfg, params);
  assert(res.ok === false, 'addModelToConfig: missing id rejected');
}

// 17. Invalid costTier rejection
{
  const cfg = baseConfig();
  const res = addModelToConfig(cfg, validAddParams({ costTier: 'cheap' }));
  assert(res.ok === false, 'addModelToConfig: unknown costTier rejected');
}

// 18. Invalid reasoningTier rejection (optional field that was provided)
{
  const cfg = baseConfig();
  const res = addModelToConfig(cfg, validAddParams({ reasoningTier: 'small' }));
  assert(res.ok === false, 'addModelToConfig: unknown reasoningTier rejected');
}

// 19. Valid add with only required fields (omit all optionals)
{
  const cfg = baseConfig();
  const minimal = {
    id: 'minimal-model',
    providerId: 'openai',
    capabilities: ['analysis'],
    costTier: 'free',
    pricing: { input: 0, output: 0, cached: 0 },
  };
  const res = addModelToConfig(cfg, minimal);
  assert(res.ok === true, 'addModelToConfig: minimal params (required only) succeed');
  const added = cfg.models.find(m => m.id === 'minimal-model');
  assert(added && added.contextWindow === undefined, 'addModelToConfig: contextWindow omitted when not provided');
  assert(added && added.reasoningTier === undefined, 'addModelToConfig: reasoningTier omitted when not provided');
  assert(added && added.notes === undefined, 'addModelToConfig: notes omitted when not provided');
}

// 20. Add creates models array if missing from config
{
  const cfg = { providers: [{ id: 'openai', type: 'openai', envVar: 'X', enabled: true }] };
  const res = addModelToConfig(cfg, {
    id: 'x', providerId: 'openai', capabilities: ['fast'],
    costTier: 'free', pricing: { input: 0, output: 0, cached: 0 },
  });
  assert(res.ok === true, 'addModelToConfig: creates models array when missing');
  assert(Array.isArray(cfg.models) && cfg.models.length === 1, 'addModelToConfig: models array created');
}

// ── updateModelInConfig ──────────────────────────────────────────────────────

// 21. Partial update — only pricing touched, other fields preserved
{
  const cfg = baseConfig();
  const originalCaps = [...cfg.models[0].capabilities];
  const originalCostTier = cfg.models[0].costTier;
  const res = updateModelInConfig(cfg, {
    id: 'claude-sonnet-4-6',
    pricing: { input: 2.5, output: 12.5, cached: 0.25 },
  });
  assert(res.ok === true, 'updateModelInConfig: partial pricing update succeeds');
  const m = cfg.models[0];
  assert(m.pricing.input === 2.5 && m.pricing.output === 12.5 && m.pricing.cached === 0.25,
    'updateModelInConfig: pricing replaced');
  assert(JSON.stringify(m.capabilities) === JSON.stringify(originalCaps),
    'updateModelInConfig: untouched capabilities preserved');
  assert(m.costTier === originalCostTier, 'updateModelInConfig: untouched costTier preserved');
}

// 22. Unknown id rejection
{
  const cfg = baseConfig();
  const res = updateModelInConfig(cfg, { id: 'nonexistent', costTier: 'low' });
  assert(res.ok === false, 'updateModelInConfig: unknown id rejected');
  assert(res.error.includes('nonexistent') && res.error.includes('not found'),
    'updateModelInConfig: error names the id and says not found');
}

// 23. Invalid capability in update rejected
{
  const cfg = baseConfig();
  const res = updateModelInConfig(cfg, {
    id: 'claude-sonnet-4-6',
    capabilities: ['reasoning', 'bogus'],
  });
  assert(res.ok === false, 'updateModelInConfig: invalid capability in update rejected');
  assert(res.error.includes('bogus'), 'updateModelInConfig: error names the unknown capability');
  // And config should be unchanged
  assert(JSON.stringify(cfg.models[0].capabilities) === JSON.stringify(['reasoning', 'code', 'analysis']),
    'updateModelInConfig: rejection does not mutate capabilities');
}

// 24. Invalid pricing in update rejected
{
  const cfg = baseConfig();
  const res = updateModelInConfig(cfg, {
    id: 'claude-sonnet-4-6',
    pricing: { input: 1, output: -2, cached: 0.1 },
  });
  assert(res.ok === false, 'updateModelInConfig: invalid pricing rejected');
  assert(cfg.models[0].pricing.input === 3.0, 'updateModelInConfig: rejection does not mutate pricing');
}

// 25. Invalid providerId in update rejected
{
  const cfg = baseConfig();
  const res = updateModelInConfig(cfg, {
    id: 'claude-sonnet-4-6',
    providerId: 'nope',
  });
  assert(res.ok === false, 'updateModelInConfig: unknown providerId rejected');
  assert(cfg.models[0].providerId === 'anthropic', 'updateModelInConfig: rejection does not mutate providerId');
}

// 26. Update with no touched fields (only id) is a no-op
{
  const cfg = baseConfig();
  const before = JSON.stringify(cfg.models[0]);
  const res = updateModelInConfig(cfg, { id: 'claude-sonnet-4-6' });
  assert(res.ok === true, 'updateModelInConfig: no-op update returns ok:true');
  const after = JSON.stringify(cfg.models[0]);
  assert(before === after, 'updateModelInConfig: no-op update does not mutate entry');
}

// 27. Update can touch multiple fields in one call
{
  const cfg = baseConfig();
  const res = updateModelInConfig(cfg, {
    id: 'claude-sonnet-4-6',
    costTier: 'low',
    notes: 'updated via test',
    contextWindow: 500000,
  });
  assert(res.ok === true, 'updateModelInConfig: multi-field update succeeds');
  const m = cfg.models[0];
  assert(m.costTier === 'low' && m.notes === 'updated via test' && m.contextWindow === 500000,
    'updateModelInConfig: all three touched fields updated');
  assert(m.pricing.input === 3.0, 'updateModelInConfig: untouched pricing preserved in multi-field update');
}

// ── Round-trip through disk ──────────────────────────────────────────────────

// 28. Add + disk round-trip via readForgeConfig/writeForgeConfig
{
  const dir = makeTmpProject();
  const configPath = join(dir, '.pipeline', 'forge-config.json');
  writeFileSync(configPath, JSON.stringify(baseConfig(), null, 2) + '\n', 'utf8');
  invalidateConfigCache();

  const { config, configPath: readBackPath } = readForgeConfig(null, dir);
  const res = addModelToConfig(config, validAddParams({ id: 'roundtrip-x' }));
  assert(res.ok === true, 'round-trip add: helper succeeds');
  writeForgeConfig(readBackPath, config);

  // Re-read (cache was invalidated by write). Verify persistence.
  const { config: reread } = readForgeConfig(null, dir);
  const found = (reread.models || []).find(m => m.id === 'roundtrip-x');
  assert(found && found.pricing.input === 1.0,
    'round-trip add: model persists to disk and re-reads with correct pricing');
  cleanup(dir);
}

// 29. Update + disk round-trip
{
  const dir = makeTmpProject();
  const configPath = join(dir, '.pipeline', 'forge-config.json');
  writeFileSync(configPath, JSON.stringify(baseConfig(), null, 2) + '\n', 'utf8');
  invalidateConfigCache();

  const { config, configPath: readBackPath } = readForgeConfig(null, dir);
  const res = updateModelInConfig(config, {
    id: 'gpt-4.1',
    pricing: { input: 0.5, output: 3.0, cached: 0.1 },
    notes: 'bumped pricing in test',
  });
  assert(res.ok === true, 'round-trip update: helper succeeds');
  writeForgeConfig(readBackPath, config);

  const { config: reread } = readForgeConfig(null, dir);
  const updated = (reread.models || []).find(m => m.id === 'gpt-4.1');
  assert(updated && updated.pricing.input === 0.5 && updated.notes === 'bumped pricing in test',
    'round-trip update: touched fields persist to disk');
  assert(updated && JSON.stringify(updated.capabilities) === JSON.stringify(['code', 'analysis', 'fast']),
    'round-trip update: untouched capabilities preserved on disk');
  cleanup(dir);
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
