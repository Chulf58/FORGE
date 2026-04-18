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
 * Sets provider-wide quotaExhausted: true. Use for failures that affect ALL
 * models from this provider (e.g. auth / 401 / billing-disabled). For per-model
 * rate or quota failures use markModelQuotaExhausted instead.
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
 * Sets quotaExhausted: true on a specific model under the given provider.
 * Used for 429 / per-model quota failures so that one exhausted model does
 * not poison other models from the same provider. Creates provider and model
 * entries if they do not yet exist.
 *
 * Stored at usage.providers[providerId].models[modelId].quotaExhausted to
 * align with the existing per-model shape produced by recordUsage.
 *
 * @param {string} projectDir
 * @param {string} providerId
 * @param {string} modelId
 */
export function markModelQuotaExhausted(projectDir, providerId, modelId) {
  const usage = readUsage(projectDir);
  if (!usage.providers) usage.providers = {};
  if (!usage.providers[providerId]) usage.providers[providerId] = emptyProvider();
  if (!usage.providers[providerId].models) usage.providers[providerId].models = {};
  if (!usage.providers[providerId].models[modelId]) {
    usage.providers[providerId].models[modelId] = { requestCount: 0, tokenCount: 0, lastUsed: null, quotaExhausted: false };
  }
  usage.providers[providerId].models[modelId].quotaExhausted = true;
  usage.updatedAt = new Date().toISOString();
  writeUsage(projectDir, usage);
}

/**
 * Pure predicate: is the given model unavailable according to the usage state?
 * Returns true when either model-level OR provider-level exhaustion is set.
 * Safe on old-format usage.json (missing models key → falls back to provider-level).
 *
 * @param {object} usage
 * @param {string} providerId
 * @param {string} modelId
 * @returns {boolean}
 */
export function isModelQuotaExhausted(usage, providerId, modelId) {
  const providerUsage = usage?.providers?.[providerId];
  if (!providerUsage) return false;
  if (providerUsage.quotaExhausted) return true;
  return providerUsage.models?.[modelId]?.quotaExhausted === true;
}

/**
 * Increments requestCount and tokenCount for the given provider, sets lastUsed.
 * Also tracks per-model breakdown when modelId is provided.
 * Creates the provider/model entry if it does not exist yet.
 *
 * @param {string} projectDir
 * @param {string} providerId
 * @param {number} tokens - total tokens used (input + output)
 * @param {string} [modelId] - optional model ID for per-model tracking
 */
export function recordUsage(projectDir, providerId, tokens, modelId) {
  const usage = readUsage(projectDir);
  if (!usage.providers) usage.providers = {};
  if (!usage.providers[providerId]) usage.providers[providerId] = emptyProvider();
  const now = new Date().toISOString();
  usage.providers[providerId].requestCount += 1;
  usage.providers[providerId].tokenCount += tokens;
  usage.providers[providerId].lastUsed = now;

  // Per-model breakdown
  if (modelId) {
    if (!usage.providers[providerId].models) usage.providers[providerId].models = {};
    if (!usage.providers[providerId].models[modelId]) {
      usage.providers[providerId].models[modelId] = { requestCount: 0, tokenCount: 0, lastUsed: null, quotaExhausted: false };
    }
    usage.providers[providerId].models[modelId].requestCount += 1;
    usage.providers[providerId].models[modelId].tokenCount += tokens;
    usage.providers[providerId].models[modelId].lastUsed = now;
  }

  usage.updatedAt = now;
  writeUsage(projectDir, usage);
}
