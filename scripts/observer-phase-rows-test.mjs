#!/usr/bin/env node
// @covers scripts/forge-observer.mjs
// Test for AC-2 and AC-3: Phase rows rendering and dynamic X/Y count
//
// AC-2: WHEN `renderPhaseRows` receives entries where `phases[0].label` exists
// (loop mode), the output shows one outer row per phase with status indicator,
// completed phases include commit hash, and the running phase renders indented
// inner agent rows. WHEN `phases[0]` has no `label` field (single-pass fallback),
// the output shows flat agent rows with no outer phase header.
//
// AC-3: WHEN a run fixture has `run.phases` with 6 entries the rendered count
// reads `X/6`; WHEN a fixture has 5 entries the count reads `X/5`; the
// denominator equals `run.phases.length` and is NOT a hard-coded constant.
//
// Run: node --test scripts/observer-phase-rows-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load renderPhaseRows function by extracting it from forge-observer.mjs source.
async function loadRenderPhaseRowsFunction() {
  const src = readFileSync(path.join(__dirname, 'forge-observer.mjs'), 'utf8');

  // Extract the renderPhaseRows function definition
  const fnMatch = src.match(/function renderPhaseRows\s*\([^)]*\)\s*{[\s\S]*?^}/m);

  if (!fnMatch) {
    return null; // Function not found - test will fail
  }

  const mod = {};
  try {
    const fn = new Function('module', 'exports', fnMatch[0] + '\nmodule.exports = { renderPhaseRows };');
    fn(mod, mod);
    return mod.exports.renderPhaseRows;
  } catch (err) {
    return null;
  }
}

// Load computePhaseCount function by extracting it from forge-observer.mjs source.
async function loadComputePhaseCountFunction() {
  const src = readFileSync(path.join(__dirname, 'forge-observer.mjs'), 'utf8');

  // Extract the computePhaseCount function definition
  const fnMatch = src.match(/function computePhaseCount\s*\([^)]*\)\s*{[\s\S]*?^}/m);

  if (!fnMatch) {
    return null; // Function not found - test will fail
  }

  const mod = {};
  try {
    const fn = new Function('module', 'exports', fnMatch[0] + '\nmodule.exports = { computePhaseCount };');
    fn(mod, mod);
    return mod.exports.computePhaseCount;
  } catch (err) {
    return null;
  }
}

// ── AC-2 Tests ──────────────────────────────────────────────────────────

test('AC-2(a): renderPhaseRows must be exported from forge-observer.mjs', async (t) => {
  const renderPhaseRows = await loadRenderPhaseRowsFunction();
  assert(typeof renderPhaseRows === 'function',
    'renderPhaseRows must be exported as a function from forge-observer.mjs');
});

test('AC-2(b): renderPhaseRows with labeled phases returns rows including phase header rows', async (t) => {
  const renderPhaseRows = await loadRenderPhaseRowsFunction();
  assert(renderPhaseRows !== null, 'renderPhaseRows function must exist');

  const phases = [
    { index: 0, label: 'Phase 1: Planning', status: 'completed', committedAt: '1a2b3c4d5e6f7890' },
    { index: 1, label: 'Phase 2: Implementing', status: 'running' },
    { index: 2, label: 'Phase 3: Review', status: 'pending' },
  ];

  const rows = renderPhaseRows(phases, []);

  assert(Array.isArray(rows), 'renderPhaseRows must return an array');
  assert(rows.length > 0, 'renderPhaseRows with labeled phases must return rows');

  // Loop mode should have phase rows (with label or status info)
  const hasPhaseInfo = rows.some(row => {
    const str = JSON.stringify(row);
    return str.includes('Phase 1') || str.includes('Phase 2') || str.includes('completed') || str.includes('running');
  });
  assert(hasPhaseInfo, 'Loop mode must render phase information in rows');
});

