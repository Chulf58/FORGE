# Handoff: TUI architecture decisions, Option B, launcher, Ink spike

## Overview

Long session spanning TUI prototype refinements, tool-choice behaviour work (Options A+B), launcher wiring with PATH-resolution fixes, two blocking architecture decisions (observer-primary, TUI library evaluation), external research (codeburn, claude-panel, TUI library Phase 1), and an Ink spike for Phase 2 library evaluation. Ended with user pausing the Ink evaluation to activate the multi-agent pipeline system.

## Session commits (chronological, all on `origin/main`)

| Commit | What |
|---|---|
| `f12f85c` | Wrapper mouse wheel scroll via SGR mouse reporting |
| `633d465` | Terminal observer prototype + smoke test |
| `473721c` | Direction change: wrapper TUI primary, sidecar legacy |
| `2fd5845` | End-of-session handoff for the TUI-primary direction slice |
| `cfb9bab` | Legacy truecolor FORGE banner stashed from Electron app |
| `d8a58f3` | OVERVIEW Era 21 (wrapper TUI pivot) |
| `ee28584` | REFERENCE drift patch |
| `7a7cd00` | TUI panes fully opaque (acrylic bleed fix) |
| `102e629` | Supervisor instructions for ChatGPT web supervisor |
| `43e804f` | Supervisor ceremony reduction + per-turn review requirement |
| `0ac7379` | Option A: positive tool-choice rules in root CLAUDE.md |
| `e73b66f` | Option A: positive tool-choice rules in code + instructional templates |
| `ee563aa` | Option A: positive tool-choice rules in power-automate template |
| `874ef45` | Board housekeeping (close forge-web-dashboard, retarget token usage task) |
| `950b986` | Option B: filter + field-select on `forge_read_board` |
| `1d18c4d` | Option B: filter + field-select on `forge_list_runs` |
| `841d433` | Remove sidecar regression tests (sidecar phasing out) |
| `4b9eee6` | Launcher entry point: `bin/forge.js` + `bin/forge.cmd` + smoke test |
| `d09fc8c` | Fix: bake absolute Node path into `bin/forge.cmd` |
| `98a6856` | Fix: SessionStart hook auto-generates `bin/forge.cmd` with Node path |
| `3de7ea9` | Fix: set FORGE_CLAUDE_CMD in `bin/forge.cmd` for Claude binary |
| `ad2ee2a` | Proper fix: `findClaude()` discovery in wrapper + SessionStart hook |
| `f168aa7` | Board: add 2 blocking TUI architecture decision tasks |
| `6e78feb` | Board: add red-team security audit task |
| `e8a8d9e` | Phase 1 TUI library research doc |
| `abe2664` | DECISIONS.md: observer-primary; close `3438a2be`; queue wt.exe hook |
| `349a8b9` | Ink spike: observer port for Phase 2 library evaluation |

## Key decisions this session

### Observer-primary over wrapper (docs/DECISIONS.md 2026-04-15)
The wrapper's ~500 lines of PTY/xterm/mouse/paint complexity exists only to give "one command starts both" UX. External evidence from `alex-radaev/claude-panel` shows a ~15-line SessionStart hook calling `wt.exe -w 0 sp -V --size 0.35 -- <observer>` achieves the same result. Observer-primary wins.

### Ink as TUI library candidate (conditional go)
Phase 1 research evaluated blessed, neo-blessed, Ink, terminal-kit, react-curse. Phase 2 spike (`scripts/forge-observer-ink-spike.mjs`) showed Ink's reactive model is genuinely cleaner for the polling dashboard case even without JSX. Go is conditional on live mouse verification (click + Shift+select in alt-screen). **Paused here — user wants to activate multi-agent pipeline first.**

### Shift+click-drag accepted as industry standard
No code change. Terminal-protocol-level tradeoff: mouse UI and native selection can't coexist in the same pane. Every TUI with buttons uses Shift for selection. Accepted.

### ChatGPT web as the supervisor platform
`docs/SUPERVISOR-INSTRUCTIONS.md` defines: one-time file upload kit, paste protocol for runtime state, §5.5 per-turn review (Scope check / Verdict / Solved before each brief), ceremony reduction rules.

