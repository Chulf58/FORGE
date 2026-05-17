/**
 * init-tdd-guard-default.test.mjs — Spec tests for scaffold tddGuard defaults.
 *
 * Verifies that the init SKILL sets `tddGuard: false` in project.json for
 * non-code scaffolds (power-automate, instructional) and leaves it absent for
 * code scaffolds (guard enabled by default).
 *
 * The oracle module `scaffold-defaults.js` exports `getScaffoldDefaults(type)`
 * which encodes the per-scaffold defaults referenced by SKILL.md Step 3.
 *
 * Wave 1 (red): scaffold-defaults.js does not exist → import fails → exit non-zero.
 * Wave 2 (green): scaffold-defaults.js created with tddGuard: false for non-code
 *                 scaffolds → all assertions pass → exit 0.
 *
 * Runner: standalone only — `node --test skills/init/init-tdd-guard-default.test.mjs`
 * (scripts/run-tests.mjs does NOT auto-discover skills/ subdirectories).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Load the defaults module via CommonJS require (it is a .js CJS module).
// MODULE_NOT_FOUND here is the intended Wave 1 red bar.
const require = createRequire(import.meta.url);
const { getScaffoldDefaults } = require('./scaffold-defaults.js');

// ---------------------------------------------------------------------------
// power-automate: must set tddGuard: false
// ---------------------------------------------------------------------------
test('power-automate scaffold defaults include tddGuard: false', () => {
  const defaults = getScaffoldDefaults('power-automate');
  assert.equal(
    defaults.tddGuard,
    false,
    'power-automate scaffold must set tddGuard: false in project.json'
  );
});

// ---------------------------------------------------------------------------
// instructional: must set tddGuard: false
// ---------------------------------------------------------------------------
test('instructional scaffold defaults include tddGuard: false', () => {
  const defaults = getScaffoldDefaults('instructional');
  assert.equal(
    defaults.tddGuard,
    false,
    'instructional scaffold must set tddGuard: false in project.json'
  );
});

// ---------------------------------------------------------------------------
// code: must NOT set tddGuard — guard enabled by default when field absent
// ---------------------------------------------------------------------------
test('code scaffold defaults do NOT include tddGuard (guard on by default)', () => {
  const defaults = getScaffoldDefaults('code');
  assert.equal(
    defaults.tddGuard,
    undefined,
    'code scaffold must not set tddGuard (guard remains enabled by default)'
  );
});
