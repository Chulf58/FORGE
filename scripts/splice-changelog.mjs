#!/usr/bin/env node
// Splice pending CHANGELOG fragments into docs/CHANGELOG.md atomically.
//
// Usage (module):
//   import { spliceChangelog } from './splice-changelog.mjs';
//   spliceChangelog(projectDir);
//
// Usage (standalone script):
//   node scripts/splice-changelog.mjs [projectDir]
//
// Contract:
//   - Reads all .pipeline/runs/<runId>/CHANGELOG-fragment.md files
//   - Validates each runId against ^r-[a-zA-Z0-9]+$ (skips invalid, fail-open)
//   - Verifies resolved fragment path stays inside .pipeline/runs/ (path-traversal guard)
//   - Prepends fragments to docs/CHANGELOG.md immediately after the `# Changelog` header
//   - Multiple fragments prepended newest-first (by fragment mtime)
//   - Idempotent: skips fragments already present in CHANGELOG
//   - Missing CHANGELOG: creates it with the fragment content
//   - Missing fragment dir: graceful skip, no error
//   - Atomic write via temp file + fs.renameSync
//   - On rename failure: logs to stderr, exits 0, leaves fragments intact
//   - Always exits 0 (fail-open)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const RUNID_REGEX = /^r-[a-zA-Z0-9]+$/;

/**
 * Collect CHANGELOG fragment files from .pipeline/runs/<runId>/CHANGELOG-fragment.md.
 * Returns an array of { runId, fragmentPath, mtime } sorted newest-first by mtime.
 *
 * @param {string} projectDir - absolute path to project root
 * @returns {{ runId: string, fragmentPath: string, mtime: number }[]}
 */
function collectFragments(projectDir) {
  const runsDir = path.join(projectDir, '.pipeline', 'runs');

  let entries;
  try {
    entries = fs.readdirSync(runsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Missing fragment directory — graceful skip
      return [];
    }
    process.stderr.write(`[splice-changelog] failed to read runs dir: ${err.message}\n`);
    return [];
  }

  const safeRunsDir = path.resolve(runsDir) + path.sep;
  const fragments = [];

  for (const entry of entries) {
    // Validate runId shape before using it in any path
    if (!RUNID_REGEX.test(entry)) {
      process.stderr.write(`[splice-changelog] skipping invalid runId: ${entry}\n`);
      continue;
    }

    const fragmentPath = path.join(runsDir, entry, 'CHANGELOG-fragment.md');

    // Path-traversal guard: resolved path must start inside .pipeline/runs/
    const resolvedFragment = path.resolve(fragmentPath);
    if (!resolvedFragment.startsWith(safeRunsDir)) {
      process.stderr.write(`[splice-changelog] skipping invalid runId: ${entry}\n`);
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(fragmentPath);
    } catch {
      // Fragment file absent for this run — skip silently
      continue;
    }

    fragments.push({ runId: entry, fragmentPath, mtime: stat.mtimeMs });
  }

  // Sort newest-first by mtime
  fragments.sort((a, b) => b.mtime - a.mtime);
  return fragments;
}

/**
 * Splice changelog fragments into docs/CHANGELOG.md atomically.
 *
 * @param {string} projectDir - absolute path to project root
 * @returns {void}
 */
export function spliceChangelog(projectDir) {
  const fragments = collectFragments(projectDir);

  if (fragments.length === 0) {
    return;
  }

  const changelogPath = path.join(projectDir, 'docs', 'CHANGELOG.md');

  // Read existing CHANGELOG (or start fresh)
  let existing = '';
  let changelogExists = true;
  try {
    existing = fs.readFileSync(changelogPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      changelogExists = false;
      existing = '';
    } else {
      process.stderr.write(`[splice-changelog] failed to read CHANGELOG: ${err.message}\n`);
      return;
    }
  }

  // Build the set of fragments to insert (skip already-spliced content — idempotency)
  const toInsert = [];
  for (const { runId, fragmentPath, mtime } of fragments) {
    let fragmentContent;
    try {
      fragmentContent = fs.readFileSync(fragmentPath, 'utf8').trim();
    } catch (err) {
      process.stderr.write(`[splice-changelog] failed to read fragment for ${runId}: ${err.message}\n`);
      continue;
    }

    if (!fragmentContent) {
      continue;
    }

    // Idempotency check: skip if fragment content is already present in the CHANGELOG
    if (existing.includes(fragmentContent)) {
      continue;
    }

    toInsert.push({ runId, fragmentPath, fragmentContent, mtime });
  }

  if (toInsert.length === 0) {
    return;
  }

  // Build new CHANGELOG content
  let newContent;

  if (!changelogExists || !existing.trim()) {
    // Create CHANGELOG with just the fragments (newest-first)
    const header = '# Changelog\n';
    const body = toInsert.map((f) => f.fragmentContent).join('\n\n');
    newContent = header + '\n' + body + '\n';
  } else {
    // Find insertion point: immediately after the `# Changelog` header line
    const headerMatch = existing.match(/^(# Changelog[^\n]*\n)/m);
    if (headerMatch) {
      const headerEnd = (headerMatch.index ?? 0) + headerMatch[0].length;
      const before = existing.slice(0, headerEnd);
      const after = existing.slice(headerEnd);
      const insertBlock = toInsert.map((f) => f.fragmentContent).join('\n\n') + '\n\n';
      newContent = before + insertBlock + after;
    } else {
      // No # Changelog header — prepend fragments at the top
      const insertBlock = toInsert.map((f) => f.fragmentContent).join('\n\n') + '\n\n';
      newContent = insertBlock + existing;
    }
  }

  // Atomic write via temp file + renameSync
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `changelog-splice-${Date.now()}-${process.pid}.md`);

  try {
    fs.writeFileSync(tmpPath, newContent, 'utf8');
  } catch (err) {
    process.stderr.write(`[splice-changelog] failed to write temp file: ${err.message}\n`);
    return;
  }

  // Ensure docs/ directory exists before rename
  try {
    fs.mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
  } catch {
    // Directory likely already exists — ignore
  }

  try {
    fs.renameSync(tmpPath, changelogPath);
  } catch (err) {
    // On rename failure: log, return gracefully, leave fragments intact for retry.
    // docs/CHANGELOG.md is NOT modified (rename was atomic-or-nothing;
    // temp file write completed before rename was attempted).
    const fragmentPaths = toInsert.map((f) => f.fragmentPath).join(', ');
    process.stderr.write(
      `[lifecycle] CHANGELOG splice rename failed: ${err.message} — fragment preserved at ${fragmentPaths} for retry\n`,
    );
    // Clean up temp file (best effort — may have been renamed already)
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return;
  }

  // Temp file consumed by rename; clean up if somehow still present (Windows edge case)
  try { fs.unlinkSync(tmpPath); } catch { /* already gone — ignore */ }

  // Delete successfully spliced fragments
  for (const { runId, fragmentPath } of toInsert) {
    try {
      fs.unlinkSync(fragmentPath);
    } catch (err) {
      process.stderr.write(`[splice-changelog] failed to delete fragment for ${runId}: ${err.message}\n`);
    }
  }
}

// --- Standalone script entry point -------------------------------------------
// Safe isMain check: compare resolved paths (handles Windows drive-letter
// capitalisation differences and forward/back slash variations).
const _scriptPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const _argv1 = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (_argv1 === _scriptPath) {
  const projectDir = process.argv[2] || process.cwd();
  spliceChangelog(projectDir);
}
