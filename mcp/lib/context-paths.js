import { join } from 'node:path';

/**
 * Returns the absolute path of the per-run reviewer output directory.
 *
 * Reviewer agents write verdict files here; skills read from this path
 * when aggregating verdicts and clearing between phases.
 *
 * @param {string} worktreePath - The worktree root (process.cwd() in the worker).
 * @returns {string} Absolute path: <worktreePath>/.pipeline/context/reviewer-output/
 */
export function reviewerOutputDir(worktreePath) {
  return join(worktreePath, '.pipeline', 'context', 'reviewer-output');
}

/**
 * Returns the absolute path of the per-run researcher status file.
 *
 * The researcher writes this file; the coder reads it to detect BLOCKED state.
 * The subagent-stop hook checks this path for truncation detection.
 *
 * @param {string} worktreePath - The worktree root (process.cwd() in the worker).
 * @returns {string} Absolute path: <worktreePath>/.pipeline/context/researcher-status.json
 */
export function researcherStatusPath(worktreePath) {
  return join(worktreePath, '.pipeline', 'context', 'researcher-status.json');
}

/**
 * Returns the absolute path for a persisted verdict body file.
 *
 * Verdict bodies are copied here after each reviewer completes so they survive
 * the inter-phase reviewer-output clear and post-apply lifecycle cleanup.
 *
 * @param {string} worktreePath - The worktree root (process.cwd() in the worker).
 * @param {string} runId - The run ID (e.g. "r-a1b2c3d4").
 * @param {string} reviewer - The reviewer agent name (e.g. "reviewer-safety").
 * @param {string} phase - Phase label: "implement" | "refactor" | "debug" | "phase-1" | "phase-2" | ...
 * @returns {string} Absolute path: <worktreePath>/.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md
 */
export function verdictPath(worktreePath, runId, reviewer, phase) {
  return join(worktreePath, '.pipeline', 'context', 'verdicts', `${runId}-${reviewer}-${phase}.md`);
}
