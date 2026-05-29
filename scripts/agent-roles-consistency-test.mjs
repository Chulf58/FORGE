// Config-consistency tests for the REAL .pipeline/agent-roles.json.
//
// WHY THIS EXISTS: the rest of the suite tests hook LOGIC against synthetic
// fixtures, so it stayed 126/126 green on 2026-05-29 while the actual manifest
// was stale for 15 of 28 roles (reviewers pointing at the wrong tree, dead
// roles, critic mislabeled readonly). This class validates the manifest that
// SHIPS, against the live agents — closing the "config bug hides behind green"
// gap.
//
// Each check is a PURE function tested two ways:
//   (1) against the REAL manifest  → the guard (must pass)
//   (2) against SYNTHETIC BAD input → proves the check is NON-VACUOUS (it fails
//       when the config is wrong). This is the mutation-verification, baked in.
//
// Run: node --test scripts/agent-roles-consistency-test.mjs
// @covers .pipeline/agent-roles.json

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Pure checks (return arrays of violation strings; empty = clean) ──────────

export function deadRoles(roles, agentFileSet) {
  return roles.filter(r => !agentFileSet.has(r));
}

export function unenforcedAgents(agentFileSet, manifestKeySet) {
  return [...agentFileSet].filter(a => !manifestKeySet.has(a));
}

export function schemaViolations(manifest, roles) {
  const out = [];
  for (const r of roles) {
    const e = manifest[r];
    const readonly = e.readonly === true;
    const allowed = Array.isArray(e.allowedPaths) && e.allowedPaths.length > 0
      && e.allowedPaths.every(p => typeof p === 'string' && p.length > 0);
    if (!readonly && !allowed) out.push(`${r}:neither-readonly-nor-allowedPaths`);
    if (readonly && Array.isArray(e.allowedPaths)) out.push(`${r}:both-readonly-and-allowedPaths`);
    if ('deniedPaths' in e && !Array.isArray(e.deniedPaths)) out.push(`${r}:deniedPaths-not-array`);
  }
  return out;
}

// Reviewer-typed roles write their verdict to .pipeline/context/reviewer-output/
// (confirmed: subagent-stop.js reads verdicts from that tree). The stale
// docs/context/reviewer-output/ tree broke enforcement in the 2026-05-29 audit.
export function reviewerTreeViolations(manifest, roles) {
  const out = [];
  for (const r of roles) {
    if (!(r.startsWith('reviewer') || r === 'technical-skeptic')) continue;
    const paths = manifest[r].allowedPaths || [];
    if (!paths.some(p => p.includes('.pipeline/context/reviewer-output'))) {
      out.push(`${r}:missing-pipeline-reviewer-output-tree`);
    }
    if (paths.some(p => p.includes('docs/context/reviewer-output'))) {
      out.push(`${r}:uses-stale-docs-reviewer-output-tree`);
    }
  }
  return out;
}

// ── Load the REAL manifest + live agent set ──────────────────────────────────

const manifest = JSON.parse(readFileSync(join(ROOT, '.pipeline', 'agent-roles.json'), 'utf8'));
const roles = Object.keys(manifest).filter(k => k !== '_comment');
const agentFileSet = new Set(
  readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)),
);
const manifestKeySet = new Set(roles);

// ── Guard tests against the REAL manifest ────────────────────────────────────

test('real manifest: every role maps to a live agents/<role>.md (no dead roles)', () => {
  assert.deepEqual(deadRoles(roles, agentFileSet), [],
    'manifest contains role(s) with no agent file — dead role(s) must be removed');
});

test('real manifest: every live agent has a manifest entry (no silently-unenforced agents)', () => {
  assert.deepEqual(unenforcedAgents(agentFileSet, manifestKeySet), [],
    'agent(s) exist with no agent-roles.json entry — they would fail-open (unenforced)');
});

test('real manifest: every entry is readonly:true XOR a non-empty allowedPaths[]', () => {
  assert.deepEqual(schemaViolations(manifest, roles), []);
});

test('real manifest: reviewer roles target the .pipeline/ reviewer-output tree, not docs/', () => {
  assert.deepEqual(reviewerTreeViolations(manifest, roles), []);
});

// ── Mutation-verification: the checks FAIL on synthetic-bad config ────────────

test('deadRoles catches a role with no agent file', () => {
  assert.deepEqual(deadRoles(['coder', 'zzz-dead'], new Set(['coder'])), ['zzz-dead']);
});

test('unenforcedAgents catches an agent with no role entry', () => {
  assert.deepEqual(unenforcedAgents(new Set(['coder', 'newagent']), new Set(['coder'])), ['newagent']);
});

test('schemaViolations catches neither-readonly-nor-allowedPaths, both, and bad deniedPaths', () => {
  const bad = {
    a: {},                                           // neither
    b: { readonly: true, allowedPaths: ['x/**'] },   // both
    c: { allowedPaths: ['x/**'], deniedPaths: 'no' },// deniedPaths not array
    ok: { readonly: true },                          // clean
  };
  const v = schemaViolations(bad, Object.keys(bad));
  assert.ok(v.includes('a:neither-readonly-nor-allowedPaths'));
  assert.ok(v.includes('b:both-readonly-and-allowedPaths'));
  assert.ok(v.includes('c:deniedPaths-not-array'));
  assert.ok(!v.some(x => x.startsWith('ok:')));
});

test('reviewerTreeViolations catches the stale docs/ tree AND a missing .pipeline/ tree', () => {
  const bad = { 'reviewer-x': { allowedPaths: ['docs/context/reviewer-output/**'] } };
  const v = reviewerTreeViolations(bad, ['reviewer-x']);
  assert.ok(v.includes('reviewer-x:uses-stale-docs-reviewer-output-tree'));
  assert.ok(v.includes('reviewer-x:missing-pipeline-reviewer-output-tree'));
});

test('reviewerTreeViolations passes a correctly-configured reviewer', () => {
  const good = { 'reviewer-y': { allowedPaths: ['.pipeline/context/reviewer-output/**', 'docs/context/checkpoint.md'] } };
  assert.deepEqual(reviewerTreeViolations(good, ['reviewer-y']), []);
});
