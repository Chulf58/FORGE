// sanitize.js — shared sanitization helpers for MCP tool inputs (ESM)

/**
 * Sanitizes a feature name for safe use in shell commands (git commit -m,
 * gh pr create --title, etc.).
 *
 * Strips characters that break shell quoting when embedded in a double-quoted
 * argument: `"`, `\`, backtick, `$`, carriage return, newline, and other
 * C0/C1 control characters. Trims whitespace and truncates to 200 chars.
 *
 * This is the mechanical enforcement boundary — prompt-level sanitization in
 * skills/apply/SKILL.md is defense in depth on top of this.
 *
 * @param {string} raw - the raw feature name from user input
 * @returns {string} safe feature name
 */
export function sanitizeFeatureName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    // Strip chars that break "..." shell quoting or trigger substitution
    .replace(/["\\`$\r\n\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 200);
}
