#!/usr/bin/env node
// Standalone smoke test: end-to-end non-Anthropic agent dispatch.
// Target: researcher → Gemini Flash via callGemini.
//
// WHY THIS EXISTS
// ---------------
// The router + skills are unit-tested in isolation, but no pipeline agent
// has actually been dispatched through forge_call_external end-to-end. This
// script proves the non-Anthropic path works against a real Gemini endpoint
// without requiring a full pipeline run.
//
// SHAPE
// -----
// Mirrors the external-call pattern used by skills/supervise/SKILL.md:
//   1. Read the agent's system prompt body (after frontmatter)
//   2. Call recommendModel() — same logic as forge_get_model_recommendation
//   3. Call callGemini() — same adapter as forge_call_external uses
//   4. Parse the response for the expected signal markers
//
// CREDENTIAL-GATED
// ----------------
// If GEMINI_API_KEY is absent: exits 0 with a clear skip message.
// This script is NOT wired into any automated test runner.
//
// Run manually: node mcp/dispatch-smoke-test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendModel } from './lib/router.js';
import { callGemini } from './lib/gemini-adapter.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..');

// ── Pre-flight: credential check ─────────────────────────────────────────────

if (!process.env.GEMINI_API_KEY) {
  console.log('');
  console.log('[dispatch-smoke] SKIP: GEMINI_API_KEY is not set in the environment.');
  console.log('[dispatch-smoke] This smoke test is credential-gated and not part of automated CI.');
  console.log('[dispatch-smoke] To run it, set GEMINI_API_KEY and re-invoke: node mcp/dispatch-smoke-test.mjs');
  console.log('');
  process.exit(0);
}

// ── Load forge-config so the router resolves against real catalog ────────────

const configPath = join(repoRoot, 'forge-config.default.json');
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (err) {
  console.error('[dispatch-smoke] FAIL: could not load forge-config.default.json: ' + err.message);
  process.exit(1);
}

// ── Read the researcher agent body (content after frontmatter) ────────

const agentPath = join(repoRoot, 'agents', 'researcher.md');
let agentMarkdown;
try {
  agentMarkdown = readFileSync(agentPath, 'utf-8');
} catch (err) {
  console.error('[dispatch-smoke] FAIL: could not read agents/researcher.md: ' + err.message);
  process.exit(1);
}

function extractBody(markdown) {
  // Frontmatter shape: '---\n<yaml>\n---\n<body>'. If not present, return as-is.
  if (!markdown.startsWith('---')) return markdown;
  const secondFence = markdown.indexOf('\n---', 3);
  if (secondFence === -1) return markdown;
  // skip '\n---' and any following newline
  return markdown.slice(secondFence + 4).replace(/^\r?\n/, '');
}

const agentBody = extractBody(agentMarkdown);
if (!agentBody || agentBody.length < 100) {
  console.error('[dispatch-smoke] FAIL: agent body looks too short after frontmatter extraction (' + agentBody.length + ' chars)');
  process.exit(1);
}

// ── Exercise the router — should route researcher to Gemini Flash ─────

const emptyUsage = { providers: {} };
const recommendation = recommendModel('researcher', config, emptyUsage);

console.log('');
console.log('[dispatch-smoke] Router recommendation for researcher:');
console.log('  source     : ' + recommendation.source);
console.log('  providerId : ' + recommendation.providerId);
console.log('  modelId    : ' + recommendation.modelId);
console.log('  reason     : ' + recommendation.reason);

if (recommendation.source !== 'capability-cost') {
  console.error('[dispatch-smoke] FAIL: expected source="capability-cost", got "' + recommendation.source + '"');
  process.exit(1);
}
if (recommendation.providerId !== 'gemini') {
  console.error('[dispatch-smoke] FAIL: expected providerId="gemini", got "' + recommendation.providerId + '"');
  console.error('[dispatch-smoke] This means forge-config.default.json no longer routes researcher to Gemini — check capabilities.');
  process.exit(1);
}
// Accept any gemini "flash" variant — 2.0-flash, 2.5-flash, 2.5-flash-lite,
// 3.1-flash-lite-preview all satisfy researcher's [analysis] requirement
// at costTier: free. The exact winner depends on alphabetical tiebreak across
// equal-cost free models in the committed catalog. We intentionally do NOT pin
// to a specific flash version — that would silently diverge from the real
// router behavior as the catalog evolves.
if (!recommendation.modelId || !/^gemini-.*flash/i.test(recommendation.modelId)) {
  console.error('[dispatch-smoke] FAIL: expected a gemini-*-flash* model, got "' + recommendation.modelId + '"');
  process.exit(1);
}

console.log('[dispatch-smoke] OK: router routed to ' + recommendation.modelId + ' (free tier)');

