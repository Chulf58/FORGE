// watchdog-stamp.mjs — decide whether a worker's exit is a GENUINE silent failure.
//
// The worker's exit handler (forge-worker.mjs) writes watchdog-stamp.json
// (failureReason:"worker-exited-without-reason", status:"failed") to surface a worker
// that died without recording why (the r-468be1b4 silent-failure pattern). But the
// implement-orchestrator's defer-gate writes gate2 and RETURNS by design — the worker
// then exits with status:"gate-pending" and no failureReason, which is NOT a silent
// failure. Stamping it "failed" was a false positive (soak r-1dc3d1fb / r-8c327c9a).

// Statuses where the worker exiting is intentional (paused at a gate) or terminal —
// none of these is a silent failure, so the watchdog must NOT stamp them.
const NON_SILENT_EXIT_STATUSES = new Set([
  'gate-pending',          // orchestrator/worker paused at a gate by design
  'waiting-for-escalation',
  'loop-guard-pending',
  'completed',
  'failed',
  'discarded',
]);

/**
 * @param {{status?: string, failureReason?: string}|null|undefined} runData - parsed run.json
 * @returns {boolean} true only when the exit is a genuine silent failure worth stamping:
 *   the run has no failureReason AND is not in an intentional-pause/terminal state
 *   (i.e. it exited while still 'running'/'created'/unknown). Defensive: a null/non-object
 *   runData never stamps.
 */
export function shouldStampSilentExit(runData) {
  if (!runData || typeof runData !== 'object') return false;
  if (runData.failureReason) return false;
  if (NON_SILENT_EXIT_STATUSES.has(runData.status)) return false;
  return true;
}
