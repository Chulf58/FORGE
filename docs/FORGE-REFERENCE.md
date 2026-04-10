# FORGE — Technical Reference

> Generated on 2026-04-07 from source-of-truth files. Do not edit manually — regenerate with "update the reference doc".

---

## 1. Pipeline Architecture & Modes

FORGE organises work into **pipeline types** (the run prefix) and **pipeline modes** (the intensity dial). The pipeline type determines which agents are eligible to run. The pipeline mode controls which subset of those agents actually runs.

### Pipeline types

Each type corresponds to a different workflow stage or intent. The "Gate" column shows where the user must approve before the next stage proceeds.

| Type | Max agent set | Gate |
|------|--------------|------|
| `plan feature` | planner, researcher, gotcha-checker, reviewer-triage, reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance | #1 |
| `implement feature` | coder, completeness-checker, reviewer-triage, reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance | #2 |
| `apply feature` | implementer, documenter | none |
| `debug` | debug, reviewer-triage, reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance | #2 |
| `apply debug` | implementer, documenter | none |
| `refactor` | refactor, reviewer-triage, reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance | #2 |
| `apply refactor` | implementer, documenter | none |
| `failed test` | debug, reviewer-triage, reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance | #2 |
| `architect` | architect, reviewer-logic | #1 |
| `explore` | claude (single) | none |
| `direct` | claude (single) | none |

`explore` and `direct` are single-agent chat-mode passthroughs with no pipeline. `architect` runs as a named pipeline and produces Gate #1 so the user can accept or discard findings before they affect the board.

### Pipeline modes

The mode is set per project in `project.json` and injected as `PIPELINE MODE: <VALUE>` into the system prompt at runtime.

| Mode | When | Effect |
|------|------|--------|
| TRIVIAL | One Chat: trivial single-file fix | Bypass pipeline entirely |
| SPRINT | GSD — easy task, trust yourself | Core agent only, no reviewers |
| LEAN | Everyday (default) | Core + reviewer-safety + reviewer |
| STANDARD | Multi-file, state/IPC | Core + completeness-checker + reviewer-triage + triage-dispatched reviewers |
| FULL | High-stakes, nothing skipped | Core + completeness-checker + all 5 reviewers (no triage) |

The mode filter is applied in `buildAgentsJson()` in `src/main/shared.ts` via the `agentsForMode()` function, which returns a Set of allowed agent names for each pipeline type. Agents not in the set are removed from the `--agents` JSON before spawning.

---

## 2. The Gate System

Gates are human approval checkpoints between pipeline stages. They enforce the "glass wall" principle: the user always sees what happened and must explicitly approve before work proceeds.

### Gate #1 — Plan approval

**Triggers:** Completion of `plan feature` or `architect` pipeline types.

**What the user sees:** A gold-accented bar (or pipeline-coloured) with the `[summary]` text from the planner, plus the `[approach]` block showing key decisions, trade-offs, and uncertainties. If a `BLOCK` verdict was emitted by a plan-stage reviewer, the bar indicates a blocked state.

**User actions:**
- **IMPLEMENT FEATURE** — proceeds to the `implement feature` pipeline with the approved plan
- **Dismiss** — discards the plan; no further pipeline runs

For `architect` runs, Gate #1 shows "Architect findings ready for review" and the user can accept or discard the health findings.

### Gate #2 — Review approval

**Triggers:** Completion of `implement feature`, `debug`, `refactor`, or `failed test` pipeline types.

**What the user sees:** A red/pipeline-coloured bar with the reviewer summary. The YES button is **disabled** when:
1. Any reviewer emitted a `[reviewer-verdict]` with `verdict: "BLOCK"`, or
2. Mandatory reviewers (reviewer + reviewer-safety in STANDARD/FULL; reviewer only in LEAN) did not emit verdicts at all (treated as implicit BLOCK — safer than silently opening the gate)

In SPRINT, LEAN, and TRIVIAL modes, the mandatory verdict check is skipped entirely.

**User actions:**
- **YES** — fires the corresponding `apply` pipeline directly (e.g., `apply feature: <title>`)
- **NO** — discards; no apply runs

The gate logic lives in `src/renderer/src/lib/gateDetector.ts`. `detectGates()` reads the pipeline mode from the project store to determine which reviewers are mandatory.

### Tester Gate

**Triggers:** The implementer emitting `[tester-gate]` at the end of a successful apply.

**What the user sees:** A blue-accented bar asking whether to run the tester agent.

**User actions:**
- **YES** — runs tester then documenter
- **SKIP** — runs documenter only (default path; tester is typically skipped)

### Q&A Strip

Any agent can emit `[questions]...[/questions]` blocks. The QaStrip renders these as chip-selection rows with the source agent's accent colour from `AGENT_META`. The prompt bar is blocked while Q&A is active. SUBMIT appends `[answers]` and re-runs; SKIP dismisses.

---

## 3. Wave Execution

The wave execution protocol governs how the implementer applies multi-task handoffs. It is defined in `.claude/agents/implementer.md`.

### What waves are

Tasks in `docs/context/handoff.md` can carry `(wave: N)` annotations. When present, the implementer groups tasks by wave number and executes them in ascending order: all wave 1 tasks complete before wave 2 begins, and so on. When no wave annotations are present, tasks execute in their numbered order with no wave grouping.

### Application order within a wave

