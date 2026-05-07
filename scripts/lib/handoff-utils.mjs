// Shared helpers for extracting sections and code blocks from handoff.md content.
// Used by lean-risk-classify.mjs, reviewer-style-check.mjs, and other scripts.

// Extract body of a level-2 markdown section by heading text.
// Returns the body (without the heading) or null if absent.
export function extractSection(content, headingText) {
  const headingRegex = new RegExp(
    `^##\\s+${headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'mi',
  );
  const match = content.match(headingRegex);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeading = rest.match(/^##\s+\S/m);
  const end = nextHeading ? nextHeading.index : rest.length;
  return rest.slice(0, end);
}

// Concatenate every fenced code block body from a section.
// Returns a single string with all code block contents joined by newlines.
export function extractCodeBlockContent(filesSection) {
  if (!filesSection) return '';
  // Concatenate every fenced code block body so content patterns can match
  // across languages. The triple-backtick fence is the universal delimiter.
  const out = [];
  const re = /```[\w-]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(filesSection)) !== null) {
    out.push(m[1]);
  }
  return out.join('\n');
}
