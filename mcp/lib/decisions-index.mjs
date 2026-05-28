// @covers mcp/lib/decisions-index.mjs
// decisions-index.mjs — In-place index over docs/DECISIONS.md.
//
// Exports:
//   buildDecisionsIndex(projectDir) -> { date, title, tags, keywords, anchor }[]
//       Parses docs/DECISIONS.md; one record per `## [YYYY-MM-DD] <title>` heading.
//   searchDecisionsIndex(projectDir, keyword) -> matching records[]
//       Reads docs/decisions-index.json; case-insensitive substring match over
//       title/keywords/tags; fail-open [] on missing/malformed.
//
// Never console.log() — would corrupt JSON-RPC if imported by server.js.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DECISIONS_MD_PATH = 'docs/DECISIONS.md';
const DECISIONS_INDEX_PATH = 'docs/decisions-index.json';

/**
 * Extract keyword tokens from a title.
 * Mirrors extractKeywords in mcp/lib/knowledge-store.js lines ~275-281.
 * Splits on whitespace and non-alphanumeric chars, lowercases, filters length >= 4, deduplicates.
 *
 * @param {string} title
 * @returns {string[]}
 */
function extractKeywords(title) {
  if (!title || typeof title !== 'string') return [];
  const tokens = title.split(/[\s\W]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4);
  return [...new Set(tokens)];
}

/**
 * Convert a heading text (after `## `) into a GitHub-style anchor slug.
 * Lowercases, strips backticks and non-alphanumeric/space/hyphen chars, converts spaces to hyphens.
 *
 * @param {string} headingText  — the full heading text after `## `
 * @returns {string}
 */
function toAnchor(headingText) {
  return headingText
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Parse docs/DECISIONS.md and return one record per `## [YYYY-MM-DD] <title>` heading.
 *
 * Each record shape:
 *   {
 *     date:     string  — YYYY-MM-DD inside the brackets
 *     title:    string  — heading text after `## [YYYY-MM-DD] ` (verbatim)
 *     tags:     []      — empty array (keyword search carries retrieval)
 *     keywords: string[] — tokenized from title
 *     anchor:   string  — GitHub-style slug of the full heading text after `## `
 *   }
 *
 * @param {string} projectDir  — absolute path to project root
 * @returns {{ date: string, title: string, tags: string[], keywords: string[], anchor: string }[]}
 */
export function buildDecisionsIndex(projectDir) {
  const mdPath = join(resolve(projectDir), DECISIONS_MD_PATH);
  const text = readFileSync(mdPath, 'utf8');
  const lines = text.split(/\r?\n/);

  const HEADING_RE = /^## \[(\d{4}-\d{2}-\d{2})\] (.+)$/;
  const records = [];

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (!m) continue;

    const date = m[1];
    const title = m[2].trimEnd();
    // Full heading text after `## ` for anchor generation: `[date] title`
    const fullHeadingText = `[${date}] ${title}`;
    const anchor = toAnchor(fullHeadingText);
    const keywords = extractKeywords(title);

    records.push({
      date,
      title,
      tags: [],
      keywords,
      anchor,
    });
  }

  return records;
}

/**
 * Search docs/decisions-index.json for entries whose title, keywords, or tags
 * contain the given keyword (case-insensitive substring match).
 *
 * Returns [] when:
 *   - keyword is falsy, empty, or whitespace-only
 *   - no matching entries found
 *   - index file is missing or malformed
 *
 * Mirrors searchGotchasIndex in mcp/lib/gotchas-index.mjs (same guard style, same shape).
 *
 * @param {string} projectDir  — absolute path to project root
 * @param {string|null|undefined} keyword
 * @returns {{ date: string, title: string, tags: string[], keywords: string[], anchor: string }[]}
 */
export function searchDecisionsIndex(projectDir, keyword) {
  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) return [];

  const indexPath = join(resolve(projectDir), DECISIONS_INDEX_PATH);
  let entries;
  try {
    const raw = readFileSync(indexPath, 'utf8');
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
  } catch {
    return [];
  }

  const needle = keyword.toLowerCase();
  const results = [];

  for (const entry of entries) {
    if (!entry || typeof entry.title !== 'string') continue;

    const entryKeywords = Array.isArray(entry.keywords)
      ? entry.keywords.map((k) => (typeof k === 'string' ? k.toLowerCase() : ''))
      : [];
    const entryTags = Array.isArray(entry.tags)
      ? entry.tags.map((t) => (typeof t === 'string' ? t.toLowerCase() : ''))
      : [];

    const titleLower = entry.title.toLowerCase();
    const matched =
      titleLower.includes(needle) ||
      entryKeywords.some((k) => k.includes(needle)) ||
      entryTags.some((t) => t.includes(needle));

    if (!matched) continue;

    results.push({
      kind: 'decision',
      date: entry.date,
      title: entry.title,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
      anchor: entry.anchor,
    });
  }

  return results;
}
