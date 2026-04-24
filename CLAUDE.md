# FORGE Pipeline — Runtime Instructions

These rules govern how FORGE operates in any project where the plugin is installed.

## Change philosophy

Choose the smallest safe implementation that solves the stated problem. No speculative abstractions. No unrelated cleanup. Prefer existing patterns in the codebase over new structure. Keep the patch easy to justify against unnecessary complexity, hidden side effects, and scope creep.

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

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
| SPRINT | Easy task, trust yourself | Core agent only, no reviewers |
| LEAN | Everyday (default) | Core + script-dispatched reviewers (risk-surface match only) |
| STANDARD | Multi-file, state or cross-cutting | Core + completeness-checker + script-dispatched reviewers |
| FULL | High-stakes, nothing skipped | Core + completeness-checker + all 5 reviewers |

The 5 reviewers: `reviewer-boundary`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`.

## Task approach protocol

When starting work on any task from the backlog or TODO list:

### Step 1 — Read the task
Read the full task details from `.pipeline/board.json`.

### Step 2 — Assess the task
Understand what the task involves: which files, what complexity, what risk.

### Step 3 — Decide the agent team
Based on the assessment, determine which agents are needed. The pipeline and mode follow from this.

**Mandatory agents** — always included when a source change touches the **risk surface** (see below). Non-negotiable regardless of mode.

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

The classifier that enforces this lives at `scripts/lean-risk-classify.mjs`. STANDARD and FULL modes always dispatch reviewers.

**Contextual agents** — see `docs/FORGE-REFERENCE.md` section 4 for the full dispatch table (implementation-architect, researcher, gotcha-checker, reviewer-logic, reviewer-performance, reviewer-style).

### Step 4 — The agent team determines the pipeline and mode

| Agent team | Pipeline |
|------------|----------|
| No reviewers needed | `direct` (single file) or `sprint` (multi-file, no cross-cutting) |
| Reviewers needed + new feature | `/forge:plan` then `/forge:implement` |
| Reviewers needed + broken behaviour | `/forge:debug` |
| Reviewers needed + cleanup | `/forge:refactor` |

### Step 5 — Present and wait for approval

Before doing anything, present the full agent team, pipeline, and mode with reasoning. Wait for explicit user approval before starting.

## Model routing

Before each agent invocation, resolve which model and execution path to use:

1. Call `forge_get_model_recommendation` with the agent name.
2. If `source === "error"` or `modelId === null`: surface the `reason` prefixed with `[routing error]` and stop — do not proceed to the agent.
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.

## Tool efficiency

Use dedicated tools over Bash: `Read` not `cat`, `Glob` not `find`, `Grep` not `grep`, `Edit` not `sed`. Prefer `forge_*` MCP tools for pipeline state; fall back to direct file reads if MCP unavailable. `hooks/bash-guard.js` enforces this as a backstop. Full tool-choice table in `docs/FORGE-REFERENCE.md` section 10.

**No subagents for file reads.** Use `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research or protecting context from large outputs.

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
