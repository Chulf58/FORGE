#!/usr/bin/env node
// FORGE launcher — stable user-facing entry point for the wrapper TUI.
//
// This file is the bin contract. The actual wrapper implementation lives at
// scripts/forge-wrapper-proto.mjs (still a prototype path; will be renamed
// once the wrapper is finalised). Keeping the launcher decoupled means the
// implementation file can move without breaking `forge` for users.
//
// Mirrors the existing bin/forge-mcp-server.cmd → mcp/server.js pattern in
// the repo: stable shim, swappable target.
//
// Usage:
//   forge                  # launches the wrapper (requires a real TTY)
//   forge --some-flag      # all argv passed through to the wrapper
//
// Exit codes are propagated from the wrapper child.

'use strict';

const path = require('path');
const { spawn } = require('child_process');

const WRAPPER = path.resolve(__dirname, '..', 'scripts', 'forge-wrapper-proto.mjs');

// stdio: 'inherit' — give the wrapper child the same TTY this launcher was
// started in. The wrapper checks process.stdout.isTTY and runs blessed only
// when a real terminal is attached; non-TTY contexts (CI, pipes) fall through
// to a clean exit-0 advisory.
const child = spawn(process.execPath, [WRAPPER, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    // Mirror the signal (Node convention: 128 + signal number on POSIX).
    process.exit(1);
    return;
  }
  process.exit(typeof code === 'number' ? code : 0);
});

child.on('error', (err) => {
  process.stderr.write('[forge] failed to launch wrapper: ' + err.message + '\n');
  process.exit(1);
});