test('AC-2(c): renderPhaseRows with unlabeled phases returns flat agent rows (fallback)', async (t) => {
  const renderPhaseRows = await loadRenderPhaseRowsFunction();
  assert(renderPhaseRows !== null, 'renderPhaseRows function must exist');

  const phases = [
    { index: 0, status: 'completed' }, // No label field
    { index: 1, status: 'running' },
  ];
  const agents = [
    { agentType: 'agent-1' },
    { agentType: 'agent-2' },
  ];

  const rows = renderPhaseRows(phases, agents);

  assert(Array.isArray(rows), 'renderPhaseRows must return an array in fallback mode');
  assert(rows.length > 0, 'renderPhaseRows in fallback mode must return rows');
});

test('AC-2(d): Completed phase includes commit hash in renderPhaseRows output', async (t) => {
  const renderPhaseRows = await loadRenderPhaseRowsFunction();
  assert(renderPhaseRows !== null, 'renderPhaseRows function must exist');

  const phases = [
    { index: 0, label: 'Phase 1', status: 'completed', committedAt: '1a2b3c4d5e6f7890' },
  ];

  const rows = renderPhaseRows(phases, []);

  // The commit hash (or at least first 7 chars) should appear somewhere in the rows
  const output = JSON.stringify(rows);
  const hasCommit = output.includes('1a2b3c4') || output.includes('1a2b3c4d5e6f7890');
  assert(hasCommit, 'Completed phase must include commit hash in rendered rows');
});

// ── AC-3 Tests ──────────────────────────────────────────────────────────

test('AC-3(a): computePhaseCount must be exported from forge-observer.mjs', async (t) => {
  const computePhaseCount = await loadComputePhaseCountFunction();
  assert(typeof computePhaseCount === 'function',
    'computePhaseCount must be exported as a function from forge-observer.mjs');
});

test('AC-3(b): computePhaseCount with 6 phases returns count with denominator 6', async (t) => {
  const computePhaseCount = await loadComputePhaseCountFunction();
  assert(computePhaseCount !== null, 'computePhaseCount function must exist');

  const phases = Array.from({ length: 6 }, (_, i) => ({
    index: i,
    label: `Phase ${i + 1}`,
    status: i < 3 ? 'completed' : 'pending',
  }));

  const count = computePhaseCount(phases, 3);

  assert.strictEqual(count, '3/6',
    'computePhaseCount(6-phase array, 3) must return "3/6"');
  assert.strictEqual(count.split('/')[1], '6',
    'Denominator must be 6, derived from phases.length');
});

test('AC-3(c): computePhaseCount with 5 phases returns count with denominator 5', async (t) => {
  const computePhaseCount = await loadComputePhaseCountFunction();
  assert(computePhaseCount !== null, 'computePhaseCount function must exist');

  const phases = Array.from({ length: 5 }, (_, i) => ({
    index: i,
    label: `Phase ${i + 1}`,
    status: i < 2 ? 'completed' : 'pending',
  }));

  const count = computePhaseCount(phases, 2);

  assert.strictEqual(count, '2/5',
    'computePhaseCount(5-phase array, 2) must return "2/5"');
  assert.strictEqual(count.split('/')[1], '5',
    'Denominator must be 5, derived from phases.length');
});

test('AC-3(d): computePhaseCount denominator is dynamic, not hard-coded', async (t) => {
  const computePhaseCount = await loadComputePhaseCountFunction();
  assert(computePhaseCount !== null, 'computePhaseCount function must exist');

  const counts = {};
  for (const len of [1, 3, 5, 6, 10]) {
    const phases = Array.from({ length: len }, (_, i) => ({
      index: i,
      status: 'pending',
    }));
    const count = computePhaseCount(phases, 1);
    counts[len] = count;
  }

  // Each count should have its own denominator matching phases.length
  assert.strictEqual(counts[1].split('/')[1], '1', 'Expected denominator 1');
  assert.strictEqual(counts[3].split('/')[1], '3', 'Expected denominator 3');
  assert.strictEqual(counts[5].split('/')[1], '5', 'Expected denominator 5');
  assert.strictEqual(counts[6].split('/')[1], '6', 'Expected denominator 6');
  assert.strictEqual(counts[10].split('/')[1], '10', 'Expected denominator 10');

  // Verify not all the same (would indicate hard-coded value)
  const uniqueCounts = new Set(Object.values(counts));
  assert(uniqueCounts.size > 1,
    'Denominators must vary based on phases.length (not hard-coded)');
});
