# FORGE Plugin — Project Instructions

FORGE is a Claude Code plugin that manages AI-powered development pipelines. It provides agents, slash commands, and hooks that are injected into any project where the plugin is installed. This repo (`forge-plugin/`) is the plugin source — all files here become available to Claude Code sessions across projects.

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
| Status line script | `forge-status.js` |
| Worktree manager | `forge-worktree.js` |
| Project templates | `templates/` |
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
- `forge-status.js`, `forge-worktree.js` — utility scripts
- `templates/` — project scaffolding templates

**Per-project files (created by /forge:init, live in the target project):**
- `.pipeline/board.json` — TODO/PLANNED task board
- `.pipeline/project.json` — project config (tech stack, pipeline mode)
- `.pipeline/modules.json` — module registry
- `docs/PLAN.md` — active plan
- `docs/context/handoff.md` — implementation draft for reviewer pass
- `docs/gotchas/GENERAL.md` — project-specific gotchas
- `docs/ARCHITECTURE.md` — project architecture overview
- `CLAUDE.md` — project instructions for Claude Code

## Pipeline types and agent sets

Pipeline **types** (the slash command) determine which agents run. Pipeline **mode** controls the subset.

| Type | Command | Agent set | Gate |
|------|---------|-----------|------|
| Plan feature | `/forge:plan` | planner, researcher, gotcha-checker, reviewer-triage, reviewers | #1 |
| Implement feature | `/forge:implement` | coder, completeness-checker, reviewer-triage, reviewers | #2 |
| Apply feature | `/forge:apply` | implementer, documenter | none |
| Debug | `/forge:debug` | debug, reviewer-triage, reviewers | #2 |
| Apply debug | `/forge:apply` | implementer, documenter | none |
| Refactor | `/forge:refactor` | refactor, reviewer-triage, reviewers | #2 |
| Apply refactor | `/forge:apply` | implementer, documenter | none |
| Architect | (direct) | architect, reviewer-logic | #1 |

## Pipeline modes

Set per project in `.pipeline/project.json` (`pipelineMode` field):

| Mode | When | Effect |
|------|------|--------|
| TRIVIAL | Trivial single-file fix | Bypass pipeline entirely |
| SPRINT | Easy task, trust yourself | Core agent only, no reviewers |
| LEAN | Everyday (default) | Core + reviewer-safety + reviewer |
| STANDARD | Multi-file, state or cross-cutting | Core + completeness-checker + reviewer-triage + triage-dispatched reviewers |
| FULL | High-stakes, nothing skipped | Core + completeness-checker + reviewer-triage + all 5 reviewers |

The 5 reviewers: `reviewer`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`.

## Signal protocol

Agents emit signals as bracket-prefixed lines. Key signals:

| Signal | Format | Purpose |
|--------|--------|---------|
| `[suggest]` | `[suggest] chip text` | Suggest next action |
| `[todo]` | `[todo] task text` | Add TODO to board |
| `[health]` | `[health] file\|aspect\|sev\|note` | Report code health issue |
| `[questions]` / `[/questions]` | multi-line block | Agent clarification questions |
| `[reviewer-verdict]` | `[reviewer-verdict] {...JSON}` | Reviewer result (APPROVED/BLOCK/REVISE) |
| `[CONTEXT-CHECKPOINT]` | literal | Context window low |

`[reviewer-verdict]` JSON requires: `agent`, `verdict`, `blockers`, `warnings`, `feature`, `model`.

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

## Task approach protocol

When starting work on any task from the backlog or TODO list:

### Step 1 — Read the task
Read the full task details from `.pipeline/board.json`.

### Step 2 — Assess the task
Understand what the task involves: which files, what complexity, what risk.

### Step 3 — Decide the agent team
Based on the assessment, determine which agents are needed. The pipeline and mode follow from this.

**Mandatory agents** — always included for any source change (non-negotiable):

| Agent | Role |
|-------|------|
| `reviewer-safety` | Security check |
| `reviewer` | Boundary correctness |

**Contextual agents** — add based on task signals:

| Agent | Include when |
|-------|-------------|
| `researcher` | External API, unfamiliar library, or unknown technical constraint |
| `gotcha-checker` | Pattern with known failure modes (file writes, process spawning, reactive state) |
| `reviewer-logic` | Complex state mutations, async flows, data transforms, multi-step conditionals |
| `reviewer-performance` | Hot paths, data-heavy operations |
| `reviewer-style` | Any visible output/formatting change |

### Step 4 — The agent team determines the pipeline and mode

**Pipeline:**

| Agent team | Pipeline |
|------------|----------|
| No reviewers needed | `direct` (single file) or `sprint` (multi-file, no cross-cutting) |
| Reviewers needed + new feature | `/forge:plan` then `/forge:implement` |
| Reviewers needed + broken behaviour | `/forge:debug` |
| Reviewers needed + cleanup | `/forge:refactor` |

**Boundaries:**
- `direct` — single file only, no type propagation
- `sprint` — sequential only; all sprint coders write to `docs/context/handoff.md` and concurrent runs overwrite each other

### Step 5 — Present and wait for approval

Before doing anything, present:
- The full agent team (every agent, with one-line reason)
- The pipeline and why
- The mode and why

Wait for explicit user approval before starting.

## Pipeline docs

- `docs/PLAN.md` — current active plan
- `docs/context/handoff.md` — implementation draft for reviewer pass
- `docs/ARCHITECTURE.md` — module map
- `docs/gotchas/GENERAL.md` — gotchas for working on this plugin
- `docs/CHANGELOG.md` — running record of changes

## Tool efficiency

**No subagents for file reads.** Never use the Agent tool to read files, extract data, or answer questions that can be resolved with Read, Grep, or Glob directly.
