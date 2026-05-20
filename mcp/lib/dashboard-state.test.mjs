// @covers mcp/lib/dashboard-state.js — extractLatestBlock
// TDD test for the latestBlock extraction function (r-3927bd13 Task 2/3).
//
// Design: reads dashboard-state.js as source text and extracts the pure
// `extractLatestBlock` function for isolated fixture testing. This avoids
// the full import chain (forge-core/zod dependencies not installed in
// worktree node_modules).
//
// Red bar: exits non-zero when extractLatestBlock is not exported.
// Green bar: exits 0 after the export + implementation is added.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'dashboard-state.js'), 'utf8');

// ── Helper: extract a named pure function from source text ───────────────────
// Locates `export function <name>` and extracts its body by brace counting.
// Returns a callable function via new Function(), or null when not found.
function extractPureFn(source, name) {
  const marker = `export function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const decl = source.slice(start);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < decl.length; i++) {
    if (decl[i] === '{') depth++;
    else if (decl[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null;
  const fnSrc = decl.slice(0, end).replace(/^export /, '');
  const paramsMatch = fnSrc.match(/\(([^)]*)\)/);
  if (!paramsMatch) return null;
  const body = fnSrc.slice(fnSrc.indexOf('{') + 1, fnSrc.lastIndexOf('}'));
  // new Function creates a non-strict function — safe for pure Array-only logic.
  return new Function(paramsMatch[1], body);
}

// ── Test 1: extractLatestBlock is exported ───────────────────────────────────
// This is the red-bar test — fails against the unmodified dashboard-state.js.
test('dashboard-state exports extractLatestBlock', () => {
  assert.ok(
    src.includes('export function extractLatestBlock'),
    'dashboard-state.js must export extractLatestBlock — not found in source (red bar)'
  );
});

// ── Tests 2-5: fixture tests run only when the export exists ─────────────────
// extractPureFn returns null when the export is absent; the tests below will
// fail with a TypeError on null() — that still satisfies the red bar.
const extractLatestBlock = extractPureFn(src, 'extractLatestBlock');

test('returns null for empty agents array', () => {
  assert.equal(extractLatestBlock([]), null);
});

test('returns null when no BLOCK outcome exists', () => {
  const agents = [
    { agentId: 'a1', agentType: 'forge:reviewer-boundary', outcome: 'APPROVED' },
    { agentId: 'a2', agentType: 'forge:reviewer-safety',   outcome: 'REVISE' },
  ];
  assert.equal(extractLatestBlock(agents), null);
});

test('returns non-null with reviewer and reviseCount when BLOCK exists', () => {
  const agents = [
    { agentId: 'a1', agentType: 'forge:reviewer-boundary', outcome: 'REVISE' },
    { agentId: 'a2', agentType: 'forge:reviewer-safety',   outcome: 'BLOCK' },
  ];
  const result = extractLatestBlock(agents);
  assert.notEqual(result, null, 'result must be non-null when BLOCK exists');
  assert.equal(result.reviewer, 'reviewer-safety', 'forge: prefix must be stripped from agentType');
  assert.equal(result.reviseCount, 1, 'one REVISE agent counted');
});

test('most recent (last in array) BLOCK agent wins when multiple BLOCKs present', () => {
  const agents = [
    { agentId: 'c1', agentType: 'forge:reviewer-logic',    outcome: 'BLOCK' },
    { agentId: 'c2', agentType: 'forge:reviewer-boundary', outcome: 'REVISE' },
    { agentId: 'c3', agentType: 'forge:reviewer-safety',   outcome: 'BLOCK' },
  ];
  const result = extractLatestBlock(agents);
  assert.notEqual(result, null);
  assert.equal(result.reviewer, 'reviewer-safety', 'last BLOCK in array wins');
  assert.equal(result.reviseCount, 1, 'one REVISE counted across all agents');
});

// ── Test 6: latestBlock is wired into activeRuns assembly ────────────────────
// Red bar for the second edit: fails until `latestBlock: extractLatestBlock(...)`
// appears in the activeRuns return object in buildDashboardState.
test('activeRuns assembly includes latestBlock field (wired via extractLatestBlock)', () => {
  assert.ok(
    src.includes('latestBlock: extractLatestBlock('),
    'dashboard-state.js must wire latestBlock into the activeRuns assembly object — not yet found (red bar for second edit)'
  );
});
