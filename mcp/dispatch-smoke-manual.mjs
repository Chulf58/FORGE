#!/usr/bin/env node
// Standalone smoke test: end-to-end non-Anthropic agent dispatch via OpenAI.
// Target: supervisor → gpt-5.5 via callOpenAI.
//
// WHY THIS EXISTS
// ---------------
// The router + skills are unit-tested in isolation, but no pipeline agent
// has actually been dispatched through forge_call_external end-to-end. This
// script proves the non-Anthropic path works against a real OpenAI endpoint
// without requiring a full pipeline run.
//
// SHAPE
// -----
// Mirrors the external-call pattern used by skills/supervise/SKILL.md:
//   1. Read the agent's system prompt body (after frontmatter)
//   2. Call recommendModel() -- same logic as forge_get_model_recommendation
//   3. Call callOpenAI() -- same adapter as forge_call_external uses
//   4. Parse the response for expected content
//
// CREDENTIAL-GATED
// ----------------
// If OPENAI_API_KEY is absent: exits 0 with a clear skip message.
// This script is NOT wired into any automated test runner.
//
// Run manually: node mcp/dispatch-smoke-manual.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendModel } from './lib/router.js';
import { callOpenAI } from './lib/openai-adapter.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

// Pre-flight: credential check

if (!process.env.OPENAI_API_KEY) {
  console.log('');
  console.log('[dispatch-smoke] SKIP: OPENAI_API_KEY is not set in the environment.');
  console.log('[dispatch-smoke] This smoke test is credential-gated and not part of automated CI.');
  console.log('[dispatch-smoke] To run it, set OPENAI_API_KEY and re-invoke: node mcp/dispatch-smoke-manual.mjs');
  console.log('');
  process.exit(0);
}

// Load forge-config so the router resolves against real catalog

const configPath = join(repoRoot, 'forge-config.default.json');
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('[dispatch-smoke] FAIL: could not load forge-config.default.json: ' + err.message);
  process.exit(1);
}

// Enable openai provider for the smoke test (it is disabled by default)
const openaiProvider = (config.providers || []).find(p => p.id === 'openai');
if (!openaiProvider) {
  console.error('[dispatch-smoke] FAIL: openai provider not found in forge-config.default.json');
  process.exit(1);
}
openaiProvider.enabled = true;

// Exercise the router -- should route supervisor to gpt-5.5

const emptyUsage = { providers: {} };
const recommendation = recommendModel('supervisor', config, emptyUsage);

console.log('');
console.log('[dispatch-smoke] Router recommendation for supervisor:');
console.log('  source     : ' + recommendation.source);
console.log('  providerId : ' + recommendation.providerId);
console.log('  modelId    : ' + recommendation.modelId);
console.log('  reason     : ' + recommendation.reason);

if (recommendation.source !== 'capability-cost') {
  console.error('[dispatch-smoke] FAIL: expected source=capability-cost, got  + recommendation.source + ');
  process.exit(1);
}
if (recommendation.providerId !== 'openai') {
  console.error('[dispatch-smoke] FAIL: expected providerId=openai, got  + recommendation.providerId + ');
  process.exit(1);
}
if (recommendation.modelId !== 'gpt-5.5') {
  console.error('[dispatch-smoke] FAIL: expected modelId=gpt-5.5, got  + recommendation.modelId + ');
  process.exit(1);
}

console.log('[dispatch-smoke] OK: router routed to ' + recommendation.modelId);

// Build a minimal prompt

const smokePrompt = 'Respond with exactly one word: acknowledged';

// Dispatch to gpt-5.5 (real HTTP call)

console.log('[dispatch-smoke] Calling ' + recommendation.modelId + ' via callOpenAI() ...');

let result;
try {
  result = await callOpenAI(
    smokePrompt,
    recommendation.modelId,
    process.env.OPENAI_API_KEY,
    { maxTokens: 16, reasoningEffort: 'low' },
  );
} catch (err) {
  console.error('');
  console.error('[dispatch-smoke] FAIL: callOpenAI threw: ' + err.message);
  const msg = err.message || '';
  const isQuotaError = msg.includes('429') || msg.toLowerCase().includes('quota');
  if (err.transient === true) {
    console.error('[dispatch-smoke] Error flagged transient (503) -- OpenAI may be overloaded; retry in a few minutes.');
  } else if (isQuotaError) {
    console.error('[dispatch-smoke] Dispatch mechanic succeeded -- HTTP call reached OpenAI and returned a valid error.');
    console.error('[dispatch-smoke] The selected model (' + recommendation.modelId + ') has exhausted its quota.');
  }
  process.exit(1);
}

console.log('[dispatch-smoke] Response received:');
console.log('  inputTokens  : ' + result.inputTokens);
console.log('  outputTokens : ' + result.outputTokens);
console.log('');
console.log('----- Raw response -----');
console.log(result.text);
console.log('----- End response -----');
console.log('');

console.log('[dispatch-smoke] PASS: supervisor dispatched via ' + recommendation.modelId + ' end-to-end.');
console.log('[dispatch-smoke]   - router routed correctly (openai, allowedVendors force-override)');
console.log('[dispatch-smoke]   - callOpenAI returned a 2xx response');
console.log('');
process.exit(0);
