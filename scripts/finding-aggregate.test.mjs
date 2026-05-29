// @covers scripts/finding-aggregate.mjs
// RED BAR: Test suite for finding-aggregate.mjs aggregation logic.
//
// AC-1: parseFindingVerdicts extracts FIND-<id>: CONFIRMED|DISMISSED|NEEDS-INVESTIGATION lines
//   (a) FIND-1: CONFIRMED → {id:'1', verdict:'CONFIRMED'}
//   (b) FIND-2: DISMISSED with trailing justification → {id:'2', verdict:'DISMISSED'} (justification ignored)
//   (c) FIND-abc-def: NEEDS-INVESTIGATION → {id:'abc-def', verdict:'NEEDS-INVESTIGATION'} (hyphens in id)
//   (d) no FIND-N lines in text → [] (empty array)
//   (e) mixed lines including comment/context → extracts only FIND-N: lines
//
// AC-2: aggregateFindings applies precedence rules to per-finding verdict lists
//   (a) ≥1 CONFIRMED in verdicts → 'blocker'
//   (b) all DISMISSED (no CONFIRMED, no NEEDS-INVESTIGATION) → 'cleared'
//   (c) ≥1 NEEDS-INVESTIGATION (no CONFIRMED) → 'revise'
//   (d) precedence: CONFIRMED > NEEDS-INVESTIGATION > DISMISSED
//
// Run: node --test scripts/finding-aggregate.test.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseFindingVerdicts, aggregateFindings } from './finding-aggregate.mjs';

// ============================================================================
// AC-1: parseFindingVerdicts
// ============================================================================

test('AC-1(a): FIND-1: CONFIRMED → {id:"1", verdict:"CONFIRMED"}', () => {
  const md = 'Some text\nFIND-1: CONFIRMED\nMore text';
  const result = parseFindingVerdicts(md);
  assert.deepEqual(result, [{ id: '1', verdict: 'CONFIRMED' }]);
});

test('AC-1(b): FIND-2: DISMISSED with trailing justification ignored', () => {
  const md = 'FIND-2: DISMISSED — auth bug not in scope';
  const result = parseFindingVerdicts(md);
  assert.deepEqual(result, [{ id: '2', verdict: 'DISMISSED' }]);
});

test('AC-1(c): FIND-abc-def: NEEDS-INVESTIGATION with hyphens in id', () => {
  const md = 'FIND-abc-def: NEEDS-INVESTIGATION further review needed';
  const result = parseFindingVerdicts(md);
  assert.deepEqual(result, [{ id: 'abc-def', verdict: 'NEEDS-INVESTIGATION' }]);
});

test('AC-1(d): text with no FIND-N lines returns empty array', () => {
  const md = 'This is just commentary. No findings here.';
  const result = parseFindingVerdicts(md);
  assert.deepEqual(result, []);
});

test('AC-1(e): mixed lines; extracts only FIND-N: lines', () => {
  const md = `
Some header text
FIND-3: CONFIRMED issue found
Random comment about finding 4
FIND-5: DISMISSED not relevant
More prose
FIND-6: NEEDS-INVESTIGATION
End
`;
  const result = parseFindingVerdicts(md);
  assert.deepEqual(result, [
    { id: '3', verdict: 'CONFIRMED' },
    { id: '5', verdict: 'DISMISSED' },
    { id: '6', verdict: 'NEEDS-INVESTIGATION' },
  ]);
});

// ============================================================================
// AC-2: aggregateFindings
// ============================================================================

test('AC-2(a): ≥1 CONFIRMED in verdicts → "blocker"', () => {
  const input = {
    'FIND-001': ['CONFIRMED'],
    'FIND-002': ['CONFIRMED', 'DISMISSED'],
  };
  const result = aggregateFindings(input);
  assert.equal(result['FIND-001'].decision, 'blocker', 'single CONFIRMED → blocker');
  assert.equal(result['FIND-002'].decision, 'blocker', 'CONFIRMED + DISMISSED → blocker');
});

test('AC-2(b): all DISMISSED (no CONFIRMED, no NEEDS-INVESTIGATION) → "cleared"', () => {
  const input = {
    'FIND-003': ['DISMISSED'],
    'FIND-004': ['DISMISSED', 'DISMISSED'],
  };
  const result = aggregateFindings(input);
  assert.equal(result['FIND-003'].decision, 'cleared', 'single DISMISSED → cleared');
  assert.equal(result['FIND-004'].decision, 'cleared', 'multiple DISMISSED → cleared');
});

test('AC-2(c): ≥1 NEEDS-INVESTIGATION (no CONFIRMED) → "revise"', () => {
  const input = {
    'FIND-005': ['NEEDS-INVESTIGATION'],
    'FIND-006': ['NEEDS-INVESTIGATION', 'DISMISSED'],
  };
  const result = aggregateFindings(input);
  assert.equal(result['FIND-005'].decision, 'revise', 'single NEEDS-INVESTIGATION → revise');
  assert.equal(result['FIND-006'].decision, 'revise', 'NEEDS-INVESTIGATION + DISMISSED → revise');
});

test('AC-2(d): precedence CONFIRMED > NEEDS-INVESTIGATION > DISMISSED', () => {
  const input = {
    'FIND-007': ['CONFIRMED', 'NEEDS-INVESTIGATION'],
    'FIND-008': ['CONFIRMED', 'NEEDS-INVESTIGATION', 'DISMISSED'],
    'FIND-009': ['NEEDS-INVESTIGATION', 'DISMISSED'],
  };
  const result = aggregateFindings(input);
  assert.equal(result['FIND-007'].decision, 'blocker', 'CONFIRMED + NEEDS-INVESTIGATION → blocker (CONFIRMED wins)');
  assert.equal(result['FIND-008'].decision, 'blocker', 'CONFIRMED + NEEDS-INVESTIGATION + DISMISSED → blocker');
  assert.equal(result['FIND-009'].decision, 'revise', 'NEEDS-INVESTIGATION + DISMISSED → revise (NEEDS-INVESTIGATION wins)');
});

test('AC-2 result includes verdicts array from input', () => {
  const input = {
    'FIND-010': ['CONFIRMED', 'DISMISSED'],
  };
  const result = aggregateFindings(input);
  assert.ok(Array.isArray(result['FIND-010'].verdicts), 'result must include verdicts array');
  assert.deepEqual(result['FIND-010'].verdicts, ['CONFIRMED', 'DISMISSED'], 'verdicts array matches input');
});