Changes are applied in dependency order to avoid breaking the build mid-way:
1. Types (`types/claude.d.ts`)
2. Main process handlers (`src/main/handlers/`)
3. Preload (`src/preload/index.ts`)
4. Stores (`stores/*.svelte.ts`)
5. Components (`components/**/*.svelte`)

### Wave self-check

After completing all tasks in a wave, the implementer verifies each change:
1. Reads the target file for each task
2. Confirms the expected change is present (using the task's `Verify:` line if present, or default heuristics)
3. Only emits `[wave-complete] N` when every task passes verification

### Signals

- **`[wave-complete] N`** — emitted after wave N passes self-check. Falls through to the terminal and renders as a `system` line (dim italic).
- **`[blocked] Wave N+1 task X — prerequisite from wave N not found in <file>`** — emitted when a wave prerequisite is missing. The implementer stops immediately. Renders as an `error` line (red) in the terminal.

### Post-apply verification (GAP-16 guard)

Before emitting `[tester-gate]`, the implementer runs three checks:
1. **File coverage** — every file listed in the handoff was touched
2. **IPC quadruple check** — new IPC channels have all four required locations (handler, preload, type declaration, helper)
3. **Store export check** — new store functions are exported and imported correctly

---

## 4. Every Agent — Roles and Models

Agents are defined as `.md` files in `.claude/agents/` with YAML frontmatter specifying name, description, model, and allowed tools. The `SCAFFOLD_AGENT_NAMES` set in `src/main/shared.ts` lists all FORGE-managed agents (27 total).

### Plan stage

| Agent | Model | Description |
|-------|-------|-------------|
| planner | claude-sonnet-4-6 | Breaks a feature request into a numbered task plan and writes it to docs/PLAN.md. First agent in the plan feature pipeline. |
| researcher | claude-haiku-4-5-20251001 | Investigates technical unknowns raised by the Planner and writes findings to docs/RESEARCH/. Second agent in the plan feature pipeline. |
| researcher-triage | claude-haiku-4-5-20251001 | Reads docs/PLAN.md once and emits one focused brief block per research question so parallel researchers avoid redundant full-plan reads. |
| gotcha-checker | claude-haiku-4-5-20251001 | Checks the plan against known pitfalls, gotchas, and project conventions. Third agent in the plan feature pipeline. |

### Implement stage

| Agent | Model | Description |
|-------|-------|-------------|
| coder | claude-sonnet-4-6 | Reads the approved plan and research, then writes a full implementation draft to docs/context/handoff.md. Does NOT touch source files. |
| coder-scout | claude-haiku-4-5-20251001 | Reads active plan tasks and GENERAL.md IPC boundary rules to identify exactly which source files and functions the coder needs. Writes docs/context/scout.json before the coder runs. |
| completeness-checker | claude-haiku-4-5-20251001 | Reads docs/PLAN.md and docs/context/handoff.md after the coder runs. Checks that every active plan task is addressed in the handoff. Emits BLOCK for unaddressed tasks. |
| regression-risk | claude-haiku-4-5-20251001 | Reads handoff and modules.json to identify which existing modules are touched. Flags high-risk modules via [health] signals before reviewer-triage runs. |
| tdd-agent | claude-haiku-4-5-20251001 | Generates concrete Given/When/Then test criteria per planned task and writes them to docs/TEST-CRITERIA.md before the coder runs. Opt-in via project.json. |

### Review stage

| Agent | Model | Description |
|-------|-------|-------------|
| reviewer-triage | claude-haiku-4-5-20251001 | Reads handoff and outputs an explicit reviewer dispatch list with file/line citations. Runs after coder/debug/refactor, before any reviewer. Its output is the sole source of truth for which reviewers run. |
| reviewer | claude-haiku-4-5-20251001 | Boundary and correctness check. Checks that IPC triple is complete, layers are respected, and types are correct. |
| reviewer-safety | claude-haiku-4-5-20251001 | Security and safety check on the handoff. |
| reviewer-logic | claude-haiku-4-5-20251001 | Logic and correctness check. Checks for bugs, edge cases, and incorrect assumptions. |
| reviewer-style | claude-haiku-4-5-20251001 | Style and convention check. Enforces FORGE coding conventions. |
| reviewer-performance | claude-haiku-4-5-20251001 | Performance check. Flags patterns that would cause sluggish UI, blocking I/O, memory leaks, or unscalable data loads. |

### Apply stage

| Agent | Model | Description |
|-------|-------|-------------|
| implementer | claude-sonnet-4-6 | Applies the approved handoff from docs/context/handoff.md to the actual source files. First agent in the apply pipeline. |
| implementer-triage | claude-haiku-4-5-20251001 | Extracts one focused brief per wave task so parallel implementers each read only their section. |
| tester | claude-haiku-4-5-20251001 | Writes a manual test checklist to docs/TESTING.md after implementation. |
| documenter | claude-haiku-4-5-20251001 | Updates CHANGELOG.md, ARCHITECTURE.md, DECISIONS.md, board.json, and features.json after implementation. |
| cleanup | claude-haiku-4-5-20251001 | On-demand maintenance agent. Deletes RESEARCH files for shipped features and archives PLAN-archive.md when it exceeds 500 lines. |

### Debug / Refactor

| Agent | Model | Description |
|-------|-------|-------------|
| debug | claude-sonnet-4-6 | Diagnoses bugs, traces root causes, and writes a fix plan to docs/context/handoff.md. First agent in the debug pipeline. |
| refactor | claude-sonnet-4-6 | Refactors hot files identified by the HEALTH tab. Writes a refactor plan to docs/context/handoff.md. |

### On-demand / Utility

| Agent | Model | Description |
|-------|-------|-------------|
| architect | claude-sonnet-4-6 | Audits any project against its docs and code, identifies functional modules, writes ARCHITECTURE.md and modules.json. |
| integrity-checker | claude-haiku-4-5-20251001 | Runs ten pipeline integrity checks and emits [health] signals. Invoke via direct mode. |
| skills-generator | claude-haiku-4-5-20251001 | Generates per-capability skill files in docs/gotchas/skills/ for tech stacks. |
| tool-call-auditor | claude-haiku-4-5-20251001 | Reads per-session tool-call audit logs and flags behavioural anti-patterns (repeated reads, tool storms, blind writes). |
| agent-optimizer | claude-haiku-4-5-20251001 | Reads recurring audit findings and writes targeted prompt-fix proposals. Triggered by tool-call-auditor. |
| observer | claude-haiku-4-5-20251001 | Reads recent session artifacts and logs reasoning-level patterns to docs/observer-log.jsonl. On-demand only. |

---

## 5. The Signal Protocol

Agents communicate with the FORGE UI by writing bracket-prefixed lines to stdout. The `onStdout` handler in `App.svelte` classifies each line before it reaches the terminal. All signal classifiers follow the **startsWith + continue** pattern: once a line is consumed as a signal, it must not be written to the terminal.

| Signal | Format | Effect |
|--------|--------|--------|
| `[suggest]` | `[suggest] chip text` | Adds chip to ChipsStrip |
| `[todo]` | `[todo] task text` | Appends todo item to board |
| `[module]` | `[module] module-id` | Sets pendingPlanModule for Gate #1 assignment |
| `[health]` | `[health] file\|aspect\|sev\|note` | Adds signal to HEALTH tab |
| `[summary]` | `[summary] text` | Captures gate display text |
| `[approach]` / `[/approach]` | multi-line block | Planner design reasoning shown in Gate #1 |
| `[questions]` / `[/questions]` | multi-line block | Triggers Q&A strip |
| `[reviewer-verdict]` | `[reviewer-verdict] {...JSON}` | Persisted to verdicts.jsonl; never shown |
| `[tester-gate]` | literal signal | Shows TesterGateBar on run complete |
| `[run-documenter]` | literal signal | Auto-chains documenter on run complete |
| `[CONTEXT-CHECKPOINT]` | literal signal | Sets checkpointPending for run reinvocation |
| `[research-status]` | `[research-status] READY` / `SKIPPED \| note` / `BLOCKED \| reason` | Researcher only; BLOCKED converts to a suggest chip and suppresses implement chip |
| `[triage-dispatch]` | `[triage-dispatch] reviewer,reviewer-safety,...` | Reviewer-triage only; declares which reviewers to invoke |
| `[scout]` | `[scout] files=N new=M` | Coder-scout only; consumed silently to populate run-metrics.json |
| `[wave-complete] N` | implementer only | Falls through to terminal; rendered as `system` (dim italic) |
| `[blocked] ...` | implementer only | Falls through to terminal; rendered as `error` (red) |
| `[run-pipeline]` | `[run-pipeline] plan feature \| standard \| Add dark mode` | One Chat orchestrator only; triggers pipeline handoff |
| `BLOCK` | literal in buffer | Sets Gate #2 to blocked state |

### Reviewer verdict JSON fields

Required fields: `agent` (string), `verdict` (APPROVED/BLOCK/REVISE), `blockers` (number), `warnings` (number), `feature` (string), `model` (string). Any missing or mistyped field causes silent skip.

### Context checkpoint

`[CONTEXT-CHECKPOINT]` is emitted by the `ctx-post-tool.js` PostToolUse hook when context usage exceeds threshold. App.svelte sets `checkpointPending = true`; on `onDone` this triggers up to `MAX_CHECKPOINT_REINVOCATIONS` (5) automatic run reinvocations.

### Health aspects

Valid `[health]` aspect values: `complexity`, `duplication`, `coupling`, `coverage`, `documentation`, `performance`, `security`, `integrity`, `nyquist`.

---

## 6. How FORGE Assembles Agent Runs

This section describes the step-by-step flow from user prompt submission to Claude CLI process spawn. The core logic lives in `src/main/handlers/runner.ts` (the `run-claude` IPC handler) and `src/main/shared.ts` (agent building and system prompt assembly).

### Step 1 — Settings and mode detection

The runner receives: `prompt`, `projectFolder`, `mode` (pipeline type or `one-chat`/`chat`/`direct`/`explore`), `continueSession`, `sessionId`, `testerEnabled`, and optional `pipelineModeOverride`.

If a `pipelineModeOverride` is provided, it is validated against the set `{trivial, sprint, lean, standard, full}` with newline stripping for injection prevention.

### Step 2 — Claude CLI discovery

The runner reads a saved Claude path from `forge-settings.json` (user-configured). If absent, `findClaude()` probes well-known paths: `~/.local/bin/claude.exe`, `~/.local/bin/claude.cmd`, `AppData/Roaming/npm/claude.cmd`, `AppData/Local/AnthropicClaude/claude.exe`, `AppData/Local/Programs/claude/claude.exe`. Falls back to `where claude` (Windows) or `which claude` (Unix), then bare `claude` as final fallback.

### Step 3 — Permission flags

- **Explore mode:** `--allowedTools Read,Glob,Grep,WebSearch,WebFetch,Task` (read-only)
- **All other modes:** `--dangerously-skip-permissions` (full access; gates and intent guards provide safety)

### Step 4 — Agent JSON build

For pipeline/explore/direct runs (not one-chat, not chat), `buildAgentsJson()` is called:

1. **Load FORGE agents** — reads all `.md` files from `<appRoot>/.claude/agents/`, parses YAML frontmatter via `parseAgentMd()`, stores in an agent map keyed by agent name
2. **Merge project overrides** — reads `.md` files from `<projectFolder>/.claude/agents/`; project agents overwrite FORGE defaults for the same name
3. **Apply mode filter** — `agentsForMode(mode)` returns a Set of allowed agent names; agents not in the set are deleted from the map
4. **Inject agent slots** — enabled slots from `project.json.agentSlots` are loaded if they were not already loaded as project overrides and are not FORGE core agents
5. **Serialize** — the map is JSON-stringified for the `--agents` CLI flag

On Windows, if the JSON exceeds 20,000 characters (the safe command-line limit), agent `.md` files are synced to the project's `.claude/agents/` directory instead and `--agents` is omitted — Claude CLI finds them on disk.

### Step 5 — System prompt assembly

`buildSystemPromptAppend()` builds the `--append-system-prompt` value:

1. Reads `docs/gotchas/GENERAL.md` from the project folder (non-fatal if absent)
2. Reads `project.json` for `techStackLabels`, `capabilities`, `structure`, `references`, `pipelineMode`, `testerMode`, `projectName`, `projectDescription`
3. Reads `SKILLS.md` from FORGE's template directory (matched by stack labels)
4. Filters skills: capability-scoped injection via `filterSkillsByCapabilities()` if capabilities are declared; falls back to `filterSkillsByStacks()` otherwise
5. Assembles: project context + pipeline mode directive + GENERAL.md + skills content

For one-chat mode, `ORCHESTRATOR_RULES` are appended. For direct mode, `DIRECT_MODE_RULES` are appended. The runner also injects `ENRICH LEVEL` directives for one-chat mode based on the user's `enrichLevel` setting.

### Step 6 — CLAUDE.md sync

Before spawning, the runner ensures the project has a `CLAUDE.md` file. If absent, it copies the template from `templates/code/CLAUDE.md`. Without it, the orchestrator has no knowledge of pipeline routing.

### Step 7 — Spawn

The runner spawns the Claude CLI with `--output-format stream-json`, `--verbose`, permission flags, optionally `--agents`, `--append-system-prompt`, `--resume`/`--continue`. The prompt is piped via stdin. A `run-active.json` marker is written to `.pipeline/` for crash recovery.

### Step 8 — Stream parsing

The stdout stream is parsed line-by-line:
- **JSON events** are classified by `type`:
  - `assistant` — text blocks forwarded as `claude-stdout`; thinking blocks forwarded as `claude-thinking`; tool_use blocks formatted via `formatProgressLabel()` and sent as `claude-progress` with `parallelGroupSize` for wave detection
  - `user` — tool_result events mark agent cards done via `TaskComplete` progress; FORGE signal lines are extracted from tool_result content and forwarded
  - `result` — usage and session ID forwarded as `claude-result`
- **Non-JSON lines** are forwarded directly as `claude-stdout`

### Step 9 — Cleanup

On process close, `claude-done` is sent with the exit code. The `run-active.json` marker is deleted. If the process exited successfully with zero output lines, a diagnostic message is emitted.

---

## 7. One Chat Orchestrator

The One Chat orchestrator is the conversational front door to FORGE. Instead of the user selecting a pipeline type via a mode selector, they type naturally and a Sonnet session handles intent detection conversationally.

### How it works

When the user submits a prompt in FORGE, it always goes to one-chat mode (single Enter submits). The orchestrator session receives:

- **~34KB of context**: GENERAL.md + SKILLS.md + ORCHESTRATOR_RULES
- **No agents** (~240KB of agent definitions are skipped for speed)

The orchestrator behaves like a senior engineer pair-programming:
- **Questions and discussion** — responds directly, no pipeline
- **Work requests** — reads, assesses, proposes an approach (pipeline type, mode, agent team), and waits for explicit approval
- **Small tasks** (add TODOs, update docs) — handled directly

### Pipeline handoff

After the user approves an approach, the orchestrator emits:
```
[run-pipeline] <pipeline-type> | <mode> | <original user request>
```

App.svelte intercepts this signal, saves `pipelineHandoffPending`, calls `ipc.stop()` to end the orchestrator session, and on `onDone` auto-starts a full pipeline run via `triggerRun()` with full agent injection.

### ORCHESTRATOR_RULES

Defined as a constant in `src/main/shared.ts`, the rules instruct the orchestrator to:
- Never start a pipeline without explicit user approval
- Never prepend pipeline prefixes to responses
- Propose approach with pipeline/mode/agents and reasons before execution
- Emit `[todo]` signals at the detail level specified by the `ENRICH LEVEL` directive
- Emit `[suggest]` for suggestion chips
- Emit `[run-pipeline]` only after approval

### Enrichment level

The `enrichLevel` setting (1=Light, 2=Standard, 3=Full) from `forge-settings.json` is injected as an `ENRICH LEVEL` directive into the orchestrator's system prompt by the runner. This controls `[todo]` signal detail for both the orchestrator and the Haiku `enrich-todo` IPC.

### Thinking suppression

In one-chat mode, `[thinking]/[/thinking]` blocks and `claude-thinking` events are silently consumed rather than displayed, creating a clean conversation feel. Pipeline modes still show thinking for glass-wall transparency.

### Terminal readability (one-chat mode)

Eight improvements make the terminal output scannable as a conversation rather than a wall of text:

| Improvement | How it works |
|-------------|-------------|
| **Dim work lines** | `normal`, `tool`, and `system` lines render at 0.45–0.55 opacity; conversational lines (`prose`, `agent`, `run-header`) at full brightness |
| **Gold accent on responses** | `.line-prose` (orchestrator conversational output) gets a 2px gold left border + 10px padding |
| **User prompt echo** | `.block-toggle` (run-header blocks) styled with bold weight, background tint, and 10px top margin — reads as "you said this" |
| **Separator lines** | `.answer-block` gets a bottom border and spacing between conversation turns |
| **Bold section headers** | Markdown headers (`#`, `##`, `###`) in prose lines render gold bold; `**bold**` lines get weight 600 |
| **Auto-collapsible work blocks** | In one-chat mode, blocks with no conversational lines auto-collapse showing a line count; click to expand |
| **Sticky gate bar** | Gate-inset uses `position: sticky; bottom: 0` when a gate is pending — amber background with pulsing border animation |
| **Rotating idle messages** | Two separate pools of 40 messages each: `TERMINAL_IDLE` (atmospheric) and `PROMPT_IDLE` (conversational) in `constants.ts` |

All implemented in `Terminal.svelte` CSS + template logic. The `isWorkBlock()` helper checks if a block has zero conversational lines and >3 total lines to determine auto-collapse.

---

## 8. Skills System

The skills system provides stack-specific guidance to pipeline agents. There are two delivery paths and a runtime filtering mechanism.

### Delivery path 1 — Template copy (new projects)

New projects created via the wizard receive skills files copied from `templates/code/docs/gotchas/skills/`. The template library contains 11 pre-baked skill files:

- **6 universal:** error-handling, api-rest, code-structure, codebase-navigation, change-safety, convention-matching
- **5 stack-specific:** electron-ipc, electron-security, svelte5-reactivity, svelte5-components, typescript-strict

### Delivery path 2 — Skills generator (imported projects)

Imported or existing projects use the `skills-generator` agent to generate per-capability files into `docs/gotchas/skills/`. The agent produces all 6 universal capabilities plus stack-specific ones derived from `project.json` capabilities or techStacks.

### Runtime filtering

`buildSystemPromptAppend()` in `src/main/shared.ts` handles injection:

1. **Capability-scoped injection** (preferred): `resolveCapabilitiesForTask()` parses file paths from the handoff and intersects with `project.json` capabilities. Then `filterSkillsByCapabilities()` reads only matching per-capability files from `docs/gotchas/skills/<id>.md` via `Promise.all`.

2. **Stack-label fallback**: If no capabilities are declared, `filterSkillsByStacks()` filters the monolithic `SKILLS.md` from FORGE's template directory by `### StackName` subsections matching the project's declared `techStackLabels`.

### File structure

Per-capability skill files follow this structure:
```
# <capability-id> (generated: YYYY-MM-DD)
## <AgentRole>
<guidance content>

## Universal
<guidance applicable to all agents>
```

---

## 9. Project Configuration (project.json)

Each project stores its configuration in `.pipeline/project.json`. The file is read and written by the `project-json.ts` handler module with full validation.

### Field reference

| Field | Type | Purpose |
|-------|------|---------|
| `techStacks` | `string[]` | Stack identifiers (e.g., `["node", "svelte"]`) |
| `techStackLabels` | `string[]` | Human-readable stack labels (e.g., `["Node.js / TypeScript", "Svelte 5"]`) |
| `capabilities` | `string[]` | Kebab-case capability IDs for skills filtering (e.g., `["electron-ipc", "svelte5-reactivity"]`) |
| `structure` | `string` | Project structure type: `standalone`, `plugin`, `library`, `service`, or `module` |
| `references` | `Array<{type, label?, value}>` | External references: `url` (links), `note` (text), `path` (local file paths) |
| `agentSlots` | `Array<{agentName, hookPoint, enabled}>` | Custom project agents injected at specific pipeline hook points |
| `pipelineMode` | `string` | Default pipeline mode: `trivial`, `sprint`, `lean`, `standard`, or `full` |
| `testerMode` | `string` | Tester agent mode: `off`, `ask`, or `on` |
| `projectName` | `string` | Project name injected into agent system prompts as a hard constraint |
| `projectDescription` | `string` | Project purpose injected into agent system prompts as a hard constraint |

All string values are sanitised (newlines stripped) before injection into system prompts to prevent YAML/JSON injection. The `pipelineMode` and `testerMode` fields are validated against fixed allowlists.

---

## 10. Custom Project Agents and Slots

Projects can add custom agents beyond FORGE's built-in set. These are loaded from `<projectFolder>/.claude/agents/` and configured via agent slots in `project.json`.

### How project agents override FORGE defaults

In `buildAgentsJson()`:
1. FORGE's built-in agents are loaded first from `<appRoot>/.claude/agents/`
2. Project agents from `<projectFolder>/.claude/agents/` overwrite any FORGE default with the same name
3. Agent slots inject additional agents that were not loaded in step 2

### Agent slots

Slots are configured in `project.json` under `agentSlots`. Each slot has:

| Field | Type | Description |
|-------|------|-------------|
| `agentName` | string | Filename stem of the agent `.md` file (e.g., `my-linter`) |
| `hookPoint` | string | Where in the pipeline the agent runs |
| `enabled` | boolean | Whether the slot is active |

### Valid hook points

| Hook Point | When it fires |
|------------|---------------|
| `BEFORE_PLAN` | Before the planner runs |
| `AFTER_RESEARCH` | After researcher completes |
| `BEFORE_GATE1` | Before Gate #1 is shown |
| `AFTER_CODER` | After the coder writes the handoff |
| `IN_REVIEW_WAVE` | Alongside reviewers in parallel |
| `AFTER_IMPLEMENT` | After the implementer applies changes |

### Safety constraints

- FORGE core agents (those in `SCAFFOLD_AGENT_NAMES`) can never be overwritten by slot injection
- Agent file paths are validated with `resolve()` + `startsWith()` to prevent path traversal
- Slot agents are always included regardless of mode filter (they are user-defined)
- The slot description is prefixed with `[hook:HOOK_POINT]` for downstream metadata detection

---

## 11. Three-Process Architecture

FORGE is an Electron application with three distinct process tiers. Each tier has a defined responsibility boundary and they communicate exclusively through IPC.

### Main process (Node.js)

**File:** `src/main/index.ts`

The main process is the privileged backend. It:
- Creates and manages the BrowserWindow (`contextIsolation: true`, `nodeIntegration: false`)
- Registers 16 handler modules at startup (runner, window, settings, projects, agents, scaffold, import, files, pipeline-data, pipeline-logs, project-json, session, research, project-agents, deps, intent)
- Spawns Claude CLI subprocesses and streams their output
- Performs all filesystem operations (read/write/scaffold/import)
- Provides shared utilities via `src/main/shared.ts` (Claude discovery, agent building, system prompt assembly, skills filtering)

### Preload (contextBridge)

**File:** `src/preload/index.ts`

The preload script bridges the main process and renderer. It exposes exactly one object — `window.claude` — via `contextBridge.exposeInMainWorld` with ~87 IPC operations spanning:
- Claude runner (run, stop, runChat)
- File system (browse, browseFile)
- Settings (get, save)
- Streaming events (onStdout, onStderr, onDone, onProgress, onResult, onThinking, offAll)
- Window controls (winMinimize, winMaximize, winClose) — the only fire-and-forget `send/on` calls
- Agent CRUD (list, read, write, delete, sync, listForge)
- Project registry (get, register, checkForge, checkFolder, forget)
- Scaffolding, import, plan, files, pipeline data, session, project JSON, skills, token tracking, verdicts, audit log, signal log, project agents, dependency checking

The preload normalises the `claude-done` exit code field for backward compatibility across main builds.

### Renderer (Svelte 5 SPA)

**File:** `src/renderer/src/App.svelte`

The renderer is a plain Svelte 5 SPA (not SvelteKit) running in a Chromium sandbox. It:
- Owns all UI rendering via Svelte 5 runes (`$state`, `$derived`, `$effect`)
- Manages seven reactive stores: session, run, gate, agents, project, editor, ui
- Calls `window.claude.*` through typed wrappers in `src/renderer/src/lib/ipc.ts`
- Parses streaming events from the main process (signal classification, line formatting, gate detection)
- Never imports Node.js APIs — `fs`, `path`, `child_process` are undefined in the renderer

### Communication flow

```
Renderer  -->  window.claude.*  -->  Preload (contextBridge)  -->  ipcRenderer.invoke  -->  Main (ipcMain.handle)
Renderer  <--  event callbacks  <--  Preload (ipcRenderer.on)  <--  webContents.send    <--  Main
```

All request/response calls use `invoke/handle`. Fire-and-forget window controls use `send/on`.

---

## 12. Module Map

FORGE's own modules are tracked in `.pipeline/modules.json`. Each module represents a functional area of the application.

### Module summary

| Module | Description | Key IPC Channels |
|--------|-------------|-----------------|
| **Pipeline System** | CLAUDE.md orchestration rules, agent network, pipeline routing, gate protocol, and the plan/implement/apply/debug/refactor lifecycle | run-claude, stop-claude |
| **IPC Layer** | The three-tier communication bridge: 16 main-process handler modules, preload contextBridge, and typed renderer wrappers | (all ~65+ channels) |
| **Terminal & Output** | Streaming output rendered to terminal: line classification, signal parsing, markdown rendering, tool progress chips, per-project history | load-terminal-history, save-terminal-history, clear-terminal-history |
| **Gate System** | Gate #1, Gate #2, Tester Gate, Q&A strip, suggestion chips — human approval checkpoints | run-claude |
| **Task Board** | TODO and PLANNED tabs backed by board.json — task capture, plan promotion, feature lifecycle | get-board, save-board, enrich-todo |
| **Feature Registry** | Module definitions with capabilities tracked in modules.json and the MODULES tab | get-modules, save-modules, get-forge-modules |
| **Run Monitor** | LIVE tab, USAGE tab — pipeline diagram, real-time agent cards, parallel wave detection, token/cost accounting | save-token-run, load-token-usage |
| **Health & Verdicts** | HEALTH tab — context window usage, code health signals, reviewer verdict log with approval rate stats | save-context-status, get-context-status, append-verdict, get-verdicts, signal-log-clear, signal-log-append |
| **Prompt & Run Controls** | Prompt input, run/stop/rerun/new-conversation controls, pause/resume, pipeline visualiser | run-claude, stop-claude, pause-session, check-resume, read-resume, get-next-step |
| **Project Management** | New project wizard, import wizard, project switching, memory scaffolding, project overview | scaffold-project, analyze-import-folder, import-project, read-project-json, write-project-json, scan-project-agents, check-deps, recheck-deps |
| **Agent Manager** | Full CRUD UI for .claude/agents/*.md prompt files | list-agents, read-agent, write-agent, delete-agent, sync-agents, list-forge-agents |
| **Settings** | User preferences, session persistence, backstage viewer, context warning toggle | get-settings, save-settings, get-history, save-history, get-decisions, save-decision |
| **Skills System** | Per-capability skill files: template library, runtime injection, skills-generator agent, SKILLS tab display | get-stack-templates |
| **App Layout** | Titlebar, left column (terminal + prompt), right panel (7 tabbed panels), FILES tab | scan-directory, open-path |
| **One Chat Orchestrator** | Conversational front door: Sonnet session handles chat, proposes pipelines, hands off via [run-pipeline] | run-claude, stop-claude |

### Module dependencies

```
Pipeline System  -->  IPC Layer, Settings
Terminal & Output  -->  IPC Layer, Pipeline System
Gate System  -->  IPC Layer, Terminal & Output, Prompt & Run Controls
Task Board  -->  IPC Layer, Feature Registry
Run Monitor  -->  IPC Layer, Pipeline System, Terminal & Output
Health & Verdicts  -->  IPC Layer, Terminal & Output
Prompt & Run Controls  -->  IPC Layer, Pipeline System, Gate System
Project Management  -->  IPC Layer, Feature Registry, Agent Manager
Agent Manager  -->  IPC Layer
Settings  -->  IPC Layer
Skills System  -->  Pipeline System, Settings
App Layout  -->  IPC Layer, Terminal & Output, Prompt & Run Controls, Run Monitor, Task Board, Health & Verdicts, Feature Registry
One Chat Orchestrator  -->  IPC Layer, Pipeline System, Terminal & Output, Settings, Task Board
```

---

## 13. Key Files Reference

### Main process

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Application entry point; window creation; registers all 16 handler modules |
| `src/main/shared.ts` | Shared utilities: Claude/git discovery, buildAgentsJson, buildSystemPromptAppend, parseAgentMd, DIRECT_MODE_RULES, ORCHESTRATOR_RULES, skills filtering, project path encoding |
| `src/main/handlers/runner.ts` | `run-claude`, `run-chat`, `stop-claude` IPC handlers; spawn and stream parsing |
| `src/main/handlers/window.ts` | Window control handlers (minimize, maximize, close) |
| `src/main/handlers/settings.ts` | Settings CRUD (forge-settings.json, tech-decisions.json, prompt-history.json) |
| `src/main/handlers/projects.ts` | Project registry CRUD (forge-projects.json) |
| `src/main/handlers/agents.ts` | Agent file CRUD (list, read, write, delete, sync) |
| `src/main/handlers/scaffold.ts` | New project scaffolding; GENERAL.md generation; memory scaffolding |
| `src/main/handlers/import.ts` | Import existing project (analyze, copy, register) |
| `src/main/handlers/files.ts` | Directory scanning, file reading, open-path |
| `src/main/handlers/pipeline-data.ts` | Board, modules, verdicts, context status, audit log, signal log, token runs |
| `src/main/handlers/pipeline-logs.ts` | Terminal history persistence |
| `src/main/handlers/project-json.ts` | project.json read/write with full validation; skills template management |
| `src/main/handlers/session.ts` | Session pause/resume, terminal history |
| `src/main/handlers/research.ts` | Stack research via Claude |
| `src/main/handlers/project-agents.ts` | Scan project-specific agents |
| `src/main/handlers/deps.ts` | Dependency checking (git, claude CLI) |
| `src/main/handlers/intent.ts` | Intent classification handler |

### Preload

| File | Purpose |
|------|---------|
| `src/preload/index.ts` | contextBridge exposing `window.claude` with ~87 IPC operations |
| `src/preload/index.d.ts` | Type declarations for the preload API |

### Renderer — Stores

| File | Owns |
|------|------|
| `src/renderer/src/stores/session.svelte.ts` | Terminal lines, settings, projectFolder, debounced terminal history save |
| `src/renderer/src/stores/run.svelte.ts` | Active run status, mode, prompt, sessionId, lineCount |
| `src/renderer/src/stores/gate.svelte.ts` | Gate #1 / Gate #2 / TesterGate visibility and state |
| `src/renderer/src/stores/agents.svelte.ts` | Per-agent status cards, token accounting, parallel wave detection |
| `src/renderer/src/stores/project.svelte.ts` | Todos, planned items, modules, healthSignals, contextStatus, pipelineMode, testerMode |
| `src/renderer/src/stores/editor.svelte.ts` | Prompt text, mode, continueSession, prompt history navigation |
| `src/renderer/src/stores/ui.svelte.ts` | Active tab, open modal, chips, Q&A state, resume banner, Forge modules |

### Renderer — Key libraries

| File | Purpose |
|------|---------|
| `src/renderer/src/lib/ipc.ts` | Typed wrappers over `window.claude` for every IPC channel |
| `src/renderer/src/lib/constants.ts` | Pipeline definitions, agent metadata, mode configs, idle messages |
| `src/renderer/src/lib/gateDetector.ts` | Gate detection logic: verdict parsing, mandatory reviewer checks |
| `src/renderer/src/lib/lineClassifier.ts` | Terminal line classification (prose, tool, agent, system, error, etc.) |
| `src/renderer/src/lib/signalParser.ts` | Signal protocol parsing |
| `src/renderer/src/lib/runner.ts` | `triggerRun()` — unified programmatic run entry point |

### Renderer — Key components

| File | Purpose |
|------|---------|
| `src/renderer/src/App.svelte` | Root component; onStdout hot path; signal classification; auto-save effects |
| `src/renderer/src/components/layout/Titlebar.svelte` | App header with FORGE wordmark, project name, window controls |
| `src/renderer/src/components/layout/LeftColumn.svelte` | Terminal + prompt controls stack |
| `src/renderer/src/components/layout/RightPanel.svelte` | Tab switcher: LIVE/USAGE/TODO/PLANNED/HEALTH/FILES/MODULES |
| `src/renderer/src/components/gates/Gate1Bar.svelte` | Gate #1 approval bar |
| `src/renderer/src/components/gates/Gate2Bar.svelte` | Gate #2 approval bar |
| `src/renderer/src/components/gates/TesterGateBar.svelte` | Tester gate approval bar |
| `src/renderer/src/components/prompt/PromptBar.svelte` | Prompt input with single-Enter one-chat submit |
| `src/renderer/src/components/prompt/QaStrip.svelte` | Agent-agnostic Q&A clarification strip |
| `src/renderer/src/components/prompt/ChipsStrip.svelte` | Suggestion chips from [suggest] signals |
| `src/renderer/src/components/terminal/Terminal.svelte` | Terminal output rendering with collapsible blocks |

### Agents

| Path | Contents |
|------|----------|
| `.claude/agents/*.md` | 28 agent definition files with YAML frontmatter and prompt bodies |
| `.pipeline/agent-roles.json` | Per-agent file-path allow-lists for write-path enforcement |

### Templates

| Path | Purpose |
|------|---------|
| `templates/code/CLAUDE.md` | Pipeline routing instructions template copied to new projects |
| `templates/code/docs/gotchas/SKILLS.md` | Monolithic skills file for stack-label filtering |
| `templates/code/docs/gotchas/skills/` | 11 per-capability skill files for capability-scoped injection |

### Pipeline data (per project)

| File | Purpose |
|------|---------|
| `.pipeline/project.json` | Project configuration (stacks, capabilities, mode, slots) |
| `.pipeline/board.json` | Task board: todos and planned items |
| `.pipeline/modules.json` | Module registry with capabilities |
| `.pipeline/verdicts.jsonl` | Reviewer verdict history |
| `.pipeline/token-log.jsonl` | Per-run token usage and cost records |
| `.pipeline/terminal-history.json` | Persisted terminal output |
| `.pipeline/run-active.json` | Run-in-progress marker for crash recovery |
| `docs/context/handoff.md` | Implementation draft from coder/debug/refactor agents |
| `docs/context/scout.json` | Coder-scout file scope output |
| `docs/context/signal-log.jsonl` | Bracket-protocol signal event log |
| `docs/PLAN.md` | Active plan for the current feature |
| `docs/RESEARCH/` | Research findings per feature |
| `docs/gotchas/GENERAL.md` | Project-specific conventions and gotchas |
| `docs/gotchas/skills/` | Per-capability skill files for the project |

---

## 14. Documentation Structure

FORGE's documentation is split into three tiers:

| Document | Purpose | Maintained how |
|----------|---------|---------------|
| `docs/FORGE-OVERVIEW.md` | Narrative: Eras, philosophy, comparisons, design decisions | Hand-written, append-only for Eras |
| `docs/FORGE-REFERENCE.md` | Technical reference: agents, signals, modules, pipeline modes, key files | Generated on demand from source-of-truth files |
| `docs/FORGE-PRESENTATION.html` | Slide deck for presentations: Era slides, deep dives, comparisons | Hand-edited following recipe |
| `docs/FORGE-OVERVIEW-RECIPE.md` | Update recipe for all three documents above | Maintained when document structure changes |

**Principle:** FORGE-OVERVIEW is the story. FORGE-REFERENCE is the specs. Neither duplicates the other. Reference data lives in source-of-truth files (GENERAL.md, modules.json, agent .md frontmatter, board.json) and is assembled into FORGE-REFERENCE.md on demand.

### Other documentation files

| File | Purpose |
|------|---------|
| `docs/CHANGELOG.md` | Running record of shipped features (last 5 entries; older in `docs/archive/CHANGELOG_HISTORY.md`) |
| `docs/DECISIONS.md` | Architectural decisions with rationale |
| `docs/ARCHITECTURE.md` | Module map and key technical decisions |
| `docs/VISION.md` | Product direction and One Chat design |
| `docs/gotchas/GENERAL.md` | Project conventions, signal protocol, pipeline modes (source of truth for reference sections) |
| `docs/PLAN.md` | Active plan for current feature |
| `docs/PLAN-archive.md` | Completed plan sections (archived by documenter) |
