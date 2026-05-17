'use strict';

// scaffold-defaults.js — Per-scaffold project.json defaults for the init SKILL.
//
// This module is the canonical source of truth for which fields the init SKILL
// (skills/init/SKILL.md Step 3) injects into project.json per scaffold type.
// It is tested by skills/init/init-tdd-guard-default.test.mjs.
//
// Tested by: node --test skills/init/init-tdd-guard-default.test.mjs

/**
 * Scaffold types whose projects bypass the TDD guard by default.
 * These are non-code scaffolds where automated test infrastructure
 * is typically absent (Power Automate flows, instructional documents, etc.).
 */
const NON_CODE_SCAFFOLDS = ['power-automate', 'instructional'];

/**
 * Returns additional fields to include in project.json for the given scaffold type.
 * The returned object is merged into the base project.json by the init SKILL.
 *
 * @param {string} scaffoldType - 'code' | 'power-automate' | 'instructional'
 * @returns {{ tddGuard?: boolean }}
 */
function getScaffoldDefaults(scaffoldType) {
  if (NON_CODE_SCAFFOLDS.includes(scaffoldType)) {
    // Disable TDD guard for non-code scaffolds — these projects do not have
    // automated test infrastructure and the guard would block all edits.
    return { tddGuard: false };
  }
  // Code scaffolds: omit the field entirely — guard is enabled by default
  // when tddGuard is absent from project.json.
  return {};
}

module.exports = { getScaffoldDefaults, NON_CODE_SCAFFOLDS };
