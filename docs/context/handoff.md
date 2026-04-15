# Handoff: Wrapper TUI primary, sidecar legacy

## Overview

Continued the TUI prototype work after context compaction. Finished the wrapper prototype's mouse-wheel support, added a standalone terminal observer prototype, and committed the product-direction pivot: wrapper TUI is now primary; sidecar is legacy/fallback on disk during the transition. Pushed three commits to `origin/main` together so the branch reflects the new direction atomically.

## Session commits

| Commit | What |
|---|---|
| `f12f85c` | `feat(wrapper): mouse wheel scrolls Claude pane via SGR mouse reporting` — enabled `\x1b[?1000h\x1b[?1002h\x1b[?1006h`, parsed CSI mouse events (Cb=64 wheel-up, Cb=65 wheel-down), routed to `term.scrollLines()`. Non-wheel mouse events swallowed so they don't leak to the PTY. |
| `633d465` | `feat(dashboard): add terminal observer prototype` — new `scripts/forge-observer-proto.mjs` (standalone read-only dashboard using `buildDashboardState`; no PTY wrapping; blessed full-screen; `keys: true, vi: true` for scroll; quit on `q`/`Q`/`Ctrl+C`; mouse reporting OFF so the host terminal keeps ownership of text selection) + `scripts/forge-observer-proto-smoke-test.mjs` (non-TTY fallback + dep-load regression check, mirrors wrapper smoke test). |
| `473721c` | `feat(dashboard): wrapper TUI is primary; sidecar legacy` — reposition without runtime-logic change. Skill rewritten to frame as in-chat snapshot + pointer to wrapper for live terminal use. `"dashboard"` npm script removed from `package.json`. `FORGE-OVERVIEW.md` + `FORGE-REFERENCE.md` updated across 5 locations. New `[2026-04-15] Wrapper TUI Primary; Sidecar Legacy` CHANGELOG entry. Sidecar files + tests + `scripts/forge-tui.mjs` untouched per "don't hard-delete yet" decision. |

Also pushed (were local at session start, not re-committed): `bafbd81` (color-aware Claude pane) and `ffbe9df` (dashboard data in wrapper's right pane).

After this session `origin/main` is at `473721c`.

## Key decisions this session

### Product direction: TUI is primary, sidecar is out
User rejected a supervisor-cycle recommendation to abandon TUI and return to sidecar/plain-stdout after a "copyability" blocker was escalated. The actual accepted interaction model is `Shift`+click-drag in Windows Terminal — the standard override for selecting text in alt-screen apps (vim, less, tmux, blessed). Plain click-drag is not a hard requirement, and treating it as one was the wrong framing.

Saved as feedback memory: `memory/feedback_tui_primary.md`.

### Wrapper = primary; observer = secondary
- Wrapper (`scripts/forge-wrapper-proto.mjs`) embeds Claude + dashboard in one terminal process — matches the "pixel-art workers alongside Claude" vision.
- Observer (`scripts/forge-observer-proto.mjs`) is the dashboard-only standalone for users who want the dashboard in a separate terminal pane next to native `claude`.

### Sidecar fate
Not hard-deleted this session. Unwired from primary UX + docs (npm script removed, skill no longer references it, docs re-framed as legacy/fallback). Files + tests + `scripts/forge-tui.mjs` (earlier abandoned TUI) remain on disk. Scheduled for a later cleanup slice once wrapper is fully validated.

## Files changed (summary)

**New files:**
- `scripts/forge-observer-proto.mjs` — standalone dashboard TUI
- `scripts/forge-observer-proto-smoke-test.mjs` — smoke test

**Edited runtime files:**
- `scripts/forge-wrapper-proto.mjs` — mouse wheel SGR handling

**Edited positioning/docs/config (no runtime behaviour change):**
- `skills/dashboard/SKILL.md` — in-chat snapshot framing; pointer to wrapper; sidecar legacy
- `package.json` — removed `"dashboard"` script
- `docs/FORGE-OVERVIEW.md` — comparison-table row + planned-work section
- `docs/FORGE-REFERENCE.md` — three dashboard-state shared-source references, utility-scripts table
- `docs/CHANGELOG.md` — new 2026-04-15 entry

## Verification performed this session

- `node --check` on both new scripts → OK.
- `node -e "require('./package.json')"` → parses after script removal.
- `node scripts/run-tests.mjs` → 11/11 PASS including legacy sidecar endpoint + gate/merge action tests, wrapper smoke, observer smoke, forge-tui smoke, dashboard-state-shape. The sidecar safety net is still active while it's legacy-but-on-disk.
- Live user validation (prior to direction change): wrapper color rendering works, mouse wheel scrolls the Claude pane, Ctrl+B→Q quits cleanly. Observer live-tested: renders, keyboard-scrolls, quits.
- Grep audit: `npm run dashboard` gone from user-facing docs (only remains in historical CHANGELOG and sidecar self-reference). Current doc references to the sidecar are all framed as legacy/fallback/transition.

## What is NOT proven

- Live-TTY behaviour of the *pushed* `origin/main` has not been re-tested end-to-end after the direction-change commit. Docs/config-only slice, so no expected regression.
- Shift+click-drag copy flow in wrapper + observer panes is accepted based on terminal-standard behaviour but has not been live-captured in a clipboard paste against ChatGPT/Claude in this session.
- Observer + wrapper have not been validated on Linux/macOS.

## Open threads / next candidate slices

- **Live verification of pushed `origin/main`** — user runs `node scripts/forge-wrapper-proto.mjs` from a fresh terminal to confirm wrapper still works end-to-end; `/forge:dashboard` inside a Claude session to confirm the new skill wording renders cleanly.
- **Promote wrapper to a real launcher** — add `bin/forge.cmd` shim + `"forge"` `bin` entry in `package.json`; do not rename the prototype file yet.
- **Cleanup slice (later)** — hard-delete `scripts/dashboard-server.mjs`, its 3 test files, and `scripts/forge-tui.mjs` + smoke test once wrapper is fully validated as primary.
- **Dashboard right-pane interactivity** — gate approve/discard, merge-blocked retry, from the wrapper's right pane.
- **Pixel-art worker cards / sprites** — `scripts/png-to-sprite.mjs` pipeline is ready; needs actual sprite PNGs.
- **Cross-platform validation** — Linux/macOS for wrapper + observer.
- **Token usage visibility** (board `3b02cb81`).
- **Legacy Electron/JS cleanup** (board `68ec233a`).
- **AgentSeal/codeburn TUI patterns research** (board `b87d8026`).

## Supervisor / pipeline notes

User flagged the supervisor cycle made two framing errors this session:
1. Over-escalating "copyability" as a hard blocker → abandoning TUI direction. Correction saved to memory.
2. Losing the fixed output format in one brief → user re-issued with correct format. No systemic fix needed; one-off.

## State on disk at session end

- Branch `main` at `473721c`, in sync with `origin/main`. Clean tree.
- Unpushed commits: none.
- Wrapper, observer, sidecar all present and functional at their current prototype levels.
- `/forge:dashboard` renders in-chat only (no longer attempts a Bash TUI launch).
- `npm run dashboard` no longer exists as a shortcut.
