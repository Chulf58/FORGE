# Handoff: Distribution milestone — self-hosted marketplace validated

## Overview

This session completed the self-hosted marketplace distribution path for FORGE. The plugin is live on GitHub, installable via marketplace commands, and fully functional (MCP server included) from the second session onward.

## GitHub

https://github.com/Chulf58/FORGE (public)

## Distribution commits

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
| `65bb7ba` | Fixed npm bootstrap (resolve npm-cli.js from Node) |
| `6c022db` | Fixed CLAUDE_PLUGIN_ROOT fallback + forge-core deps |
| `545ab4e` | Tried cwd approach (intermediate) |
| `da388f5` | Tried bin/ bare command approach (intermediate) |
| `c147f59` | Final fix: SessionStart writes launcher with resolved Node path |

## What shipped

### Self-hosted marketplace distribution

- `marketplace.json` at `.claude-plugin/marketplace.json` with HTTPS URL source
- `plugin.json` with repository URL
- `README.md` with install instructions
- Portable `.mcp.json` using `${CLAUDE_PLUGIN_ROOT}\\bin\\forge-mcp-server.cmd`

### MCP bootstrap chain (3 blockers fixed)

1. `CLAUDE_PLUGIN_ROOT` fallback — use `__dirname` parent when env var not set
2. `packages/forge-core` deps — install loop covers both `mcp/` and `packages/forge-core/`
3. Node path resolution — SessionStart hook writes `bin/forge-mcp-server.cmd` with absolute `process.execPath` baked in; `.mcp.json` references the wrapper

### Two-session bootstrap (known trade-off)

- Session 1 after install: hook installs deps + writes launcher; MCP fails (launcher written after MCP already tried to start)
- Session 2+: launcher exists; MCP connects immediately

### Board triage (earlier in session)

42 → 37 open tasks. Closed: `knowledge-compound-refresh`, `ideate-command`, `move-utils-to-bin`, `plugin-knowledge-compound`, `plugin-intent-classification`. Refined: `forge-web-dashboard` scope narrowed.

## Install instructions

```
/plugin marketplace add Chulf58/FORGE
/plugin install forge@forge-tools
# Close and reopen session for MCP to connect
```

## Core contracts

1. **`.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}\\bin\\forge-mcp-server.cmd`** — do not change to bare `node`.
2. **`mcp-deps-install.js` writes the launcher on every SessionStart** — adapts if Node path changes.
3. **The shipped `.cmd` is a placeholder** — returns exit 1 until overwritten by the hook.
4. **Two-session bootstrap is expected** on machines without Node in system PATH.

## Known limitations

1. Two-session bootstrap (first session: no MCP; second+: full MCP)
2. Sidecar project-mismatch gap (sidecar doesn't detect wrong project on fixed port)
3. Enterprise PATH restriction (user cannot add Node to system PATH)

## Deferred

- Investigate MCP startup ordering (could fix two-session bootstrap)
- Sidecar project-mismatch detection
- Official Anthropic marketplace submission
- npm packaging
- Close `marketplace-json` board task

## Next recommended slice

Close `marketplace-json` on the board, then Diesel Priser e2e re-validation or `add-plugin-settings`.
