'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, resolvePluginRoot, STDIN_TIMEOUT_LONG } = require('./hook-utils');

/**
 * Semver guard: only compare when the path segment looks like a release version.
 * A local dev-install (e.g. pluginRoot = '.../forge-plugin') produces a
 * non-semver basename — return null to avoid spurious mismatch warnings.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+/;

/**
 * Pure function: compute a cache-drift warning string when the loaded plugin
 * cache version differs from the working-tree version recorded in plugin.json.
 *
 * Returns the notice string on mismatch, null otherwise.
 * Never throws — any I/O or parse failure silently returns null.
 *
 * @param {string|null|undefined} pluginRoot  path from resolvePluginRoot()
 * @param {string}               projectDir  project root directory
 * @returns {string|null}
 */
function computeDriftWarning(pluginRoot, projectDir) {
  // Defensive guard: resolvePluginRoot() never returns falsy in production,
  // but tests pass null directly to exercise this contract.
  if (!pluginRoot) return null;

  // Extract the cache version from the last path segment (e.g. '0.6.7').
  const cacheVersion = path.basename(pluginRoot);

  // Non-semver segment → local dev-install; skip comparison.
  if (!SEMVER_RE.test(cacheVersion)) return null;

  // Read the working-tree plugin.json to get its declared version.
  let wtVersion;
  try {
    const pluginJsonPath = path.join(projectDir, '.claude-plugin', 'plugin.json');
    const raw = fs.readFileSync(pluginJsonPath, 'utf8');
    const data = JSON.parse(raw);
    // Guard: missing or non-string version — never compare undefined.
    if (data == null || typeof data.version !== 'string') return null;
    wtVersion = data.version;
  } catch (_) {
    // Missing file, unreadable dir, or invalid JSON → fail silently.
    return null;
  }

  // No drift when versions match.
  if (cacheVersion === wtVersion) return null;

  // Drift detected: return the notice string (hook body wraps it in the directive).
  return (
    'FORGE cache drift detected: the loaded plugin cache is v' + cacheVersion +
    ' but the working-tree .claude-plugin/plugin.json is v' + wtVersion +
    '. Run /plugin then /reload-plugins to load the current version.'
  );
}

// ---------------------------------------------------------------------------
// Hook body — only runs when invoked directly as a hook script
// ---------------------------------------------------------------------------

module.exports = { computeDriftWarning };

if (require.main === module) {
  function main(rawInput) {
    let payload;
    try { payload = JSON.parse(rawInput); } catch (_) { process.exit(0); return; }

    const projectDir = resolveProjectDir(payload);
    const pluginRoot = resolvePluginRoot();

    const warning = computeDriftWarning(pluginRoot, projectDir);
    if (!warning) { process.exit(0); return; }

    // Mirror ctx-session-start.js:130-138 — the imperative-display prefix
    // ensures the conductor reliably surfaces the notice before any response.
    const directive =
      'Display the following FORGE notice to the user on its own line, exactly as written, ' +
      'before any other response. Do not paraphrase, do not add advice, ' +
      'do not offer to restart or resume the run:\n\n' +
      warning;

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: directive,
      },
    }) + '\n');

    process.exit(0);
  }

  let inputData = '';
  const timer = setTimeout(() => {
    main(inputData || '{}');
  }, STDIN_TIMEOUT_LONG);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => { inputData += line + '\n'; });
  rl.on('close', () => {
    clearTimeout(timer);
    main(inputData || '{}');
  });
}
