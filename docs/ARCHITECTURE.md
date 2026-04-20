# Architecture — FORGE Plugin

## Stack
Claude Code plugin: Node.js hooks, Markdown agents/commands, JSON config.

## Overview
FORGE is a Claude Code plugin that provides AI-powered development pipelines. It injects agents, slash commands, and hooks into any project where the plugin is installed. The plugin orchestrates multi-agent workflows (plan, implement, review, apply) against the user's codebase.

## Module map

| Module | Description | Key files |
|--------|-------------|-----------|
| Pipeline Agents | 28 agent definitions that form the pipeline stages | `agents/*.md` |
| Skills | 20 user-facing skills (pipeline + gate + status + setup) | `skills/*/SKILL.md` |
| MCP Server | 26 forge_* tools backing skills and hooks; persists pipeline state and model catalog | `mcp/server.js`, `mcp/lib/` |
| Run Registry | Durable run identity + lifecycle (Zod schemas, on-disk index) | `packages/forge-core/src/runs/` |
| Hooks | Session tracking, workflow guard, context monitoring, observer auto-split | `hooks/*.js`, `hooks/hooks.json` |
| Parallel Runs | Git worktree isolation for concurrent pipelines | `bin/forge-worktree.js` |
| Status Line | Multi-run progress display | `bin/forge-status.js` |
| Project Scaffolds | Scaffold files for new project init | `scaffolds/` |
| Plugin Manifest | Plugin identity and metadata | `.claude-plugin/plugin.json` |

## Entry points

- **User invokes a skill** (e.g. `/forge:plan`) → Claude Code loads `skills/plan/SKILL.md` → skill calls MCP tools and orchestrates agents.
- **MCP tool call** → `mcp/server.js` dispatches → reads/writes `.pipeline/` + `packages/forge-core` run registry.
- **User invokes `/forge:resume <runId>`** → restores `run-active.json` steering pointer; does not progress the run autonomously.
- **Hook fires** (e.g. PostToolUse) → `hooks/hooks.json` routes to `hooks/ctx-post-tool.js` → script processes event.
- **User runs `/forge:init`** → scaffolds `.pipeline/`, `docs/`, `CLAUDE.md` into the target project using templates.

## Agent pipeline flow

```
/forge:plan  →  brainstormer? → planner → researcher? → gotcha-checker? → reviewers → Gate #1
/forge:implement  →  implementation-architect? → coder-scout? → coder → completeness-checker? → reviewers → Gate #2
/forge:apply  →  implementer → documenter  (worktree context injected via SubagentStart hook)
```

Each agent reads from and writes to files in the target project (`docs/PLAN.md`, `docs/context/handoff.md`, `.pipeline/board.json`, etc.).

## Data flow

1. User describes work in natural language
2. `/forge:plan` runs agents that produce `docs/PLAN.md`
3. User approves plan (Gate #1)
4. `/forge:implement` runs agents that produce `docs/context/handoff.md`
5. User approves implementation (Gate #2)
6. `/forge:apply` applies changes to source files and updates docs

## Run model

A **run** is the durable, identity-bearing, resumable logical unit of FORGE work — it has a stable `runId`, a persisted lifecycle (`created` → `running` → `gate-pending` → `completed`/`failed`/`discarded`), and on-disk state that survives Claude session restarts. The **Claude conversation** is the container that drives a run forward: a run only advances during turns where the conversation is actively orchestrating it.

Run state lives at `.pipeline/runs/<runId>/run.json`; the lightweight registry index at `.pipeline/runs/index.json` tracks every run's status. `.pipeline/run-active.json` is the per-Claude-session steering pointer — it names the run the current conversation is driving and is overwritten by `forge_create_run` and `forge_resume_run`.

**Runs do not advance autonomously between conversation turns.** There is no background worker; nothing happens to a run when the conversation isn't driving it. See `docs/FORGE-REFERENCE.md` § 8 for the statusline-vs-dashboard scope rule and the `/forge:resume` non-promise.

## Hooks

See `docs/FORGE-REFERENCE.md` § 9 "Hook Inventory" for the canonical hook list (~13 scripts across SessionStart, PreToolUse, PostToolUse, PostCompact, Stop, SubagentStart, SubagentStop).

## Parallel sessions

`bin/forge-worktree.js` creates git worktrees for isolated parallel pipeline runs. Each worktree gets its own `.pipeline/`, `docs/`, and `.claude/` directories. `bin/forge-status.js` reads state from all worktrees to show combined progress.

## Per-project state (created by /forge:init)

The plugin writes no files on install. Projects get their pipeline state via `/forge:init`:

```
target-project/
├── .pipeline/
│   ├── board.json          — task board (TODO/PLANNED)
│   ├── project.json        — project config (tech stack, pipeline mode)
│   ├── modules.json        — module registry (written by architect agent)
│   ├── agent-roles.json    — agent write permissions
│   ├── run-active.json     — per-session steering pointer (temporary)
│   ├── gate-pending.json   — pending gate approval (temporary)
│   └── runs/
│       ├── index.json              — run registry index
│       └── <runId>/run.json        — durable per-run state
├── .worktrees/
│   └── <runId>/            — git worktree binding for an apply-stage run
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
