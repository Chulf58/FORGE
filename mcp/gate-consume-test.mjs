#!/usr/bin/env node
// TDD wave-1 red-bar: post-approval gate-file deletion in forge-worker.mjs
//
// Closes TODO 9a9d29b2 AC-2 — after the worker injects the approval resume
// message, it MUST delete gate-pending.json so the file cannot be
// auto-consumed by a subsequent gate poll (stale-file risk observed on
// r-7299690b 2026-05-09).
//
// The worker currently does NOT delete the file (lines 672–683 of
// mcp/forge-worker.mjs, decision==='approved' branch).  This test establishes
// the red bar that Phase 2 must satisfy.
//
// Test strategy
// ─────────────
// The deletion behaviour is expected to be implemented as a utility exported
// from mcp/lib/gate-helpers.js (or inline in forge-worker.mjs itself). Either
// way, Phase 2 must make T1 pass.  We import `consumeGateApproval` from
// mcp/lib/gate-helpers.js here; if Phase 2 inlines the delete instead of
// extracting it, the coder must also create that export so this test can
// verify the behaviour in isolation.
//
// Run: node --test mcp/gate-consume-test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ── Import the helper that Phase 2 must create ───────────────────────────────
// This import deliberately targets a module that does NOT yet exist.
// Node resolves the import at test startup and throws ERR_MODULE_NOT_FOUND,
// making the test exit non-zero — a genuine red bar.
//
// Phase 2 must:
//   1. Create mcp/lib/gate-helpers.js (or gate-helpers.mjs)
//   2. Export `consumeGateApproval(gatePath, gateName)` which deletes the
//      gate file after the worker injects the approval resume message.
//   3. Call consumeGateApproval inside the decision==='approved' block in
//      mcp/forge-worker.mjs so the live worker clears the file too.
//
let consumeGateApproval;
try {
  const mod = await import('./lib/gate-helpers.js');
  consumeGateApproval = mod.consumeGateApproval;
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
    // Expected during wave 1 — mark import failure as a test failure so
    // `node --test` reports a failing test suite with exit code 1.
    test('T0 — mcp/lib/gate-helpers.js must exist and export consumeGateApproval', () => {
      assert.fail(
        'mcp/lib/gate-helpers.js does not exist yet — Phase 2 must create it ' +
        'and export consumeGateApproval(gatePath, gateName). ' +
        'Original error: ' + err.message
      );
    });
    // Skip remaining tests — they also depend on the missing module.
    process.exit(1); // eslint-disable-line n/no-process-exit
  }
  throw err; // unexpected error — re-throw
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gate-consume-test-'));
  mkdirSync(join(tmpDir, '.pipeline'), { recursive: true });
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function writeGateFile(gatePath, gate, status) {
  writeFileSync(
    gatePath,
    JSON.stringify({
      gate,
      status,
      feature: 'test-feature',
      runId: 'r-test001',
      createdAt: new Date().toISOString(),
    }, null, 2),
    'utf-8'
  );
}

// ── T1: approved gate file is deleted after consumeGateApproval ──────────────

test('T1 — gate-pending.json is DELETED after consumeGateApproval(gate1)', () => {
  const gatePath = join(tmpDir, '.pipeline', 'gate-pending-t1.json');
  writeGateFile(gatePath, 'gate1', 'approved');

  // Precondition: file exists before consume
  assert.ok(existsSync(gatePath), 'gate file should exist before consume');

  consumeGateApproval(gatePath, 'gate1');

  // Post-condition: file must be gone
  assert.equal(
    existsSync(gatePath),
    false,
    'gate-pending.json must be deleted after consumeGateApproval — ' +
    'currently fails because forge-worker does not unlink the file (Phase 2 required)'
  );
});

// ── T2: gate2 approved file is deleted after consumeGateApproval ─────────────

test('T2 — gate-pending.json is DELETED after consumeGateApproval(gate2)', () => {
  const gatePath = join(tmpDir, '.pipeline', 'gate-pending-t2.json');
  writeGateFile(gatePath, 'gate2', 'approved');

  assert.ok(existsSync(gatePath), 'gate file should exist before consume');

  consumeGateApproval(gatePath, 'gate2');

  assert.equal(
    existsSync(gatePath),
    false,
    'gate-pending.json must be deleted after gate2 approval consume'
  );
});

// ── T3: consumeGateApproval is fail-open — no throw if file is already gone ──

test('T3 — consumeGateApproval does not throw when gate file is already absent', () => {
  const gatePath = join(tmpDir, '.pipeline', 'gate-pending-absent.json');
  // Deliberately do NOT create the file
  assert.equal(existsSync(gatePath), false, 'precondition: file must not exist');

  // Must not throw — fail-open contract
  assert.doesNotThrow(
    () => consumeGateApproval(gatePath, 'gate1'),
    'consumeGateApproval must be fail-open when the gate file is absent'
  );
});
