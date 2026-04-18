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

module.exports = { resolveProjectDir, resolvePluginRoot };
