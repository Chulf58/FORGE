# FORGE Worker — Runtime Instructions

These rules apply when `.pipeline/worker-task.json` exists — i.e., this is a worker session executing a pipeline task.

## Change philosophy

Choose the smallest safe implementation that solves the stated problem. No speculative abstractions. No unrelated cleanup. Prefer existing patterns in the codebase over new structure. Keep the patch easy to justify against unnecessary complexity, hidden side effects, and scope creep.

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

## Tool efficiency

Use dedicated tools over Bash: `Read` not `cat`, `Glob` not `find`, `Grep` not `grep`, `Edit` not `sed`. Prefer `forge_*` MCP tools for pipeline state; fall back to direct file reads if MCP unavailable. `hooks/bash-guard.js` enforces this as a backstop.

**No subagents for file reads.** Use `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research or protecting context from large outputs.

---

## Checkpoint resume

When you receive a user message starting with `[resume-from-checkpoint]`, a subagent hit its context limit mid-task and was paused. The `[resume-from-checkpoint]` message names the agent type and tells you the `docs/context/checkpoint.md` file holds the partial state.

**What to do:** Re-dispatch the named agent via `Agent(subagent_type=<X>)` with a prompt that begins with the literal `[resume-from-checkpoint]` prefix and instructs it to read `docs/context/checkpoint.md` to continue. Do NOT do the agent's work yourself — re-dispatch it.

**What NOT to do:** Do not treat this as a conversational message and narrate intent. Do not do the work yourself. The worker must be the dispatcher, not the implementer.

Example: if you receive:
```
[resume-from-checkpoint]
The previous debug agent hit its context limit mid-task. Read `docs/context/checkpoint.md` to see what was completed and what remains. Continue from where the prior pass stopped — do not repeat completed work.
```
Dispatch `Agent(subagent_type='forge:debug', prompt='[resume-from-checkpoint]\n...')` immediately.

**Cap:** the orchestrator allows at most 2 resume passes per agent per run. If the run reaches the cap, it is marked failed with `failureReason: "context-exhausted"` and requires manual intervention.

---

## Plugin development

> These rules apply when working on the FORGE plugin source code itself — editing agents, hooks, skills, or MCP server code in this repo.

### Stack

- **Runtime:** Node.js (hooks are `.js` scripts executed by Claude Code)
- **Content:** Markdown (agents, commands, skills)
- **Config:** JSON (plugin manifest, pipeline state, board)
- **Distribution:** Claude Code plugin system (marketplace or local path)

### Key source locations

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

### How the plugin works

When installed, Claude Code loads:
1. **Agents** from `agents/` — available as subagents in any session
2. **Commands** from `commands/forge/` — available as `/forge:plan`, `/forge:init`, etc.
3. **Hooks** from `hooks/hooks.json` — fire on SessionStart, PreToolUse, PostToolUse
4. **MCP servers** from `.mcp.json` — spawned automatically

The plugin does NOT modify project files on install. Projects get their pipeline state (`docs/`, `.pipeline/`) via `/forge:init`.

### Working on this plugin

Edit files directly — no build step, no compilation. Agent changes take effect on next invocation (no restart needed). Hook and command changes require restarting the Claude Code session.

### Stack rules and gotchas

@docs/gotchas/GENERAL.md
