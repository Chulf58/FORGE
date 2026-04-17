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

module.exports = { resolveProjectDir };
