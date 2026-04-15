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
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildDashboardState } from "../mcp/lib/dashboard-state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// Locate the Claude binary the wrapper should spawn as its PTY child.
// Order of resolution:
//   1. FORGE_WRAP_SPAWN  — testing override (e.g. 'cmd' on Windows).
//   2. FORGE_CLAUDE_CMD  — explicit override for this session.
//   3. `where claude` / `which claude` — PATH resolution via the system tool.
//   4. Common Windows install locations (.local\bin, LOCALAPPDATA\Programs\claude, APPDATA\npm).
//   5. Bare "claude" — last-resort fallback; pty.spawn will error with ENOENT if PATH fails.
//
// Covers the common failure mode where `claude` isn't on PATH for a cmd
// environment (File Explorer launch, portable installs). Keeps the two
// existing env-var overrides as the top priority so tests and power
// users aren't affected.
function findClaude() {
  if (process.env.FORGE_WRAP_SPAWN) return process.env.FORGE_WRAP_SPAWN;
  if (process.env.FORGE_CLAUDE_CMD) return process.env.FORGE_CLAUDE_CMD;

  // Step 3 — ask the shell. execFileSync swallows stdout on non-zero exit.
  const pathTool = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(pathTool, ["claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = (out || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch (_) { /* not on PATH — fall through to hardcoded candidates */ }

  // Step 4 — Windows common locations. Kept narrow on purpose; adding more
  // paths increases the false-match surface.
  if (process.platform === "win32") {
    const candidates = [
      process.env.USERPROFILE && join(process.env.USERPROFILE, ".local", "bin", "claude.exe"),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "claude", "claude.exe"),
      process.env.APPDATA && join(process.env.APPDATA, "npm", "claude.cmd"),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) return candidate;
      } catch (_) { /* unreadable path — skip */ }
    }
  }

  // Step 5 — last resort; pty.spawn will report ENOENT if this also fails.
  return "claude";
}

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

// Spawn target — resolved via findClaude() which honours env overrides,
// then PATH, then common Windows install locations, then falls back to bare.
const cmd = findClaude();
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
  style: { bg: "black", border: { fg: "grey" } },
});

