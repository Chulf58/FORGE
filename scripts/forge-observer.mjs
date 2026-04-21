#!/usr/bin/env node
// FORGE terminal observer — primary read-only dashboard (Ink + React).
//
// Purpose: show FORGE project state in a dedicated terminal process next
// to a natively-running Claude Code. The user opens a split in their
// terminal and runs this in the second pane; Claude runs untouched in
// its own pane with native copy/paste.
//
// Run:  node scripts/forge-observer.mjs
// Quit: q, Q, or Ctrl+C
// Refresh: r (keyboard), or click anywhere (SGR mouse)
// Drag: hold and drag cards in Notes/TODOs panels to reorder; release to persist.
//
// Mouse: SGR mouse reporting is enabled. Left-click triggers refresh.
// Drag cards with mouse to reorder. Escape cancels an active drag.

import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

// Non-TTY fallback — must come before any Ink import or render.
if (!process.stdout.isTTY) {
  process.stderr.write('[forge-observer] stdout is not a TTY — observer requires a real terminal.\n');
  process.exit(0);
}

// Load deps from mcp/node_modules. Ink is ESM → dynamic import via file:// URL.
// React is CJS → createRequire.
const mcpRequire = createRequire(join(PLUGIN_ROOT, 'mcp', 'package.json'));

let React, ink, buildDashboardState;
try {
  React = mcpRequire('react');
  const inkUrl = pathToFileURL(join(PLUGIN_ROOT, 'mcp', 'node_modules', 'ink', 'build', 'index.js')).href;
  ink = await import(inkUrl);
  const dsUrl = pathToFileURL(join(PLUGIN_ROOT, 'mcp', 'lib', 'dashboard-state.js')).href;
  const ds = await import(dsUrl);
  buildDashboardState = ds.buildDashboardState;
} catch (err) {
  process.stderr.write('[forge-observer] Failed to load dependencies: ' + err.message + '\n');
  process.stderr.write('[forge-observer] Run `node hooks/mcp-deps-install.js` to install, or start a fresh Claude Code session.\n');
  process.exit(1);
}

const { useState, useEffect, useCallback, useRef } = React;
const { render, Text, Box, useApp, useInput } = ink;
const e = React.createElement;

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REFRESH_MS = 2000;

// ---- Data layer (task 1) ----

/**
 * Load notes from .pipeline/notes.json.
 * Returns [] if absent or invalid — never throws.
 */
function loadNotes(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, '.pipeline', 'notes.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.notes) ? parsed.notes : [];
  } catch (_) {
    return [];
  }
}

/**
 * Rewrite todos array in .pipeline/board.json, preserving all other fields.
 * Fail-open: swallows write errors (observer is read/reorder-only).
 */
function saveBoardOrder(projectDir, todos) {
  const filePath = join(projectDir, '.pipeline', 'board.json');
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    data.todos = todos;
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {
    // fail-open — observer continues without crashing
  }
}

/**
 * Rewrite notes array in .pipeline/notes.json, preserving all other fields.
 * Fail-open: swallows write errors.
 */
