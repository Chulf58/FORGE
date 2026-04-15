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
// Architecture:
//   node-pty → @xterm/headless Terminal (parses ANSI into cell grid)
//     → render loop copies cells to blessed left pane
//   blessed owns layout, right pane, keyboard, mouse, resize
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
let blessed, pty, xterm;
try {
  blessed = require(join(PLUGIN_ROOT, "mcp", "node_modules", "blessed"));
  pty = require(join(PLUGIN_ROOT, "mcp", "node_modules", "node-pty"));
  xterm = require(join(PLUGIN_ROOT, "mcp", "node_modules", "@xterm", "headless"));
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

// Blessed screen setup. Mouse tracking is disabled for the prototype — when
// enabled, blessed sends CSI enable-mouse sequences which make the terminal
// emit mouse-event bytes to stdin. Our raw stdin handler forwards those to
// the PTY where Claude can't interpret them correctly. Mouse scroll support
// will be added when we build the dashboard pane with its own handlers.
const screen = blessed.screen({
  smartCSR: true,
  title: "FORGE wrapper prototype",
  fullUnicode: true,
  mouse: false,
  terminal: process.env.TERM || "xterm-256color",
});

const LEFT_WIDTH = "70%";
const RIGHT_OFFSET = "70%";

// Left pane — blessed.box as a plain canvas. @xterm/headless handles the
// terminal emulation; we paint its cell grid into this box on each tick.
const leftPane = blessed.box({
  parent: screen,
  top: 0, left: 0, width: LEFT_WIDTH, height: "100%-1",
  border: { type: "line" },
  label: ` ${cmd} `,
  tags: false,
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
  content: " Ctrl+B then Q to quit · xterm-backed claude pane · resize supported",
  style: { bg: "blue", fg: "white" },
});

// Compute PTY child size from the left pane's inner area (minus border).
function paneSize() {
  const w = Math.max(10, Math.floor(screen.width * 0.7) - 2);  // -2 for border
  const h = Math.max(5, screen.height - 3);                    // -2 border, -1 status
  return { cols: w, rows: h };
}

// Create the xterm.js headless terminal emulator.
// allowProposedApi is required to access the buffer cell API we paint from.
const initialSize = paneSize();
const term = new xterm.Terminal({
  cols: initialSize.cols,
  rows: initialSize.rows,
  allowProposedApi: true,
  scrollback: 1000,
  convertEol: false,
});

// Spawn the PTY child.
let ptyProc;
try {
  ptyProc = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: initialSize.cols,
    rows: initialSize.rows,
    cwd: process.cwd(),
    env: process.env,
  });
} catch (err) {
  screen.destroy();
  console.error("[forge-wrapper-proto] Failed to spawn '" + cmd + "': " + err.message);
  console.error("[forge-wrapper-proto] Falling back: run `" + cmd + "` directly in your shell.");
  process.exit(1);
}

// Clean shutdown. The ordering matters: destroy the screen FIRST so blessed's
// alt-screen exit + cursor restore escape codes get written before we touch
// stdin. Then kill the PTY child, restore stdin cooked mode, force-flush
// explicit reset sequences, and exit. A setTimeout fallback SIGKILLs the
// process if process.exit() is somehow blocked (observed on Windows when
// ptyProc.kill() leaves lingering event-loop refs).
function quit(code) {
  // Last-resort hard kill — fires if process.exit doesn't return control.
  const forceKill = setTimeout(() => {
    try { process.kill(process.pid, "SIGKILL"); } catch (_) {}
  }, 500);
  forceKill.unref();

  try { screen.destroy(); } catch (_) {}
  try { ptyProc.kill(); } catch (_) {}
  try {
    if (typeof process.stdin.setRawMode === "function") process.stdin.setRawMode(false);
  } catch (_) {}
  try { process.stdin.pause(); } catch (_) {}
  // Belt-and-suspenders: explicit terminal reset sequences in case blessed
  // didn't fully restore the main screen buffer.
  try {
    process.stdout.write("\x1b[?1049l"); // exit alt-screen
    process.stdout.write("\x1b[?25h");   // show cursor
    process.stdout.write("\x1b[0m");     // reset attributes
    process.stdout.write("\r\n");
  } catch (_) {}
  process.exit(code);
}

// Feed PTY bytes into the xterm parser.
ptyProc.onData(data => {
  term.write(data);
});

ptyProc.onExit(({ exitCode }) => {
  process.stdout.write("\n[forge-wrapper-proto] child exited with code " + (exitCode ?? 0) + "\n");
  quit(exitCode ?? 0);
});

