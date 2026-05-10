#!/usr/bin/env node
// @covers scripts/covers-parser.mjs
// Parses @covers tags from test file content.
// Export: parseCovers(content: string) → { covered: string[] }

/**
 * Parse all `// @covers <path>` lines from file content.
 * Normalises paths to canonical forward-slash, repo-relative form:
 *   - strips leading ./
 *   - converts backslashes to forward-slashes
 *
 * @param {string} content - raw file content string
 * @returns {{ covered: string[] }}
 */
export function parseCovers(content) {
  const covered = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\/\/\s*@covers\s+(.+)$/);
    if (match) {
      let p = match[1].trim();
      // Normalise Windows backslashes to forward-slashes, then collapse runs of slashes
      p = p.replace(/\\/g, '/').replace(/\/+/g, '/');
      // Strip leading ./
      if (p.startsWith('./')) {
        p = p.slice(2);
      }
      covered.push(p);
    }
  }
  return { covered };
}
