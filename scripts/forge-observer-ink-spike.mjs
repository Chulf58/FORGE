#!/usr/bin/env node
// FORGE observer Ink spike — Phase 2 TUI library evaluation.
//
// Purpose: port the blessed observer prototype to Ink (React-for-terminals)
// as a side-by-side comparison. Evaluates: reactive model ergonomics,
// mouse+selection coexistence in alt-screen, and code size/clarity.
//
// This is a spike / evaluation artifact, NOT the real observer. The real
// observer is scripts/forge-observer-proto.mjs (blessed-based, untouched).
//
// Run:  node scripts/forge-observer-ink-spike.mjs
// Quit: q, Q, or Ctrl+C
// Refresh: r (keyboard)
//
// Mouse experiment: enables SGR mouse reporting and listens for click on
// the [Refresh] button row. If Ink's stdin management conflicts with raw
// mouse bytes, that is itself a finding for the evaluation.

import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

// Non-TTY fallback — must come before any Ink import or render.
if (!process.stdout.isTTY) {
  console.error("[forge-observer-ink-spike] stdout is not a TTY — observer requires a real terminal.");
  process.exit(0);
}

// Load deps from mcp/node_modules. Ink is ESM → dynamic import via file:// URL.
// React is CJS → createRequire.
const mcpRequire = createRequire(join(PLUGIN_ROOT, "mcp", "package.json"));

let React, ink, buildDashboardState;
try {
  React = mcpRequire("react");
  const inkUrl = pathToFileURL(join(PLUGIN_ROOT, "mcp", "node_modules", "ink", "build", "index.js")).href;
  ink = await import(inkUrl);
  const dsUrl = pathToFileURL(join(PLUGIN_ROOT, "mcp", "lib", "dashboard-state.js")).href;
  const ds = await import(dsUrl);
  buildDashboardState = ds.buildDashboardState;
} catch (err) {
  console.error("[forge-observer-ink-spike] Failed to load dependencies: " + err.message);
  console.error("[forge-observer-ink-spike] Run `node hooks/mcp-deps-install.js` to install, or start a fresh Claude Code session.");
  process.exit(1);
}

const { useState, useEffect, useCallback } = React;
const { render, Text, Box, useApp, useInput } = ink;
const e = React.createElement;

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REFRESH_MS = 2000;

// ---- Formatting helpers (mirrored from blessed observer) ----

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

function priColor(pri) {
  if (pri === "high") return "red";
  if (pri === "medium") return "yellow";
  return "gray";
}

// ---- React components (pure createElement — no JSX, no build step) ----

function Header() {
  return e(Box, { marginBottom: 1 },
    e(Text, { bold: true, color: "yellow" }, "FORGE"),
    e(Text, { color: "gray" }, "  (Ink spike)")
  );
}

function ActiveRuns({ runs }) {
  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Text, { color: "cyan" }, "Active runs ", e(Text, { color: "gray" }, "(" + (runs || []).length + ")")),
    ...(runs && runs.length > 0
      ? runs.slice(0, 5).map((r, i) =>
          e(Box, { key: r.runId || i, flexDirection: "column", marginLeft: 2 },
            e(Text, null,
              (r.runId || "").slice(0, 10),
              e(Text, { color: "gray" }, " · "),
              r.pipelineType || "",
              e(Text, { color: "gray" }, " · "),
              r.stageLabel || r.currentStep || "starting"
            ),
            r.feature
              ? e(Text, { color: "gray", marginLeft: 2 }, (r.feature || "").slice(0, 44))
              : null
          )
        )
      : [e(Text, { key: "none", color: "gray", marginLeft: 2 }, "none")]
    )
  );
}

function GatesPending({ gates }) {
  if (!gates || gates.length === 0) return null;
  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Text, { color: "yellow" }, "Gates pending ", e(Text, { color: "gray" }, "(" + gates.length + ")")),
    ...gates.slice(0, 5).map((g, i) =>
      e(Box, { key: g.runId || i, flexDirection: "column", marginLeft: 2 },
        e(Text, null,
          (g.runId || "").slice(0, 10),
          e(Text, { color: "gray" }, " · "),
          (g.gateState && g.gateState.gate) || "gate"
        ),
        g.feature
          ? e(Text, { color: "gray", marginLeft: 2 }, (g.feature || "").slice(0, 44))
          : null
      )
    )
  );
}

