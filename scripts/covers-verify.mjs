#!/usr/bin/env node
// @covers scripts/covers-verify.mjs
// Post-handoff coverage verifier.
//
// CLI: node scripts/covers-verify.mjs --handoff=<path> --root=<path> [--strict-gaps]
//
// Reads the handoff "Files modified" section, resolves covering tests via the
// impact map, runs them in a single batched `node --test` subprocess, and
// emits [covers-gap] to stderr for any touched file with no @covers entry.
//
// Exit codes:
//   0 — all covering tests passed (gaps are diagnostic only unless --strict-gaps)
//   non-zero — at least one covering test failed, OR --strict-gaps and gaps exist

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { extractSection, extractCodeBlockContent } from './lib/handoff-utils.mjs';
import { buildCoversMap } from './covers-map.mjs';

// ─── CLI arg parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  let handoffPath = null;
  let rootDir = null;
  let strictGaps = false;

  for (const arg of argv) {
    if (arg.startsWith('--handoff=')) {
      handoffPath = arg.slice('--handoff='.length);
    } else if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else if (arg === '--strict-gaps') {
      strictGaps = true;
    }
  }

  return { handoffPath, rootDir, strictGaps };
}

// ─── Extract touched source files from handoff ──────────────────────────────

/**
 * Read the handoff file and extract touched source file paths from the
 * "Files modified" section (code block content, one path per line).
 *
 * @param {string} handoffPath - absolute path to handoff.md
 * @returns {string[]} list of repo-relative source paths (forward-slash)
 */
function extractTouchedFiles(handoffPath) {
  let handoffText;
  try {
    handoffText = readFileSync(handoffPath, 'utf8');
  } catch (err) {
    process.stderr.write(`[covers-verify] cannot read handoff: ${err.message}\n`);
    return [];
  }

  const section = extractSection(handoffText, 'Files modified');
  const raw = extractCodeBlockContent(section);

  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    // Normalise to forward-slash, drop any leading ./
    .map(l => l.replace(/\\/g, '/').replace(/^\.\//, ''));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { handoffPath, rootDir, strictGaps } = parseArgs(process.argv.slice(2));

  if (!handoffPath) {
    process.stderr.write('[covers-verify] --handoff=<path> is required\n');
    process.exit(1);
  }

  const resolvedRoot = rootDir ? resolve(rootDir) : process.cwd();
  const resolvedHandoff = resolve(handoffPath);

  // Build the impact map (src → [testFile, …])
  const map = await buildCoversMap(resolvedRoot);

  // Extract touched files from the handoff
  const touchedFiles = extractTouchedFiles(resolvedHandoff);

  // Collect covering test files and identify gaps
  const testFilesToRun = new Set();
  let gapCount = 0;

  for (const srcFile of touchedFiles) {
    const coveringTests = map[srcFile];
    if (!coveringTests || coveringTests.length === 0) {
      process.stderr.write(`[covers-gap] ${srcFile}\n`);
      gapCount++;
    } else {
      for (const t of coveringTests) {
        testFilesToRun.add(t);
      }
    }
  }

  const testFiles = [...testFilesToRun];
  const coveredCount = touchedFiles.length - gapCount;

  process.stderr.write(`[covers] ${coveredCount} tests resolved, ${gapCount} gaps\n`);
  // Log each test file being run so callers can see which files were exercised
  for (const f of testFiles) {
    process.stderr.write(`[covers] running ${f}\n`);
  }

  // Run covering tests in a single batched subprocess.
  // Strip NODE_TEST_CONTEXT so the child runs as a top-level test process and
  // propagates exit codes normally (exit 1 on failures).  Without this, when
  // covers-verify.mjs is invoked under `node --test`, the child inherits
  // NODE_TEST_CONTEXT=child-v8 and behaves as a test worker — suppressing
  // non-zero exit codes (always exits 0).
  let testExitCode = 0;
  if (testFiles.length > 0) {
    const childEnv = { ...process.env };
    delete childEnv['NODE_TEST_CONTEXT'];
    const result = spawnSync(
      process.execPath,
      ['--test', ...testFiles],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
    );
    // Forward child output so test file names appear in our stdout/stderr
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    testExitCode = result.status ?? 1;
  }

  // Determine final exit code
  const exitGaps = strictGaps && gapCount > 0;
  if (testExitCode !== 0 || exitGaps) {
    process.exit(testExitCode !== 0 ? testExitCode : 1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[covers-verify] unexpected error: ${err.message}\n`);
  process.exit(1);
});
