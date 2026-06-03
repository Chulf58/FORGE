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
import { getGitExecutable } from '../packages/forge-core/src/runs/index.js';

// ─── CLI arg parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  let handoffPath = null;
  let rootDir = null;
  let strictGaps = false;
  let changedFromGit = false;

  for (const arg of argv) {
    if (arg.startsWith('--handoff=')) {
      handoffPath = arg.slice('--handoff='.length);
    } else if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else if (arg === '--strict-gaps') {
      strictGaps = true;
    } else if (arg === '--changed-from-git') {
      changedFromGit = true;
    }
  }

  return { handoffPath, rootDir, strictGaps, changedFromGit };
}

/**
 * Resolve changed SOURCE files from the worktree's git state — modified tracked
 * files (vs HEAD) plus untracked files — kept to code files and excluding test
 * files (the @covers map is keyed by source path). Format-independent
 * alternative to parsing the handoff: the orchestrator uses this because the
 * coder's handoff sections ("## Files to create" / "## Files to modify" with
 * content blocks) don't match the legacy "## Files modified" path-list shape.
 *
 * @param {string} rootDir - absolute worktree/repo root
 * @returns {string[]} repo-relative source paths (forward-slash)
 */
function getGitChangedFiles(rootDir) {
  const runGit = (args) => {
    try {
      // Resolve git via getGitExecutable (PATH probe → Windows install-location fallback) —
      // a bare 'git' ENOENTs in the worker (its PATH lacks git), silently returning 0 changed
      // files so the whole test-gate no-ops (G1 / a8de840b-class, same fix as commit-worktree #7).
      const r = spawnSync(getGitExecutable(), ['-C', rootDir, ...args], { encoding: 'utf8' });
      return r.status === 0 && r.stdout ? r.stdout : '';
    } catch (_) {
      return '';
    }
  };
  const blocks = [
    runGit(['diff', '--name-only', 'HEAD']),                 // modified + staged tracked
    runGit(['ls-files', '--others', '--exclude-standard']),  // untracked
  ];
  const collected = [];
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const f = line.trim().replace(/\\/g, '/');
      if (f) collected.push(f);
    }
  }
  return [...new Set(collected)].filter(
    (f) => /\.(js|mjs|cjs|ts)$/.test(f) && !/[-.]test\.[a-z]+$/.test(f),
  );
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
  const { handoffPath, rootDir, strictGaps, changedFromGit } = parseArgs(process.argv.slice(2));

  if (!handoffPath && !changedFromGit) {
    process.stderr.write('[covers-verify] --handoff=<path> or --changed-from-git is required\n');
    process.exit(1);
  }

  const resolvedRoot = rootDir ? resolve(rootDir) : process.cwd();

  // Build the impact map (src → [testFile, …])
  const map = await buildCoversMap(resolvedRoot);

  // Resolve touched source files. --changed-from-git reads the worktree's git
  // state directly (format-independent); otherwise parse the handoff section.
  const touchedFiles = changedFromGit
    ? getGitChangedFiles(resolvedRoot)
    : extractTouchedFiles(resolve(handoffPath));

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
