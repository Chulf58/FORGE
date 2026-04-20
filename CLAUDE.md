# FORGE Pipeline — Runtime Instructions

These rules govern how FORGE operates in any project where the plugin is installed.

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
| `[task-block]` | `[task-block] taskId blockedBy:id1,id2` | Mark task as blocked |
| `[solution-hit]` | `[solution-hit] docs/solutions/<file>.md — <summary>` | Known fix pattern applied |
| `[promote-gotcha]` | `[promote-gotcha] docs/solutions/<file>.md — <reason>` | Solution ready for GENERAL.md promotion |
| `[CONTEXT-CHECKPOINT]` | literal | Context window low |

`[reviewer-verdict]` JSON requires: `agent`, `verdict`, `blockers`, `warnings`, `feature`, `model`.

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

Pick the cheapest dedicated tool for each operation. `hooks/bash-guard.js` enforces a subset as a backstop.

| Need to… | Use | Common mistake |
|---|---|---|
| Read a file | `Read` | `cat` / `head` / `tail` in Bash |
| Find files by pattern | `Glob` | `find` / `ls` in Bash |
| Search inside file contents | `Grep` | `grep` / `rg` in Bash |
| Check the board state | `forge_read_board` MCP tool, or `Read .pipeline/board.json` | `node -e` to filter JSON |
| Check dashboard state | `forge_dashboard_state` MCP tool | Reading `.pipeline/runs/*.json` by hand |
| Check a specific run | `forge_get_run` MCP tool | `Read .pipeline/runs/r-*/run.json` |
| Check the active run | `forge_get_active_run` MCP tool | `Read .pipeline/run-active.json` |
| Check the pending gate | `forge_check_gate` MCP tool | `Read .pipeline/gate-pending.json` |
| Edit an existing file | `Edit` | `sed` / `awk` in Bash |
| Create a new file | `Write` | `echo > file` in Bash |
| Git operations, npm, process | Bash | — |
| Delegate open-ended investigation | `Agent` with appropriate subagent type | Using `Agent` for single-file lookups |

### MCP unavailability

When any `forge_*` MCP tool call fails (connection error, tool not found, timeout), emit this warning once per session before falling back to direct file reads:

`[forge] MCP server not running. Run /forge:doctor to diagnose, or restart Claude Code.`

### Hard rules

**No subagents for file reads.** Never use the `Agent` tool to read files, extract data, or answer questions that can be resolved with `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research or protecting the main context from large outputs.
