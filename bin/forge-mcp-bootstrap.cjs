#!/usr/bin/env node
'use strict';
// FORGE MCP bootstrap — pure-CJS shim that self-heals mcp/node_modules
// before spawning the real MCP server (mcp/server.js).
//
// Why: hooks/mcp-deps-install.js scans + heals all plugin cache versions, but
// it only fires on SessionStart. After a `git push` + `/plugin` + /reload-plugins
// cycle, Claude Code respawns the MCP server WITHOUT firing SessionStart, so
// the new cache version's missing node_modules is never healed by the hook.
//
// This shim closes that window: every MCP server spawn runs through this file
// first, checks for critical deps via findMissingDirectDep from preflight.cjs,
// runs npm install if needed (via makeNpmRunner — uses the running Node's
// bundled npm-cli.js, no PATH dependency), then spawns server.js.
//
// Source: docs/solutions/mcp-node-modules-sdk-silently-removed-by-merge-cascade-
// recovery-from-plugin-cache.md and .gitignore lines 8-26 document why
// mcp/node_modules cannot be tracked.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const mcpDir = path.join(pluginRoot, 'mcp');
const packageJsonPath = path.join(mcpDir, 'package.json');
const nodeModulesPath = path.join(mcpDir, 'node_modules');

let preflight;
try {
  preflight = require(path.join(pluginRoot, 'scripts', 'lib', 'preflight.cjs'));
} catch (err) {
  process.stderr.write('[forge-mcp-bootstrap] Failed to load preflight helpers: ' + err.message + '\n');
  process.stderr.write('[forge-mcp-bootstrap] Continuing without self-heal — MCP server may fail to start if deps are missing.\n');
  preflight = null;
}

if (preflight && fs.existsSync(packageJsonPath)) {
  const missing = preflight.findMissingDirectDep(packageJsonPath, nodeModulesPath);
  if (missing) {
    process.stderr.write('[forge-mcp-bootstrap] Missing direct dep "' + missing + '" in ' + nodeModulesPath + ' — running npm install...\n');
    try {
      const runNpm = preflight.makeNpmRunner();
      runNpm(['install'], mcpDir);
      process.stderr.write('[forge-mcp-bootstrap] npm install completed.\n');
    } catch (err) {
      process.stderr.write('[forge-mcp-bootstrap] npm install failed: ' + err.message + '\n');
      process.stderr.write('[forge-mcp-bootstrap] MCP server will attempt to start anyway — expect import errors if deps are still missing.\n');
    }
  }
}

const serverPath = path.join(mcpDir, 'server.js');
const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code == null ? 0 : code);
  }
});

child.on('error', (err) => {
  process.stderr.write('[forge-mcp-bootstrap] Failed to spawn server.js: ' + err.message + '\n');
  process.exit(1);
});