// ── Build injected-context prompt per GENERAL.md's context-injection map ─────
// For researcher the spec injects docs/PLAN.md + docs/gotchas/GENERAL.md.
// We use a minimal realistic fixture instead of reading real project docs.

const FIXTURE_PLAN = [
  '# Plan',
  '',
  '### Feature: dispatch-smoke-demo',
  '',
  '- [ ] 1. Demonstrate non-Anthropic dispatch end-to-end',
  '',
  '### Research needed',
  '',
  '1. What is the maximum stdin payload size for Node.js readline before it starts dropping data?',
  '2. Does `fsPromises.cp` follow symlinks by default on Windows, or does it copy the link target?',
  '',
].join('\n');

const FIXTURE_GENERAL_EXCERPT = [
  '## Platform differences (Windows)',
  '- Hook scripts run via `node` — ensure `node` is on PATH',
  '- Path separators: use `path.join()` / `path.resolve()` in hook scripts, never string concatenation',
  '- Temp files go to `os.tmpdir()` — never hardcode `/tmp/`',
  '- `fsPromises.cp` requires Node 16.7+; the import handler includes a `copyDirRecursive` fallback',
  '',
].join('\n');

const injectedPrompt = [
  agentBody.trim(),
  '',
  '[CONTEXT]',
  '',
  'docs/PLAN.md:',
  FIXTURE_PLAN,
  '',
  'docs/gotchas/GENERAL.md (excerpt):',
  FIXTURE_GENERAL_EXCERPT,
  '',
  '[TASK]',
  'Emit one [brief-for: N] block per numbered question in the "### Research needed" section of the PLAN above. Follow the output format defined in your instructions exactly — no preamble, no trailing commentary.',
  '',
].join('\n');

// ── Dispatch to Gemini Flash (real HTTP call) ────────────────────────────────

console.log('[dispatch-smoke] Calling ' + recommendation.modelId + ' via callGemini() ...');

let result;
try {
  result = await callGemini(
    injectedPrompt,
    recommendation.modelId,
    process.env.GEMINI_API_KEY,
    { maxTokens: 4096 },
  );
} catch (err) {
  console.error('');
  console.error('[dispatch-smoke] FAIL: callGemini threw: ' + err.message);
  const msg = err.message || '';
  const isQuotaError = msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
  if (err.transient === true) {
    console.error('[dispatch-smoke] Error flagged transient (503) — Gemini may be overloaded; retry in a few minutes.');
  } else if (isQuotaError) {
    console.error('[dispatch-smoke] Dispatch MECHANIC succeeded — HTTP call reached Gemini and returned a valid error.');
    console.error('[dispatch-smoke] The selected model (' + recommendation.modelId + ') has exhausted its quota.');
    console.error('[dispatch-smoke] This is a catalog/quota issue, not a dispatch-path issue.');
    console.error('[dispatch-smoke] Consider: remove deprecated models from forge-config.default.json, or wait for quota reset.');
  }
  process.exit(1);
}

console.log('[dispatch-smoke] Response received:');
console.log('  inputTokens  : ' + result.inputTokens);
console.log('  outputTokens : ' + result.outputTokens);
console.log('');
console.log('───── Raw response ─────');
console.log(result.text);
console.log('───── End response ─────');
console.log('');

// ── Parse [brief-for: N] signal markers ──────────────────────────────────────

const briefRegex = /\[brief-for:\s*(\d+)\]([\s\S]*?)\[\/brief-for\]/g;
const briefs = Array.from(result.text.matchAll(briefRegex));

if (briefs.length === 0) {
  console.error('[dispatch-smoke] FAIL: no [brief-for: N] blocks in response.');
  console.error('[dispatch-smoke] The dispatch call succeeded but the model did not follow researcher output protocol.');
  console.error('[dispatch-smoke] This is a content-quality issue with the model, not a dispatch failure.');
  process.exit(1);
}

const numbers = briefs.map(m => Number(m[1])).sort((a, b) => a - b);
console.log('[dispatch-smoke] Parsed ' + briefs.length + ' [brief-for: N] block(s) for question number(s): ' + numbers.join(', '));

const expected = [1, 2];
const missing = expected.filter(n => !numbers.includes(n));
if (missing.length > 0) {
  console.log('[dispatch-smoke] PARTIAL: missing brief block(s) for question number(s): ' + missing.join(', '));
  console.log('[dispatch-smoke] Dispatch mechanic works; content coverage is partial. Treated as pass.');
}

console.log('');
console.log('[dispatch-smoke] PASS: researcher dispatched via ' + recommendation.modelId + ' end-to-end.');
console.log('[dispatch-smoke]   - router routed correctly (gemini free tier)');
console.log('[dispatch-smoke]   - callGemini returned a 2xx response');
console.log('[dispatch-smoke]   - response contained parseable [brief-for: N] markers');
console.log('');
process.exit(0);
