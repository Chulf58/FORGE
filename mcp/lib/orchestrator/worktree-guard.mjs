// mcp/lib/orchestrator/worktree-guard.mjs
// a8de840b #2 — structural backstop for the worktree-isolation breach: a dispatched
// agent (running with cwd=worktree) must never write into the MAIN project root. The
// orchestrator snapshots main's untracked files (under hooks/mcp/scripts) at run start,
// then re-snapshots after the writer dispatches; any NEW entry is a leak that escaped
// the worktree. This is mechanism-independent — it catches the breach however the agent
// computed the offending path (relative, absolute, or via a node/Bash command).

/**
 * Diff two snapshots of main-root untracked paths; return the additions (strays).
 *
 * @param {string[]|null|undefined} baseline - untracked paths present at run start
 * @param {string[]|null|undefined} current  - untracked paths after the writer dispatches
 * @returns {string[]} paths in `current` that were absent from `baseline` (order-preserved)
 */
export function detectMainStrays(baseline, current) {
  const base = new Set(Array.isArray(baseline) ? baseline : []);
  const cur = Array.isArray(current) ? current : [];
  return cur.filter((p) => !base.has(p));
}