// Paint xterm's active buffer into the left pane.
// Strategy: for each row in the viewport, use translateToString to get the
// raw character content (no ANSI), join with newlines, setContent on the box.
// This proves the cell-grid round-trip works. Colors/attributes come in a
// follow-up slice once we confirm no control-code garbage.
function paintLeftPane() {
  const buf = term.buffer.active;
  const lines = [];
  const start = buf.viewportY;
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(start + y);
    lines.push(line ? line.translateToString(false) : "");
  }
  leftPane.setContent(lines.join("\n"));
  screen.render();
}

// Debounce paint calls — xterm emits onRender multiple times per PTY chunk.
let paintScheduled = false;
function schedulePaint() {
  if (paintScheduled) return;
  paintScheduled = true;
  setImmediate(() => {
    paintScheduled = false;
    try { paintLeftPane(); } catch (_) { /* best-effort render */ }
  });
}

// @xterm/headless exposes onWriteParsed (not onRender — that's browser only).
// Fires after term.write() finishes parsing each chunk, which is when the
// buffer is in its updated state and ready to paint.
term.onWriteParsed(schedulePaint);
// Also paint once after a short delay so the first PTY output renders
// even if the first onRender arrives before screen is fully ready.
setTimeout(schedulePaint, 100);

// Key forwarding — read raw bytes from stdin, forward as-is to the PTY.
// Previous approach using blessed's keypress event caused double-dispatch on
// Windows when Enter arrives as CRLF (two separate keypress events → two '\r'
// to the PTY → visible as phantom Enter presses in Claude's menus).
//
// Raw stdin with explicit raw-mode + resume gives us exact-byte control and
// avoids readline/keypress parsing. Blessed still handles screen rendering;
// we just own keyboard input. The one byte we intercept is Ctrl+B (0x02) as
// the tmux-style prefix for the quit shortcut.

if (typeof process.stdin.setRawMode === "function") {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

let prefixArmed = false;
const CTRL_B = 0x02;

// Enable SGR mouse reporting so the wheel sends mouse events instead of
// being translated to arrow keys by the terminal. Without this, Windows
// Terminal turns wheel scrolls into arrow-up/down and we can't distinguish
// them from actual keyboard arrow presses.
//   \x1b[?1000h = basic mouse click/release reporting
//   \x1b[?1002h = button-event mouse tracking (also captures wheel)
//   \x1b[?1006h = SGR extended coordinates (unlimited, not limited to 223)
process.stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");

// SGR mouse sequence format: ESC [ < Cb ; Cx ; Cy {M|m}
// Cb encodes button + modifier bits. Wheel up = 64, wheel down = 65 (both "press").
const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
const WHEEL_SCROLL_LINES = 3;

function handleMouseEvent(btn, x, y, pressed) {
  // Only process wheel events for now; swallow all other mouse events to
  // avoid leaking them into the PTY (Claude doesn't run a mouse UI).
  if (!pressed) return;
  if (btn === 64) {
    // Wheel up — scroll xterm buffer backward.
    try { term.scrollLines(-WHEEL_SCROLL_LINES); } catch (_) {}
    schedulePaint();
  } else if (btn === 65) {
    // Wheel down — scroll xterm buffer forward.
    try { term.scrollLines(WHEEL_SCROLL_LINES); } catch (_) {}
    schedulePaint();
  }
  // Clicks and drags (other button codes) are swallowed for the prototype.
}

process.stdin.on("data", (buf) => {
  // Check for prefix-armed single-byte commands first.
  if (buf.length === 1 && prefixArmed) {
    prefixArmed = false;
    const b = buf[0];
    // q or Q or Ctrl+C = quit
    if (b === 0x71 || b === 0x51 || b === 0x03) {
      quit(0);
      return;
    }
    // Any other key after prefix — swallow to avoid leaking to PTY.
    return;
  }
  // Arm prefix on bare Ctrl+B byte.
  if (buf.length === 1 && buf[0] === CTRL_B) {
    prefixArmed = true;
    return;
  }
  // Mouse event — parse and consume without forwarding to PTY.
  // SGR mouse events start with ESC [ < . We only check for the prefix here
  // to keep the fast path for normal input cheap.
  if (buf.length >= 6 && buf[0] === 0x1b && buf[1] === 0x5b && buf[2] === 0x3c) {
    const s = buf.toString("binary");
    const m = SGR_MOUSE_RE.exec(s);
    if (m) {
      handleMouseEvent(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), m[4] === "M");
      return;
    }
    // Malformed mouse-looking sequence — fall through as regular input rather
    // than leaking to PTY.
    return;
  }
  // Everything else: raw passthrough to PTY.
  ptyProc.write(buf);
});

// Handle terminal resize — update xterm + PTY in lockstep.
screen.on("resize", () => {
  try {
    const sz = paneSize();
    term.resize(sz.cols, sz.rows);
    ptyProc.resize(sz.cols, sz.rows);
    schedulePaint();
  } catch (_) { /* best effort */ }
});

screen.render();
