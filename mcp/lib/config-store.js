// config-store.js — forge-config.json read/write helpers (ESM)
// Config priority: CLAUDE_PLUGIN_DATA/forge-config.json -> projectDir/.pipeline/forge-config.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Returns the CLAUDE_PLUGIN_DATA directory, or null if the env var is not set.
 * Callers fall back to the project .pipeline/ directory when this returns null.
 */
export function resolvePluginDataDir() {
  return process.env.CLAUDE_PLUGIN_DATA || null;
}

/**
 * Reads forge-config.json.
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
      return { config, configPath: candidate };
    }
  }

  throw new Error(
    'forge-config.json not found. Searched: ' + candidates.join(', ') +
    '. Run /forge:init or copy forge-config.default.json to one of these locations.',
  );
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
}
