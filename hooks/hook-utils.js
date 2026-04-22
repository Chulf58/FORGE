'use strict';

const path = require('path');

/**
 * Resolves the safe project directory from a hook stdin payload.
 *
 * Validates payload.cwd against process.cwd() to prevent a tampered payload
 * from redirecting hook file operations to an attacker-chosen directory.
 *
 * Validation rules:
 *   1. payload.cwd must be a non-empty string
 *   2. payload.cwd must be an absolute path
 *   3. payload.cwd must exactly match process.cwd()
 *
 * On any violation: falls back to process.cwd() and emits a stderr warning.
 * Never throws or returns an untrusted path.
 *
 * @param {object} payload - parsed hook stdin payload
 * @returns {string} safe project directory (always equals process.cwd())
 */
function resolveProjectDir(payload) {
  const actual = process.cwd();
  const fromPayload = (payload && typeof payload.cwd === 'string')
    ? payload.cwd.trim()
    : '';

  if (!fromPayload) return actual;

  if (!path.isAbsolute(fromPayload)) {
    console.error(
      '[forge-hook] payload.cwd is not absolute ("' + fromPayload +
      '") — falling back to process.cwd()'
    );
    return actual;
  }

  if (fromPayload !== actual) {
    console.error(
      '[forge-hook] payload.cwd mismatch: received "' + fromPayload +
      '", expected "' + actual + '" — falling back to process.cwd()'
    );
    return actual;
  }

  return fromPayload;
}

/**
 * Resolves the safe plugin root for dynamic import() calls.
 *
 * Uses the hook file's own location as the trust anchor:
 *   path.resolve(__dirname, '..') — one level up from hooks/
 *
 * Validation rules for CLAUDE_PLUGIN_ROOT:
 *   1. If absent: use hook-derived root (no warning)
 *   2. If present but not absolute: warn + fall back
 *   3. If present, absolute, but mismatched after normalization: warn + fall back
 *   4. If present, absolute, matching: accept
 *
 * This prevents a tampered CLAUDE_PLUGIN_ROOT env var from redirecting
 * dynamic import() to attacker-controlled JS outside the plugin.
 *
 * @returns {string} safe plugin root path
 */
function resolvePluginRoot() {
  const trusted = path.resolve(__dirname, '..');
  const fromEnv = process.env.CLAUDE_PLUGIN_ROOT;
  if (!fromEnv) return trusted;

  if (!path.isAbsolute(fromEnv)) {
    console.error(
      '[forge-hook] CLAUDE_PLUGIN_ROOT is not absolute ("' + fromEnv +
      '") — falling back to hook-derived plugin root'
    );
    return trusted;
  }

  const normalized = path.normalize(fromEnv);
  if (normalized !== trusted) {
    console.error(
      '[forge-hook] CLAUDE_PLUGIN_ROOT mismatch: "' + normalized +
      '" !== "' + trusted + '" — falling back to hook-derived plugin root'
    );
    return trusted;
  }

  return normalized;
}

/**
 * Strips ANSI escape sequences and terminal control characters from a string
 * before it is written to terminal-facing output (console.error/log).
 *
 * Removes:
 *   - CSI sequences (\x1b[...m) — colour, cursor movement, clear-screen
 *   - OSC sequences (\x1b]...) — title-setting, hyperlinks
 *   - C0/C1 control characters except tab (\x09), newline (\x0a), carriage
 *     return (\x0d) — preserves readable whitespace, strips injection vectors
 *
 * Use on untrusted strings before including them in log messages:
 *   console.error('[hook] agentType=' + stripAnsi(agentType));
 *
 * @param {*} value - value to sanitize (coerced to string if not already)
 * @returns {string} printable string with escape sequences removed
 */
function stripAnsi(value) {
  const str = typeof value === 'string' ? value : String(value == null ? '' : value);
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')          // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*[\x07\x1b\\]/g, '') // OSC sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, ''); // C0/C1 (keep \t \n \r)
}

/**
 * Checks whether a valid, non-expired approval token exists for the given action.
 * Shared implementation — used by bash-guard, workflow-guard, and any other hook
 * that needs to verify user approval.
 *
 * @param {string} action - action to check (e.g. 'commit', 'push', 'gate-approve')
 * @param {string} [projectDir] - project directory (defaults to process.cwd())
 * @returns {boolean}
 */
function hasValidApprovalToken(action, projectDir) {
  const fs = require('fs');
  try {
    const tokenPath = path.join(projectDir || process.cwd(), '.pipeline', 'action-approved.json');
    const raw = fs.readFileSync(tokenPath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions) || !data.expiresAt) return false;
    const expiresAt = new Date(data.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return false;
    return data.actions.includes(action);
  } catch (_) {
    return false;
  }
}

// -- FORGE agent allowlist ---------------------------------------------------
// Derived from the plugin's agents/*.md filenames. Only events whose
// agent_type matches a known FORGE agent are recorded.

let _forgeAgents = undefined;
function getForgeAgentSet() {
  if (_forgeAgents !== undefined) return _forgeAgents;
  try {
    const pluginRoot = resolvePluginRoot();
    const agentsDir = path.join(pluginRoot, 'agents');
    const entries = require('fs').readdirSync(agentsDir);
    const names = entries.filter(n => n.endsWith('.md')).map(n => n.slice(0, -3));
    if (names.length === 0) { _forgeAgents = null; return _forgeAgents; }
    _forgeAgents = new Set(names);
    return _forgeAgents;
  } catch (_) {
    _forgeAgents = null;
    return _forgeAgents;
  }
}

function isForgeAgent(agentType) {
  if (!agentType) return false;
  const allowlist = getForgeAgentSet();
  if (!allowlist) return true;
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return allowlist.has(normalized);
}

// -- Shared constants ---------------------------------------------------------

const STDIN_TIMEOUT_LONG = 10_000;
const STDIN_TIMEOUT_SHORT = 5000;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

// -- Shared run-status reader -------------------------------------------------

/**
 * Read the status of a run from the local registry at
 * .pipeline/runs/<runId>/run.json. Returns the status string or null when
 * the run file is absent, unreadable, unparseable, or missing a status.
 * Defensive — never throws.
 */
function readRunStatus(projectDir, runId) {
  if (!runId || typeof runId !== 'string') return null;
  try {
    const fs = require('fs');
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = fs.readFileSync(runPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.status === 'string' ? parsed.status : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  resolveProjectDir, resolvePluginRoot, stripAnsi, hasValidApprovalToken,
  getForgeAgentSet, isForgeAgent,
  STDIN_TIMEOUT_LONG, STDIN_TIMEOUT_SHORT, TERMINAL_STATUSES, readRunStatus,
};
