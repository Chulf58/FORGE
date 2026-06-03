#!/usr/bin/env node
// @covers mcp/forge-worker.mjs
//
// task-47 (the flip): after the Phase-E soak exit bar cleared (APPROVED r-00c32feb, BLOCK
// r-053032de, REVISE→APPROVE AC-6c), the implement pipeline graduates from opt-in to the
// default. Remove the `process.env.FORGE_ORCHESTRATOR_IMPLEMENT === 'on'` env-gate so an
// `implement` pipelineType routes UNCONDITIONALLY to runImplementStageOrchestrator. The
// FORGE_ORCHESTRATOR_PLAN gate and the prose `else` branch (debug/refactor/research/ideate/
// spawn) stay (Phase 2 removes the prose branch later). This is the AC-47 oracle as a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'forge-worker.mjs'), 'utf-8');

test('AC-47: the FORGE_ORCHESTRATOR_IMPLEMENT env-gate is gone (implement no longer opt-in)', () => {
  assert.doesNotMatch(SRC, /FORGE_ORCHESTRATOR_IMPLEMENT/, 'the implement env-gate must be deleted by the flip');
});

test('AC-47: implement routes to runImplementStageOrchestrator gated only on pipelineType', () => {
  assert.match(SRC, /else if \(pipelineType === 'implement'\)/, 'implement branch must be unconditional (no env flag)');
  assert.match(SRC, /runImplementStageOrchestrator\(/, 'implement must still invoke the deterministic orchestrator');
});

test('AC-47: the FORGE_ORCHESTRATOR_PLAN gate is RETAINED (plan stage is not flipped)', () => {
  assert.match(SRC, /FORGE_ORCHESTRATOR_PLAN === 'on'/, 'plan stage stays opt-in');
});

test('AC-47: the prose else branch remains (debug/refactor/research/ideate/spawn fallback)', () => {
  assert.match(SRC, /\n\s*} else \{/, 'the LLM-prose else branch must remain for non-orchestrated pipelines');
});
