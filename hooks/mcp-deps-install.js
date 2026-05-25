'use strict';

// MCP Dependencies Installer — SessionStart hook.
// Auto-installs dependencies for mcp/ and packages/forge-core/ under
// the plugin root directory. Runs npm install only when node_modules
// is missing or package.json is newer than the lockfile.

const { findMissingDirectDep } = require('../scripts/lib/preflight.cjs');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

function exitOk() { process.exit(0); }

/**
 * Locate the Claude binary on this machine. Mirrors findClaude() in
 * scripts/forge-wrapper-proto.mjs — duplicated because the wrapper is ESM
 * and this hook is CommonJS, and because the discovery is short enough
 * that duplication is cheaper than a shared-module refactor.
 *
 * Returns the absolute path if discovery succeeds, or null otherwise.
 * Null callers (the launcher generator below) skip baking a
 * FORGE_CLAUDE_CMD line and let the wrapper's own discovery run at launch.
 */
function discoverClaudePath() {
  const pathTool = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(pathTool, ['claude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = (out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch (_) { /* not on PATH */ }

  if (process.platform === 'win32') {
    const candidates = [
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.local', 'bin', 'claude.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'claude.cmd'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) { /* skip */ }
    }
  }

  return null;
}

/**
 * Copies forge-config.default.json to ${CLAUDE_PLUGIN_DATA}/forge-config.json
 * on first session. Skips silently if:
 * - CLAUDE_PLUGIN_DATA env var is not set (config-store.js falls back to .pipeline/)
 * - target file already exists (never overwrite user edits)
 * - source default file is missing (log and skip)
 */
function bootstrapForgeConfig(pluginRoot) {
  const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginDataDir) {
    return;
  }

  const targetPath = path.join(pluginDataDir, 'forge-config.json');
  if (fs.existsSync(targetPath)) {
    return;
  }

  const sourcePath = path.join(pluginRoot, 'forge-config.default.json');
  if (!fs.existsSync(sourcePath)) {
    console.error('[forge-mcp] forge-config.default.json not found at ' + sourcePath + ' — skipping bootstrap');
    return;
  }

  try {
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    console.error('[forge-mcp] Bootstrapped forge-config.json to ' + targetPath);
  } catch (err) {
    console.error('[forge-mcp] Failed to bootstrap forge-config.json: ' + err.message);
    // Non-fatal — config-store.js falls back to .pipeline/forge-config.json
  }
}

/**
 * Runs after bootstrapForgeConfig. If the live config's schemaVersion
 * differs from the default's, performs a shallow diff-merge that:
 *   - Adds providers/models/agentMap entries present in default but missing in live
 *   - Removes providers/models/agentMap entries present in live but missing in default
 *     (retired content like gemini-2.0-flash)
 *   - Updates non-user-owned fields from default (capabilities, costTier, pricing,
 *     contextWindow, notes, reasoningTier on models; name/type/notes/priority on
 *     providers; requiredCapabilities/allowedVendors on agentMap entries)
 *   - Preserves user-owned fields: providers[*].enabled, providers[*].envVar
 *   - Preserves user-added providers/models/agents whose ids are not in default
 *   - Preserves top-level quotaTracking user value
 *   - Writes backup to <liveDir>/forge-config.json.bak-<ISO-timestamp>.json before
 *     overwriting the live file
 *   - Logs a one-line [forge-mcp-migration] summary to stderr with counts of
 *     providers/models/agents added/removed/updated
 *   - Fail-open: on any error (file I/O, JSON parse, validation), leaves live
 *     config untouched, logs the error, exits without throwing
 */
