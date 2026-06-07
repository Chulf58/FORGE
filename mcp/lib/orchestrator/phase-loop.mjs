// Phase-sequencing primitives shared by the implement orchestrator's Phase Execution Loop
// (mcp/lib/orchestrator/implement-stage.mjs, task 8) and skills/implement/SKILL.md. Pure functions
// only — no I/O, no side effects (codebase convention: reviewer-verdict.mjs, commit-worktree.mjs,
// wave-split.mjs). Isolated here so the orchestrator loop and the skill cannot silently drift on
// phase detection / phase-entry shape. Observer overhaul W3, task 6 (AC-7).

// Matches a plan phase heading at H2-H4 (canonical is H4 `#### Phase N`, but accept H2/H3 for
// backward compatibility — mirrors skills/implement/SKILL.md phase detection). Captures the full
// heading text after the leading #'s (e.g. "Phase 1 — Citation grounding").
const PHASE_HEADING_RE = /^#{2,4}\s+(Phase\s+\d+\b.*?)\s*$/;

/**
 * Parse a plan's `#### Phase N — <label>` headings into an ordered phase list.
 * @param {string} planMd - the full PLAN.md text.
 * @returns {Array<{index:number, label:string, taskLines:string}>} ordered phases (0-based index);
 *   empty array when the plan has NO phase headings (single-pass fallback).
 */
export function detectPhases(planMd) {
  const lines = String(planMd == null ? '' : planMd).split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PHASE_HEADING_RE);
    if (m) headings.push({ lineIdx: i, label: m[1].trim() });
  }
  return headings.map((h, k) => {
    const start = h.lineIdx + 1;
    const end = (k + 1 < headings.length) ? headings[k + 1].lineIdx : lines.length;
    // taskLines = the block between this heading and the next (the `- [ ]` task lines and their
    // Intent/Verify sub-lines), trimmed of surrounding blank lines.
    const taskLines = lines.slice(start, end).join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    return { index: k, label: h.label, taskLines };
  });
}

/**
 * Build the `[phase-scope: <label>]` coder/test-author prompt prefix (mirrors SKILL.md). The
 * bracketed token is machine-detectable — agents/coder.md's HARD PRECONDITION refuses to write
 * files when it is absent from a phase-scoped dispatch.
 * @param {string} label - the phase label (e.g. "Phase 1 — Alpha").
 * @param {string} taskLines - the phase's task lines.
 * @returns {string}
 */
export function phaseScopePrefix(label, taskLines) {
  return '[phase-scope: ' + label + '] Only implement the following tasks from the plan — '
    + 'do NOT implement tasks from other phases:\n\n'
    + String(taskLines == null ? '' : taskLines);
}

/** Phase entry stamped when a phase's work begins (before its first dispatch). */
export function makeRunningEntry(index, label) {
  return { index, label, status: 'running' };
}

/** Phase entry stamped when a phase completes (reviewers APPROVED + per-phase commit). */
export function makeCompletedEntry(index, label, reviewerVerdict, committedAt) {
  return {
    index,
    label,
    status: 'completed',
    reviewerVerdict: reviewerVerdict == null ? null : reviewerVerdict,
    committedAt: committedAt == null ? null : committedAt,
  };
}

/** Phase entry stamped when a reviewer BLOCKs the phase mid-loop. */
export function makeBlockedEntry(index, label) {
  return { index, label, status: 'blocked', reviewerVerdict: 'BLOCK' };
}
