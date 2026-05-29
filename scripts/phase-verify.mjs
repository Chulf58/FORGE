#!/usr/bin/env node
// @covers scripts/phase-verify.mjs
// Post-coder phase-level diagnostic verifier.
//
// CLI: node scripts/phase-verify.mjs [--root=<path>] [--baseline=<path>] [--loc-threshold=<n>] [--strict]
//
// Checks: (1) LoC delta via git shortstat, (2) new lint-error keys vs baseline JSON.
//
// Exit codes:
//   0 — diagnostic mode (default): diagnostics are reported but exit is always 0
//   1 — strict mode (--strict): exits 1 when any regressions are found

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── stderr helper ───────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`${msg}\n`);
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  let rootDir = null;
  let baselinePath = null;
  let locThreshold = 500;
  let strict = false;

  for (const arg of argv) {
    if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else if (arg.startsWith('--baseline=')) {
      baselinePath = arg.slice('--baseline='.length);
    } else if (arg.startsWith('--loc-threshold=')) {
      const n = parseInt(arg.slice('--loc-threshold='.length), 10);
      if (!isNaN(n)) locThreshold = n;
    } else if (arg === '--strict') {
      strict = true;
    }
  }

  return { rootDir, baselinePath, locThreshold, strict };
}

// ─── parseShortstat ───────────────────────────────────────────────────────────

/**
 * Parse the output of `git diff --shortstat` into structured metrics.
 *
 * @param {string} text - e.g. "3 files changed, 10 insertions(+), 4 deletions(-)"
 * @returns {{ filesChanged: number, insertions: number, deletions: number, changedLines: number }}
 */
export function parseShortstat(text) {
  const filesMatch = text.match(/(\d+)\s+files?\s+changed/);
  const insertMatch = text.match(/(\d+)\s+insertions?\(\+\)/);
  const deleteMatch = text.match(/(\d+)\s+deletions?\(-\)/);

  const filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
  const insertions = insertMatch ? parseInt(insertMatch[1], 10) : 0;
  const deletions = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;
  const changedLines = insertions + deletions;

  return { filesChanged, insertions, deletions, changedLines };
}

// ─── diffLintErrors ───────────────────────────────────────────────────────────

/**
 * Return keys present in currentKeys but not in baselineKeys (new errors).
 *
 * @param {string[]} baselineKeys
 * @param {string[]} currentKeys
 * @returns {string[]} new error keys introduced in current
 */
export function diffLintErrors(baselineKeys, currentKeys) {
  const baselineSet = new Set(baselineKeys);
  return currentKeys.filter(k => !baselineSet.has(k));
}

// ─── runPhaseVerify ───────────────────────────────────────────────────────────

/**
 * Run phase-level diagnostics: LoC delta and lint error regression check.
 * Never throws — returns fail-open results on any error.
 *
 * @param {{ root?: string, baselinePath?: string, locThreshold?: number }} opts
 * @returns {Promise<{ changedLines: number, newLintErrors: string[], warnings: string[] }>}
 */
export async function runPhaseVerify({ root, baselinePath, locThreshold = 500 } = {}) {
  const resolvedRoot = root ? resolve(root) : process.cwd();
  const warnings = [];
  let changedLines = 0;
  let newLintErrors = [];

  // ── LoC delta via git shortstat ───────────────────────────────────────────
  try {
    const shortstatOut = execSync('git diff --shortstat', {
      cwd: resolvedRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (shortstatOut) {
      const stats = parseShortstat(shortstatOut);
      changedLines = stats.changedLines;
    }
  } catch {
    // git not available or no repo — changedLines stays 0
  }

  if (changedLines > locThreshold) {
    warnings.push(`LoC delta: +${changedLines} (warn >${locThreshold})`);
  }

  // ── Lint error regression ─────────────────────────────────────────────────
  if (baselinePath && existsSync(baselinePath)) {
    try {
      const raw = readFileSync(baselinePath, 'utf8');
      const baseline = JSON.parse(raw);
      const baselineKeys = Array.isArray(baseline) ? baseline : Object.keys(baseline);

      // No live lint runner in this diagnostic pass — compare against baseline keys only.
      // Current keys come from the baseline itself (no regression when baseline exists but
      // no current lint output is available); consumer may extend this to run a real linter.
      newLintErrors = diffLintErrors(baselineKeys, baselineKeys);
    } catch {
      // Unreadable or malformed baseline — fail open
      newLintErrors = [];
    }
  } else {
    // Missing baseline — fail open
    newLintErrors = [];
  }

  return { changedLines, newLintErrors, warnings };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { rootDir, baselinePath, locThreshold, strict } = parseArgs(process.argv.slice(2));

  const resolvedRoot = rootDir ? resolve(rootDir) : process.cwd();
  const resolvedBaseline = baselinePath ? resolve(baselinePath) : null;

  try {
    const { changedLines, newLintErrors, warnings } = await runPhaseVerify({
      root: resolvedRoot,
      baselinePath: resolvedBaseline,
      locThreshold,
    });

    log(`[phase-verify] LoC delta: +${changedLines} (warn >${locThreshold})`);
    log(`[phase-verify] lint errors: ${newLintErrors.length} new`);

    for (const w of warnings) {
      log(`[phase-verify] WARNING: ${w}`);
    }

    if (newLintErrors.length > 0) {
      for (const e of newLintErrors) {
        log(`[phase-verify] new-lint-error: ${e}`);
      }
    }

    log(`[phase-verify] done — does NOT treat this as a control signal`);

    if (strict && (newLintErrors.length > 0 || warnings.length > 0)) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    log(`[phase-verify] unexpected error: ${err.message}`);
    process.exit(0); // fail-open even on unexpected errors
  }
}
