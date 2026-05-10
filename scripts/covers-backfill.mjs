#!/usr/bin/env node
// @covers scripts/covers-backfill.mjs
// One-shot backfill script: prepends // @covers <inferred-src> to test files
// that have no existing @covers tag, using the heuristic of stripping the
// `-test` suffix and matching against existing source files.
//
// CLI: node scripts/covers-backfill.mjs [--dry-run] [--root=<path>]
//
// Exit codes:
//   0 — success (or dry-run)
//   1 — at least one multi-match, zero-match (non-dry-run), or traversal error

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative, basename } from 'node:path';
import { glob } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCovers } from './covers-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  let dryRun = false;
  let rootDir = resolve(__dirname, '..');

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--root=')) {
      rootDir = resolve(arg.slice('--root='.length));
    }
  }

  return { dryRun, rootDir };
}

// ─── Glob helpers ─────────────────────────────────────────────────────────────

async function globTestFiles(rootDir) {
  const patterns = [
    'hooks/*-test.js',
    'mcp/*-test.mjs',
    'scripts/*-test.mjs',
  ];
  const results = [];
  for (const pattern of patterns) {
    try {
      // @ts-ignore — glob available Node 22+
      const matches = glob(pattern, { cwd: rootDir });
      for await (const match of matches) {
        results.push(join(rootDir, match));
      }
    } catch {
      const matched = await globFallback(rootDir, pattern);
      results.push(...matched);
    }
  }
  return results;
}

async function globFallback(rootDir, pattern) {
  const { readdir } = await import('node:fs/promises');
  const parts = pattern.split('/');
  if (parts.length !== 2) return [];
  const [dir, filePattern] = parts;
  const dirPath = join(rootDir, dir);
  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }
  const regexStr = '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$';
  const re = new RegExp(regexStr);
  return entries.filter(e => re.test(e)).map(e => join(rootDir, dir, e));
}

async function globSourceFiles(rootDir) {
  const patterns = [
    'hooks/*.js',
    'mcp/*.mjs',
    'scripts/*.mjs',
  ];
  const results = [];
  for (const pattern of patterns) {
    try {
      // @ts-ignore — glob available Node 22+
      const matches = glob(pattern, { cwd: rootDir });
      for await (const match of matches) {
        const abs = join(rootDir, match);
        // Exclude test files from source list
        if (!abs.includes('-test.')) {
          results.push(abs);
        }
      }
    } catch {
      const matched = await globFallback(rootDir, pattern);
      results.push(...matched.filter(f => !f.includes('-test.')));
    }
  }
  return results;
}

// ─── Path-traversal safety ────────────────────────────────────────────────────

/**
 * Validate inferred source path:
 *   (a) resolves under project root (no ../ traversal)
 *   (b) file exists on disk
 *
 * @param {string} inferredAbs - absolute inferred source path
 * @param {string} rootDir     - project root
 * @param {string} testFile    - test file (for error messages)
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateInferredPath(inferredAbs, rootDir, testFile) {
  const rel = relative(rootDir, inferredAbs);
  // Reject traversal outside root
  if (rel.startsWith('..') || resolve(inferredAbs) !== inferredAbs) {
    return { ok: false, reason: 'path resolves outside project root' };
  }
  // Reject non-existent files
  if (!existsSync(inferredAbs)) {
    return { ok: false, reason: 'inferred source file does not exist' };
  }
  return { ok: true };
}

// ─── Heuristic: strip -test suffix, match against source files ───────────────

/**
 * Given a test file, infer the source file it tests by:
 *   1. Stripping `-test` from the base name (before the extension).
 *   2. Matching against the list of known source files.
 *
 * Returns:
 *   { match: string }         — exactly one match found
 *   { candidates: string[] }  — multiple matches (ambiguous)
 *   { none: true }            — no match
 *
 * @param {string} testFile    - absolute path to the test file
 * @param {string[]} srcFiles  - list of absolute source file paths
 */
function inferSourceFile(testFile, srcFiles) {
  const base = basename(testFile);
  // Strip -test suffix: e.g. covers-parser-test.mjs → covers-parser.mjs
  const inferred = base.replace(/-test(\.[^.]+)$/, '$1');

  const matches = srcFiles.filter(f => basename(f) === inferred);

  if (matches.length === 1) return { match: matches[0] };
  if (matches.length > 1) return { candidates: matches };
  return { none: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, rootDir } = parseArgs(process.argv.slice(2));

  const [testFiles, srcFiles] = await Promise.all([
    globTestFiles(rootDir),
    globSourceFiles(rootDir),
  ]);

  // Filter to only test files missing @covers
  const missing = testFiles.filter((tf) => {
    let content;
    try {
      content = readFileSync(tf, 'utf8');
    } catch {
      return false;
    }
    const { covered } = parseCovers(content);
    return covered.length === 0;
  });

  let hasError = false;

  if (dryRun) {
    if (missing.length === 0) {
      process.stdout.write('[covers-backfill] all test files already have @covers tags\n');
    } else {
      process.stdout.write('[covers-backfill] test files missing @covers:\n');
      for (const tf of missing) {
        const rel = relative(rootDir, tf).replace(/\\/g, '/');
        process.stdout.write(`  ${rel}\n`);
      }
    }
    process.exit(0);
  }

  for (const tf of missing) {
    const rel = relative(rootDir, tf).replace(/\\/g, '/');
    const inferred = inferSourceFile(tf, srcFiles);

    if ('candidates' in inferred) {
      const candidateRels = inferred.candidates
        .map(c => relative(rootDir, c).replace(/\\/g, '/'));
      process.stderr.write(
        `[covers-ambiguous] ${rel}: candidates=[${candidateRels.join(', ')}]\n`,
      );
      hasError = true;
      continue;
    }

    if ('none' in inferred) {
      process.stderr.write(`[covers-no-source] ${rel}\n`);
      hasError = true;
      continue;
    }

    // Single match — validate path safety
    const inferredAbs = inferred.match;
    const validation = validateInferredPath(inferredAbs, rootDir, rel);
    if (!validation.ok) {
      process.stderr.write(`[covers-rejected] ${rel}: ${validation.reason}\n`);
      continue;
    }

    // Prepend @covers comment to the test file
    const srcRel = relative(rootDir, inferredAbs).replace(/\\/g, '/');
    const content = readFileSync(tf, 'utf8');
    const tag = `// @covers ${srcRel}\n`;

    // Safety: don't double-prepend if already present (shouldn't happen but guard anyway)
    if (!content.includes(`@covers ${srcRel}`)) {
      writeFileSync(tf, tag + content, 'utf8');
      process.stdout.write(`[covers-backfill] wrote @covers ${srcRel} → ${rel}\n`);
    }
  }

  process.exit(hasError ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`[covers-backfill] unexpected error: ${err.message}\n`);
  process.exit(1);
});
