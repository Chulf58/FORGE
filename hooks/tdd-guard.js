'use strict';

// tdd-guard.js — PreToolUse hook stub (Phase 1 / TDD red-bar scaffold)
//
// Scope note: this hook intentionally uses a NARROWER, ADDITIVE rule compared
// to hooks/workflow-guard.js. workflow-guard.js excludes /hooks/, /bin/, /mcp/
// from its isSourceFile check because it gates end-of-pipeline workflow steps
// (apply-stage commit signals). tdd-guard.js gates *every* Write/Edit/MultiEdit
// on plugin source code regardless of pipeline stage — so /hooks/, /bin/, /mcp/,
// and /scripts/ are IN scope here. The two hooks serve different policies and
// are intentionally disjoint in their source-file detection rules.
// (See PLAN.md "reviewer-boundary warning — source-file detection scope" resolution.)
//
// This stub exports runGuard() returning {exitCode: 0} unconditionally.
// Phase 2 will replace the stub body with full TDD guard logic.
// The function signature and the _spawnImpl injection point are intentional API
// surface — do not remove them.

/**
 * @typedef {{ exitCode: number, stderr: string }} GuardResult
 */

/**
 * Run the TDD guard check against the given PreToolUse payload.
 *
 * @param {unknown} payload  - Parsed stdin JSON payload from Claude Code
 * @param {object}  env      - Environment variables (defaults to process.env)
 * @param {Function|null} _spawnImpl - Optional spawn override for testing timeout/ENOENT paths
 * @returns {Promise<GuardResult>}
 */
async function runGuard(payload, env = process.env, _spawnImpl = null) {
  // STUB: unconditionally allow. Phase 2 implements the real guard logic.
  // Tests for block cases (1, 2, 3) will fail against this stub — that is the
  // intended red bar for TDD Phase 1.
  void payload;
  void env;
  void _spawnImpl;
  return { exitCode: 0, stderr: '' };
}

module.exports = { runGuard };
