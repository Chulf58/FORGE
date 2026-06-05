#!/usr/bin/env node
// @covers scripts/forge-observer.mjs
// Test for AC-1: Stage label fix for implement-stage runs
//
// AC-1: WHEN a run's `pipelineType` is `"plan"` AND its currently-running
// stage is `"implement"`, the Pipeline detail row must display `"implement"`
// (not `"plan → implement"` as if mid-transition).
//
// Run: node --test scripts/observer-stage-label-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load computeStageLabel function by extracting it from forge-observer.mjs source.
// We read the source and extract the function to avoid the module's process.exit
// side effect when imported in non-TTY mode.
async function loadComputeStageLabelFunction() {
  const src = readFileSync(path.join(__dirname, 'forge-observer.mjs'), 'utf8');

  // Extract the computeStageLabel function definition and any dependencies
  // Look for function computeStageLabel(pipelineType, runningStage, mode) { ... }
  const fnMatch = src.match(/function computeStageLabel\s*\([^)]*\)\s*{[\s\S]*?^}/m);

  if (!fnMatch) {
    return null; // Function not found - test will fail
  }

  const mod = {};
  try {
    const fn = new Function('module', 'exports', fnMatch[0] + '\nmodule.exports = { computeStageLabel };');
    fn(mod, mod);
    return mod.exports.computeStageLabel;
  } catch (err) {
    return null;
  }
}

test('AC-1(a): computeStageLabel must be exported from forge-observer.mjs', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(typeof computeStageLabel === 'function',
    'computeStageLabel must be exported as a function from forge-observer.mjs');
});

test('AC-1(b): computeStageLabel("plan", "implement", null) returns "implement"', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(computeStageLabel !== null, 'computeStageLabel function must exist');

  const label = computeStageLabel('plan', 'implement', null);

  assert.strictEqual(label, 'implement',
    'When pipelineType="plan" and runningStage="implement", must return "implement" (not "plan → implement")');
});

test('AC-1(c): computeStageLabel("implement", null, "orchestrator") returns "implement (orchestrator)"', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(computeStageLabel !== null, 'computeStageLabel function must exist');

  const label = computeStageLabel('implement', null, 'orchestrator');

  assert.strictEqual(label, 'implement (orchestrator)',
    'Mode should be appended when there is no different running stage');
});

test('AC-1(d): computeStageLabel("plan", "plan", null) returns "plan" (no suffix)', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(computeStageLabel !== null, 'computeStageLabel function must exist');

  const label = computeStageLabel('plan', 'plan', null);

  assert.strictEqual(label, 'plan',
    'When running stage equals pipeline type, no arrow suffix should be added');
});

test('AC-1(e): computeStageLabel("research", null, "orchestrator") returns "research"', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(computeStageLabel !== null, 'computeStageLabel function must exist');

  const label = computeStageLabel('research', null, 'orchestrator');

  assert.strictEqual(label, 'research',
    'Research pipeline must exclude mode from label');
});

test('AC-1(f): computeStageLabel("apply", "reviewing", null) returns "reviewing"', async (t) => {
  const computeStageLabel = await loadComputeStageLabelFunction();
  assert(computeStageLabel !== null, 'computeStageLabel function must exist');

  const label = computeStageLabel('apply', 'reviewing', null);

  assert.strictEqual(label, 'reviewing',
    'When a different stage is running, that stage becomes the label');
});
