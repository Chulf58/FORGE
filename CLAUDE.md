# ⚠ Anti-speculation rule (read first, every turn)

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been". If you lack tool-call evidence this turn, you don't know — verify or disclaim. This rule overrides conversational fluency.

---

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

## Pipeline types and agent sets

Pipeline **types** (the slash command) determine which agents run. Pipeline **mode** controls the subset.

| Type | Command | Agent set | Gate |
|------|---------|-----------|------|
| Plan feature | `/forge:plan` | planner, researcher, gotcha-checker, reviewer-triage, reviewers | #1 |
| Implement feature | `/forge:implement` | coder, completeness-checker, reviewer-triage, reviewers | #2 |
| Implement feature (scoped) | `/forge:implement` | implementation-architect, coder, completeness-checker, reviewer-triage, reviewers | #2 |
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

The 5 reviewers: `reviewer-boundary`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`.

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

**Mandatory agents** — always included when a source change touches the **risk surface** (see below). In that case they are non-negotiable regardless of mode.

| Agent | Role |
|-------|------|
| `reviewer-safety` | Security check |
| `reviewer-boundary` | Boundary correctness |

**Risk surface** — a change is risk-surface when any of the following hold:

- Shell / `child_process` / process spawning.
- `fs` writes or deletes outside `.pipeline/`.
- Auth / crypto / secret / credential handling.
- Network boundaries — HTTP clients, server handlers, `fetch`, `http.createServer`.
- New MCP tools, hook scripts, commands, or public handlers.
- Schema / contract changes — tool schemas, signal formats, persisted `.pipeline/*` shape, model/config schema.
- Security-sensitive path, import, or environment-variable resolution.
- Merge / apply / worktree boundary code.

**LEAN-lite skip rule** — in **LEAN mode only**, reviewer dispatch is skipped when **all** of the following hold:

- `coder` emitted `## Verification: pre-flight clean`.
- `coder` emitted no `## Blockers` bullets.
- The handoff diff matches none of the risk-surface rules above.
- The operator did not include the literal token `[force-review]` in the invocation.

The classifier that enforces this lives at `scripts/lean-risk-classify.mjs`; the gate is wired into `skills/implement/SKILL.md` (post-coder step), `skills/debug/SKILL.md` (post-debug-agent step), and `skills/refactor/SKILL.md` (post-refactor-agent step). STANDARD and FULL modes always dispatch reviewers — the skip rule does not apply there. Note: for refactor, `reviewer-style` always runs even when the gate skips other reviewers. The plan pipeline (`skills/plan/SKILL.md`) does not yet use this gate — its output is `docs/PLAN.md` not `docs/context/handoff.md`, which requires classifier adaptation (deferred).

**Contextual agents** — add based on task signals:

| Agent | Include when |
|-------|-------------|
| `implementation-architect` | Plan has 10+ tasks, crosses module boundaries, modifies shared state, involves migration sequencing, or prior implement runs failed/revised |
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

For every operation, pick the cheapest dedicated tool that does the job. The table below is the decision reference. `hooks/bash-guard.js` enforces a subset of this as a backstop — the table is the primary guidance and should make the backstop unnecessary.

| Need to… | Use | Common mistake |
|---|---|---|
| Read a file | `Read` | `cat` / `head` / `tail` in Bash (blocked by bash-guard); also `node -e 'require("./foo.json")…'` for JSON (slow Node startup, raw stdout, no formatting) |
| Find files by pattern | `Glob` | `find` / `ls` in Bash (blocked) |
| Search inside file contents | `Grep` | `grep` / `rg` in Bash (blocked) |
| Extract fields from a local JSON file | `Read` the file, parse and filter in your response | `node -e "const x=require('./foo.json'); …"` — same data with ~100–300 ms of Node startup, raw stdout, and no rendering control |
| Check the board state (TODOs, planned) | `forge_read_board` MCP tool, or `Read .pipeline/board.json` | Shelling out with `node -e` to filter; reading `.pipeline/*` directly when MCP is available |
| Check dashboard state (active runs, pending gates, recent completions, board summary) | `forge_dashboard_state` MCP tool | Reading `.pipeline/runs/*.json` by hand; launching the legacy HTTP sidecar just to inspect state |
| Check a specific run's full record | `forge_get_run` MCP tool with the run ID | `Read .pipeline/runs/r-*/run.json` when MCP is available |
| Check the active-run pointer / current unit | `forge_get_active_run` MCP tool | `Read .pipeline/run-active.json` directly |
| Check the pending gate | `forge_check_gate` MCP tool | `Read .pipeline/gate-pending.json` directly |
| Edit an existing file | `Edit` | `sed` / `awk` (blocked) |
| Create a new file | `Write` | `echo > file` / `cat <<EOF > file` (blocked) |
| Run tests | Bash → `node scripts/run-tests.mjs` | — |
| Run a project script | Bash → `node scripts/<name>.mjs` | `node -e '…'` inline (write a script file instead — preserves provenance and is re-runnable) |
| Git operations, npm, process / env | Bash | — |
| Delegate an open-ended multi-step investigation | `Agent` with the appropriate subagent type | Using `Agent` to read a single file or extract one field — Read/Grep/Glob are cheaper |

### Common FORGE data lookups — worked examples

**Check what's on the TODO board.**
Call `forge_read_board`. If MCP is unavailable, `Read .pipeline/board.json` and filter in your response. Never `node -e "const b=require('./.pipeline/board.json'); b.todos.filter(…)"` — it's slower, uglier, and unnecessary.

**Check current pipeline state (runs, gates, recent completions, board summary).**
Call `forge_dashboard_state`. Returns a compact four-group snapshot. Do not read `.pipeline/runs/*.json` individually — the tool's output is the contract.

**Check a specific run's full record.**
Call `forge_get_run` with the run ID. Returns the hydrated `run.json` contents.

### Hard rules (preserved for emphasis)

**No subagents for file reads.** Never use the `Agent` tool to read files, extract data, or answer questions that can be resolved with `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research across many files or protecting the main context from large outputs — not for single-file lookups.
