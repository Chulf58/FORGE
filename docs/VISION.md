# FORGE — Vision

## What it is

FORGE is an AI-powered development pipeline manager distributed as a Claude Code plugin. It turns natural-language task descriptions into structured, multi-agent workflows with built-in quality gates. Install the plugin once, run `/forge:init` in any project, and you have a full development pipeline.

---

## Core idea

FORGE owns the logic, projects own the data.

- **The plugin** provides: 28 agents, 17 commands, 5 hooks, 6 project templates, the pipeline orchestration rules, and the signal protocol
- **Each project** gets: `.pipeline/board.json` (task board), `docs/PLAN.md` (plans), `docs/context/handoff.md` (implementation drafts), `docs/gotchas/GENERAL.md` (stack-specific rules), and `CLAUDE.md` (project instructions)

When FORGE improves an agent prompt or adds a command, every project benefits immediately — no re-scaffolding, no per-project updates.

---

## Two core workflows

### 1. New project creation
1. Run `/forge:init` in an empty or existing directory
2. FORGE scaffolds pipeline files from templates
3. The architect agent analyses the codebase, detects the tech stack, writes `GENERAL.md` and `modules.json`
4. The project is immediately ready for pipeline work

### 2. Task lifecycle
1. User captures an idea → TODO (via `/forge:todo` or `[todo]` signal)
2. User plans it → `/forge:plan` runs brainstormer + planner + reviewers → `docs/PLAN.md` → Gate #1
3. User implements it → `/forge:implement` runs coder + reviewers → `docs/context/handoff.md` → Gate #2
4. User applies it → `/forge:apply` runs implementer + documenter → source files updated, changelog written

---

## Pipeline modes

| Mode | When | Agent set |
|------|------|-----------|
| TRIVIAL | One-line fix | Bypass pipeline |
| SPRINT | Easy, trusted | Core agent only |
| LEAN | Everyday default | Core + reviewer-safety + reviewer |
| STANDARD | Multi-file, cross-cutting | Core + triage + dispatched reviewers |
| FULL | High-stakes | Core + triage + all 5 reviewers |

---

## Design principles

- **Structure over chaos** — the pipeline and gate system prevent shortcuts that cause problems later
- **Visibility** — every agent action is observable through signals and terminal output
- **Adaptability** — the template moulds to the project's stack, not the other way around
- **Easy to install** — one plugin install, one init command, done
- **Quality by default** — reviewers, gotcha-checker, and documenter are not optional
- **Multi-model ready** — MCP server architecture (pinned) enables routing agents to any provider

---

## What's next

### Near-term (plugin hardening)
- Test plugin through Claude Code's native plugin loading system
- Verify banner display on SessionStart
- Clean up agent prompts for plugin context (some still reference Electron internals)
- Distribution via marketplace wrapper + install script for team

### Medium-term (pipeline improvements)
- Knowledge compounding — capture solutions after each apply cycle
- Test execution loop — auto-run tests, feed failures to debug pipeline
- Git integration — auto-commit, branch-per-feature
- Project references — import URLs/PDFs as persistent project knowledge

### Long-term (multi-model + scaling)
- MCP server for multi-model routing (Anthropic, OpenAI, Google)
- `forge-config.json` per project to route agents to different providers
- Web dashboard for visual pipeline status (read-only companion to CLI)
- Parallel sessions via git worktrees (forge-worktree.js — already built)

---

## The One Chat vision (carried forward)

The original Electron app's "One Chat" vision — where users type naturally and FORGE detects intent — translates directly to the plugin. The `/forge:chat` command acts as the conversational orchestrator. The user describes what they want, FORGE proposes an approach with the right pipeline and agent team, and the user approves before anything runs.

Gates become explicit confirmation prompts in the conversation. Signals (`[suggest]`, `[questions]`, `[reviewer-verdict]`) still flow through the terminal. The pipeline logic is identical — only the display surface changed from a desktop window to the Claude Code terminal.
