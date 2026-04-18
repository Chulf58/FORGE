// config-store.js — forge-config.json read/write helpers (ESM)
// Config priority: CLAUDE_PLUGIN_DATA/forge-config.json -> projectDir/.pipeline/forge-config.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Known provider types supported by forge_call_external adapters.
// Any type not in this set cannot dispatch to an adapter and must be rejected.
const KNOWN_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'gemini']);

// Environment variable names must be uppercase alphanumeric + underscores.
// This blocks malicious strings like "$(...)", "../../etc", or injection attempts.
const ENV_VAR_RE = /^[A-Z][A-Z0-9_]{0,99}$/;

/**
 * Validates a parsed forge-config.json object.
 * Throws with a descriptive message on any violation so invalid config never
 * reaches router or adapter resolution.
 *
 * Validates:
 *   - providers: array of objects with known type and safe envVar
 *   - models: array of objects with id and providerId
 *   - agentModelMap: object whose values are objects
 *
 * @param {object} config - parsed config object
 * @param {string} configPath - source path (for error messages)
 */
export function validateForgeConfig(config, configPath) {
  const loc = configPath || 'forge-config.json';

  // providers — required array
  if (!Array.isArray(config.providers)) {
    throw new Error(`forge-config validation failed at ${loc}: "providers" must be an array`);
  }
  for (const p of config.providers) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new Error(`forge-config validation failed at ${loc}: provider entry must be an object`);
    }
    if (typeof p.id !== 'string' || !p.id) {
      throw new Error(`forge-config validation failed at ${loc}: provider entry missing "id"`);
    }
    if (!KNOWN_PROVIDER_TYPES.has(p.type)) {
      throw new Error(
        `forge-config validation failed at ${loc}: provider "${p.id}" has unknown type "${p.type}" — allowed: ${[...KNOWN_PROVIDER_TYPES].join(', ')}`
      );
    }
    if (typeof p.envVar !== 'string' || !ENV_VAR_RE.test(p.envVar)) {
      throw new Error(
        `forge-config validation failed at ${loc}: provider "${p.id}" has invalid envVar "${p.envVar}" — must be uppercase alphanumeric + underscores`
      );
    }
  }

  // models — optional array; each entry needs id + providerId
  if (config.models !== undefined && !Array.isArray(config.models)) {
    throw new Error(`forge-config validation failed at ${loc}: "models" must be an array`);
  }
  for (const m of (config.models || [])) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      throw new Error(`forge-config validation failed at ${loc}: model entry must be an object`);
    }
    if (typeof m.id !== 'string' || !m.id) {
      throw new Error(`forge-config validation failed at ${loc}: model entry missing "id"`);
    }
    if (typeof m.providerId !== 'string' || !m.providerId) {
      throw new Error(`forge-config validation failed at ${loc}: model "${m.id}" missing "providerId"`);
    }
  }

  // agentModelMap — optional object; each value must be an object
  if (config.agentModelMap !== undefined) {
    if (typeof config.agentModelMap !== 'object' || Array.isArray(config.agentModelMap) || config.agentModelMap === null) {
      throw new Error(`forge-config validation failed at ${loc}: "agentModelMap" must be an object`);
    }
    for (const [agentName, entry] of Object.entries(config.agentModelMap)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`forge-config validation failed at ${loc}: agentModelMap["${agentName}"] must be an object`);
      }
    }
  }
}

/**
 * Returns the CLAUDE_PLUGIN_DATA directory, or null if the env var is not set.
 * Callers fall back to the project .pipeline/ directory when this returns null.
 */
export function resolvePluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || null;
}

// Module-level routing config cache — loaded once per session, invalidated on write.
// The routing config (models, providers, agentModelMap) changes only when the user
// explicitly updates it, so re-reading on every recommendation call is wasteful.
let _cache = null; // { config, configPath, pluginDataDir, projectDir }

/**
 * Reads forge-config.json — cached after first load.
 * Tries pluginDataDir/forge-config.json first (when pluginDataDir is non-null),
 * then falls back to projectDir/.pipeline/forge-config.json.
 *
 * Returns { config, configPath } so writes always go to the same location.
 * Throws with a descriptive message if neither path exists or cannot be parsed.
 *
 * @param {string|null} pluginDataDir - value from resolvePluginDataDir()
 * @param {string} projectDir - project root (process.cwd() or CLAUDE_PROJECT_DIR)
 * @returns {{ config: object, configPath: string }}
 */
export function readForgeConfig(pluginDataDir, projectDir) {
  if (_cache !== null &&
      _cache.pluginDataDir === pluginDataDir &&
      _cache.projectDir === projectDir) {
    return { config: _cache.config, configPath: _cache.configPath };
  }

  const candidates = [];
  if (pluginDataDir) {
    candidates.push(join(pluginDataDir, 'forge-config.json'));
  }
  candidates.push(join(projectDir, '.pipeline', 'forge-config.json'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      let raw;
      try {
        raw = readFileSync(candidate, 'utf-8');
      } catch (err) {
        throw new Error('forge-config.json read failed at ' + candidate + ': ' + err.message);
      }
      let config;
      try {
        config = JSON.parse(raw);
      } catch (err) {
        throw new Error('forge-config.json parse failed at ' + candidate + ': ' + err.message);
      }
      validateForgeConfig(config, candidate);
      _cache = { config, configPath: candidate, pluginDataDir, projectDir };
      return { config, configPath: candidate };
    }
  }

  throw new Error(
    'forge-config.json not found. Searched: ' + candidates.join(', ') +
    '. Run /forge:init or copy forge-config.default.json to one of these locations.',
  );
}

/**
 * Invalidates the routing config cache.
 * Call after any operation that modifies forge-config.json.
 */
export function invalidateConfigCache() {
  _cache = null;
}

/**
 * Writes config back to the path it was read from (read-mutate-write pattern).
 * Uses 2-space indent. Throws on I/O failure.
 *
 * @param {string} configPath - path returned by readForgeConfig()
 * @param {object} config - the full config object to serialize
 */
export function writeForgeConfig(configPath, config) {
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    throw new Error('forge-config.json write failed at ' + configPath + ': ' + err.message);
  }
  _cache = null; // invalidate after write so next read picks up the new config
}
