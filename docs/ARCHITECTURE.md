# Architecture — FORGE Plugin

## Stack
Claude Code plugin: Node.js hooks, Markdown agents/commands, JSON config.

## Overview
FORGE is a Claude Code plugin that provides AI-powered development pipelines. It injects agents, slash commands, and hooks into any project where the plugin is installed. The plugin orchestrates multi-agent workflows (plan, implement, review, apply) against the user's codebase.

## Module map

| Module | Description | Key files |
|--------|-------------|-----------|
| Pipeline Agents | 27 agent definitions that form the pipeline stages | `agents/*.md` |
| Slash Commands | 17 user-facing commands for pipeline control | `commands/forge/*.md` |
| Hooks | Session tracking, workflow guard, context monitoring | `hooks/*.js`, `hooks/hooks.json` |
| Parallel Sessions | Git worktree isolation for concurrent pipelines | `forge-worktree.js` |
| Status Line | Multi-session progress display | `forge-status.js` |
| Project Templates | Scaffold templates for new project init | `templates/` |
| Plugin Manifest | Plugin identity and metadata | `.claude-plugin/plugin.json` |

## Entry points

- **User runs a command** (e.g. `/forge:plan`) → Claude Code loads `commands/forge/plan.md` → command orchestrates agents
- **Hook fires** (e.g. PostToolUse) → `hooks/hooks.json` routes to `hooks/ctx-post-tool.js` → script processes event
- **User runs `/forge:init`** → scaffolds `.pipeline/`, `docs/`, `CLAUDE.md` into the target project using templates

## Agent pipeline flow

```
/forge:plan  →  brainstormer? → planner → researcher? → gotcha-checker? → reviewers → Gate #1
/forge:implement  →  coder-scout? → coder → completeness-checker? → reviewers → Gate #2
/forge:apply  →  implementer → documenter
```

Each agent reads from and writes to files in the target project (`docs/PLAN.md`, `docs/context/handoff.md`, `.pipeline/board.json`, etc.).

## Data flow

1. User describes work in natural language
2. `/forge:plan` runs agents that produce `docs/PLAN.md`
3. User approves plan (Gate #1)
4. `/forge:implement` runs agents that produce `docs/context/handoff.md`
5. User approves implementation (Gate #2)
6. `/forge:apply` applies changes to source files and updates docs

## Hooks

| Hook | Event | Script | Purpose |
|------|-------|--------|---------|
| Context tracking | SessionStart | `ctx-session-start.js` | Reads transcript, computes remaining context % |
| Context monitoring | PostToolUse | `ctx-post-tool.js` | Logs tool calls, emits `[CONTEXT-CHECKPOINT]` when low |
| Workflow guard | PreToolUse (Write/Edit) | `workflow-guard.js` | Enforces agent write-path restrictions |
| Role enforcement | PreToolUse (Write/Edit) | `ctx-pre-tool.js` | Validates agent permissions via `agent-roles.json` |
| Banner | SessionStart | `forge-banner.js` | Displays FORGE branding on session start |

## Parallel sessions

`forge-worktree.js` creates git worktrees for isolated parallel pipeline runs. Each worktree gets its own `.pipeline/`, `docs/`, and `.claude/` directories. `forge-status.js` reads state from all worktrees to show combined progress.

## Per-project state (created by /forge:init)

The plugin writes no files on install. Projects get their pipeline state via `/forge:init`:

```
target-project/
├── .pipeline/
│   ├── board.json          — task board (TODO/PLANNED)
│   ├── project.json        — project config (tech stack, pipeline mode)
│   ├── modules.json        — module registry (written by architect agent)
│   ├── agent-roles.json    — agent write permissions
│   ├── run-active.json     — active run state (temporary)
│   └── gate-pending.json   — pending gate approval (temporary)
├── docs/
│   ├── PLAN.md             — active plan
│   ├── ARCHITECTURE.md     — project architecture (written by architect)
│   ├── CHANGELOG.md        — change history
│   ├── context/
│   │   └── handoff.md      — implementation draft for reviewer pass
│   └── gotchas/
│       └── GENERAL.md      — project-specific rules (written by architect)
└── CLAUDE.md               — project instructions for Claude Code
```

The architect agent (`agents/architect.md`) is responsible for writing/updating `ARCHITECTURE.md`, `modules.json`, and `GENERAL.md` in target projects. It detects the tech stack, maps functional modules, and generates stack-specific gotchas.