function RecentCompleted({ recent }) {
  if (!recent || recent.length === 0) return null;
  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Text, { color: "gray" }, "Recent ", e(Text, { color: "gray" }, "(" + recent.length + ")")),
    ...recent.slice(0, 3).map((r, i) => {
      const statusColor = r.status === "completed" ? "green"
        : r.status === "failed" ? "red" : "gray";
      const rel = fmtRel(r.updatedAt);
      return e(Text, { key: r.runId || i, marginLeft: 2 },
        e(Text, { color: statusColor }, r.status || ""),
        " ",
        (r.runId || "").slice(0, 10),
        rel ? e(Text, { color: "gray" }, " " + rel) : null
      );
    })
  );
}

function BoardSummary({ board }) {
  const todo = (board && board.todoCount) || 0;
  const blocked = (board && board.blockedTodoCount) || 0;
  const planned = (board && board.plannedCount) || 0;
  const tops = (board && Array.isArray(board.topPriorityTodos)) ? board.topPriorityTodos : [];
  return e(Box, { flexDirection: "column", marginBottom: 1 },
    e(Text, { color: "cyan" }, "Board"),
    e(Text, { marginLeft: 2 },
      todo + " open",
      blocked > 0 ? e(Text, { color: "red" }, " (" + blocked + " blocked)") : null,
      ", " + planned + " planned"
    ),
    tops.length > 0
      ? e(Box, { flexDirection: "column", marginTop: 0 },
          e(Text, { color: "gray", marginLeft: 2 }, "Top priorities:"),
          ...tops.slice(0, 3).map((t, i) =>
            e(Text, { key: t.id || i, marginLeft: 4 },
              e(Text, { color: priColor(t.priority) }, "[" + (t.priority || "-") + "]"),
              " ",
              (t.text || "").slice(0, 44)
            )
          )
        )
      : null
  );
}

function RefreshButton({ onRefresh, lastRefresh }) {
  return e(Box, { marginTop: 1 },
    e(Text, { color: "blue", bold: true }, "[ Refresh now ]"),
    e(Text, { color: "gray" }, "  r=refresh  q=quit  "),
    lastRefresh
      ? e(Text, { color: "gray" }, "last: " + new Date(lastRefresh).toLocaleTimeString())
      : null
  );
}

function Dashboard() {
  const { exit } = useApp();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [mouseInfo, setMouseInfo] = useState("");

  const refresh = useCallback(() => {
    try {
      const s = buildDashboardState(PROJECT_DIR);
      setState(s);
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

  // Keyboard: r to refresh, q to quit.
  useInput((input, key) => {
    if (input === "r" || input === "R") refresh();
    if (input === "q" || input === "Q" || (key.ctrl && input === "c")) exit();
  });

  // Mouse experiment: enable SGR mouse reporting and listen for clicks.
  // If Ink's stdin management eats the mouse bytes, this won't fire —
  // that IS the finding. Write to stderr so it doesn't corrupt Ink's render.
  useEffect(() => {
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
    const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
    const onData = (buf) => {
      const s = buf.toString("binary");
      const m = SGR_RE.exec(s);
      if (m && m[4] === "M") {
        const btn = parseInt(m[1], 10);
        if (btn === 0) { // left click
          setMouseInfo("click at col=" + m[2] + " row=" + m[3]);
          refresh(); // any click triggers refresh for the spike
        }
      }
    };
    if (process.stdin.readable) {
      process.stdin.on("data", onData);
    }
    return () => {
      process.stdout.write("\x1b[?1000l\x1b[?1006l");
      if (process.stdin.readable) {
        process.stdin.removeListener("data", onData);
      }
    };
  }, [refresh]);

  if (error) {
    return e(Box, { flexDirection: "column", padding: 1 },
      e(Header),
      e(Text, { color: "red" }, "dashboard error: " + error)
    );
  }

  if (!state) {
    return e(Box, { padding: 1 },
      e(Text, { color: "gray" }, "Loading…")
    );
  }

  return e(Box, { flexDirection: "column", padding: 1 },
    e(Header),
    e(ActiveRuns, { runs: state.activeRuns }),
    e(GatesPending, { gates: state.gatesAwaiting }),
    e(RecentCompleted, { recent: state.recentCompleted }),
    e(BoardSummary, { board: state.boardSummary }),
    e(RefreshButton, { onRefresh: refresh, lastRefresh }),
    mouseInfo
      ? e(Text, { color: "gray", marginTop: 1 }, "Mouse: " + mouseInfo)
      : null
  );
}

// ---- Launch ----

const app = render(e(Dashboard), { exitOnCtrlC: true });
await app.waitUntilExit();
