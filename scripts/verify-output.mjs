#!/usr/bin/env node
// Filesystem mtime-based output verification helper.
//
// Answers: "did this file change after timestamp T?"
// Replaces `git diff --stat HEAD` checks in skill files so that gitignored
// files (CHANGELOG.md, ARCHITECTURE.md, docs/PLAN.md, etc.) are correctly
// detected as changed — git never reports them even when they are modified.
//
// Resolution assumption: NTFS (Windows) mtime resolution is 100 ns, which is
// finer than the millisecond precision of `since`. Same-second collisions are
// vanishingly rare. Comparison is `mtime >= since` (inclusive) per the plan
// Resolution section. If cross-platform CI is added on filesystems with
// second-only mtime resolution, subtract 1 s from `since` on those platforms.
//
// Usage:
//   node scripts/verify-output.mjs --file=<path> --since=<epoch-ms>
//
// Exit codes:
//   0 — file exists AND mtime >= since  →  stdout: {"ok":true,"reason":"..."}
//   1 — file is absent                  →  stdout: {"ok":false,"reason":"..."}
//   2 — file exists but mtime < since   →  stdout: {"ok":false,"reason":"..."}
//
// stdout is JSON on every exit path (never empty, never partial).
// stderr is used only for argument-parsing errors (agent-readable diagnostics).

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Pure logic — exported for testing if needed
// ---------------------------------------------------------------------------

/**
 * @param {string} filePath
 * @param {number} sinceMs  — epoch milliseconds (inclusive lower bound)
 * @returns {{ exitCode: 0|1|2, ok: boolean, reason: string }}
 */
export function checkMtime(filePath, sinceMs) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { exitCode: 1, ok: false, reason: `file absent: ${filePath}` };
    }
    // Unexpected stat error — treat as absent to be safe.
    return { exitCode: 1, ok: false, reason: `stat error (${code}): ${filePath}` };
  }

  const mtimeMs = stat.mtimeMs;
  if (mtimeMs >= sinceMs) {
    return {
      exitCode: 0,
      ok: true,
      reason: `fresh: mtime ${mtimeMs} >= since ${sinceMs}`,
    };
  }

  return {
    exitCode: 2,
    ok: false,
    reason: `stale: mtime ${mtimeMs} < since ${sinceMs} (old by ${sinceMs - mtimeMs} ms)`,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — runs when the script is invoked directly
// ---------------------------------------------------------------------------

// Use fileURLToPath for cross-platform path comparison (handles Windows drive
// letters in file:// URLs — e.g. file:///C:/... → C:\...).
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);

  /** @param {string} prefix */
  const getArg = (prefix) => {
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
  };

  const filePath = getArg('--file=');
  const sinceRaw = getArg('--since=');

  if (!filePath || sinceRaw === null) {
    process.stderr.write('Usage: node scripts/verify-output.mjs --file=<path> --since=<epoch-ms>\n');
    process.stdout.write(JSON.stringify({ ok: false, reason: 'missing required arguments: --file and --since' }) + '\n');
    process.exit(1);
  }

  const sinceMs = Number(sinceRaw);
  if (!Number.isFinite(sinceMs)) {
    process.stderr.write(`Invalid --since value: ${sinceRaw}\n`);
    process.stdout.write(JSON.stringify({ ok: false, reason: `invalid --since value: ${sinceRaw}` }) + '\n');
    process.exit(1);
  }

  const { exitCode, ok, reason } = checkMtime(filePath, sinceMs);
  process.stdout.write(JSON.stringify({ ok, reason }) + '\n');
  process.exit(exitCode);
}
