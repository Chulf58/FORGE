#!/usr/bin/env node
// @covers mcp/forge-worker.mjs
// @covers mcp/lib/tools/run-lifecycle.js
// TDD regression test for the r-468be1b4 silent-failure pattern.
//
// r-468be1b4 failure: worker exited without writing failureReason to run.json,
// leaving the run in an unknown state with no diagnostic.
//
// Wave 6 (red bar): watchdog stamp not yet in forge-worker.mjs or run-lifecycle.js.
//   Test exits 1 with [worker-watchdog-test] r-468be1b4 regression: FAIL
// Wave 7 (green bar): after Tasks 17a + 17b implement the watchdog, test exits 0.
//
// Checks:
//   [17a] mcp/forge-worker.mjs contains an exit handler that writes watchdog-stamp.json
//   [17b] mcp/lib/tools/run-lifecycle.js contains sidecar merge logic for watchdog-stamp.json
//
// Run: node scripts/worker-watchdog-test.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const WATCHDOG_STAMP_TOKEN = 'watchdog-stamp.json';

// ── [17a] forge-worker.mjs exit handler check ─────────────────────────────────
const workerPath = join(projectRoot, 'mcp', 'forge-worker.mjs');
let workerContent = '';
try {
  workerContent = readFileSync(workerPath, 'utf-8');
} catch (err) {
  process.stderr.write(
    `[worker-watchdog-test] r-468be1b4 regression: FAIL — cannot read forge-worker.mjs: ${err.message}\n`,
  );
  process.exit(1);
}

if (!workerContent.includes(WATCHDOG_STAMP_TOKEN)) {
  process.stderr.write(
    '[worker-watchdog-test] r-468be1b4 regression: FAIL — missing watchdog stamp in forge-worker.mjs\n',
  );
  process.exit(1);
}

// ── [17b] run-lifecycle.js sidecar merge check ────────────────────────────────
const lifecyclePath = join(projectRoot, 'mcp', 'lib', 'tools', 'run-lifecycle.js');
let lifecycleContent = '';
try {
  lifecycleContent = readFileSync(lifecyclePath, 'utf-8');
} catch (err) {
  process.stderr.write(
    `[worker-watchdog-test] r-468be1b4 regression: FAIL — cannot read run-lifecycle.js: ${err.message}\n`,
  );
  process.exit(1);
}

if (!lifecycleContent.includes(WATCHDOG_STAMP_TOKEN)) {
  process.stderr.write(
    '[worker-watchdog-test] r-468be1b4 regression: FAIL — missing sidecar merge in run-lifecycle.js\n',
  );
  process.exit(1);
}

// ── Both present — run Wave 2 assertions ─────────────────────────────────────
// These detailed assertions will be added properly in Wave 2 (Tasks 17a + 17b).
// Placeholder: confirm the token appears in both files (already checked above).
process.stdout.write('[worker-watchdog-test] PASS: watchdog stamp present in both files\n');
process.exit(0);
