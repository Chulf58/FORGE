'use strict';

// MCP Dependencies Installer — SessionStart hook.
// Auto-installs dependencies for mcp/ and packages/forge-core/ under
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

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
  if (!pluginRoot) {
    console.error('[forge-mcp] Cannot resolve plugin root — skipping dependency install');
    exitOk();
    return;
  }

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

  // Install dependencies for each package directory that has a package.json.
  const installTargets = [
    { label: 'mcp', dir: path.join(pluginRoot, 'mcp') },
    { label: 'forge-core', dir: path.join(pluginRoot, 'packages', 'forge-core') },
  ];

  for (const target of installTargets) {
    const packageJson = path.join(target.dir, 'package.json');
    const nodeModules = path.join(target.dir, 'node_modules');
    const lockFile = path.join(nodeModules, '.package-lock.json');

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

    if (!needsInstall) continue;

    console.error('[forge-mcp] Installing ' + target.label + ' dependencies...');
    try {
      execSync(npmCmd + ' install --prefix "' + target.dir.replace(/\\/g, '/') + '"', {
        stdio: ['ignore', 'ignore', 'inherit'],
        timeout: 60000
      });
      console.error('[forge-mcp] ' + target.label + ' dependencies installed successfully.');
    } catch (err) {
      console.error('[forge-mcp] Failed to install ' + target.label + ' dependencies: ' + err.message);
      try {
        fs.rmSync(nodeModules, { recursive: true, force: true });
      } catch (_) { /* best effort cleanup — next session retries */ }
    }
  }

  // Write the MCP server launcher with the resolved Node path so the MCP
  // spawner doesn't need bare `node` on the system PATH. The .cmd wrapper
  // uses the absolute path to the Node binary that is running this hook.
  const launcherPath = path.join(pluginRoot, 'bin', 'forge-mcp-server.cmd');
  const serverPath = path.join(pluginRoot, 'mcp', 'server.js');
  const launcherContent = '@echo off\r\n"' + process.execPath + '" "' + serverPath + '" %*\r\n';
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
  const wrapperLauncherPath = path.join(pluginRoot, 'bin', 'forge.cmd');
  const wrapperJsPath = path.join(pluginRoot, 'bin', 'forge.js');
  const wrapperLauncherContent =
    '@echo off\r\n' +
    'REM FORGE wrapper launcher — auto-generated by hooks/mcp-deps-install.js on SessionStart.\r\n' +
    'REM Edits will be overwritten next session. Update the generator if you want a different shape.\r\n' +
    '"' + process.execPath + '" "' + wrapperJsPath + '" %*\r\n';
  try {
    fs.writeFileSync(wrapperLauncherPath, wrapperLauncherContent, 'utf8');
    console.error('[forge-mcp] Wrote wrapper launcher: ' + wrapperLauncherPath);
  } catch (err) {
    console.error('[forge-mcp] Failed to write wrapper launcher: ' + err.message);
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
