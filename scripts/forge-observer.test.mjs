// @covers scripts/forge-observer.mjs
// Content-verification tests for the SPECS tab v2 additions.
//
// These tests confirm that the three new SPECS sections and the model-pricing
// import are present in forge-observer.mjs after Phase 2 implementation.
// They fail before implementation (red bar) and pass after (green bar).
//
// Run: node --test scripts/forge-observer.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'forge-observer.mjs'), 'utf8');

test('AC-2: forge-observer imports from model-pricing.js', () => {
  assert.ok(
    src.includes('model-pricing.js'),
    'forge-observer.mjs must import model-pricing.js (ESM import for estimateCost)',
  );
});

test('AC-3: SPECS tab renders Token Attribution section', () => {
  assert.ok(
    src.includes('Token Attribution'),
    'buildSpecsTab must include a "Token Attribution" section header',
  );
});

test('AC-4: SPECS tab renders Cost (est.) section', () => {
  assert.ok(
    src.includes('Cost (est.)'),
    'buildSpecsTab must include a "Cost (est.)" section header',
  );
});

test('AC-5: SPECS tab renders Classifier Audit section', () => {
  assert.ok(
    src.includes('Classifier Audit'),
    'buildSpecsTab must include a "Classifier Audit" section header',
  );
});

test('AC-5: classification.json lookup is present', () => {
  assert.ok(
    src.includes('classification.json'),
    'forge-observer.mjs must reference classification.json for the audit panel',
  );
});

test('AC-4: estimateCost is called in the observer', () => {
  assert.ok(
    src.includes('estimateCost'),
    'forge-observer.mjs must call estimateCost() for cost projection',
  );
});
