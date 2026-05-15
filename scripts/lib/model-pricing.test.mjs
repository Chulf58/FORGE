// @covers scripts/lib/model-pricing.js
// Tests for the model-pricing helper module.
//
// AC-2: Module exports estimateCost(tokens, modelId) returning a USD number;
// opus/sonnet/haiku tiers match scripts/token-usage.mjs:8-12 rates;
// module is importable from ESM contexts.
//
// Run: node --test scripts/lib/model-pricing.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

// This import will fail (module not found) until model-pricing.js is written.
import { estimateCost, modelTier, MODEL_PRICING } from './model-pricing.js';

test('MODEL_PRICING has opus/sonnet/haiku keys', () => {
  assert.ok(MODEL_PRICING.opus,   'missing opus tier');
  assert.ok(MODEL_PRICING.sonnet, 'missing sonnet tier');
  assert.ok(MODEL_PRICING.haiku,  'missing haiku tier');
});

test('MODEL_PRICING rates match token-usage.mjs:8-12', () => {
  // Rates from scripts/token-usage.mjs:8-12 (input/output USD per 1M tokens)
  assert.strictEqual(MODEL_PRICING.opus.input,    15.0);
  assert.strictEqual(MODEL_PRICING.opus.output,   75.0);
  assert.strictEqual(MODEL_PRICING.sonnet.input,   3.0);
  assert.strictEqual(MODEL_PRICING.sonnet.output, 15.0);
  assert.strictEqual(MODEL_PRICING.haiku.input,    0.80);
  assert.strictEqual(MODEL_PRICING.haiku.output,   4.0);
});

test('modelTier returns opus for opus model IDs', () => {
  assert.strictEqual(modelTier('claude-opus-4-6'),            'opus');
  assert.strictEqual(modelTier('claude-opus-4-5-20251001'),   'opus');
});

test('modelTier returns haiku for haiku model IDs', () => {
  assert.strictEqual(modelTier('claude-haiku-4-5-20251001'),  'haiku');
});

test('modelTier returns sonnet for sonnet and unknown IDs', () => {
  assert.strictEqual(modelTier('claude-sonnet-4-5-20251001'), 'sonnet');
  assert.strictEqual(modelTier('unknown-model'),               'sonnet');
  assert.strictEqual(modelTier(null),                          'sonnet');
});

test('estimateCost with numeric tokens uses input rate', () => {
  // 1M tokens at sonnet input rate ($3.00/1M) = $3.00
  const cost = estimateCost(1_000_000, 'claude-sonnet-4-5');
  assert.strictEqual(cost, 3.0);
});

test('estimateCost with usage object gives exact breakdown cost', () => {
  // sonnet: 1M input ($3) + 1M output ($15) = $18
  const cost = estimateCost(
    { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    'claude-sonnet-4-5',
  );
  assert.strictEqual(cost, 18.0);
});

test('estimateCost returns 0 for zero tokens', () => {
  assert.strictEqual(estimateCost(0, 'claude-opus-4-6'), 0);
  assert.strictEqual(estimateCost({}, 'claude-opus-4-6'), 0);
});

test('estimateCost with cache breakdown', () => {
  // haiku: 1M cache_read ($0.08) + 1M cache_write ($1.00) = $1.08
  const cost = estimateCost(
    { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 },
    'claude-haiku-4-5-20251001',
  );
  assert.strictEqual(cost, 1.08);
});
