// Build a unified diff the reviewer-dispatch classifier can read, so its
// addReviewerTestsIfNeeded force-include fires on test-touching changes.
//
// Why this exists (G2): the orchestrator dispatched reviewer-dispatch with only
// --stage/--run-id, which falls to the handoff-PROSE classification path. The
// reviewer-tests force-include lives in the DIFF path (it parses `+++ b/<path>`
// headers and `+` lines), so it never ran — and the test-author's NEW test files
// are UNTRACKED, so a plain `git diff HEAD` would miss them entirely. The worker
// builds (tracked `git diff HEAD`) + (untracked files synthesized as new-file
// hunks) and threads the result via --tests-diff so reviewer-tests fires.
//
// Pure string assembly — kept separate from forge-worker.mjs (which has module-load
// side effects and can't be unit-imported) so the synthesis is directly testable.

/**
 * @param {{ trackedDiff?: string, untracked?: Array<{path: string, content: string}> }} input
 *   trackedDiff: output of `git diff HEAD` (already valid unified-diff text), or ''.
 *   untracked:   new/untracked files as {path, content} pairs (content may be '' for
 *                oversized/binary files — the path-only header still triggers Rule (a)).
 * @returns {string} unified diff text; '' when there are no changes.
 */
export function synthesizeReviewDiff({ trackedDiff = '', untracked = [] } = {}) {
  const parts = [];

  if (typeof trackedDiff === 'string' && trackedDiff.trim()) {
    parts.push(trackedDiff.replace(/\n+$/, ''));
  }

  for (const entry of untracked) {
    if (!entry || !entry.path) continue;
    const norm = String(entry.path).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!norm) continue;

    const lines = String(entry.content == null ? '' : entry.content).split('\n');
    // `split('\n')` on a trailing newline yields a phantom empty final element — drop it.
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const body = lines.map((l) => '+' + l).join('\n');

    parts.push(
      `diff --git a/${norm} b/${norm}\n` +
      'new file mode 100644\n' +
      '--- /dev/null\n' +
      `+++ b/${norm}\n` +
      `@@ -0,0 +1,${lines.length} @@` +
      (body ? '\n' + body : ''),
    );
  }

  return parts.length ? parts.join('\n') + '\n' : '';
}