/**
 * Resolve the live forge-config.json path. When CLAUDE_PLUGIN_DATA is set,
 * use it (matches mcp/lib/config-store.js resolvePluginDataDir()). Otherwise
 * fall back to <mainProjectDir>/.pipeline/forge-config.json — explicitly
 * NOT process.cwd(), because in worker sessions cwd points at the worktree
 * and config writes would land in the wrong place.
 *
 * Extracted as a pure helper for regression coverage (closes d9683d2a part A).
 *
 * @param {string|null} pluginDataDir — value of process.env.CLAUDE_PLUGIN_DATA, or null
 * @param {string} mainProjectDir — resolved via resolveProjectDir(payload), the canonical main project root
 * @returns {string} absolute path to forge-config.json
 */
function resolveLiveConfigPath(pluginDataDir, mainProjectDir) {
  return pluginDataDir
    ? path.join(pluginDataDir, 'forge-config.json')
    : path.join(mainProjectDir, '.pipeline', 'forge-config.json');
}

function migrateForgeConfig(pluginRoot, mainProjectDir) {
  try {
    // Resolve live config path — mirrors mcp/lib/config-store.js resolvePluginDataDir().
    // Fallback uses mainProjectDir (resolved via resolveProjectDir(payload)) rather
    // than process.cwd() so worker sessions don't write the config into the worktree.
    const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA || null;
    const liveConfigPath = resolveLiveConfigPath(pluginDataDir, mainProjectDir);

    // If live config doesn't exist, bootstrap handles first-run — skip
    if (!fs.existsSync(liveConfigPath)) {
      return;
    }

    const defaultConfigPath = path.join(pluginRoot, 'forge-config.default.json');
    if (!fs.existsSync(defaultConfigPath)) {
      console.error('[forge-mcp-migration] forge-config.default.json not found at ' + defaultConfigPath + ' — skipping migration');
      return;
    }

    // Parse both configs — fail-open on parse errors
    let liveConfig;
    try {
      liveConfig = JSON.parse(fs.readFileSync(liveConfigPath, 'utf8'));
    } catch (err) {
      console.error('[forge-mcp-migration] Failed to parse live config at ' + liveConfigPath + ': ' + err.message + ' — skipping migration');
      return;
    }

    let defaultConfig;
    try {
      defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
    } catch (err) {
      console.error('[forge-mcp-migration] Failed to parse default config at ' + defaultConfigPath + ': ' + err.message + ' — skipping migration');
      return;
    }

    const oldVersion = liveConfig.schemaVersion;
    const newVersion = defaultConfig.schemaVersion;

    // If both versions are defined and equal, nothing to do — idempotent
    if (oldVersion !== undefined && oldVersion === newVersion) {
      return;
    }

    // --- Diff-merge providers ---
    let pAdd = 0, pRem = 0, pUpd = 0;
    const defaultProviderMap = new Map((defaultConfig.providers || []).map(function(p) { return [p.id, p]; }));
    const liveProviderMap = new Map((liveConfig.providers || []).map(function(p) { return [p.id, p]; }));
    const mergedProviders = [];

    // Add or update entries from default
    for (const entry of defaultProviderMap) {
      const id = entry[0];
      const defP = entry[1];
      if (!liveProviderMap.has(id)) {
        // ADD: present in default but not in live
        mergedProviders.push(Object.assign({}, defP));
        pAdd++;
      } else {
        // UPDATE: non-user-owned fields from default; keep enabled/envVar from live
        const liveP = liveProviderMap.get(id);
        const merged = {
          id: defP.id,
          name: defP.name,
          type: defP.type,
          envVar: liveP.envVar !== undefined ? liveP.envVar : defP.envVar,
          enabled: liveP.enabled !== undefined ? liveP.enabled : defP.enabled,
          priority: defP.priority,
        };
        if (defP.notes !== undefined) merged.notes = defP.notes;
        mergedProviders.push(merged);
        pUpd++;
      }
    }
    // Preserve user-added providers not in default
    for (const entry of liveProviderMap) {
      const id = entry[0];
      const liveP = entry[1];
      if (!defaultProviderMap.has(id)) {
        mergedProviders.push(Object.assign({}, liveP));
      }
    }
    // pRem stays 0: we can't distinguish user-added from retired default entries
    // in the live-only set without old-default history. Preserve all to avoid data loss.

    // --- Diff-merge models ---
    let mAdd = 0, mRem = 0, mUpd = 0;
    const defaultModelMap = new Map((defaultConfig.models || []).map(function(m) { return [m.id, m]; }));
    const liveModelMap = new Map((liveConfig.models || []).map(function(m) { return [m.id, m]; }));
    const mergedModels = [];

    // Add or update entries from default (models have no user-owned fields — replace wholesale)
    for (const entry of defaultModelMap) {
      const id = entry[0];
      const defM = entry[1];
      if (!liveModelMap.has(id)) {
        mergedModels.push(Object.assign({}, defM));
        mAdd++;
      } else {
        // UPDATE: replace all fields from default
        mergedModels.push(Object.assign({}, defM));
        mUpd++;
      }
    }
    // Preserve user-added models not in default
    for (const entry of liveModelMap) {
      const id = entry[0];
      const liveM = entry[1];
      if (!defaultModelMap.has(id)) {
        mergedModels.push(Object.assign({}, liveM));
      }
    }
    // mRem stays 0: same conservative logic as providers

    // --- Diff-merge agentModelMap ---
    let aAdd = 0, aRem = 0, aUpd = 0;
    const defaultAgentMap = defaultConfig.agentModelMap || {};
    const liveAgentMap = liveConfig.agentModelMap || {};
    const mergedAgentMap = {};

    // Add or REPLACE entries from default (drops legacy preferred/fallback shape)
    const defaultAgentKeys = Object.keys(defaultAgentMap);
    for (let i = 0; i < defaultAgentKeys.length; i++) {
      const name = defaultAgentKeys[i];
      const defEntry = defaultAgentMap[name];
      if (!(name in liveAgentMap)) {
        mergedAgentMap[name] = Object.assign({}, defEntry);
        aAdd++;
      } else {
        // REPLACE entirely — drops any legacy shape, adopts requiredCapabilities shape
        mergedAgentMap[name] = Object.assign({}, defEntry);
        aUpd++;
      }
    }
    // Preserve user-added agents not in default
    const liveAgentKeys = Object.keys(liveAgentMap);
    for (let i = 0; i < liveAgentKeys.length; i++) {
      const name = liveAgentKeys[i];
      if (!(name in defaultAgentMap)) {
        mergedAgentMap[name] = Object.assign({}, liveAgentMap[name]);
      }
    }
    // aRem stays 0: same conservative logic

    // --- Assemble merged config ---
    const merged = {
      schemaVersion: newVersion,
      providers: mergedProviders,
      models: mergedModels,
      agentModelMap: mergedAgentMap,
      // Preserve top-level quotaTracking from live if present, else take from default
      quotaTracking: liveConfig.quotaTracking !== undefined
        ? liveConfig.quotaTracking
        : defaultConfig.quotaTracking,
    };

    // Copy any other top-level keys from default that aren't explicitly handled above
    const defaultTopKeys = Object.keys(defaultConfig);
    for (let i = 0; i < defaultTopKeys.length; i++) {
      const key = defaultTopKeys[i];
      if (!(key in merged)) {
        merged[key] = defaultConfig[key];
      }
    }

    // Write backup before overwriting — abort migration if backup fails
    const liveDir = path.dirname(liveConfigPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(liveDir, 'forge-config.json.bak-' + timestamp + '.json');
    try {
      fs.copyFileSync(liveConfigPath, backupPath);
    } catch (err) {
      console.error('[forge-mcp-migration] Failed to write backup at ' + backupPath + ': ' + err.message + ' — aborting migration to preserve live config');
      return;
    }

    // Write merged config
    try {
      fs.writeFileSync(liveConfigPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error('[forge-mcp-migration] Failed to write merged config at ' + liveConfigPath + ': ' + err.message + ' — live config unchanged (backup at ' + backupPath + ')');
      return;
    }

    console.error(
      '[forge-mcp-migration] schemaVersion ' + oldVersion + ' \u2192 ' + newVersion +
      '; providers +' + pAdd + '/-' + pRem + '/~' + pUpd +
      ', models +' + mAdd + '/-' + mRem + '/~' + mUpd +
      ', agents +' + aAdd + '/-' + aRem + '/~' + aUpd +
      '; backup at ' + backupPath
    );
  } catch (err) {
    // Outermost safety net — never throw from a hook function
    console.error('[forge-mcp-migration] Unexpected error: ' + err.message + ' — live config untouched');
  }
}

function resolveNpmTimeout() {
  return parseInt(process.env.FORGE_NPM_INSTALL_TIMEOUT_MS || '600000', 10);
}

// findMissingDirectDep is imported from scripts/lib/preflight.cjs at the top of
// this file. It is re-exported below so existing tests that import it via this
// module continue to work.

function _runNpmCatch(label, nodeModules, err) {
  console.error('[forge-mcp] Failed to install ' + label + ' dependencies: ' + err.message);
}

/**
 * Factory that builds a runNpm function using the resolved Node installation's
 * bundled npm-cli.js. Extracted from main() so it can be shared with
 * scanCacheVersions (and overridden in tests via the opts._runNpm injection).
 */
function makeNpmRunner() {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const hasNpmCli = fs.existsSync(npmCli);
  if (!hasNpmCli) {
    console.error('[forge-mcp] npm-cli.js not found at ' + npmCli + ' — falling back to bare npm');
  }
  return function runNpm(args, cwd) {
    if (hasNpmCli) {
      execFileSync(process.execPath, [npmCli].concat(args), {
        cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: resolveNpmTimeout(),
      });
    } else {
      execFileSync('npm', args, {
        cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: resolveNpmTimeout(),
      });
    }
  };
}

/**
 * Recursively copies src directory to dst directory.
 * @param {string} src
 * @param {string} dst
 */
function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Module-level flag: prevents multiple scans per Claude session.
// SessionStart may re-fire on resume/compact — this ensures only one scan.
let _scanRanThisSession = false;

/**
 * Scans all version directories under cacheBaseDir for missing or incomplete
 * mcp/node_modules. For each broken version:
 *   1. Copies @anthropic-ai/claude-agent-sdk from a healthy donor version (NEVER npm-installs the SDK)
 *   2. Runs npm ci for any remaining missing direct deps
 *
 * @param {string} cacheBaseDir - directory containing version subdirs
 * @param {{ _runNpm?: function }} [opts] - test injection: override npm runner
 */
function scanCacheVersions(cacheBaseDir, opts) {
  try {
    if (!fs.existsSync(cacheBaseDir)) return;

    let entries;
    try {
      entries = fs.readdirSync(cacheBaseDir, { withFileTypes: true });
    } catch (_) { return; }

    const versionDirs = entries
      .filter(function(e) { return e.isDirectory(); })
      .map(function(e) { return path.join(cacheBaseDir, e.name); });

    if (versionDirs.length === 0) return;

    // Resolve npm runner — injectable for tests
    const runNpmFn = (opts && opts._runNpm) || makeNpmRunner();

    // Find a healthy donor version (intact mcp/node_modules with no missing direct deps)
    let donorNodeModules = null;
    for (const versionDir of versionDirs) {
      const mcpDir = path.join(versionDir, 'mcp');
      const packageJson = path.join(mcpDir, 'package.json');
      const nodeModules = path.join(mcpDir, 'node_modules');
      if (!fs.existsSync(packageJson) || !fs.existsSync(nodeModules)) continue;
      const missing = findMissingDirectDep(packageJson, nodeModules);
      if (!missing) { donorNodeModules = nodeModules; break; }
    }

    // Repair each broken version
    for (const versionDir of versionDirs) {
      const mcpDir = path.join(versionDir, 'mcp');
      const packageJson = path.join(mcpDir, 'package.json');
      const nodeModules = path.join(mcpDir, 'node_modules');
      const packageLockJson = path.join(mcpDir, 'package-lock.json');

      if (!fs.existsSync(packageJson)) continue;

      const missing = findMissingDirectDep(packageJson, nodeModules);
      if (!missing) continue; // Already healthy

      console.error('[forge-mcp-cache-repair] Repairing ' + versionDir + ': missing ' + missing);

      // Ensure node_modules dir exists
      try { fs.mkdirSync(nodeModules, { recursive: true }); } catch (_) {}

      // Copy SDK from donor — always use file copy for the agent SDK, not package manager
      const sdkDir = path.join(nodeModules, '@anthropic-ai', 'claude-agent-sdk');
      if (!fs.existsSync(sdkDir) && donorNodeModules) {
        const donorSdkDir = path.join(donorNodeModules, '@anthropic-ai', 'claude-agent-sdk');
        if (fs.existsSync(donorSdkDir)) {
          try {
            fs.mkdirSync(path.join(nodeModules, '@anthropic-ai'), { recursive: true });
            copyDirSync(donorSdkDir, sdkDir);
            console.error('[forge-mcp-cache-repair] SDK copied from ' + donorSdkDir + ' to ' + sdkDir);
          } catch (copyErr) {
            console.error('[forge-mcp-cache-repair] SDK copy failed: ' + copyErr.message);
          }
        }
      }

      // Re-check: if still missing (non-SDK dep), run npm ci
      const stillMissing = findMissingDirectDep(packageJson, nodeModules);
      if (!stillMissing) continue;

      // Run npm install for remaining missing deps (NOT for the SDK — handled above)
      // Always npm install, never npm ci — see TODO 3d6b7587 (EPERM-unlink on Windows).
      try {
        const installArgs = ['install'];
        const cmdLabel = 'npm install';
        console.error('[forge-mcp-cache-repair] Running ' + cmdLabel + ' in ' + mcpDir);
        runNpmFn(installArgs, mcpDir);
        console.error('[forge-mcp-cache-repair] deps installed in ' + versionDir);
      } catch (npmErr) {
        console.error('[forge-mcp-cache-repair] npm failed in ' + versionDir + ': ' + npmErr.message);
        // Non-fatal — continue with other versions
      }
    }
  } catch (err) {
    // Outermost safety net — never throw from a hook function
    console.error('[forge-mcp-cache-repair] Unexpected error: ' + err.message);
  }
}

async function main(rawInput) {
  // Parse stdin payload — used to resolve the active project directory.
  let payload = {};
  try { payload = JSON.parse(rawInput); } catch (_) { /* ignore parse failures */ }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  if (!pluginRoot) {
    console.error('[forge-mcp] Cannot resolve plugin root — skipping dependency install');
    exitOk();
    return;
  }

  // Build the npm runner using the running Node installation's bundled npm-cli.js
  // so we don't depend on bare `npm` being in PATH — which fails on
  // marketplace-installed copies where the user's PATH doesn't include the Node
  // bin directory. makeNpmRunner() is also used by scanCacheVersions.
  const runNpm = makeNpmRunner();

  // Install dependencies for each package directory that has a package.json.
  const installTargets = [
    { label: 'mcp', dir: path.join(pluginRoot, 'mcp') },
    { label: 'forge-core', dir: path.join(pluginRoot, 'packages', 'forge-core') },
  ];

  for (const target of installTargets) {
    const packageJson = path.join(target.dir, 'package.json');
    const nodeModules = path.join(target.dir, 'node_modules');
    const lockFile = path.join(nodeModules, '.package-lock.json');
    const packageLockJson = path.join(target.dir, 'package-lock.json');

    if (!fs.existsSync(packageJson)) continue;

    let needsInstall = false;
    if (!fs.existsSync(nodeModules)) {
      needsInstall = true;
    } else if (fs.existsSync(lockFile)) {
      const pkgMtime = fs.statSync(packageJson).mtimeMs;
      const lockMtime = fs.statSync(lockFile).mtimeMs;
      if (pkgMtime > lockMtime) {
        needsInstall = true;
      }
    } else {
      needsInstall = true;
    }

    if (!needsInstall) {
      const missing = findMissingDirectDep(packageJson, nodeModules);
      if (missing) {
        console.error('[forge-mcp] Partial node_modules corruption in ' + target.label + ': missing ' + missing + ' — reinstalling');
        needsInstall = true;
      }
    }

    if (!needsInstall) continue;

    // Use `npm install` (not `npm ci`) on Windows to avoid EPERM-unlink
    // corruption: `npm ci` deletes node_modules first, and on Windows the
    // unlink syscall fails partway through when another process holds file
    // handles open (concurrent worker, MCP server). The partial deletion
    // leaves random packages missing. `npm install` is incremental — it
    // updates only what changed and never wipes the tree. See TODO 3d6b7587.
    const installArgs = ['install'];
    const cmdLabel = 'npm install';

    console.error('[forge-mcp] Installing ' + target.label + ' dependencies (' + cmdLabel + ')...');
    try {
      runNpm(installArgs, target.dir);
      console.error('[forge-mcp] ' + target.label + ' dependencies installed successfully.');
    } catch (err) {
      _runNpmCatch(target.label, nodeModules, err);
    }
  }

  // Scan plugin cache versions for missing deps — option 4 implementation.
  // Guard (a): skip in worker sessions (FORGE_WORKER_RUN_ID is set by forge-worker.mjs)
  // Guard (b): once-per-Claude-session dedup (_scanRanThisSession module-level flag)
  if (!process.env.FORGE_WORKER_RUN_ID && !_scanRanThisSession) {
    _scanRanThisSession = true;
    const cacheBaseDir = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'forge-tools', 'forge');
    scanCacheVersions(cacheBaseDir);
  }

  // Write the MCP server launcher with the resolved Node path so the MCP
  // spawner doesn't need bare `node` on the system PATH. The .cmd wrapper
  // uses the absolute path to the Node binary that is running this hook.
  //
  // The .cmd points at bin/forge-mcp-bootstrap.cjs (NOT mcp/server.js directly).
  // The bootstrap shim runs first to self-heal mcp/node_modules when missing —
  // closing the timing gap where /reload-plugins respawns the MCP server without
  // firing SessionStart, leaving a freshly-fetched cache version unhealed.
  const launcherPath = path.join(pluginRoot, 'bin', 'forge-mcp-server.cmd');
  const bootstrapPath = path.join(pluginRoot, 'bin', 'forge-mcp-bootstrap.cjs');
  const launcherContent = '@echo off\r\n"' + process.execPath + '" "' + bootstrapPath + '" %*\r\n';
  try {
    fs.writeFileSync(launcherPath, launcherContent, 'utf8');
    console.error('[forge-mcp] Wrote MCP launcher: ' + launcherPath);
  } catch (err) {
    console.error('[forge-mcp] Failed to write MCP launcher: ' + err.message);
  }

  // Same pattern for the wrapper TUI launcher (`forge` command). Without this,
  // double-clicking bin/forge.cmd or invoking it from a shell that lacks `node`
  // on PATH errors with "'node' is not recognized". Generated per-environment
  // so distribution works regardless of how the user installed Node.
  //
  // Also discover and bake in FORGE_CLAUDE_CMD so the wrapper's pty.spawn() of
  // Claude works in the same hostile-PATH environments. If discovery fails,
  // the env-var line is omitted and the wrapper's own findClaude() runs at
  // launch time as the fallback.
  const wrapperLauncherPath = path.join(pluginRoot, 'bin', 'forge.cmd');
  const wrapperJsPath = path.join(pluginRoot, 'bin', 'forge.js');
  const claudePath = discoverClaudePath();
  const claudeEnvLine = claudePath
    ? 'set "FORGE_CLAUDE_CMD=' + claudePath + '"\r\n'
    : '';
  const wrapperLauncherContent =
    '@echo off\r\n' +
    'REM FORGE wrapper launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
    'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
    'REM For the observer-primary UX, use bin/forge-observer.cmd to launch the dashboard.\r\n' +
    claudeEnvLine +
    '"' + process.execPath + '" "' + wrapperJsPath + '" %*\r\n';
  try {
    fs.writeFileSync(wrapperLauncherPath, wrapperLauncherContent, 'utf8');
    const claudeNote = claudePath ? ' (claude=' + claudePath + ')' : ' (claude path not discovered — wrapper will search at launch)';
    console.error('[forge-mcp] Wrote wrapper launcher: ' + wrapperLauncherPath + claudeNote);
  } catch (err) {
    console.error('[forge-mcp] Failed to write wrapper launcher: ' + err.message);
  }

  // Observer launcher — same generator pattern as the wrapper, minus Claude discovery.
  // The observer is the primary terminal dashboard surface today; this launcher lets
  // users invoke it without remembering the long `node scripts/...` path.
  const observerLauncherPath = path.join(pluginRoot, 'bin', 'forge-observer.cmd');
  const observerScriptPath = path.join(pluginRoot, 'scripts', 'forge-observer.mjs');
  const observerLauncherContent =
    '@echo off\r\n' +
    'REM FORGE observer launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
    'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
    '"' + process.execPath + '" "' + observerScriptPath + '" %*\r\n';
  try {
    fs.writeFileSync(observerLauncherPath, observerLauncherContent, 'utf8');
    console.error('[forge-mcp] Wrote observer launcher: ' + observerLauncherPath);
  } catch (err) {
    console.error('[forge-mcp] Failed to write observer launcher: ' + err.message);
  }

  // Bootstrap forge-config.json into CLAUDE_PLUGIN_DATA on first session
  bootstrapForgeConfig(pluginRoot);

  // Diff-merge live config against default when schemaVersion differs.
  // Pass main project dir so worker sessions resolve to the project root,
  // not the worktree (closes TODO da950b12).
  migrateForgeConfig(pluginRoot, resolveProjectDir(payload));

  // Write a per-project observer launcher to .pipeline/forge-observer.cmd so
  // users can invoke the observer from any project without knowing the plugin
  // path. Skipped silently when .pipeline/ does not exist (not a FORGE project).
  try {
    const projectDir = resolveProjectDir(payload);
    const projectPipelineDir = path.join(projectDir, '.pipeline');
    if (fs.existsSync(projectPipelineDir)) {
      const projectObserverCmdPath = path.join(projectPipelineDir, 'forge-observer.cmd');
      const observerScriptPath = path.join(pluginRoot, 'scripts', 'forge-observer.mjs');
      const projectObserverContent =
        '@echo off\r\n' +
        'REM FORGE observer launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
        'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
        '"' + process.execPath + '" "' + observerScriptPath + '" %*\r\n';
      fs.writeFileSync(projectObserverCmdPath, projectObserverContent, 'utf8');
      console.error('[forge-mcp] Wrote project observer launcher: ' + projectObserverCmdPath);
    }
  } catch (err) {
    console.error('[forge-mcp] Failed to write project observer launcher: ' + (err.message || String(err)));
  }

  exitOk();
}

// Export pure helpers for regression-test access. Must come before the
// require-main guard below so module.exports is populated even when this file
// is imported (not invoked directly). Closes d9683d2a part A.
module.exports = { resolveLiveConfigPath, resolveNpmTimeout, _runNpmCatch, findMissingDirectDep, scanCacheVersions, copyDirSync };

// -- Stdin reader with timeout guard -----------------------------------------
// Guard with require.main === module so unit tests can `require()` this file
// without triggering the readline setup or the hook-side launcher writers.
if (require.main === module) {
  let inputData = '';
  const timer = setTimeout(() => {
    main(inputData || '{}').catch(() => process.exit(0));
  }, 5000);

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => { inputData += line + '\n'; });
  rl.on('close', () => {
    clearTimeout(timer);
    main(inputData || '{}').catch(() => process.exit(0));
  });
}
