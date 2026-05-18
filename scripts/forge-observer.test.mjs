// @covers scripts/forge-observer.mjs
// Content-removal tests: SPECS tab and its supporting code have been deleted
// (2026-05-18 — SPECS decommissioned per user feedback). Tests assert the
// negative — that no SPECS-related symbols remain in forge-observer.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'forge-observer.mjs'), 'utf8');

test('forge-observer no longer imports model-pricing.js', () => {
  assert.ok(
    !src.includes('model-pricing.js'),
    'forge-observer.mjs must not import the deleted scripts/lib/model-pricing.js',
  );
});

test('forge-observer no longer references the SPECS tab', () => {
  assert.ok(
    !src.includes("label: 'SPECS'"),
    'forge-observer.mjs must not register a SPECS tab',
  );
});

test('forge-observer no longer defines buildSpecsTab', () => {
  assert.ok(
    !src.includes('buildSpecsTab'),
    'buildSpecsTab and its switch case must be removed',
  );
});

test('forge-observer no longer reads classification.json', () => {
  assert.ok(
    !src.includes('classification.json'),
    'classification.json reads were SPECS-only and must be removed',
  );
});

test('forge-observer no longer defines loadAgentHealth', () => {
  assert.ok(
    !src.includes('loadAgentHealth'),
    'loadAgentHealth was SPECS-only and must be removed',
  );
});

test("forge-observer no longer binds the '4' key to a SPECS tab switch", () => {
  assert.ok(
    !src.includes("case '4': switchTab(3)"),
    "keypress handler must not route '4' to a removed tab index",
  );
});
