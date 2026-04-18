#!/usr/bin/env node
// Regression tests for mcp/lib/usage-store.js — per-model + provider-level quota.
//
// Uses an isolated tmpdir as projectDir so tests do not touch real project state.
// Run: node mcp/usage-store-test.mjs

import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readUsage,
  writeUsage,
  markQuotaExhausted,
  markModelQuotaExhausted,
  isModelQuotaExhausted,
  recordUsage,
} from './lib/usage-store.js';

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

function makeTmpProject() {
  const dir = join(tmpdir(), 'forge-usage-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n── usage-store-test.mjs ─────────────────────────────────────────────────');

// 1. readUsage on missing file returns empty usage
{
  const dir = makeTmpProject();
  const usage = readUsage(dir);
  assert(usage && typeof usage === 'object' && usage.providers && Object.keys(usage.providers).length === 0,
    'readUsage: missing file → empty usage object with empty providers');
  cleanup(dir);
}

// 2. markQuotaExhausted sets provider-wide flag
{
  const dir = makeTmpProject();
  markQuotaExhausted(dir, 'gemini');
  const usage = readUsage(dir);
  assert(usage.providers.gemini.quotaExhausted === true,
    'markQuotaExhausted: provider-wide flag set to true');
  cleanup(dir);
}

// 3. markModelQuotaExhausted creates provider + model entries and sets model-level flag
{
  const dir = makeTmpProject();
  markModelQuotaExhausted(dir, 'gemini', 'gemini-2.5-pro');
  const usage = readUsage(dir);
  assert(usage.providers.gemini, 'markModelQuotaExhausted: provider entry created');
  assert(usage.providers.gemini.models, 'markModelQuotaExhausted: models map created');
  assert(usage.providers.gemini.models['gemini-2.5-pro'].quotaExhausted === true,
    'markModelQuotaExhausted: model-level flag set to true');
  assert(usage.providers.gemini.quotaExhausted === false,
    'markModelQuotaExhausted: provider-wide flag NOT set (only the model is exhausted)');
  cleanup(dir);
}

// 4. markModelQuotaExhausted does not poison other models on the same provider
{
  const dir = makeTmpProject();
  markModelQuotaExhausted(dir, 'gemini', 'gemini-2.5-pro');
  const usage = readUsage(dir);
  assert(!usage.providers.gemini.models['gemini-2.5-flash'],
    'markModelQuotaExhausted: only the named model gets an entry');
  assert(isModelQuotaExhausted(usage, 'gemini', 'gemini-2.5-pro') === true,
    'isModelQuotaExhausted: returns true for the exhausted model');
  assert(isModelQuotaExhausted(usage, 'gemini', 'gemini-2.5-flash') === false,
    'isModelQuotaExhausted: returns false for other models on same provider (no poisoning)');
  cleanup(dir);
}

// 5. markModelQuotaExhausted is idempotent
{
  const dir = makeTmpProject();
  markModelQuotaExhausted(dir, 'gemini', 'gemini-2.5-pro');
  markModelQuotaExhausted(dir, 'gemini', 'gemini-2.5-pro');
  const usage = readUsage(dir);
  assert(usage.providers.gemini.models['gemini-2.5-pro'].quotaExhausted === true,
    'idempotent: second call keeps flag true');
  cleanup(dir);
}

// 6. isModelQuotaExhausted — provider-wide flag blocks all models (even unmarked ones)
{
  const usage = { providers: { gemini: { quotaExhausted: true } } };
  assert(isModelQuotaExhausted(usage, 'gemini', 'gemini-2.5-flash') === true,
    'isModelQuotaExhausted: provider-wide flag blocks even unmarked models');
  assert(isModelQuotaExhausted(usage, 'gemini', 'gemini-2.5-pro') === true,
    'isModelQuotaExhausted: provider-wide flag blocks all models uniformly');
}

// 7. isModelQuotaExhausted — backward compat with old-format usage (no models key)
{
  const oldFormat = { providers: { gemini: { quotaExhausted: false, requestCount: 5 } } };
  assert(isModelQuotaExhausted(oldFormat, 'gemini', 'gemini-2.5-pro') === false,
    'backward compat: old-format usage with no models key returns false for any model');
}

// 8. isModelQuotaExhausted — unknown provider/model returns false
{
  assert(isModelQuotaExhausted({ providers: {} }, 'gemini', 'gemini-2.5-pro') === false,
    'safety: unknown provider returns false');
  assert(isModelQuotaExhausted(undefined, 'gemini', 'gemini-2.5-pro') === false,
    'safety: undefined usage returns false');
}

// 9. recordUsage creates model entry with quotaExhausted: false and preserves shape
{
  const dir = makeTmpProject();
  recordUsage(dir, 'gemini', 100, 'gemini-2.5-flash');
  const usage = readUsage(dir);
  const modelEntry = usage.providers.gemini.models['gemini-2.5-flash'];
  assert(modelEntry.requestCount === 1, 'recordUsage: model requestCount incremented');
  assert(modelEntry.tokenCount === 100, 'recordUsage: model tokenCount recorded');
  assert(modelEntry.quotaExhausted === false, 'recordUsage: new model entry has quotaExhausted: false');
  cleanup(dir);
}

// 10. markModelQuotaExhausted then recordUsage on the same model preserves the flag
{
  const dir = makeTmpProject();
  markModelQuotaExhausted(dir, 'gemini', 'gemini-2.5-pro');
  recordUsage(dir, 'gemini', 50, 'gemini-2.5-pro');
  const usage = readUsage(dir);
  assert(usage.providers.gemini.models['gemini-2.5-pro'].quotaExhausted === true,
    'markModel then recordUsage: quotaExhausted flag survives recordUsage (recordUsage does not clobber it)');
  assert(usage.providers.gemini.models['gemini-2.5-pro'].requestCount === 1,
    'markModel then recordUsage: requestCount still increments');
  cleanup(dir);
}

// 11. Old-format usage.json on disk still reads cleanly (no crash)
{
  const dir = makeTmpProject();
  const oldPayload = {
    providers: {
      gemini: { requestCount: 3, tokenCount: 500, lastUsed: '2026-04-01T00:00:00Z', quotaExhausted: false, resetAt: null },
    },
    updatedAt: '2026-04-01T00:00:00Z',
  };
  writeFileSync(join(dir, '.pipeline', 'usage.json'), JSON.stringify(oldPayload, null, 2), 'utf-8');
  const usage = readUsage(dir);
  assert(usage.providers.gemini.requestCount === 3,
    'backward compat on disk: old-format usage.json reads without error');
  assert(usage.providers.gemini.models === undefined,
    'backward compat on disk: old-format has no models key');
  assert(isModelQuotaExhausted(usage, 'gemini', 'gemini-2.5-flash') === false,
    'backward compat on disk: isModelQuotaExhausted works on old-format');
  cleanup(dir);
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