function saveNotesOrder(projectDir, notes) {
  const filePath = join(projectDir, '.pipeline', 'notes.json');
  try {
    let data = {};
    try {
      const raw = readFileSync(filePath, 'utf8');
      data = JSON.parse(raw);
    } catch (_) {
      // file may not exist yet; start with empty object
    }
    data.notes = notes;
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {
    // fail-open
  }
}

// ---- Text truncation helper ----

/**
 * Truncate text to fit within the terminal width, accounting for prefix chars.
 * Applied to data before rendering to keep 1-row-per-card mapping accurate.
 */
function truncateCard(text, prefixWidth) {
  const cols = process.stdout.columns || 80;
  const maxChars = Math.max(20, cols - prefixWidth - 6);
  if (typeof text !== 'string') return '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// ---- Formatting helpers (mirrored from blessed observer) ----

function fmtRel(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

// ---- React components (pure createElement — no JSX, no build step) ----

// ---- StatusBar (task 3) — replaces ActiveRuns, GatesPending, RecentCompleted ----

function StatusBar({ state }) {
  if (!state) {
    return e(Box, { marginBottom: 1 },
      e(Text, { color: 'yellow', bold: true }, 'FORGE'),
      e(Text, { color: 'gray' }, '  loading…'),
    );
  }
  const activeCount = (state.activeRuns || []).length;
  const gateCount = (state.gatesAwaiting || []).length;
  const recent = (state.recentCompleted || [])[0] || null;
  const recentStr = recent
    ? ' last: ' + (recent.status || '') + ' ' + (recent.runId || '').slice(0, 8) + ' ' + fmtRel(recent.updatedAt)
    : '';
  return e(Box, { marginBottom: 1 },
    e(Text, { color: 'yellow', bold: true }, 'FORGE'),
    e(Text, { color: 'gray' }, '  active: '),
    e(Text, null, String(activeCount)),
    e(Text, { color: 'gray' }, '  gates: '),
    gateCount > 0
      ? e(Text, { color: 'yellow' }, String(gateCount))
      : e(Text, null, String(gateCount)),
    recentStr
      ? e(Text, { color: 'gray' }, recentStr)
      : null,
  );
}

// ---- NotesPanel (task 4) ----

function NotesPanel({ notes, dragState, panelStartRow }) {
  const items = (notes || []).map((n, i) => {
    const isDragRow = dragState.phase === 'dragging' &&
      dragState.panel === 'notes' &&
      (panelStartRow + 1 + i) === dragState.currentRow;
    const prefix = isDragRow ? '> ' : (i + 1) + ' ';
    const text = truncateCard(
      typeof n === 'string' ? n : (n && typeof n.text === 'string' ? n.text : ''),
      prefix.length,
    );
    return e(Text, { key: i },
      e(Text, { color: isDragRow ? 'cyan' : 'gray' }, prefix),
      text,
    );
  });

  return e(Box, { flexDirection: 'column', borderStyle: 'single', paddingX: 1, flexGrow: 1 },
    e(Text, { bold: true, color: 'cyan' }, 'Notes'),
    items.length > 0
      ? items
      : e(Text, { color: 'gray' }, '(none)'),
  );
}

// ---- TodosPanel (task 4) ----

function TodosPanel({ todos, dragState, panelStartRow }) {
  const openTodos = (todos || []).filter(t => t && t.done !== true);
  const items = openTodos.map((t, i) => {
    const isDragRow = dragState.phase === 'dragging' &&
      dragState.panel === 'todos' &&
      (panelStartRow + 1 + i) === dragState.currentRow;
    const prefix = isDragRow ? '> ' : (i + 1) + ' ';
    const text = truncateCard(
      typeof t.text === 'string' ? t.text : '',
      prefix.length,
    );
    return e(Text, { key: t.id || i },
      e(Text, { color: isDragRow ? 'cyan' : 'gray' }, prefix),
      text,
    );
  });

  return e(Box, { flexDirection: 'column', borderStyle: 'single', paddingX: 1, flexGrow: 1 },
    e(Text, { bold: true, color: 'cyan' }, 'TODOs'),
    items.length > 0
      ? items
      : e(Text, { color: 'gray' }, '(none)'),
  );
}

// ---- BoardSummary (retained for fallback / reference — not rendered in new layout) ----

function RefreshButton({ lastRefresh }) {
  return e(Box, { marginTop: 1 },
    e(Text, { color: 'blue', bold: true }, '[ Refresh now ]'),
    e(Text, { color: 'gray' }, '  r=refresh  q=quit  drag=reorder  '),
    lastRefresh
      ? e(Text, { color: 'gray' }, 'last: ' + new Date(lastRefresh).toLocaleTimeString())
      : null,
  );
}

// ---- Dashboard (task 6 — orchestrates layout, state, drag FSM wiring) ----

function Dashboard() {
  const { exit } = useApp();
  const [state, setState] = useState(null);
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Drag FSM state (task 2).
  // Shapes: { phase: 'idle' } | { phase: 'dragging', startRow, currentRow, panel }
  //       | { phase: 'dropped', startRow, endRow, panel }
  const [dragState, setDragState] = useState({ phase: 'idle' });

  // Panel start rows — track approximate terminal rows for row→index mapping.
  // Row 0 = first line of render area. StatusBar is 1 row, separator is 1 row.
  // NOTES panel starts at row 2 (header at row 2, first card at row 3).
  // TODOS panel shares the same row range (side-by-side).
  const PANEL_HEADER_OFFSET = 2; // StatusBar + blank margin

  // Ref to keep drag handler closure current without stale state.
  const dragStateRef = useRef({ phase: 'idle' });

  const refresh = useCallback(() => {
    try {
      const s = buildDashboardState(PROJECT_DIR);
      setState(s);
      const n = loadNotes(PROJECT_DIR);
      setNotes(n);
      setError(null);
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Periodic polling.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Keyboard: r to refresh, q to quit, Escape to cancel drag (task 2).
  useInput((input, key) => {
    if (input === 'r' || input === 'R') refresh();
    if (input === 'q' || input === 'Q' || (key.ctrl && input === 'c')) exit();
    if (key.escape) {
      dragStateRef.current = { phase: 'idle' };
      setDragState({ phase: 'idle' });
    }
  });

  // SGR mouse handler + drag FSM (task 2).
  useEffect(() => {
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

    // Determine which panel a row belongs to based on terminal column.
    // In side-by-side layout: left half = notes, right half = todos.
    // In stacked layout: first N rows = notes, rest = todos.
    // We use a simple heuristic: col <= halfWidth → notes, else → todos.
    function detectPanel(col) {
      const half = Math.floor((process.stdout.columns || 80) / 2);
      return col <= half ? 'notes' : 'todos';
    }

    const onData = (buf) => {
      const s = buf.toString('binary');
      const m = SGR_RE.exec(s);
      if (!m) return;

      const btn = parseInt(m[1], 10);
      const col = parseInt(m[2], 10);
      const row = parseInt(m[3], 10);
      const press = m[4] === 'M'; // M = press/move, m = release

      // Ignore scroll events.
      if (btn === 64 || btn === 65) return;

      const current = dragStateRef.current;

      if (press && btn === 0) {
        // Left button press → start drag (force reset if already dragging).
        const panel = detectPanel(col);
        const next = { phase: 'dragging', startRow: row, currentRow: row, panel };
        dragStateRef.current = next;
        setDragState({ ...next });
        return;
      }

      if (press && btn === 32) {
        // Move with button held → update currentRow.
        if (current.phase === 'dragging') {
          const next = { ...current, currentRow: row };
          dragStateRef.current = next;
          setDragState({ ...next });
        }
        return;
      }

      if (!press && btn === 0) {
        // Release → dropped.
        if (current.phase === 'dragging') {
          const next = {
            phase: 'dropped',
            startRow: current.startRow,
            endRow: row,
            panel: current.panel,
          };
          dragStateRef.current = next;
          setDragState({ ...next });
        } else {
          // Plain click (no drag) → refresh.
          refresh();
        }
        return;
      }
    };

    if (process.stdin.readable) {
      process.stdin.on('data', onData);
    }
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1006l');
      if (process.stdin.readable) {
        process.stdin.removeListener('data', onData);
      }
    };
  }, [refresh]);

  // Drop handler — persist reorder on 'dropped' phase (task 5).
  useEffect(() => {
    if (dragState.phase !== 'dropped') return;

    const { startRow, endRow, panel } = dragState;

    // Reset to idle immediately regardless of outcome.
    const resetIdle = () => {
      dragStateRef.current = { phase: 'idle' };
      setDragState({ phase: 'idle' });
    };

    // No-op if no movement.
    if (startRow === endRow) {
      resetIdle();
      return;
    }

    // Compute source and target indices from row numbers.
    // Panel cards start at PANEL_HEADER_OFFSET + 1 (header row counts as 1).
    const cardStartRow = PANEL_HEADER_OFFSET + 1;
    const srcIdx = startRow - cardStartRow;
    const dstIdx = endRow - cardStartRow;

    if (panel === 'notes') {
      const arr = notes.slice();
      if (srcIdx < 0 || srcIdx >= arr.length || dstIdx < 0) {
        resetIdle();
        return;
      }
      const [item] = arr.splice(srcIdx, 1);
      const clampedDst = Math.min(dstIdx, arr.length);
      arr.splice(clampedDst, 0, item);
      setNotes(arr);
      saveNotesOrder(PROJECT_DIR, arr);
    } else if (panel === 'todos') {
      const allTodos = (state && Array.isArray(state.boardSummary && state._rawTodos)
        ? state._rawTodos
        : null);
      // Re-read board.json directly to get the full todos array (open + done).
      try {
        const boardPath = join(PROJECT_DIR, '.pipeline', 'board.json');
        const raw = readFileSync(boardPath, 'utf8');
        const boardData = JSON.parse(raw);
        const fullTodos = Array.isArray(boardData.todos) ? boardData.todos : [];
        // We operate on open todos only (matching what the panel displays).
        const openTodos = fullTodos.filter(t => t && t.done !== true);
        const doneTodos = fullTodos.filter(t => t && t.done === true);

        if (srcIdx < 0 || srcIdx >= openTodos.length || dstIdx < 0) {
          resetIdle();
          return;
        }
        const [item] = openTodos.splice(srcIdx, 1);
        const clampedDst = Math.min(dstIdx, openTodos.length);
        openTodos.splice(clampedDst, 0, item);

        // Reconstruct: open todos in new order + done todos appended.
        const newTodos = [...openTodos, ...doneTodos];
        saveBoardOrder(PROJECT_DIR, newTodos);
        refresh();
      } catch (_) {
        // fail-open — if we can't read board.json, skip the reorder
      }
    }

    resetIdle();
  }, [dragState]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return e(Box, { flexDirection: 'column', padding: 1 },
      e(StatusBar, { state: null }),
      e(Text, { color: 'red' }, 'dashboard error: ' + error),
    );
  }

  if (!state) {
    return e(Box, { padding: 1 },
      e(Text, { color: 'gray' }, 'Loading…'),
    );
  }

  // Layout (task 6): StatusBar on top, then side-by-side panels.
  // Fall back to stacked if terminal is narrow.
  const isNarrow = (process.stdout.columns || 80) < 80;
  const panelDirection = isNarrow ? 'column' : 'row';

  // Panel start row is approximate — StatusBar = row 1, margin = row 2.
  const notesPanelStart = PANEL_HEADER_OFFSET;
  const todosPanelStart = PANEL_HEADER_OFFSET;

  return e(Box, { flexDirection: 'column', padding: 1 },
    e(StatusBar, { state }),
    e(Box, { flexDirection: panelDirection },
      e(NotesPanel, { notes, dragState, panelStartRow: notesPanelStart }),
      e(TodosPanel, {
        todos: state && state.boardSummary
          ? (() => {
              // Re-read open todos from board summary top todos for display;
              // full list is re-read during drop handling.
              try {
                const raw = readFileSync(join(PROJECT_DIR, '.pipeline', 'board.json'), 'utf8');
                const bd = JSON.parse(raw);
                return Array.isArray(bd.todos) ? bd.todos : [];
              } catch (_) {
                return [];
              }
            })()
          : [],
        dragState,
        panelStartRow: todosPanelStart,
      }),
    ),
    e(RefreshButton, { lastRefresh }),
  );
}

// ---- Launch ----

const app = render(e(Dashboard), { exitOnCtrlC: true });
await app.waitUntilExit();
