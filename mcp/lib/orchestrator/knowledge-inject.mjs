// @covers mcp/lib/orchestrator/knowledge-inject.mjs
// knowledge-inject.mjs — Gap-1 auto-injection of task-relevant gotchas.
//
// Exports a single pure function:
//   buildInjectedKnowledge(keywords, projectDir) -> string
//
// Given an array of keyword strings, searches docs/gotchas/ for matching
// sections (via searchConstraints) and returns them formatted as injectable
// prompt text. Returns '' when there are no matches or no valid keywords.
// No side effects. Never console.log().

import { searchConstraints } from '../knowledge-store.js';

/**
 * Build injectable prompt text for the given keywords by searching the
 * project's knowledge store (docs/gotchas/).
 *
 * @param {string[] | null | undefined} keywords
 * @param {string} projectDir  — absolute path to project root
 * @returns {string}  — injectable text block, or '' when nothing matched
 */
export function buildInjectedKnowledge(keywords, projectDir) {
  // Guard: null / not-array / all-empty-after-trim → return ''
  if (!Array.isArray(keywords)) return '';

  const trimmed = keywords
    .filter((k) => typeof k === 'string')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (trimmed.length === 0) return '';

  // Collect matched sections, deduplicated by heading
  const seenHeadings = new Set();
  const matched = [];

  for (const keyword of trimmed) {
    const sections = searchConstraints(projectDir, keyword);
    for (const section of sections) {
      if (!seenHeadings.has(section.heading)) {
        seenHeadings.add(section.heading);
        matched.push(section);
      }
    }
  }

  if (matched.length === 0) return '';

  // Format as injectable prompt block
  const lines = ['## Relevant project knowledge', ''];
  for (const section of matched) {
    lines.push(`### ${section.heading}`, '');
    if (section.content) {
      lines.push(section.content, '');
    }
  }

  return lines.join('\n').trimEnd();
}
