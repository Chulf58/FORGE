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

module.exports = { resolveProjectDir, resolvePluginRoot, stripAnsi };
