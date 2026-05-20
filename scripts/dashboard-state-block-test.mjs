// @covers mcp/lib/dashboard-state.js — latestBlock extraction
// TDD red-bar oracle for Task 2 (r-3927bd13).
//
// Design: reads dashboard-state.js as text to extract the pure `extractLatestBlock`
// function in isolation (no import chain, no node_modules required).
// Red bar: exits 1 when the export is absent (unmodified file).
// Green bar: exits 0 after Task 3 adds the export and implementation.

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../mcp/lib/dashboard-state.js'), 'utf8');

// ── Red-bar guard ─────────────────────────────────────────────────────────────
// Fails against unmodified dashboard-state.js (no extractLatestBlock export).
if (!src.includes('export function extractLatestBlock')) {
  console.error('FAIL [AC-2]: dashboard-state.js does not export extractLatestBlock');
  process.exit(1);
}

// ── Extract the pure function for isolated fixture testing ─────────────────────
// extractLatestBlock is a pure Array-only function with no external dependencies.
// We locate the function body by brace counting and instantiate it via new Function.
const fnStart = src.indexOf('export function extractLatestBlock');
const fnDecl = src.slice(fnStart);

let depth = 0;
let end = -1;
for (let i = 0; i < fnDecl.length; i++) {
  if (fnDecl[i] === '{') depth++;
  else if (fnDecl[i] === '}') {
    depth--;
    if (depth === 0) { end = i + 1; break; }
  }
}

if (end === -1) {
  console.error('FAIL: Could not parse extractLatestBlock body from source');
  process.exit(1);
}

const fnSrc = fnDecl.slice(0, end).replace(/^export /, '');
// Extract param list and body for new Function()
const paramsMatch = fnSrc.match(/\(([^)]*)\)/);
assert.ok(paramsMatch, 'extractLatestBlock must have a parameter list');
const fnBody = fnSrc.slice(fnSrc.indexOf('{') + 1, fnSrc.lastIndexOf('}'));
// new Function creates a non-strict-mode function from body only; no imports needed.
const extractLatestBlock = new Function(paramsMatch[1], fnBody);

// ── Fixture tests (green bar) ─────────────────────────────────────────────────

// Fixture 1: run with one BLOCK agent — latestBlock must be non-null
const agentsWithBlock = [
  { agentId: 'a1', agentType: 'forge:reviewer-boundary', startedAt: 1000, completedAt: 2000, durationMs: 1000, outcome: 'REVISE' },
  { agentId: 'a2', agentType: 'forge:reviewer-safety',   startedAt: 1100, completedAt: 2200, durationMs: 1100, outcome: 'BLOCK' },
];
const block = extractLatestBlock(agentsWithBlock);
assert.notEqual(block, null, '[AC-3] latestBlock must be non-null when a BLOCK outcome exists');
assert.equal(typeof block.reviewer, 'string', '[AC-3] latestBlock.reviewer must be a string');
assert.equal(block.reviewer, 'reviewer-safety', '[AC-3] reviewer name must strip forge: prefix from agentType');
assert.equal(typeof block.reviseCount, 'number', '[AC-3] latestBlock.reviseCount must be a number');
assert.equal(block.reviseCount, 1, '[AC-3] one REVISE agent → reviseCount = 1');

// Fixture 2: run with no BLOCK agents — latestBlock must be null
const agentsNoBlock = [
  { agentId: 'b1', agentType: 'forge:reviewer-boundary', startedAt: 1000, completedAt: 2000, durationMs: 1000, outcome: 'APPROVED' },
];
const noBlock = extractLatestBlock(agentsNoBlock);
assert.equal(noBlock, null, '[AC-3] latestBlock must be null when no BLOCK outcome exists');

// Fixture 3: empty agents array
const noBlockEmpty = extractLatestBlock([]);
assert.equal(noBlockEmpty, null, '[AC-3] latestBlock must be null for empty agents array');

// Fixture 4: multiple BLOCK agents — most recent (last in array) wins
const agentsMultiBlock = [
  { agentId: 'c1', agentType: 'forge:reviewer-logic',    outcome: 'BLOCK' },
  { agentId: 'c2', agentType: 'forge:reviewer-boundary', outcome: 'REVISE' },
  { agentId: 'c3', agentType: 'forge:reviewer-safety',   outcome: 'BLOCK' },
];
const multiBlock = extractLatestBlock(agentsMultiBlock);
assert.notEqual(multiBlock, null, '[AC-3] latestBlock must be non-null with multiple BLOCKs');
assert.equal(multiBlock.reviewer, 'reviewer-safety', '[AC-3] most recent (last in array) BLOCK agent wins');
assert.equal(multiBlock.reviseCount, 1, '[AC-3] one REVISE agent counted across all agents');

console.log('dashboard-state-block-test: all assertions passed');
