// @covers scripts/gotchas-coverage-verify.mjs
// gotchas-coverage-verify.mjs — Verifies every record in docs/gotchas/index.json is
// (a) backed by a matching markdown heading in its source file, and
// (b) queryable through searchGotchasIndex.
//
// Usage: node scripts/gotchas-coverage-verify.mjs [projectDir]
//   projectDir defaults to process.cwd() when omitted.
//
// Exit 0: all records pass. Exit 1: one or more gaps.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { searchGotchasIndex } from '../mcp/lib/gotchas-index.mjs';

const projectDir = resolve(process.argv[2] || process.cwd());
const indexPath = join(projectDir, 'docs', 'gotchas', 'index.json');

// --- Read index.json ---
let records;
try {
  const raw = readFileSync(indexPath, 'utf8');
  records = JSON.parse(raw);
  if (!Array.isArray(records)) {
    process.stderr.write(`[gotchas-coverage-verify] error: docs/gotchas/index.json is not a JSON array\n`);
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(`[gotchas-coverage-verify] error: cannot read docs/gotchas/index.json — ${err.message}\n`);
  process.exit(1);
}

// --- Heading matcher ---
const HEADING_RE = /^#{1,6}\s+(.*?)\s*$/;

function isHeadingCovered(filePath, title) {
  if (!existsSync(filePath)) return false;
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split('\n')) {
    const m = HEADING_RE.exec(line);
    if (m && m[1] === title) return true;
  }
  return false;
}

// --- Queryability check ---
function isQueryable(projectDir, title) {
  const results = searchGotchasIndex(projectDir, title);
  return results.some((r) => r.title === title);
}

// --- Main loop ---
let hasGap = false;

for (const record of records) {
  if (!record || typeof record.title !== 'string' || typeof record.file !== 'string') {
    process.stdout.write(`[coverage-gap] <malformed record> — missing title or file field\n`);
    hasGap = true;
    continue;
  }

  const { title, file } = record;
  const absFile = join(projectDir, file);

  if (!existsSync(absFile)) {
    process.stdout.write(`[coverage-gap] ${title} — file-missing (${file})\n`);
    hasGap = true;
    continue;
  }

  const headingOk = isHeadingCovered(absFile, title);
  const queryOk = isQueryable(projectDir, title);

  if (headingOk && queryOk) {
    process.stdout.write(`PASS: ${title}\n`);
  } else if (!headingOk && !queryOk) {
    process.stdout.write(`[coverage-gap] ${title} — heading-missing and not-queryable\n`);
    hasGap = true;
  } else if (!headingOk) {
    process.stdout.write(`[coverage-gap] ${title} — heading-missing\n`);
    hasGap = true;
  } else {
    process.stdout.write(`[coverage-gap] ${title} — not-queryable\n`);
    hasGap = true;
  }
}

process.exit(hasGap ? 1 : 0);
