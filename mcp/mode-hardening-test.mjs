#!/usr/bin/env node
// Tests for mode-hardening validation in forge_create_run.
// Imports the validateModeForRisk function logic inline (it's embedded in server.js,
// not separately exported) — so we replicate the exact logic here and verify behavior.

const RISK_KEYWORDS = /\b(hook|hooks|mcp|security|auth|crypto|secret|credential|token|spawn|child_process|migration|schema|contract|network|fetch|http|inject|xss|csrf|permission|guard|enforcement|worktree|merge)\b/i;

function validateModeForRisk(pipelineType, mode, feature) {
  if (mode !== 'TRIVIAL' && mode !== 'SPRINT') return null;

  if (mode === 'TRIVIAL' && pipelineType !== 'plan' && pipelineType !== 'apply') {
    return 'BLOCKED:TRIVIAL-' + pipelineType;
  }

  const SOURCE_MUTATING = new Set(['implement', 'debug', 'refactor']);
  if (mode === 'SPRINT' && SOURCE_MUTATING.has(pipelineType) && feature && RISK_KEYWORDS.test(feature)) {
    const match = feature.match(RISK_KEYWORDS);
    return 'BLOCKED:SPRINT-' + (match ? match[0] : '');
  }

  return null;
}

let pass = 0;
let fail = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertNull(label, actual) {
  if (actual === null) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: null\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertNotNull(label, actual) {
  if (actual !== null) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${label}\n  expected: non-null\n  actual:   null`);
  }
}

// --- TRIVIAL mode tests ---

// TRIVIAL + plan = allowed (plan doesn't modify source)
assertNull('TRIVIAL+plan allowed', validateModeForRisk('plan', 'TRIVIAL', 'add login page'));

// TRIVIAL + apply = allowed (apply is post-review)
assertNull('TRIVIAL+apply allowed', validateModeForRisk('apply', 'TRIVIAL', 'apply login changes'));

// TRIVIAL + implement = blocked (modifies source, needs review)
assertNotNull('TRIVIAL+implement blocked', validateModeForRisk('implement', 'TRIVIAL', 'simple rename'));

// TRIVIAL + debug = blocked
assertNotNull('TRIVIAL+debug blocked', validateModeForRisk('debug', 'TRIVIAL', 'fix typo'));

// TRIVIAL + refactor = blocked
assertNotNull('TRIVIAL+refactor blocked', validateModeForRisk('refactor', 'TRIVIAL', 'clean up names'));

// --- SPRINT mode tests ---

// SPRINT + implement with safe feature = allowed
assertNull('SPRINT+implement safe feature', validateModeForRisk('implement', 'SPRINT', 'add readme section'));

// SPRINT + implement with risky feature (hook) = blocked
assertNotNull('SPRINT+implement risky hook', validateModeForRisk('implement', 'SPRINT', 'add new hook for validation'));

// SPRINT + implement with risky feature (mcp) = blocked
assertNotNull('SPRINT+implement risky mcp', validateModeForRisk('implement', 'SPRINT', 'add mcp tool for board'));

// SPRINT + implement with risky feature (security) = blocked
assertNotNull('SPRINT+implement risky security', validateModeForRisk('implement', 'SPRINT', 'security hardening pass'));

// SPRINT + implement with risky feature (auth) = blocked
assertNotNull('SPRINT+implement risky auth', validateModeForRisk('implement', 'SPRINT', 'fix auth middleware'));

// SPRINT + implement with risky feature (crypto) = blocked
assertNotNull('SPRINT+implement risky crypto', validateModeForRisk('implement', 'SPRINT', 'add crypto signing'));

// SPRINT + implement with risky feature (migration) = blocked
assertNotNull('SPRINT+implement risky migration', validateModeForRisk('implement', 'SPRINT', 'database migration for users'));

// SPRINT + implement with risky feature (schema) = blocked
assertNotNull('SPRINT+implement risky schema', validateModeForRisk('implement', 'SPRINT', 'schema change for run objects'));

// SPRINT + implement with risky feature (spawn) = blocked
assertNotNull('SPRINT+implement risky spawn', validateModeForRisk('implement', 'SPRINT', 'spawn child process'));

// SPRINT + implement with risky feature (token) = blocked
assertNotNull('SPRINT+implement risky token', validateModeForRisk('implement', 'SPRINT', 'approval token validation'));

// SPRINT + implement with risky feature (worktree) = blocked
assertNotNull('SPRINT+implement risky worktree', validateModeForRisk('implement', 'SPRINT', 'worktree merge logic'));

// SPRINT + implement with risky feature (guard) = blocked
assertNotNull('SPRINT+implement risky guard', validateModeForRisk('implement', 'SPRINT', 'bash guard improvements'));

// SPRINT + implement with risky feature (fetch) = blocked
assertNotNull('SPRINT+implement risky fetch', validateModeForRisk('implement', 'SPRINT', 'add fetch call to API'));

// SPRINT + implement with risky feature (inject) = blocked
assertNotNull('SPRINT+implement risky inject', validateModeForRisk('implement', 'SPRINT', 'prevent XSS injection'));

// SPRINT + plan with risky feature = allowed (plan doesn't skip reviewers meaningfully)
assertNull('SPRINT+plan risky feature allowed', validateModeForRisk('plan', 'SPRINT', 'plan hook security audit'));

// SPRINT + empty feature = allowed (no keywords to match)
assertNull('SPRINT+implement empty feature', validateModeForRisk('implement', 'SPRINT', ''));

// SPRINT + null feature = allowed
assertNull('SPRINT+implement null feature', validateModeForRisk('implement', 'SPRINT', null));

// SPRINT + debug with risky feature = blocked
assertNotNull('SPRINT+debug risky auth', validateModeForRisk('debug', 'SPRINT', 'fix auth bypass bug'));

// SPRINT + refactor with risky feature = blocked
assertNotNull('SPRINT+refactor risky schema', validateModeForRisk('refactor', 'SPRINT', 'refactor schema validation'));

// SPRINT + apply with risky feature = allowed (apply is post-review)
assertNull('SPRINT+apply risky feature allowed', validateModeForRisk('apply', 'SPRINT', 'apply hook changes'));

// --- Higher modes pass through unconditionally ---

assertNull('LEAN passes through', validateModeForRisk('implement', 'LEAN', 'hook security audit'));
assertNull('STANDARD passes through', validateModeForRisk('implement', 'STANDARD', 'mcp schema migration'));
assertNull('FULL passes through', validateModeForRisk('implement', 'FULL', 'crypto auth token spawn'));

// --- Case insensitivity of risk keywords ---
assertNotNull('SPRINT case insensitive HOOK', validateModeForRisk('implement', 'SPRINT', 'add HOOK script'));
assertNotNull('SPRINT case insensitive Security', validateModeForRisk('implement', 'SPRINT', 'Security hardening'));

// --- Risk keyword must be word-bounded ---
assertNull('SPRINT "hooked" not matched', validateModeForRisk('implement', 'SPRINT', 'I am hooked on this feature'));
// But "hook" as a standalone word IS matched
assertNotNull('SPRINT "hook" standalone matched', validateModeForRisk('implement', 'SPRINT', 'add a hook for events'));

// --- Summary ---
console.log(`\nmode-hardening-test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
