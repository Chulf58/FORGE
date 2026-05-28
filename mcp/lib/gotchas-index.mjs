// @covers mcp/lib/gotchas-index.mjs
// gotchas-index.mjs — Index-backed retrieval of gotcha sections.
//
// Export:
//   searchGotchasIndex(projectDir, keyword) -> { title, file, tags?, keywords? }[]
//
// Reads docs/gotchas/index.json (mirrors docs/solutions/index.json shape).
// Fail-open on missing/malformed JSON (returns []).
// Never console.log() — would corrupt JSON-RPC if imported by server.js.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GOTCHAS_INDEX_PATH = 'docs/gotchas/index.json';

/**
 * Search docs/gotchas/index.json for entries whose title, tags, or keywords
 * contain the given keyword (case-insensitive substring match).
 *
 * Returns [] when:
 *   - keyword is falsy, empty, or whitespace-only
 *   - no matching entries found
 *   - index file is missing or malformed
 *
 * @param {string} projectDir  — absolute path to project root
 * @param {string|null|undefined} keyword
 * @returns {{ title: string, file: string, tags?: string[], keywords?: string[] }[]}
 */
export function searchGotchasIndex(projectDir, keyword) {
  if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) return [];

  const indexPath = join(resolve(projectDir), GOTCHAS_INDEX_PATH);
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
    if (!entry || typeof entry.title !== 'string' || typeof entry.file !== 'string') continue;

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
      title: entry.title,
      file: entry.file,
      kind: 'gotcha',
      ...(Array.isArray(entry.tags) && { tags: entry.tags }),
      ...(Array.isArray(entry.keywords) && { keywords: entry.keywords }),
    });
  }

  return results;
}
