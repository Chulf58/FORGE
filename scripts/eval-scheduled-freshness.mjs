#!/usr/bin/env node
// @covers scripts/eval-scheduled-freshness.mjs
// Freshness check for the scheduled eval mechanism.
//
// Asserts that at least one file under evals/scheduled-runs/ has mtime
// within the last N days (default 7). Exits non-zero if no recent run
// exists — the automated mechanism is broken or was never set up.
//
// Usage:
//   node scripts/eval-scheduled-freshness.mjs [--max-age-days <N>]
//
// Exit codes:
//   0 — at least one scheduled run report exists within the max-age window
//   1 — no recent run found (mechanism broken or never ran)

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const scheduledRunsDir = join(projectRoot, 'evals', 'scheduled-runs');

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const maxAgeDaysIdx = args.indexOf('--max-age-days');
const maxAgeDays = maxAgeDaysIdx !== -1 && args[maxAgeDaysIdx + 1]
  ? parseInt(args[maxAgeDaysIdx + 1], 10)
  : (process.env.EVAL_FRESHNESS_MAX_AGE_DAYS
    ? parseInt(process.env.EVAL_FRESHNESS_MAX_AGE_DAYS, 10)
    : 7);

if (isNaN(maxAgeDays) || maxAgeDays < 1) {
  process.stderr.write('[eval-scheduled-freshness] ERROR: --max-age-days must be a positive integer\n');
  process.exit(1);
}

// ── Check for recent scheduled runs ──────────────────────────────────────────
if (!existsSync(scheduledRunsDir)) {
  process.stderr.write(
    `[eval-scheduled-freshness] FAIL: no scheduled run in last ${maxAgeDays} days — automated mechanism is broken or never ran\n`,
  );
  process.exit(1);
}

let files;
try {
  files = readdirSync(scheduledRunsDir).filter((f) => f.endsWith('.json'));
} catch (err) {
  process.stderr.write(
    `[eval-scheduled-freshness] FAIL: cannot read ${scheduledRunsDir}: ${err.message}\n`,
  );
  process.exit(1);
}

const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
let mostRecentMs = 0;

for (const file of files) {
  try {
    const stat = statSync(join(scheduledRunsDir, file));
    if (stat.mtimeMs > mostRecentMs) mostRecentMs = stat.mtimeMs;
  } catch { /* skip unreadable files */ }
}

if (mostRecentMs >= cutoffMs) {
  const ageHours = Math.round((Date.now() - mostRecentMs) / (1000 * 60 * 60));
  process.stdout.write(
    `[eval-scheduled-freshness] PASS: last run was within ${maxAgeDays} days (${ageHours}h ago)\n`,
  );
  process.exit(0);
} else {
  process.stderr.write(
    `[eval-scheduled-freshness] FAIL: no scheduled run in last ${maxAgeDays} days — automated mechanism is broken or never ran\n`,
  );
  process.exit(1);
}
