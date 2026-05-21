// mcp/lib/worker-timeouts.js
//
// Timeout constants and helpers for forge-worker.mjs.
// Extracted to a separate module so the values are testable without spinning
// up a full worker process.
//
// Two separate timeouts serve two separate purposes:
//   WORKER_TIMEOUT_MS              — active-worker safety valve (60 min)
//   GATE_POLL_TIMEOUT_DEFAULT_MS   — how long the worker waits at a gate for
//                                    human approval before giving up (6 h,
//                                    env-overridable via FORGE_WORKER_GATE_TIMEOUT_MS)

/**
 * Active-worker safety valve — 60 minutes.
 *
 * Prevents a running pipeline from consuming resources indefinitely.
 * Reset by the implement skill after each phase commit (via the reset-pill
 * mechanism in skills/implement/SKILL.md) so each phase gets its own budget.
 * Unchanged by the gate-poll decoupling.
 */
export const WORKER_TIMEOUT_MS = 60 * 60 * 1000; // 3 600 000 ms

/**
 * Default gate-poll timeout — 6 hours.
 *
 * Used when the worker is sitting at a gate (gate1 or gate2) waiting for a
 * human approval decision. Deliberately much longer than the active-worker
 * safety valve because the operator may not be at the keyboard when a gate
 * opens. Overridable via the FORGE_WORKER_GATE_TIMEOUT_MS env var.
 */
export const GATE_POLL_TIMEOUT_DEFAULT_MS = 6 * 60 * 60 * 1000; // 21 600 000 ms

/**
 * Hard upper bound for FORGE_WORKER_GATE_TIMEOUT_MS — 24 hours.
 * Values at or above this limit are treated as misconfiguration and fall back
 * to the 6-hour default.
 */
const GATE_POLL_TIMEOUT_MAX_MS = 24 * 60 * 60 * 1000; // 86 400 000 ms

/**
 * Parses the FORGE_WORKER_GATE_TIMEOUT_MS environment variable value.
 *
 * Validation rules (any failure silently falls back to the 6-h default):
 *   - Must be parseable as a base-10 integer (parseInt(..., 10) not NaN)
 *   - Must be a positive integer (> 0)
 *   - Must be strictly less than 86 400 000 ms (24 h)
 *
 * @param {string|undefined|null} envValue - The raw env var value.
 * @returns {number} Gate-poll timeout in milliseconds.
 */
export function parseGatePollTimeout(envValue) {
  if (envValue === undefined || envValue === null || envValue === '') {
    return GATE_POLL_TIMEOUT_DEFAULT_MS;
  }
  const parsed = parseInt(envValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= GATE_POLL_TIMEOUT_MAX_MS) {
    return GATE_POLL_TIMEOUT_DEFAULT_MS;
  }
  return parsed;
}

/**
 * Builds the failureReason string for a gate-poll timeout.
 *
 * Does NOT use "60-minute limit" — the reason reflects the actual configured
 * gate-poll duration (in ms) so operators can diagnose from run.json without
 * guessing which limit fired.
 *
 * @param {string} gateName      - Gate name (e.g. 'gate1', 'gate2').
 * @param {number} gatePollMs    - The configured gate-poll timeout in ms.
 * @param {string} [timestamp]   - ISO timestamp string. Defaults to now.
 * @returns {string} Human-readable failure reason.
 */
export function buildGatePollFailureReason(gateName, gatePollMs, timestamp) {
  const ts = timestamp || new Date().toISOString();
  return `worker timeout: ${gateName} gate poll exceeded ${gatePollMs} ms gate-poll limit at ${ts}`;
}

/**
 * Default escalation-poll timeout — 30 minutes.
 *
 * Used when the worker is waiting for a human response to a forge_escalate
 * call made with responseRequested: true. Shorter than the gate-poll timeout
 * (6 h) because escalations expect faster turnaround than gate decisions.
 * Overridable via the FORGE_WORKER_ESCALATION_TIMEOUT_MS env var.
 */
export const ESCALATION_POLL_TIMEOUT_DEFAULT_MS = 30 * 60 * 1000; // 1 800 000 ms

/**
 * Hard upper bound for FORGE_WORKER_ESCALATION_TIMEOUT_MS — 24 hours.
 * Values at or above this limit are treated as misconfiguration and fall back
 * to the 30-minute default.
 */
const ESCALATION_POLL_TIMEOUT_MAX_MS = 24 * 60 * 60 * 1000; // 86 400 000 ms

/**
 * Parses the FORGE_WORKER_ESCALATION_TIMEOUT_MS environment variable value.
 *
 * Validation rules (any failure silently falls back to the 30-min default):
 *   - Must be parseable as a base-10 integer (parseInt(..., 10) not NaN)
 *   - Must be a positive integer (> 0)
 *   - Must be strictly less than 86 400 000 ms (24 h)
 *
 * @param {string|undefined|null} envValue - The raw env var value.
 * @returns {number} Escalation-poll timeout in milliseconds.
 */
export function parseEscalationTimeout(envValue) {
  if (envValue === undefined || envValue === null || envValue === '') {
    return ESCALATION_POLL_TIMEOUT_DEFAULT_MS;
  }
  const parsed = parseInt(envValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= ESCALATION_POLL_TIMEOUT_MAX_MS) {
    return ESCALATION_POLL_TIMEOUT_DEFAULT_MS;
  }
  return parsed;
}