## Blocking tasks (highest priority, paused)

| Task | Status | Next step |
|---|---|---|
| `24fae760` TUI library evaluation | **Paused** — Ink spike committed, Phase 2 verdict written, awaiting live mouse test | Run spike in real terminal, report outcome (a)/(b)/(c), then migrate or fall back |
| `95aeb42f` wt.exe SessionStart hook | **Queued** — depends on observer-primary being validated | Implement after Ink decision settles |
| `0b6959d2` Red-team security audit | **Queued** — independent of TUI work | Can run anytime |

## What the user wants next session

**Activate the multi-agent pipeline system.** The full FORGE pipeline (29 agents, 21 skills, 13 hooks, 24 MCP tools, gates, worktrees) should already work. User wants to use it — likely running pipelines against real projects, not more meta-work on the plugin itself.

## Files changed this session (summary)

**New files:**
- `scripts/forge-observer-ink-spike.mjs` — Ink observer spike (~200 lines, pure createElement)
- `scripts/forge-observer-ink-spike-smoke-test.mjs` — non-TTY smoke test
- `scripts/forge-launcher-smoke-test.mjs` — launcher contract test
- `scripts/forge-banner-truecolor.js` — stashed legacy truecolor banner
- `bin/forge.js` — thin launcher delegating to wrapper
- `bin/forge.cmd` — Windows shim with absolute Node + Claude paths
- `mcp/forge-read-board-filter-test.mjs` — board filter regression test
- `mcp/forge-list-runs-filter-test.mjs` — runs filter regression test
- `docs/SUPERVISOR-INSTRUCTIONS.md` — ChatGPT web supervisor operating instructions
- `docs/RESEARCH/tui-library-evaluation.md` — Phase 1 + Phase 2 research doc
- `templates/power-automate/CLAUDE.md` — tool-choice guidance for PA scaffold

**Modified files:**
- `CLAUDE.md` — positive Tool Decision Table replacing negative rule
- `templates/code/CLAUDE.md` — tool-choice guidance mirrored
- `templates/instructional/CLAUDE.md` — tool-choice guidance mirrored
- `templates/power-automate/docs/gotchas/GENERAL.md` — pointer replacing stale tool-preference section
- `mcp/server.js` — `forge_read_board` + `forge_list_runs` filter/fields extensions
- `mcp/package.json` — added ink + react deps
- `hooks/mcp-deps-install.js` — generates `bin/forge.cmd` + Claude discovery
- `scripts/forge-wrapper-proto.mjs` — `findClaude()` discovery, opaque pane backgrounds, (earlier: color paint, dashboard polling, mouse wheel)
- `scripts/forge-observer-proto.mjs` — opaque pane background
- `package.json` — `bin.forge` entry, removed sidecar npm script
- `docs/FORGE-OVERVIEW.md` — Era 21, updated planned-next
- `docs/FORGE-REFERENCE.md` — drift patch (date, utility scripts table)
- `docs/DECISIONS.md` — observer-primary entry
- `docs/CHANGELOG.md` — wrapper TUI primary entry + mouse wheel
- `skills/dashboard/SKILL.md` — reframed as in-chat snapshot
- `.pipeline/board.json` — multiple task changes (closed 2, added 3, updated 2)

**Deleted files:**
- `scripts/dashboard-gate-action-test.mjs` — sidecar test removed
- `scripts/dashboard-merge-action-test.mjs` — sidecar test removed
- `scripts/dashboard-server-endpoint-test.mjs` — sidecar test removed

## Verification state

- 12/12 tests pass at session end (new Ink spike smoke test included)
- `origin/main` at `349a8b9`, in sync with local HEAD
- Working tree clean
- Board: 43 open items (2 high blocking paused, 1 high security audit queued, remainder medium/low)

## Memory updates this session

- `feedback_tui_primary.md` — TUI is primary surface, sidecar out, Shift+click-drag accepted
- `feedback_no_speculative_tool_comparisons.md` — don't claim "tool X does it this way" without reading their code
