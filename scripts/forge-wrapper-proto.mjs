#!/usr/bin/env node
// FORGE wrapper prototype — risk-reduction only.
//
// Purpose: prove or disprove that a PTY-hosted Claude Code process can be
// embedded inside a blessed split-pane UI with usable output and key
// forwarding. NOT the final `forge` launcher — intentionally minimal.
//
// Run:  node scripts/forge-wrapper-proto.mjs
// Exit: Ctrl+B then Q (tmux-style prefix shortcut)
//
// What this proves (when it works):
//   - node-pty spawns a child process in a real PTY on this platform
//   - blessed layout survives alongside a noisy ANSI stream
//   - raw keystrokes forward to the PTY child
//   - quit/cleanup path works end-to-end
//
// What this deliberately does NOT do:
//   - dashboard data polling
//   - worker cards or sprites
//   - any action wiring
//   - distribution shims (bin/forge.cmd, bin/forge.sh)
//   - final launcher UX polish
//
// Environment overrides:
//   FORGE_CLAUDE_CMD — path to claude binary (default: 'claude')
//   FORGE_WRAP_SPAWN — override child command for testing (e.g. 'cmd' on Windows)

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// Load deps from mcp/node_modules (our single dep location).
let blessed, pty;
try {
  blessed = require(join(PLUGIN_ROOT, "mcp", "node_modules", "blessed"));
  pty = require(join(PLUGIN_ROOT, "mcp", "node_modules", "node-pty"));
} catch (err) {
  console.error("[forge-wrapper-proto] Failed to load dependencies: " + err.message);
  console.error("[forge-wrapper-proto] Run `node hooks/mcp-deps-install.js` to install, or start a fresh Claude Code session.");
  process.exit(1);
}

// Hard fallback: non-TTY contexts cannot host a blessed split-pane UI.
if (!process.stdout.isTTY) {
  console.error("[forge-wrapper-proto] stdout is not a TTY — wrapper requires a real terminal.");
  process.exit(0);
}

// Spawn target — default to Claude Code, but allow override for testing.
const cmd = process.env.FORGE_WRAP_SPAWN || process.env.FORGE_CLAUDE_CMD || "claude";
const args = process.argv.slice(2);

// Blessed screen setup.
const screen = blessed.screen({
  smartCSR: true,
  title: "FORGE wrapper prototype",
  fullUnicode: true,
  mouse: true,
  terminal: process.env.TERM || "xterm-256color",
});

const LEFT_WIDTH = "70%";
const RIGHT_OFFSET = "70%";

// Left pane — PTY-hosted Claude output.
const leftPane = blessed.log({
  parent: screen,
  top: 0, left: 0, width: LEFT_WIDTH, height: "100%-1",
  border: { type: "line" },
  label: ` ${cmd} `,
  scrollable: true,
  alwaysScroll: true,
  scrollOnInput: true,
  mouse: true,
  tags: false,              // keep ANSI bytes literal — don't let blessed parse {tag} markup
  style: { border: { fg: "grey" } },
});

// Right pane — static FORGE placeholder.
const rightPane = blessed.box({
  parent: screen,
  top: 0, left: RIGHT_OFFSET, right: 0, height: "100%-1",
  border: { type: "line" },
  label: " FORGE ",
  tags: true,
  content: "\n  {bold}{yellow-fg}FORGE{/}\n\n  {grey-fg}[dashboard placeholder]{/}\n\n  {grey-fg}wrapper prototype v0{/}",
  style: { border: { fg: "yellow" } },
});

// Status bar — bottom line, quit/resize hints.
const status = blessed.box({
  parent: screen,
  bottom: 0, left: 0, right: 0, height: 1,
  content: " Ctrl+B then Q to quit · mouse scroll in panes · resize supported",
  style: { bg: "blue", fg: "white" },
});

// Compute PTY child size from the left pane's inner area.
function ptySize() {
  // leftPane.width is computed but may be a string like "70%"; use actual width.
  const w = Math.max(10, Math.floor(screen.width * 0.7) - 2);  // -2 for border
  const h = Math.max(5, screen.height - 3);                    // -2 border, -1 status
  return { cols: w, rows: h };
}

// Spawn the PTY child.
let ptyProc;
try {
  const sz = ptySize();
  ptyProc = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: sz.cols,
    rows: sz.rows,
    cwd: process.cwd(),
    env: process.env,
  });
} catch (err) {
  screen.destroy();
  console.error("[forge-wrapper-proto] Failed to spawn '" + cmd + "': " + err.message);
  console.error("[forge-wrapper-proto] Falling back: run `" + cmd + "` directly in your shell.");
  process.exit(1);
}

// Forward PTY output into the left pane. Log() appends and scrolls to bottom.
ptyProc.onData(data => {
  leftPane.log(data);
  screen.render();
});

ptyProc.onExit(({ exitCode }) => {
  screen.destroy();
  process.stdout.write("\n[forge-wrapper-proto] child exited with code " + (exitCode ?? 0) + "\n");
  process.exit(exitCode ?? 0);
});

// Key forwarding. blessed captures keys at the screen level and emits two
// events: `keypress` (cooked, with modifiers) and raw stdin bytes via
// screen.program. We forward every byte to the PTY unless the user hits the
// Ctrl+B prefix. Then we interpret the next key as a wrapper command.
let prefixArmed = false;

screen.on("keypress", (ch, key) => {
  if (!key) return;
  if (prefixArmed) {
    prefixArmed = false;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      try { ptyProc.kill(); } catch (_) {}
      screen.destroy();
      process.exit(0);
    }
    // Unknown prefix key — swallow silently so it doesn't reach PTY.
    return;
  }
  if (key.ctrl && key.name === "b") {
    prefixArmed = true;
    return;
  }
  // Forward raw character/byte to the PTY.
  // blessed's `ch` is the literal character for printable keys.
  // For special keys (arrows, function), we need the sequence blessed saw.
  if (key.sequence) {
    ptyProc.write(key.sequence);
  } else if (ch) {
    ptyProc.write(ch);
  }
});

// Handle terminal resize — update PTY child cols/rows.
screen.on("resize", () => {
  try {
    const sz = ptySize();
    ptyProc.resize(sz.cols, sz.rows);
  } catch (_) { /* best effort */ }
});

screen.render();