// Right pane — live FORGE dashboard, refreshed on a timer by
// buildDashboardState (same pure function backing forge_dashboard_state).
// `tags: true` so the renderer can use blessed markup for color; dynamic
// user content (feature names, TODO text) is escaped before interpolation.
// `scrollable` so long TODO lists don't silently overflow.
const rightPane = blessed.box({
  parent: screen,
  top: 0, left: RIGHT_OFFSET, right: 0, height: "100%-1",
  border: { type: "line" },
  label: " FORGE ",
  tags: true,
  content: "\n  {grey-fg}Loading…{/}",
  style: { bg: "black", border: { fg: "yellow" } },
  scrollable: true,
  alwaysScroll: true,
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

  if (dashboardTimer) { try { clearInterval(dashboardTimer); } catch (_) {} dashboardTimer = null; }
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

// Paint xterm's active buffer into the left pane with color + attributes.
// Strategy: walk each cell, diff against the last emitted style, and only
// push a fresh ANSI SGR sequence when the style actually changes. On change
// we emit a full reset + new state (simplest correct form — the alternative,
// differential attribute toggles, is fiddly with no measurable win for a
// 200x60 grid). Reset at end-of-line so row styling can't bleed across the
// blessed pane border.
//
// Cell API (@xterm/headless): getCell(x, reusableCell) fills the same object
// each call for performance. Wide-char continuation cells have getWidth()===0
// and are skipped. Empty glyphs become a literal space to preserve alignment.
function paintLeftPane() {
  const buf = term.buffer.active;
  const lines = [];
  const start = buf.viewportY;
  const cell = buf.getNullCell();
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(start + y);
    if (!line) { lines.push(""); continue; }
    let rowStr = "";
    let lastStyle = "__init__";
    for (let x = 0; x < term.cols; x++) {
      const c = line.getCell(x, cell);
      if (!c) break;
      if (c.getWidth() === 0) continue;           // continuation of prev wide char
      const chars = c.getChars() || " ";
      // Compact style key for change detection across consecutive cells.
      const fgMode = c.getFgColorMode();
      const bgMode = c.getBgColorMode();
      const fg = c.getFgColor();
      const bg = c.getBgColor();
      const attrBits =
        (c.isBold()      ? 1  : 0) |
        (c.isItalic()    ? 2  : 0) |
        (c.isUnderline() ? 4  : 0) |
        (c.isDim()       ? 8  : 0) |
        (c.isInverse()   ? 16 : 0);
      const styleKey = fgMode + ":" + fg + ":" + bgMode + ":" + bg + ":" + attrBits;
      if (styleKey !== lastStyle) {
        rowStr += "\x1b[0m";                      // reset then re-assert state
        if (attrBits & 1)  rowStr += "\x1b[1m";
        if (attrBits & 2)  rowStr += "\x1b[3m";
        if (attrBits & 4)  rowStr += "\x1b[4m";
        if (attrBits & 8)  rowStr += "\x1b[2m";
        if (attrBits & 16) rowStr += "\x1b[7m";
        if (c.isFgRGB()) {
          const r = (fg >> 16) & 0xff, g = (fg >> 8) & 0xff, b = fg & 0xff;
          rowStr += "\x1b[38;2;" + r + ";" + g + ";" + b + "m";
        } else if (c.isFgPalette()) {
          rowStr += "\x1b[38;5;" + fg + "m";
        }
        if (c.isBgRGB()) {
          const r = (bg >> 16) & 0xff, g = (bg >> 8) & 0xff, b = bg & 0xff;
          rowStr += "\x1b[48;2;" + r + ";" + g + ";" + b + "m";
        } else if (c.isBgPalette()) {
          rowStr += "\x1b[48;5;" + bg + "m";
        } else {
          // Default bg — emit explicit black so the terminal's acrylic/opacity
          // effect can't bleed through empty cells. Without this, cells whose
          // bg is "default" render with the terminal's background, which on
          // Windows Terminal with acrylic on == the desktop showing through.
          rowStr += "\x1b[48;2;0;0;0m";
        }
        lastStyle = styleKey;
      }
      rowStr += chars;
    }
    rowStr += "\x1b[0m";                          // reset at EOL — no bleed
    lines.push(rowStr);
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

// ---- Right-pane dashboard rendering --------------------------------------
//
// buildDashboardState is a pure read from .pipeline/runs + board.json — no
// network, no worker, no push. We poll on a timer and repaint the box.
// 2s feels snappy enough for a prototype without thrashing the registry.

const DASHBOARD_REFRESH_MS = 2000;
let dashboardTimer = null;

// Blessed treats `{...}` as markup when tags:true. Strip both delimiters
// from dynamic content so user-authored strings (feature names, TODO text)
// can't inject `{bold}` or break markup balance.
function escapeTags(s) {
  return String(s ?? "").replace(/\{/g, "(").replace(/\}/g, ")");
}

function fmtRel(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

function priorityColor(pri) {
  if (pri === "high") return "red-fg";
  if (pri === "medium") return "yellow-fg";
  return "grey-fg";
}

function renderDashboard(state) {
  const ar = state.activeRuns || [];
  const ga = state.gatesAwaiting || [];
  const rc = state.recentCompleted || [];
  const bs = state.boardSummary || {};
  const lines = [];

  lines.push("");
  lines.push("  {bold}{yellow-fg}FORGE{/}");
  lines.push("");

  // Active runs
  lines.push("  {cyan-fg}Active runs{/} {grey-fg}(" + ar.length + "){/}");
  if (ar.length === 0) {
    lines.push("    {grey-fg}none{/}");
  } else {
    for (const r of ar.slice(0, 5)) {
      const id = escapeTags(r.runId).slice(0, 10);
      const stage = escapeTags(r.stageLabel || r.currentStep || "starting");
      lines.push("    " + id + " {grey-fg}·{/} " + escapeTags(r.pipelineType) + " {grey-fg}·{/} " + stage);
      const feat = escapeTags((r.feature || "").slice(0, 44));
      if (feat) lines.push("      {grey-fg}" + feat + "{/}");
    }
  }
  lines.push("");

  // Gates pending
  if (ga.length > 0) {
    lines.push("  {yellow-fg}Gates pending{/} {grey-fg}(" + ga.length + "){/}");
    for (const g of ga.slice(0, 5)) {
      const id = escapeTags(g.runId).slice(0, 10);
      const gate = escapeTags((g.gateState && g.gateState.gate) || "gate");
      lines.push("    " + id + " {grey-fg}·{/} " + gate);
      const feat = escapeTags((g.feature || "").slice(0, 44));
      if (feat) lines.push("      {grey-fg}" + feat + "{/}");
    }
    lines.push("");
  }

  // Recent completions
  if (rc.length > 0) {
    lines.push("  {grey-fg}Recent{/} {grey-fg}(" + rc.length + "){/}");
    for (const r of rc.slice(0, 3)) {
      const id = escapeTags(r.runId).slice(0, 10);
      const rel = fmtRel(r.updatedAt);
      const statusColor = r.status === "completed" ? "green-fg"
        : r.status === "failed" ? "red-fg" : "grey-fg";
      lines.push("    {" + statusColor + "}" + escapeTags(r.status) + "{/} " + id
        + (rel ? " {grey-fg}" + rel + "{/}" : ""));
    }
    lines.push("");
  }

  // Board
  lines.push("  {cyan-fg}Board{/}");
  const todo = bs.todoCount || 0;
  const blocked = bs.blockedTodoCount || 0;
  const planned = bs.plannedCount || 0;
  lines.push("    " + todo + " open"
    + (blocked > 0 ? " ({red-fg}" + blocked + " blocked{/})" : "")
    + ", " + planned + " planned");
  const tops = Array.isArray(bs.topPriorityTodos) ? bs.topPriorityTodos : [];
  if (tops.length > 0) {
    lines.push("  {grey-fg}Top priorities:{/}");
    for (const t of tops.slice(0, 3)) {
      const pri = escapeTags(t.priority || "-");
      const txt = escapeTags((t.text || "").slice(0, 44));
      lines.push("    {" + priorityColor(t.priority) + "}[" + pri + "]{/} " + txt);
    }
  }

  return lines.join("\n");
}

function refreshDashboard() {
  try {
    const state = buildDashboardState(process.cwd());
    rightPane.setContent(renderDashboard(state));
  } catch (err) {
    rightPane.setContent("\n  {red-fg}dashboard error{/}\n  {grey-fg}"
      + escapeTags(err && err.message) + "{/}");
  }
  screen.render();
}

// Paint once immediately so the user doesn't see "Loading…" for 2s, then
// kick off the poll timer. unref() so the timer can't hold the event loop
// open during shutdown (the quit path also clearInterval's defensively).
refreshDashboard();
dashboardTimer = setInterval(refreshDashboard, DASHBOARD_REFRESH_MS);
if (typeof dashboardTimer.unref === "function") dashboardTimer.unref();

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
