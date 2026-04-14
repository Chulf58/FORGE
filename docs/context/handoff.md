# Handoff: Distribution, sidecar mismatch, and board maintenance

## Overview

This session completed self-hosted marketplace distribution (with MCP bootstrap fixes), resolved the sidecar project-mismatch issue, closed landed board tasks, and added new board tasks for legacy cleanup and token usage visibility.

## Session commits

| Commit | What |
|---|---|
| `f313193` | Made `.mcp.json` portable |
| `23e64b8` | Documented dev-only MCP double-load warning |
| `45f03b2` | Created `marketplace.json` |
| `4ab239b` | Set GitHub repository URL |
| `20b7213` | Added README with install instructions |
| `7849b71` | Fixed marketplace source schema |
| `e4ec505` | Fixed source field name |
| `6a7ae28` | Switched to HTTPS URL source |
| `65bb7ba` | Fixed npm bootstrap (npm-cli.js from Node) |
| `6c022db` | Fixed CLAUDE_PLUGIN_ROOT fallback + forge-core deps |
| `545ab4e` | Tried cwd approach (intermediate) |
| `da388f5` | Tried bin/ bare command (intermediate) |
| `c147f59` | Final MCP fix: SessionStart writes launcher with resolved Node path |
| `5c355f8` | Session handoff for distribution milestone |
| `59035dd` | Closed `marketplace-json` board task |
| `ef61a14` | Added plugin folder cleanup board task |
| `39bc92b` | Added project identity to sidecar API/UI |
| `6ee127c` | Added sidecar mismatch detection (aggressive — superseded) |
| `64abbe6` | Corrected mismatch to safe non-destructive handling |
| `dcaef24` | Added dashboard token usage board task |

## What shipped

### Self-hosted marketplace distribution
- FORGE live at https://github.com/Chulf58/FORGE (public)
- Install: `/plugin marketplace add Chulf58/FORGE` → `/plugin install forge@forge-tools` → reopen session for MCP
- Two-session bootstrap: session 1 installs deps + writes launcher; session 2+ has full MCP

### MCP bootstrap chain (3 blockers fixed)
1. `CLAUDE_PLUGIN_ROOT` fallback to `__dirname` parent
2. Dependency install loop covers both `mcp/` and `packages/forge-core/`
3. SessionStart hook writes `bin/forge-mcp-server.cmd` with absolute `process.execPath`

### Sidecar project-mismatch fix
- `/api/dashboard-state` now includes `project: { name, dir }`
- Sidecar HTML header and browser title show the served project name
- `/forge:dashboard` detects mismatch: if running sidecar serves a different project, logs a warning and skips the browser open (does not kill the other sidecar)
- Text dashboard always renders regardless of sidecar state

### Board maintenance
- Closed `marketplace-json` (landed)
- Added `68ec233a`: legacy Electron/JS clutter cleanup
- Added `3b02cb81`: dashboard token usage visibility (per-run, per-session, all-time)

## Core contracts

1. **`.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}\\bin\\forge-mcp-server.cmd`** — do not change to bare `node`.
2. **`mcp-deps-install.js` writes the launcher on every SessionStart** — adapts if Node path changes.
3. **Sidecar project identity** via `state.project.name` — used for mismatch detection.
4. **Mismatch is non-destructive** — warn + skip, do not kill other sidecars.

## Deferred

- Auto-restart sidecar on mismatch (add if manual approach proves too friction-heavy)
- Legacy Electron/JS cleanup (board task `68ec233a`)
- Dashboard token usage (board task `3b02cb81`)
- Official Anthropic marketplace submission
- npm packaging
- Two-session bootstrap improvement (investigate MCP startup ordering)

## Next recommended slice

Legacy cleanup task (`68ec233a`), dashboard token usage (`3b02cb81`), or `add-plugin-settings`.
