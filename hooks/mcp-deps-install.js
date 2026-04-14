'use strict';

// MCP Dependencies Installer — SessionStart hook.
// Auto-installs MCP server dependencies into mcp/node_modules/ under
// the plugin root directory. Runs npm install only when node_modules
// is missing or package.json is newer than the lockfile.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

function exitOk() { process.exit(0); }

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

async function main(rawInput) {
  // Parse stdin payload (required by hook protocol, not used here)
  try { JSON.parse(rawInput); } catch (_) { /* ignore parse failures */ }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (!pluginRoot) {
    console.error('[forge-mcp] CLAUDE_PLUGIN_ROOT not set — skipping MCP dependency install');
    exitOk();
    return;
  }

  const mcpDir = path.join(pluginRoot, 'mcp');
  const packageJson = path.join(mcpDir, 'package.json');
  const nodeModules = path.join(mcpDir, 'node_modules');
  const lockFile = path.join(nodeModules, '.package-lock.json');

  // If package.json does not exist, nothing to install
  if (!fs.existsSync(packageJson)) {
    exitOk();
    return;
  }

  let needsInstall = false;

  if (!fs.existsSync(nodeModules)) {
    // First run — node_modules missing entirely
    needsInstall = true;
  } else if (fs.existsSync(lockFile)) {
    // Compare mtimes: if package.json is newer than the lockfile, re-install
    const pkgMtime = fs.statSync(packageJson).mtimeMs;
    const lockMtime = fs.statSync(lockFile).mtimeMs;
    if (pkgMtime > lockMtime) {
      needsInstall = true;
    }
  } else {
    // node_modules exists but no lockfile — re-install to be safe
    needsInstall = true;
  }

  if (!needsInstall) {
    exitOk();
    return;
  }

  console.error('[forge-mcp] Installing MCP server dependencies...');

  // Resolve npm-cli.js from the running Node installation so we don't depend
  // on bare `npm` being in PATH — which fails on marketplace-installed copies
  // where the user's PATH doesn't include the Node bin directory.
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCli)) {
    console.error('[forge-mcp] npm-cli.js not found at ' + npmCli + ' — falling back to bare npm');
  }
  const npmCmd = fs.existsSync(npmCli)
    ? '"' + process.execPath + '" "' + npmCli + '"'
    : 'npm';

  try {
    execSync(npmCmd + ' install --prefix "' + mcpDir.replace(/\\/g, '/') + '"', {
      stdio: ['ignore', 'ignore', 'inherit'],
      timeout: 60000
    });
    console.error('[forge-mcp] MCP dependencies installed successfully.');
  } catch (err) {
    console.error('[forge-mcp] Failed to install MCP dependencies: ' + err.message);
    // Remove node_modules so next session retries
    try {
      fs.rmSync(nodeModules, { recursive: true, force: true });
    } catch (_) { /* best effort cleanup */ }
  }

  // Bootstrap forge-config.json into CLAUDE_PLUGIN_DATA on first session
  bootstrapForgeConfig(pluginRoot);

  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
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
