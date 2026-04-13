// usage-store.js — .pipeline/usage.json read/write helpers (ESM)
// Usage is always project-scoped — not global. Lives in projectDir/.pipeline/usage.json.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const USAGE_FILENAME = 'usage.json';

/** Returns a fresh empty usage object (used when usage.json does not exist yet). */
function emptyUsage() {
  return {
    providers: {},
    updatedAt: null,
  };
}

/** Returns a fresh empty provider entry. */
function emptyProvider() {
  return {
    requestCount: 0,
    tokenCount: 0,
    lastUsed: null,
    quotaExhausted: false,
    resetAt: null,
  };
}

function usagePath(projectDir) {
  return join(projectDir, '.pipeline', USAGE_FILENAME);
}

/**
 * Reads .pipeline/usage.json.
 * Returns a fresh empty usage object when the file does not exist.
 * Throws on parse errors (corrupt file).
 *
 * @param {string} projectDir
 * @returns {object}
 */
export function readUsage(projectDir) {
  const filePath = usagePath(projectDir);
  if (!existsSync(filePath)) {
    return emptyUsage();
  }
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error('usage.json read failed: ' + err.message);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('usage.json parse failed: ' + err.message);
  }
}

/**
 * Writes the full usage object to .pipeline/usage.json with 2-space indent.
 * Throws on I/O failure.
 *
 * @param {string} projectDir
 * @param {object} usage
 */
export function writeUsage(projectDir, usage) {
  const filePath = usagePath(projectDir);
  try {
    writeFileSync(filePath, JSON.stringify(usage, null, 2) + '\n', 'utf-8');
  } catch (err) {
    throw new Error('usage.json write failed: ' + err.message);
  }
}

/**
 * Sets quotaExhausted: true for the given provider. Creates the provider entry
 * if it does not exist yet. Reads then writes.
 *
 * @param {string} projectDir
 * @param {string} providerId
 */
export function markQuotaExhausted(projectDir, providerId) {
  const usage = readUsage(projectDir);
  if (!usage.providers) usage.providers = {};
  if (!usage.providers[providerId]) usage.providers[providerId] = emptyProvider();
  usage.providers[providerId].quotaExhausted = true;
  usage.updatedAt = new Date().toISOString();
  writeUsage(projectDir, usage);
}

/**
 * Increments requestCount and tokenCount for the given provider, sets lastUsed.
 * Creates the provider entry if it does not exist yet.
 *
 * @param {string} projectDir
 * @param {string} providerId
 * @param {number} tokens - total tokens used (input + output)
 */
export function recordUsage(projectDir, providerId, tokens) {
  const usage = readUsage(projectDir);
  if (!usage.providers) usage.providers = {};
  if (!usage.providers[providerId]) usage.providers[providerId] = emptyProvider();
  usage.providers[providerId].requestCount += 1;
  usage.providers[providerId].tokenCount += tokens;
  usage.providers[providerId].lastUsed = new Date().toISOString();
  usage.updatedAt = new Date().toISOString();
  writeUsage(projectDir, usage);
}
