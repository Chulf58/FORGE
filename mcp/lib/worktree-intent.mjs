// Pure helpers for worktree intent + detection.
// Side-effect-free (no I/O, no imports) so tests can load it directly and
// run-lifecycle.js / the orchestrator can share one definition.

/**
 * Whether a run should execute in an isolated git worktree.
 * Implement runs ALWAYS get a worktree (an orchestrated implement must never
 * run in the main project root); other pipelines opt in via `useWorktree`.
 * @param {{ pipelineType?: string, useWorktree?: boolean }} [opts]
 * @returns {boolean}
 */
export function wantsWorktree({ pipelineType, useWorktree } = {}) {
  return useWorktree === true || pipelineType === 'implement';
}

/**
 * Whether `workDir` is the isolated worktree for `runId` — i.e. it contains a
 * `.worktrees/<runId>` path segment. Normalizes POSIX and Windows separators and
 * matches the runId segment EXACTLY (so a prefix like `r-abc` does not match
 * `.worktrees/r-abc-def`).
 * @param {string} workDir
 * @param {string} runId
 * @returns {boolean}
 */
export function isWorktreePath(workDir, runId) {
  if (!workDir || !runId) return false;
  const parts = String(workDir).replace(/\\/g, '/').split('/');
  const i = parts.indexOf('.worktrees');
  return i >= 0 && parts[i + 1] === runId;
}
