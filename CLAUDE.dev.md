# FORGE Plugin — Developer Instructions

These instructions apply when working on the FORGE plugin source code itself. They are NOT loaded for end users.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

---

## Stack

- **Runtime:** Node.js (hooks are `.js` scripts executed by Claude Code)
- **Content:** Markdown (agents, commands, skills)
- **Config:** JSON (plugin manifest, pipeline state, board)
- **Distribution:** Claude Code plugin system (marketplace or local path)

## Key source locations

| Area | Path |
|------|------|
| Plugin manifest | `.claude-plugin/plugin.json` |
| Pipeline agents | `agents/*.md` |
| Slash commands | `commands/forge/*.md` |
| Hook declarations | `hooks/hooks.json` |
| Hook scripts | `hooks/*.js` |
| Status line script | `bin/forge-status.js` |
| Worktree manager | `bin/forge-worktree.js` |
| Project scaffolds | `scaffolds/` |
| Pipeline state (per-project) | `.pipeline/` |
| Pipeline docs (per-project) | `docs/` |
| Gotchas for this plugin project | `docs/gotchas/GENERAL.md` |

## How the plugin works

When installed, Claude Code loads:
1. **Agents** from `agents/` — available as subagents in any session
2. **Commands** from `commands/forge/` — available as `/forge:plan`, `/forge:init`, etc.
3. **Hooks** from `hooks/hooks.json` — fire on SessionStart, PreToolUse, PostToolUse
4. **MCP servers** from `.mcp.json` — spawned automatically (future: multi-engine routing)

The plugin does NOT modify project files on install. Projects get their pipeline state (`docs/`, `.pipeline/`) via `/forge:init`.

## File categories

**Plugin files (this repo, distributed to users):**
- `agents/` — agent prompt definitions
- `commands/` — slash command definitions
- `hooks/` — hook scripts and declarations
- `bin/forge-status.js`, `bin/forge-worktree.js` — utility scripts
- `scaffolds/` — project scaffolding files

**Per-project files (created by /forge:init, live in the target project):**
- `.pipeline/board.json` — TODO/PLANNED task board
- `.pipeline/project.json` — project config (tech stack, pipeline mode)
- `.pipeline/modules.json` — module registry
- `docs/PLAN.md` — active plan
- `docs/context/handoff.md` — implementation draft for reviewer pass
- `docs/gotchas/GENERAL.md` — project-specific gotchas
- `docs/ARCHITECTURE.md` — project architecture overview
- `CLAUDE.md` — project instructions for Claude Code

## Stack rules and gotchas

@docs/gotchas/GENERAL.md

## Working on this plugin

This repo is the plugin source. When editing agents, commands, or hooks:
- Edit the files directly — no build step, no compilation
- Test by opening a Claude Code session in a project where the plugin is installed
- Agent changes take effect on next agent invocation (no restart needed)
- Hook changes require restarting the Claude Code session
- Command changes require restarting the Claude Code session

## End-of-session protocol

After any session that modifies plugin files, run these steps:

**Step 1 — Write handoff.** Write a summary to `docs/context/handoff.md` starting with `# Handoff: <session name>`.

**Step 2 — Update CHANGELOG.** Add an entry to `docs/CHANGELOG.md` describing what changed.

**Step 3 — Update ARCHITECTURE.md (if structural changes).** Only if new modules, agents, or commands were added/removed.

## Pipeline docs

- `docs/PLAN.md` — current active plan
- `docs/context/handoff.md` — implementation draft for reviewer pass
- `docs/ARCHITECTURE.md` — module map
- `docs/gotchas/GENERAL.md` — gotchas for working on this plugin
- `docs/CHANGELOG.md` — running record of changes

## FORGE data lookups — worked examples

**Check what's on the TODO board.**
Call `forge_read_board`. If MCP is unavailable, `Read .pipeline/board.json` and filter in your response.

**Check current pipeline state (runs, gates, recent completions, board summary).**
Call `forge_dashboard_state`. Returns a compact four-group snapshot.

**Check a specific run's full record.**
Call `forge_get_run` with the run ID. Returns the hydrated `run.json` contents.
