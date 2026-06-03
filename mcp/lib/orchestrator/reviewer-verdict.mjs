// mcp/lib/orchestrator/reviewer-verdict.mjs
// Parse a reviewer's verdict (BLOCK / REVISE / APPROVED) from its output markdown.
//
// Soak r-15ef051e finding #1: the orchestrator previously judged the verdict by the
// FIRST LINE only (content.split('\n')[0]). Reviewers write the verdict under a
// "### Verdict" heading several lines down — line 1 is often a blockquote or a
// per-criterion preamble — so a genuine BLOCK was silently read as APPROVED and the
// run took the all-APPROVED path. This anchors on the Verdict section and is fail-safe:
// a BLOCK is never silently dropped.

/**
 * Classify a reviewer output file's verdict.
 *
 * Strategy: prefer the region AFTER the singular "Verdict" heading (the canonical
 * verdict location). Fall back to the whole document if no such heading exists. Within
 * the region, detect verdict tokens as whole words with BLOCK > REVISE > APPROVED
 * priority — BLOCK wins so a block is never lost; word boundaries prevent prose like
 * "no blocking issues" from false-triggering. Unknown/empty → APPROVED (the documented
 * prior default; absent-verdict hardening is tracked separately).
 *
 * @param {string} content - raw reviewer markdown
 * @returns {'BLOCK'|'REVISE'|'APPROVED'}
 */
export function parseReviewerVerdict(content) {
  const text = String(content || '');

  // Anchor on a heading line CONTAINING the singular word "Verdict" (e.g. "### Verdict",
  // "## Final Verdict"). \bVerdict\b excludes the plural "verdicts" (e.g. the
  // "### Per-criterion verdicts" section), which is not the verdict anchor.
  const headingMatch = text.match(/^#{1,6}[^\n]*\bVerdict\b[^\n]*\n([\s\S]*)$/im);
  const region = (headingMatch ? headingMatch[1] : text).toUpperCase();

  // Whole-word tokens. BLOCK(ED), REVISE(D/S), APPROVE(D). \b stops "BLOCKING" from
  // matching BLOCK, "approval" from matching APPROVED, etc.
  if (/\bBLOCK(?:ED)?\b/.test(region)) return 'BLOCK';
  if (/\bREVISE[DS]?\b/.test(region)) return 'REVISE';
  if (/\bAPPROVED?\b/.test(region)) return 'APPROVED';
  return 'APPROVED';
}
