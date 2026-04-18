# FORGE — Complete Team Reference

> A living document covering everything your team needs to understand FORGE: what it is, why it exists, how it works, and how it compares to similar tools.

---

## Table of Contents

1. [What Is FORGE?](#1-what-is-forge)
2. [The Glass Wall Principle](#2-the-glass-wall-principle)
3. [FORGE vs Plain Claude CLI](#3-forge-vs-plain-claude-cli)
4. [FORGE vs Similar Tools](#4-forge-vs-similar-tools)
5. [Why Use FORGE for New Projects](#5-why-use-forge-for-new-projects)
6. [The Evolution of FORGE's Pipeline — Eras](#6-the-evolution-of-forges-pipeline)

> **Looking for technical reference?** Agent tables (29), signal protocol, pipeline modes, hook system (13 scripts), MCP tools (24), model routing, and key files live in [FORGE-REFERENCE.md](FORGE-REFERENCE.md) — generated on demand from source-of-truth files.

---

## 1. What Is FORGE?

FORGE is a **Claude Code plugin** that structures AI-powered software development into a multi-agent pipeline with human approval gates, parallel review waves, persistent project state, and stack-aware skill injection.

FORGE is a **tool for developing your projects** — and it dogfoods itself. The plugin's own codebase is maintained using its own pipelines. Install the plugin once, and every project gains the same structured workflow.

FORGE does not replace Claude Code. It orchestrates it by:
1. Providing 29 specialist agents loaded via the plugin system
2. Exposing 21 skills (slash commands) that orchestrate those agents into pipelines
3. Enforcing workflow rules through 13 hook scripts across 7 lifecycle events
4. Offering 24 MCP tools for structured access to pipeline state
5. Pausing for human approval at defined checkpoints (gates)
6. Persisting state, todos, and project metadata across sessions
7. Structurally enforcing gate sequencing at the write boundary (not just prompts)

---

## 2. The Glass Wall Principle

Everything FORGE does is designed around one idea: **you should always be able to see what is happening and why.**

When you submit a prompt to a plain AI tool, work disappears into a black box. You get a result. You don't know what decisions were made, what was considered and rejected, what assumptions were baked in, or why the output looks the way it does. If something is wrong you can't trace it. If something is right you can't learn from it. You are a recipient, not a participant.

FORGE is built on the opposite premise. The terminal is not a log — it is a live window into the work as it happens. You watch the planner reason through your feature. You watch the researcher investigate an unknown. You watch reviewer-safety raise a concern and the coder revise its approach in response. Every agent's thinking, every tool call, every signal is visible as it streams. Nothing is buffered and delivered as a finished product.

**This is the glass wall:** the work happens behind glass — agents run, tokens are spent, decisions are made — but the glass is transparent. You are always on the other side watching.

### Why it matters

**Trust.** You approved a plan at Gate #1. You watched the coder write a handoff. Reviewers flagged two issues; you saw them resolved. By the time Gate #2 appears, you have watched everything that led to it. You are not being asked to trust a result — you are confirming something you observed. That is a fundamentally different relationship with an AI system.

**Control.** When you can see every step, you can intervene at every step. You can stop a pipeline mid-run because you saw the planner head in the wrong direction. You can reject Gate #2 because you watched reviewer-logic approve something that felt off to you. The gates are the formal control points, but the terminal is the continuous one.

**Accountability.** Every run is auditable after the fact. The terminal shows what ran. The audit log shows every tool call. The verdicts log shows every reviewer decision. If a bug ships, you can trace exactly which agent missed it and improve that agent's prompt. Nothing is hidden.

**Learning.** Watching agents work teaches you how the pipeline thinks. Over time you build intuition about when a plan is underdone, when a reviewer is overcautious, when research is necessary. Users who engage with the terminal become better at using FORGE than users who just click gates.

### The principle applied throughout FORGE

The glass wall is not just the terminal. It is a design principle that shows up everywhere:

- **Gates** (`/forge:approve`) show the plan or handoff summary and verdict before asking for approval — you are approving something you can read, not a blind "yes"
- **Suggest chips** (`[suggest]` signals) show the next logical step rather than silently deciding it
- **Clarifying questions** (`[questions]`/`[/questions]` signals) make the planner's questions visible before a plan is written, rather than having assumptions baked in silently
- **Reviewer verdicts** (`[reviewer-verdict]` signals) stream as they arrive, not aggregated into a single pass/fail
- **The signal protocol** gives agents a formal way to communicate intent to you, not just to each other
- **Enforcement hooks** (bash-guard, workflow-guard) are transparent — when a tool call is blocked, the agent sees the reason and you see it in the terminal
- **Transparent pipeline construction** (planned) — when the orchestrator decides which agents to run for a request, it will explain that decision before running, extending the glass wall to the meta level

### An analogy — the open kitchen

Think of an expensive restaurant with an open kitchen. You sit at your table and talk to the waiter. The waiter guides you — asks clarifying questions about your preferences, suggests what pairs well, describes the options. You place your order. The waiter carries it to the kitchen, which has a full glass wall facing the restaurant floor.

From your seat you can watch everything the chefs are doing. You might not understand every technique — only they truly know what they're making and why — but you can see the work happening in real time. You can see when something gets adjusted, when a dish gets a second pass, when the head chef checks the plate before it goes out. If something looks wrong from where you're sitting, you could say something. When your meal arrives, you watched it being made every step of the way.

FORGE works the same way. You talk to the interface (the waiter). It guides you with questions and suggestions, then carries your request to the pipeline (the kitchen). The terminal is the glass wall — the chefs (agents) are the specialists doing the work, each with their own domain and expertise, and you may not understand every decision they make. But the transparency is always there. By the time your feature arrives — reviewed, implemented, documented — you watched it being made.

---

### What the glass wall is not

The terminal being live and visible does not mean you have to watch it constantly or understand every line. You can submit a prompt and come back when the gate appears. The glass wall is an offer of visibility, not a demand for attention. The point is that it is always *available* — you can look whenever you want, and what you see is the real thing, not a summary or a sanitised output.

---

## 3. FORGE vs Plain Claude CLI

| Capability | FORGE | Claude CLI |
|---|---|---|
| Named, pre-defined pipelines | Yes — 7 pipeline types, 5 modes | No — manual sequencing required |
| Human approval gates | Yes — Gate #1 (plan→implement), Gate #2 (review→apply) | No |
| 29 specialist agents | Yes — plan, implement, review, debug, refactor, architect, ideate | Possible via `--agents` but no orchestration |
| Parallel reviewer waves | Yes — up to 5 reviewers simultaneously | No built-in review step |
| Wave execution (task parallelism) | Yes — with prerequisite verification | No |
| Signal protocol (`[suggest]`, `[todo]`, etc.) | Yes — consumed by skills and hooks | No — plain text |
| Enforcement hooks | Yes — bash-guard, workflow-guard, role-based access | No |
| 24 MCP tools for pipeline state | Yes — board, config, gates, modules, model routing, dashboard state | No |
| Multi-model routing | Yes — per-agent model selection, external provider support (OpenAI) | Single model per session |
| Context checkpointing | Yes — reinjection after compaction via PostCompact hook | No |
| Stack-aware skill guidance | Yes — per-agent, per-stack guidance from SKILLS.md | No |
| Project state persistence | Yes — todos, modules, health, run lifecycle tracking | No |
| Subagent lifecycle tracking | Yes — SubagentStart/Stop hooks with duration and verdict extraction | No |
| Git integration in apply pipeline | Yes — opt-in branch creation, auto-commit, auto-PR | No |
| Local terminal dashboard | Yes — wrapper TUI prototype (`scripts/forge-wrapper-proto.mjs`) embeds Claude + dashboard in a split pane (primary, experimental); standalone observer TUI as a dashboard-only secondary; HTTP sidecar retained as legacy/fallback during transition | No |

**Summary:** Claude CLI is a single-session tool. FORGE is a development workflow engine built as a plugin on top of it.

---

## 4. FORGE vs Similar Tools

### FORGE vs Get-Shit-Done (GSD)

GSD (`get-shit-done-cc`) is an npm-based global CLI installer that auto-configures agents, commands, and hooks into 9 runtimes (Claude Code, Copilot, Gemini CLI, Cursor, Windsurf, etc.). It demonstrated that structured agent sequencing with spec-driven development produced better output than open-ended chat. GSD uses PreToolUse hooks for advisory enforcement (non-blocking warnings for read-before-edit, prompt injection scanning) and shared its approach via a `.planning/` directory per project.

FORGE and GSD share the same philosophical root — structured, agent-based pipelines are better than freeform prompting. The differences are in enforcement model, scope, and distribution:

| Capability | FORGE | GSD |
|---|---|---|
| Distribution | Claude Code plugin (marketplace) | npm package (multi-runtime) |
| Runtime support | Claude Code only | 9 runtimes |
| Gate system (human approval) | Yes — Gate #1 and #2, explicit approval required | No formal gates |
| Enforcement model | PreToolUse hooks with exit 2 (hard blocking) | PreToolUse hooks (advisory only, non-blocking) |
| Pipeline modes | 5 modes (TRIVIAL→FULL) controlling reviewer depth | Single mode |
| Persistent project state | Yes — board, modules, run lifecycle, usage tracking | Stateless per run |
| MCP tool layer | Yes — 24 structured tools for pipeline state | No |
| Multi-model routing | Yes — per-agent model selection, external providers | No |
| Stack-aware skill injection | Yes — per-agent, per-stack guidance | No |
| Knowledge compounding | Yes — docs/solutions/ with YAML frontmatter | No |
| Revision cycles | Yes — automatic REVISE loops with circuit breaker | Manual |

---

### FORGE vs Cursor / GitHub Copilot

Cursor and Copilot are **in-editor AI assistants** — they help you write code line-by-line inside your IDE. They have no concept of a planning phase, no multi-agent review, no approval gates, and no persistent project state across sessions. They are autocomplete tools that scale up to chat. FORGE is a pipeline tool that structures an entire feature lifecycle — from planning through review, implementation, and documentation — with human checkpoints at each major transition.

| Capability | FORGE | Cursor / Copilot |
|---|---|---|
| Planning before code | Yes — planner + researcher + gotcha-checker | No |
| Multi-agent specialist review | Yes — up to 5 reviewers in parallel | No |
| Human approval gates | Yes — can't proceed without explicit YES | No |
| Enforcement hooks | Yes — bash-guard, workflow-guard block bad patterns | No |
| Persistent project knowledge | Yes — modules, todos, health signals, solutions | No |
| Works on any project structure | Yes — `/forge:init` + architect agent | Language-aware but no project model |

---

### FORGE vs Compound Engineering

Compound Engineering by Every.to is the closest competitor in philosophy and architecture — also a Claude Code plugin (marketplace + npm), also structured into Plan → Work → Review → Compound. It has 26 agents, 23 commands, and 13 skills. Its core principle is that each feature should make the next easier to build ("compounding knowledge").

FORGE and Compound Engineering share: plugin-native distribution, multi-agent pipelines, knowledge capture, and an ideation step. The differences are structural:

| Capability | FORGE | Compound Engineering |
|---|---|---|
| Gate system | Yes — formal Gate #1 and #2 with block/approve | No formal gates |
| Enforcement hooks | Yes — 3 PreToolUse hooks with exit 2 blocking | No enforcement hooks |
| Pipeline modes | 5 modes controlling agent depth (TRIVIAL→FULL) | Single mode |
| Multi-model routing | Yes — MCP-based, per-agent, external provider support | No |
| MCP tool layer | Yes — 24 tools for structured state access | No |
| Subagent lifecycle tracking | Yes — SubagentStart/Stop hooks with timing | No |
| Distribution | Plugin marketplace | Plugin marketplace + npm (`@every-env/compound-plugin`) + multi-tool conversion |
| Multi-runtime | Claude Code only | Codex, Windsurf, Gemini CLI via Bun converter |
| Ideation | Yes — adversarial analysis (ideator agent) | Yes — ideation step |
| Knowledge compounding | Yes — docs/solutions/ with YAML frontmatter | Yes — compound step (core philosophy) |

Compound Engineering's multi-runtime support and npm distribution reach a broader audience. FORGE's enforcement model, gate system, and MCP tool layer provide deeper pipeline control within Claude Code.

---

### FORGE vs Aider

Aider is a terminal-based AI coding tool that applies Claude or GPT changes to your files via git-aware diffs. It handles file writes well but has no pipeline structure, no planning phase, no reviewer wave, and no gate system. It is closer to Claude CLI than to FORGE — a capable single-agent tool that requires the developer to direct every step. FORGE adds the orchestration layer Aider lacks: specialists, gates, persistence, and a UI that makes the process legible.

---

### FORGE vs Autonomous Agents (Devin, OpenHands, etc.)

Fully autonomous agents attempt to complete entire tasks without human involvement. FORGE takes the opposite philosophical position: **human judgment at every major transition is a feature, not a limitation**. Gate #1 stops before code is written. Gate #2 stops before code is applied. The developer remains the decision-maker; FORGE makes that decision well-informed by surfacing research, reviewer verdicts, and a structured plan — rather than skipping the human entirely.

---

## 5. Why Use FORGE for New Projects

### Structured from Day One
Every FORGE project starts with `/forge:init` which scaffolds:
- `.pipeline/project.json` — tech stack, pipeline mode, test command, git integration config
- `docs/` — plan, context, gotchas, architecture
- `CLAUDE.md` — pipeline routing instructions

This context is automatically included in every pipeline run. The architect agent can further map your project's modules and conventions.

### Planning Before Code
FORGE enforces a planning phase before any code is written:
- **Brainstormer** (optional) — explores requirements when the request is vague
- **Planner** breaks the feature into numbered tasks with wave assignments
- **Researcher** investigates unknowns and writes findings to `docs/RESEARCH/`
- **Gotcha-checker** validates the plan against known pitfalls and project conventions
- **Gate #1** requires your explicit approval (`/forge:approve`) before implementation starts

You never discover a fundamental design problem mid-implementation.

### Multiple Specialists Review Every Change
Before any code lands on disk, up to 5 specialist reviewers examine the implementation in parallel:
- `reviewer-safety` — injection risks, secret leakage, input validation
- `reviewer-logic` — async correctness, edge cases, race conditions
- `reviewer-style` — naming conventions, formatting rules, code consistency
- `reviewer-performance` — blocking I/O, memory leaks, hot path issues
- `reviewer-boundary` — boundary correctness, type contracts, module isolation

The pipeline mode controls how many run: LEAN (2), STANDARD (triage-dispatched), FULL (all 5). If any returns `BLOCK`, Gate #2 is blocked until issues are fixed.

### Enforcement Built In
Three PreToolUse hooks enforce workflow discipline:
- **bash-guard** blocks `cat`, `grep`, `find`, `sed` and redirects to dedicated tools (Read, Grep, Glob, Edit)
- **workflow-guard** blocks source file writes when pipeline conditions are not met
- **ctx-pre-tool** validates file paths against role-based access patterns

Enforcement is hard — exit code 2 forces the agent to re-plan. No bypass possible.

### Project State Accumulates Over Time
As FORGE develops your project, it builds up:
- A **TODO board** (`.pipeline/board.json`) with prioritized, taggable, blockable tasks — managed via `/forge:todo` and MCP tools
- A **module map** (`.pipeline/modules.json`) with FORGE's understanding of your architecture
- A **knowledge store** (`docs/solutions/`) capturing solutions with YAML frontmatter for future reuse
- **Health signals** from the architect and ideator agents flagging gaps and improvement opportunities
- **Run lifecycle data** in `.pipeline/run-active.json` — subagent timing, verdicts, outcomes

---

## 6. The Evolution of FORGE's Pipeline

FORGE's pipeline was not designed all at once. Each layer was added because the previous version had a clear, concrete failure. This section traces the progression so you understand why each piece exists and what it replaced.

---

### Era 1 — UI for Claude (the beginning)

FORGE started as a lightweight Electron wrapper around the Claude CLI — a way to give structure to what would otherwise be freeform prompting. The core UI had a TODO tab and a PLANNED tab: raw ideas on the left, approved features on the right. The only pipeline was "talk to Claude, get output, track it manually."

The problem this solved: keeping context across sessions. Claude forgets everything between chats. FORGE gave the work a home.

---

### Era 2 — Project scaffolding

Before scaffolding existed, pointing FORGE at a project meant manually setting up the right files — creating the `.pipeline/` directory, writing a `CLAUDE.md` with pipeline routing rules, adding the docs structure. Every new project was a copy-paste job.

Scaffolding formalised the concept of a FORGE project and made creation a guided act:

**The wizard:** A multi-step creation flow that collected the project name, description, tech stack, and structure type, then generated the initial folder layout automatically. A FORGE project became something you create rather than something you assemble by hand.

**`project.json`:** The machine-readable project identity file — `techStacks`, `techStackLabels`, `structure`, `projectName`, `projectDescription`. Every pipeline run reads this file to know what it is working on.

**Templates per tech stack:** Rather than one universal CLAUDE.md and one universal SKILLS.md, FORGE gained a `templates/` directory with per-stack variants (`code/`, `VanillaHTMLCSSJavaScript/`, `instructional/`, `power-automate/`). A new project gets the right starting files for its declared stack.

**How it evolved:** The initial model copied everything — CLAUDE.md, SKILLS.md, hooks — into the project folder at creation time. This created orphan copies: fixing a routing bug in FORGE's templates never reached existing projects. The model shifted toward runtime injection: SKILLS.md is no longer copied, it is read from FORGE's own templates directory on every run. CLAUDE.md is moving toward a thin project brief only, with routing rules injected by FORGE at run time. The goal is a project folder that holds only project data, with FORGE owning and injecting all operational logic.

---

### Era 3 — The first linear pipeline

```
planner → researcher → coder → shipped
```

FORGE grew its first real pipeline: a planner broke the feature into tasks, a researcher investigated technical unknowns, and a coder wrote the implementation. No gates, no reviewers, no human checkpoint between steps.

The problem this solved: unstructured vibe-coding. A single "do everything" prompt produces a first draft with no plan and no research. Splitting into specialist agents produced more coherent output.

The gap it exposed: the coder's output went straight to disk, unreviewed. Bugs, security issues, and wrong approaches shipped without any check.

---

### Era 4 — Gate #1 and the first reviewer

```
planner → researcher → gotcha-checker → Gate #1 → coder → 1 reviewer → shipped
```

Two things were added simultaneously: a gotcha-checker that audited the plan before approval, and Gate #1 — the first human checkpoint. The user now had to explicitly approve the plan before the coder ran. A single boundary reviewer then checked the coder's output before shipping.

The problem this solved: plans with structural errors (wrong wave ordering, scope creep, missing IPC channels) were catching problems after implementation instead of before. Gate #1 made the plan approval a deliberate act rather than an implicit step.

The gap it exposed: one reviewer wasn't enough. It caught boundary violations but missed logic bugs, security vulnerabilities, and performance problems. And there was still no Gate #2 — the single reviewer's output had no approval moment; it went straight to applied.

---

### Era 5 — Gate #2 and the reviewer expansion

```
planner → researcher → gotcha-checker → 1 reviewer → Gate #1
                                                         ↓
                                              coder → 3 reviewers → Gate #2 → shipped
```

Gate #2 was added as the second human checkpoint — the user now had to approve the implementation before it touched source files. The reviewer count expanded to three: boundary, safety, and logic. Each owned a non-overlapping domain.

The problem this solved: the coder's handoff was going directly to source files after one reviewer's sign-off. A security bug caught by reviewer-safety after Gate #2 would require a rollback. The new gate made "reviewed and human-approved" a precondition for any write to disk.

The gap it exposed: three reviewers still missed style regressions and performance issues. And the plan-phase review was still a single reviewer — the plan got less scrutiny than the implementation.

---

### Era 6 — Five reviewers, implementer/documenter split, reviewer-triage

```
planner → researcher → gotcha-checker → plan-reviewers (3–5) → Gate #1
                                                                    ↓
                                              coder → reviewer-triage → impl-reviewers (5) → Gate #2
                                                                                                ↓
                                                                          implementer → documenter → shipped
```

Several things matured together:

**Five specialist reviewers:** reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance, and reviewer (boundary/aggregator). Each owns a completely separate domain. Running in parallel, they cover more ground in less wall-clock time than sequential review.

**reviewer-triage:** A fast Haiku agent that reads the handoff first and decides which reviewers actually need to run for this specific change. A pure CSS change doesn't need reviewer-logic. A config file change doesn't need reviewer-performance. Triage prevents unnecessary reviewer runs and focuses attention where the risk is real.

**Coder/implementer split:** The coder now only writes the handoff document — it never touches source files. The implementer is the only agent that writes to disk, and only after Gate #2 approval. This made the handoff the canonical "staging area": reviewers check a document, not a half-applied diff.

**Documenter:** Shipping a feature now ends with a documenter pass that updates CHANGELOG.md, ARCHITECTURE.md, DECISIONS.md, and archives the completed plan section. The shipped state became auditable and searchable.

The gap it exposed: running all five reviewers on every change was expensive and slow for simple features. A one-line CSS fix went through the same review gauntlet as a complex IPC refactor.

---

### Era 7 — Wave execution

```
implementer (wave 1: parallel tasks) → [wave-complete] 1
           (wave 2: parallel tasks) → [wave-complete] 2
           → documenter → shipped
```

The planner gained the ability to annotate independent tasks with `(wave: N)` markers. The implementer runs all tasks in wave N in parallel, verifies each output (key-link verification), then proceeds to wave N+1. Tasks with no dependencies on each other no longer waited in a queue.

The problem this solved: a feature with 8 independent tasks used to run sequentially — task 1 finished before task 2 started. Wave execution cut wall-clock implementation time significantly for large features.

The key design decision: waves are opt-in via explicit planner annotations, not automatic. Automatic dependency inference from natural language task descriptions is unreliable. The planner marks `(wave: N)` only when it is certain tasks are independent — making the parallelism contract explicit and auditable.

---

### Era 8 — Modular building

Until this point, FORGE tracked work as flat lists: TODOs, planned items, shipped features. The project existed as a collection of files, but there was no structured understanding of what the codebase was made of — no map of which components served which purpose, and no way to assign a feature to the part of the app it would affect.

Three things were introduced together:

**The architect agent:** An on-demand agent that reads the codebase and produces a structured map of functional modules — each with a name, description, and list of capabilities. It writes this to `.pipeline/modules.json` and updates `docs/ARCHITECTURE.md`. Running the architect gives every agent an accurate, up-to-date picture of the project's structure without relying on per-agent file exploration.

**Module assignment for planned features:** In the PLANNED tab, each planned feature can be assigned to a module. This made planning modular — "add gallery filter" would be assigned to the gallery-module, making the board a living document of what is changing where, not just what is changing.

**The MODULES tab:** A dedicated UI panel showing every identified module, its description, and its capabilities. Meant to always reflect the real codebase — the architect updates it when the structure changes, and the documenter (planned) appends new capabilities as features ship.

The problem this solved: as projects grow, agents lose track of which files are responsible for what. Without a module map, the planner has to infer structure from file names and a flat directory listing. With modules, every agent that reads `docs/ARCHITECTURE.md` inherits the architect's structured understanding of the project — and plans naturally align to the existing structure rather than creating new, orphaned files.

---

### Era 9 — Tech stacks and the SKILLS system

```
project.json: techStackLabels → filterSkillsByStacks → --append-system-prompt
```

Until this point, every agent ran with the same instructions regardless of what the project was built with. A reviewer-safety checking an Electron app and one checking a vanilla HTML site ran identical prompts — the Electron-specific checks (contextIsolation, nodeIntegration, IPC validation, sandbox flags) were either hardcoded in the agent prompt for every project, or missing entirely.

Two things were introduced together:

**Tech stacks in the wizard:** The project creation wizard began collecting the project's tech stack (Electron, Svelte 5, TypeScript, Vanilla HTML/CSS/JavaScript, Power Automate, etc.) and saving it to `project.json` as `techStackLabels`. This gave FORGE a machine-readable declaration of what technology the project uses.

**SKILLS.md — per-agent, per-stack guidance:** A structured markdown file organised by agent name and stack name. Each agent section contains stack-specific rules that only apply when working on that stack. FORGE reads SKILLS.md at runtime, filters it to the project's declared stack labels, and injects only the matching content into every agent's system prompt via `--append-system-prompt`.

The problem this solved: agent prompts were bloated with stack-specific rules that only applied to one technology. reviewer-safety's Electron security checklist was irrelevant noise when reviewing a plain HTML site. reviewer-logic's Svelte 5 rune mutation rules meant nothing in a Python project. SKILLS.md moved all of that out of agent prompts and into a single filterable file — agents became stack-agnostic by default and stack-aware by injection.

**Ownership decision:** FORGE owns SKILLS.md. It lives in FORGE's templates directory and is never copied into active projects. This means every project always gets the current version of the guidance — fixing a SKILLS entry in FORGE fixes it for all projects immediately, with no per-project migration.

---

### Era 10 — Pipeline modes (LEAN / STANDARD / FULL)

**Plan phase:**

| Mode | Agent sequence |
|------|----------------|
| `LEAN` | planner → researcher (conditional) → reviewer (boundary only — no gotcha-checker, no reviewer-triage, no specialists) → Gate #1 |
| `STANDARD` | planner → researcher (conditional) → gotcha-checker → reviewer-triage → dispatched reviewers → Gate #1 |
| `FULL` | planner → researcher (always, unconditional) → gotcha-checker → reviewer-triage → all 5 reviewers → Gate #1 |

**Implement/debug/refactor phase:**

| Mode | Agent sequence |
|------|----------------|
| `LEAN` | coder/debug/refactor → reviewer (boundary only — no reviewer-triage, no specialists) → Gate #2 |
| `STANDARD` | coder/debug/refactor → reviewer-triage → reviewer + reviewer-safety (always) + conditionally logic/style/performance → Gate #2 |
| `FULL` | coder/debug/refactor → reviewer-triage → all 5 reviewers → Gate #2 |

The mode is stored in `.pipeline/project.json` as `pipelineMode` and injected as `PIPELINE MODE: <VALUE>` in every agent's `--append-system-prompt`. When absent, STANDARD is assumed. The mode controls reviewer depth — it never skips a gate.

Three modes give users control over the speed/quality trade-off. LEAN is fast feedback for simple, familiar changes — one boundary reviewer, no specialist wave. STANDARD is the default: research and reviewers are dispatched selectively based on what changed. FULL is for high-risk changes — all reviewers run unconditionally.

The problem this solved: STANDARD mode was over-engineered for a small CSS tweak and under-configured for a critical security-sensitive feature. LEAN exists for speed; FULL exists for confidence.

---

### Era 11 — Suggest chips and the signal protocol

Agents produce plain text output streamed to the terminal. Early on, that output was only ever for the user to read. There was no way for an agent to reach into the FORGE UI and do something — suggest the next step, add a TODO, emit a summary the gate could display.

The signal protocol changed this. Agents began embedding structured tokens on their own lines that FORGE intercepts before the text reaches the terminal renderer:

**`[suggest] <text>`** — creates a clickable chip in the UI above the prompt bar. Clicking it pre-fills the prompt with that text. Agents use this to guide users toward the natural next action: after a plan is written, a `[suggest] implement feature: X` chip appears; after Gate #2 approval, `[suggest] apply feature: X`. Users no longer had to remember what to type next.

**`[todo] <text>`** — adds an item to the TODO tab in real time, without the user having to open the board. Agents surface ideas, gaps, and follow-up work as they encounter them.

**`[summary] <text>`** — sets the summary text that Gate #1 and Gate #2 display. Gates stopped showing raw terminal output and started showing the one-line human-readable summary the agent deliberately wrote.

**`[reviewer-verdict] {...}`** — a JSON signal emitted by each reviewer, intercepted and appended to `.pipeline/verdicts.jsonl` before the text reaches the terminal. Gate #2's blocked/clear state is driven entirely by these persisted signals, not by string-scanning terminal output.

The problem this solved: before signals, FORGE had to scrape terminal text to guess what happened. Gate state was brittle, next steps required the user to know the pipeline by heart, and agent output disappeared after the session. Signals gave agents a first-class way to communicate intent to the UI, not just to the human reading the terminal.

---

### Era 12 — Clarifying questions and the Q&A strip

Until this point, when a feature description was ambiguous the planner had two bad options: guess and potentially write the wrong plan, or produce a plan so hedged it required rewriting after the first Gate #1 review. Both options wasted tokens and time.

The Q&A strip introduced a two-pass planner behaviour:

**Pass 1 (questions):** If the feature description leaves design-critical decisions unanswered, the planner emits a `[questions]` / `[/questions]` block with 2–8 structured questions and stops immediately — no plan written. FORGE intercepts the block, renders it as an inline Q&A strip in the UI, and waits.

**Pass 2 (plan):** The user fills in answers and submits. FORGE re-invokes the full plan pipeline with an `[answers]` block prepended to the prompt. The planner skips questions on this pass and writes the full plan with the correct context already in hand.

The problem this solved: plans built on guesses had a structural defect from the start. The Q&A strip moved requirement clarification to before the plan existed — before any tokens were spent on research, gotcha-checking, or review. A two-question exchange up front prevented entire pipeline reruns due to a wrong scope assumption.

The signal was also repurposed for the debug pipeline — ambiguous bug reports (`"X is broken"` with no error output) could trigger a short questions pass before the debug agent traced a root cause.

---

### Era 13 — Automated auditing and self-improvement

As FORGE ran more pipelines, a pattern emerged: the same agent mistakes kept recurring across sessions. A reviewer would repeatedly read source files it didn't need. An implementer would re-read the handoff on every task instead of once. These were prompt-level inefficiencies — fixable, but only visible to someone watching many runs over time.

Automated auditing made the pipeline observe itself:

**The hook (ctx-post-tool.js):** A post-tool hook that fires after every tool call in a Claude CLI session. It appends a compact record — agent name, tool name, file path, timestamp — to `docs/audit-log.jsonl`. Every pipeline run accumulates its own audit trail without any agent being aware of it.

**tool-call-auditor:** An agent that runs at the end of every apply pipeline, after the documenter. It reads the current session's audit log and checks for known anti-patterns: repeated reads of the same file, tool call storms (many calls with no work between them), blind writes without a preceding read, repeated greps on the same pattern. It also compares against prior sessions — if a pattern appears in 3 or more distinct sessions, it is flagged as recurring with `[auditor-recurring]`.

**agent-optimizer:** Triggered only on `[auditor-recurring]`. It reads the recurring findings, maps each to the responsible agent `.md` file, and writes targeted prompt-fix proposals to `docs/context/handoff.md`. Those proposals then go through Gate #2 — the same human approval gate used for any code change — before an implementer applies them to the actual agent files.

The problem this solved: agent prompt quality had no feedback loop. A reviewer that wasted 3000 tokens on unnecessary file reads in every session cost real money and time, but there was no systematic way to catch it. Automated auditing created a feedback loop where the pipeline improves its own agents based on observed behaviour, not just on human intuition.

**Token efficiency rules:** After observing real 500k-token pipeline runs, four concrete rules were embedded directly into the researcher and planner agent prompts:
- **No bash commands** — use Glob/Grep/Read tools only; `ls`, `find`, `cat`, `echo` forbidden
- **One-fetch rule** — never fetch the same URL more than once per session (a researcher was observed fetching the same docs page ×8 in a single run)
- **No caniuse for mainstream APIs** — skip caniuse checks for browser APIs with >95% support (Fetch, Geolocation, CSS Grid, etc.)
- **One-read rule** — read each file path exactly once; PLAN.md named explicitly

These rules reduced plan-phase token consumption significantly on runs where researchers had previously fetched reference documentation repeatedly.

---

### Era 14 — Strategic optimisation: competitive analysis and pipeline completeness

By Era 13, FORGE's self-improvement loop was running. The next question was no longer "what is broken?" but "what are we missing compared to the best multi-agent systems in production?"

A systematic competitive analysis compared FORGE against CrewAI, LangGraph, AutoGen, MetaGPT, and patterns from documented production pipelines. The result was not a list of weaknesses — FORGE's gate system, signal protocol, reviewer wave, and self-improvement loop were confirmed as genuinely ahead of the field. The result was a structured improvement backlog: 17 items catalogued with effort estimates, reward projections (token reduction % or quality improvement %), and feasibility verdicts.

**The methodology:** For each item requiring more investigation, a dedicated `explore:` agent run answered a specific feasibility question before any planning or implementation was committed. Six explore agents ran in parallel to assess the new specialist agents; five had run in the previous session for pipeline improvement items. This produced concrete answers: where an agent slots, what signals it emits, whether infrastructure already exists or needs to be built, and how it interacts with existing agents.

**Key findings from the explore phase:**
- The `BEFORE_PLAN` hook already exists in the type system (`claude.d.ts`) and the project-agents handler infers it automatically for agents with "domain" or "context" in their description — but CLAUDE.md has zero orchestrator logic to activate it. Infrastructure exists; wiring is missing.
- The handoff summarizer is a natural extension to reviewer-triage (which already reads the full handoff once) rather than a new agent — reviewer-triage currently produces no summary, only a dispatch list and per-reviewer excerpts.
- The TDD agent and verification-aware planning are orthogonal, not duplicates: TDD writes executable test code stubs; Verify: lines write human-readable pass/fail criteria. Different artifacts for different audiences.
- The observer agent needs a separate `docs/observer-log.jsonl` (not appended to audit-log.jsonl) to maintain schema isolation — the tool-call-auditor and agent-optimizer work only with tool statistics; the observer would capture reasoning-level patterns from output text.
- modules.json exposes id, name, description, notes, and capabilities — no coupling or dependency data. The regression-risk agent would work from module names and handoff file paths, emitting `[health]` signals rather than structured coupling graphs.

**The improvement backlog is tracked in `docs/competitive-eval.md`** with a full effort/reward table. Prioritised by ratio: planner checkpoint (XS effort, silent failure eliminated), model version in verdicts (XS effort, A/B analysis enabled), handoff summarizer (S effort, 15–20% reviewer token reduction every run), verification-aware planning (S effort, ~15% less implementer rework), circuit breaker (S effort, 5–15% token saving on revision loops).

**Shipped in Era 14 (Group 1 sprint):**
- **Model version in reviewer verdicts** — all 5 reviewer agents now emit `"model"` in their `[reviewer-verdict]` JSON; GENERAL.md signal spec updated. Enables A/B analysis after model upgrades.
- **Handoff summarizer** — reviewer-triage extended to emit a `[handoff-summary]...[/handoff-summary]` block before the dispatch block; CLAUDE.md injects it into every reviewer's context prefix.
- **Planner checkpoint/resume** — discovered already implemented. Marked done.
- **Debug/refactor revision loop** — discovered already implemented. Marked done.

**Shipped in Era 14 (Groups 2–5 sprint, 2026-03-30):**
- **Diff review UI (Gate2Bar)** — collapsible file sections, copy-to-clipboard button for the full diff.
- **Per-agent latency budget (RunTimer)** — warning state after 5 min: timer turns gold, "· slow" label appears.
- **Verification-aware planning** — planner now writes a `Verify:` line per task; implementer uses it for wave self-checks; gotcha-checker validates Verify: coverage.
- **Circuit breaker for revision loops** — orchestrator compares BLOCK reasons across cycles; stops and escalates if same reason appears unchanged (added to all 3 revision loops in templates/code/CLAUDE.md).
- **Prompt injection guard** — researcher sanitises web-fetched content and emits `[INJECTION-WARNING]` for adversarial patterns; reviewer-safety scans docs/RESEARCH/.
- **Regression-risk agent** — Haiku agent (step 1b in implement feature STANDARD/FULL); reads modules.json + handoff.md, flags high-risk touched modules via `[health]` signals.
- **Spec agent** — Haiku pre-planner agent; writes structured spec to docs/SPEC.md with acceptance criteria, out-of-scope, open questions. Opt-in via `"specAgent": true`.
- **Observer agent** — Haiku on-demand agent (invoked via `direct: run observer`); logs reasoning-level patterns to docs/observer-log.jsonl, feeds agent-optimizer.
- **TDD agent** — Haiku pre-coder agent; writes Given/When/Then criteria to docs/TEST-CRITERIA.md before coder runs. Opt-in via `"tddAgent": true`.
- **Domain-context agent** — Haiku pre-planner agent; checks feature against docs/DOMAIN.md domain rules. Activated by file presence in project's `.claude/agents/`.
- **Completeness-checker agent** — Haiku agent (step 1c in implement feature STANDARD/FULL); reads PLAN.md + handoff.md, emits `[reviewer-verdict]` BLOCK for unaddressed tasks.
- **Per-run cost telemetry** — `load-token-usage` IPC now returns last 5 runs; agents.svelte.ts stores `recentRuns`; USAGE tab shows "RECENT RUNS" section (mode, cost, tokens).
- **Parallel coder fix** — FORGE's CLAUDE.md and templates/code/CLAUDE.md now explicitly state sprint coder must run sequentially (all coders write to same handoff.md).
- **One Chat Phase 2 agent catalog** — board entry updated with 3-tier catalog (always-pipeline / conditional-pipeline / on-demand-only) for the intent classifier.
- **Missing-project-folder-handling** — `check-folder-exists` IPC wired through all four layers (handler → preload → types → ipc.ts); ProjectsModal shows ⚠ MISSING badge on projects whose folder no longer exists, disables selecting them, and adds a LOCATE button to re-point to the new path via browse dialog + re-registration.

---

### Era 15 — Module wiring, pipeline self-knowledge, and docs consolidation (2026-03-30)

The module system existed but was static — the architect wrote it once and it drifted. This era made it live.

**Module wiring fields:** The architect agent's `modules.json` schema gained five new fields per module: `keyFiles`, `stores`, `ipcChannels`, `dependsOn`, `usedBy`. The architect was run against FORGE in FULL mode to backfill all 12 existing modules with real wiring data traced from source. The result: before touching any module, an agent (or developer) can see exactly which other modules depend on it and which stores/IPC channels it uses.

**Continuous wiring updates:** The documenter's Step 5d now keeps `modules.json` fresh after every apply cycle — it scans the handoff for new file paths, IPC channel strings, and store references and appends them to the matched module's wiring fields, with an `updatedAt` timestamp. No manual architect run needed to keep wiring current.

**No orphaned features:** The planner's Step 4 (module assignment) now handles the case where no module fits — it generates a suggested module name from the feature description and existing taxonomy, presents it in the QA strip with an Accept default, and emits `[module] <new-id>` on re-invocation. The documenter creates the new module record on apply. Every feature ships into a registered module.

**BACKSTAGE.md merged into FORGE-OVERVIEW.md:** The separate design rationale file (15 "why it works this way" entries) was folded inline into the relevant sections of this document. The Backstage button in FORGE now surfaces this complete reference instead of a smaller separate file. BACKSTAGE.md deleted.

**Board hygiene:** 36 completed todos cleaned from `board.json` — 5 orphaned entries deleted, 31 archived to `PLAN-archive.md`. Documenter Step 5c replaced 7-day silent purge with immediate archival so completed todos always have a permanent record.

---

### Era 16 — Capability-scoped skills and user domain knowledge

```
project.json: capabilities[] → resolveCapabilitiesForTask() → filterSkillsByCapabilities() → --append-system-prompt
```

The Era 9 SKILLS system filtered by stack label — a task on an Electron project got all Electron rules. The problem: stack label is coarse. A fix to a Svelte component still received Electron IPC rules even though no main process code was involved. Research on the "lost in the middle" effect confirmed why this mattered — rules placed in the middle of injected context are recalled at ~40–50% vs ~90% at the start or end. Irrelevant rules don't just waste tokens; they crowd out the rules that do apply.

**Per-capability files** broke the monolithic SKILLS.md subsections into individual concern files at `templates/code/docs/gotchas/skills/<id>.md` — `electron-ipc`, `electron-security`, `svelte5-reactivity`, `svelte5-components`, `typescript-strict`. Each file is independently stamped with a generated date so the integrity-checker can flag stale sections in isolation rather than the whole file.

**Task-aware injection** added `resolveCapabilitiesForTask()` in `shared.ts`. It parses file paths mentioned in the handoff, maps them to capability IDs via a `FILE_TO_CAPABILITIES` table, and intersects the result with the project's declared capabilities. A task touching only `.svelte` files gets only `svelte5-reactivity` and `svelte5-components` — main process IPC rules are not injected at all.

**`capabilities[]` in `project.json`** is the machine-readable declaration of which capability files a project uses, separate from the display-oriented `techStackLabels`. The wizard, import flow, and the Project Overview add/remove stack actions all derive and persist capabilities automatically from the stack selection via `stackLabelToCapabilities()`.

**Updated skills-generator** now generates per-capability files instead of adding subsections to a monolithic SKILLS.md. Each file covers one concern, one agent at a time, with 5–8 rules per section. The integrity-checker's Check 10 validates freshness for both the legacy SKILLS.md format and the new per-capability files.

**User domain knowledge** added an optional textarea to the wizard and import flow. Platform-specific knowledge — WoW API rate limits, Power Automate connector constraints, anything the LLM doesn't know about the target platform — is appended to `GENERAL.md` at project creation as a `## User-provided domain knowledge` section. Every agent that reads `GENERAL.md` inherits it immediately, without requiring a separate agent or special injection step.

The problem this solved: skills were stack-aware but not task-aware, and platform context had no home at creation time. The capability system makes injected context proportional to what's actually changing — smaller prompts, better rule recall, less noise for agents working in one layer of the stack.

---

### Era 17 — One Chat Phase 1: the conversation-first front door (2026-04-03)

The biggest change to how FORGE is used since the pipeline itself was built. The mode selector and pipeline prefix typing (`plan feature:`, `debug:`) are no longer the front door. You type what you want. FORGE figures out the rest.

**Phase 1a — Intent detection IPC:** A Haiku classifier runs on prompt submit via a new `classify-intent` IPC channel (`src/main/handlers/intent.ts`). It calls `spawnClaudeJson()` with a structured system prompt that maps natural language to one of 7 pipeline types and 5 modes. The result is a typed `IntentResult` — `{ ok: true; pipeline; mode; reason }` — stored in the editor store (`intentResult`, `intentPending`). A 5-second timeout with lean fallback ensures the UI never hangs on a cold Haiku start.

**Phase 1b — Intent confirmation UI:** The two-Enter confirmation flow. First Enter: classification runs, `IntentConfirmRow.svelte` appears below the textarea showing pipeline and mode as editable chips — the user sees what FORGE detected and why (the `reason` field). Second Enter: confirmed, run starts. The mode chip is a dropdown — override is one click, not a trip to settings. The original mode selector hides while chips are visible; an "override" link restores it to dismiss classification entirely. `pipelineModeOverride` threads through as an optional seventh param to `ipc.run()` and is validated in `runner.ts` before reaching the system prompt — no injection risk. After confirmation, the terminal shows `→ detected: <pipeline> · <MODE> — <reason>` above the run header.

**What did not change:** Every pipeline, every agent, every gate, every reviewer, the terminal glass wall. The routing rules are the same — the user just no longer has to know them.

**Why this matters:** FORGE now works the way a conversation with a collaborator works. You say what you want. The system proposes a plan. You confirm or adjust. Work begins. The pipeline complexity is real and valuable — it's just no longer the user's problem to navigate.

**Stage 1 of dynamic pipeline construction is also delivered:** The classifier recommends a mode (LEAN/STANDARD/FULL) based on the risk profile of the request, not just the pipeline type. A CSS tweak gets LEAN. An auth feature gets FULL. The user sees the recommendation and can override it before a single agent runs.

**Shipped in this era:**
- Phase 1a intent detection IPC (`classify-intent`, Haiku classifier, 5s timeout, lean fallback)
- Phase 1b intent confirmation UI (two-Enter flow, IntentConfirmRow editable chips, `pipelineModeOverride`)
- Intent classification log persistence (`log-intent-override` IPC, `.pipeline/intent-log.jsonl`, 1000-entry cap)
- Classifier gap fixes: TRIVIAL mode distinct UX (amber chip, "direct edit — no agents will run"), stale chip clear on textarea edit, Escape key dismissal, apply modes excluded from classification
- Pipeline type routing made functional: `resolvedPipeline` drives `ipc.run()`, classifier output actually determines which pipeline runs
- Count-based triage gate: invoke reviewer-triage when ≥3 reviewers regardless of mode
- **Non-pipeline request handling (Phase 1.5 POC):** `'chat'` pipeline type routes questions/greetings to a direct Claude reply — no pipeline, no agents. LEAN_FALLBACK changed from `'plan feature'` to `'chat'` for safer timeout handling.
- **LIVE tab agent preview (Phase 1.5):** After classification succeeds, LIVE tab pre-populates with pending agent cards for the resolved pipeline before the user confirms. Dropdowns sync cards live.
- **Cost optimisations (shipped alongside Phase 1):** Coder-scout Haiku pre-step resolves file paths before coder runs (max 5 files). Tier-based model routing: planner emits `[tier]` signal, coder routed to Haiku for tier-a (bug fixes), Sonnet for tier-b/c. Key facts extraction in research (max 100 tokens). Revision mode for coder skips static context on retry loops. Tightened BLOCK thresholds across all 5 reviewers — block only on silent runtime failures, security breaches, or unrecoverable races.
- **Gates inline with terminal:** Gate #1 and Gate #2 render inside the terminal's scrollable content as conversation pauses, not fixed UI chrome.

---

### Era 18 — Real One Chat: the conversational orchestrator (2026-04-07)

The Haiku classifier from Era 17 was a step in the right direction, but it still felt like operating a tool — type, wait for classification, confirm, then work happens. Real One Chat removes that friction entirely. You talk to FORGE the same way you talk to Claude in the CLI. One Enter. A conversation. Pipelines are invisible infrastructure.

**What replaced what:** The Haiku `classify-intent` IPC call + `IntentConfirmRow` two-Enter confirmation is gone. In its place: a single Sonnet orchestrator session that receives every message. The orchestrator is conversational — it can chat, answer questions, discuss ideas, and propose pipeline approaches. Only when the user approves an approach does a pipeline run.

**The 90% context reduction:** The Haiku classifier was fast because it was small. The orchestrator is Sonnet — it needs to be fast too. The key insight: the orchestrator doesn't need the 240KB of agent definitions that pipeline runs require. For conversation, it only needs GENERAL.md (~8KB), SKILLS.md (~23KB), and the ORCHESTRATOR_RULES (~3KB). Agent injection is skipped entirely for `one-chat` mode. The result: ~34KB of system context, comparable to a direct Claude CLI conversation.

**Pipeline handoff via signal:** When the orchestrator proposes an approach and the user approves, it emits `[run-pipeline] plan feature | standard | Add dark mode toggle`. App.svelte captures this signal, stops the lightweight orchestrator session, and auto-starts a proper pipeline run with full agent injection. The user sees one continuous flow in the terminal — the orchestrator's proposal, the approval, then agents spinning up in the LIVE tab.

**Thinking suppression:** In one-chat mode, extended thinking blocks are silently consumed instead of rendered as dim terminal lines. The model still reasons internally, but the terminal shows only the conversation — matching the feel of a direct Claude Code session. Pipeline modes still render thinking for glass-wall transparency.

**Enriched TODOs:** The orchestrator writes detailed, actionable TODO items by default — with TYPE prefix, clear title, and context. No separate Haiku enrichment call needed because Sonnet is already writing the text.

**What was explored and rejected:** A three-column layout (conversation | terminal | data panels) was built and tested. The user found it worse — the conversation surface felt separated from the glass wall. The terminal + prompt below IS the conversation. The two-column layout was restored.

**Shipped in this era:**
- `one-chat` mode with ORCHESTRATOR_RULES system prompt
- 90% context reduction (skip agent injection for conversational mode)
- Single-Enter PromptBar (no classification, no confirmation chips)
- `[run-pipeline]` signal + pipeline handoff in onDone
- Thinking suppression for one-chat mode
- Enriched TODO instructions in orchestrator prompt
- Right panel width 240px → 290px (fits all tabs with collapse arrow)
- Removed: IntentConfirmRow usage, editor intent state, Haiku classification flow
- **Terminal readability overhaul (8 improvements):** Dim work lines / brighten conversation (opacity layering), gold accent border on orchestrator prose, user prompt echo restyled with bold + background tint, separator lines between conversation turns, bold markdown headers in gold, auto-collapsible work blocks in one-chat mode (click to expand), sticky gate bar pinned to bottom when approval needed with amber pulse, rotating idle messages (40 per pool) for empty terminal and prompt placeholder
- **TODO enrichment levels:** 3-tier enrichment setting (Light / Standard / Full) in FORGE Settings. Controls both the Haiku `enrich-todo` IPC (≈ button in TODO panel) and the One Chat orchestrator's `[todo]` signal detail level. Runner reads `enrichLevel` from `forge-settings.json` and injects `ENRICH LEVEL` directive into orchestrator system prompt.
- **Documentation restructure:** FORGE-OVERVIEW.md trimmed to narrative-only (Eras + philosophy, 580 lines from 1363). Technical reference sections moved to FORGE-REFERENCE.md (generated on demand from source-of-truth files). Update recipe written to `FORGE-OVERVIEW-RECIPE.md` covering both documents and the slide deck.
- **Modules audit:** Added One Chat module to modules.json. Updated pipeline-system (removed deleted agents, added agent-skip capability), prompt-run-controls (One Chat single-Enter), terminal-output (8 readability capabilities), settings (enrichLevel), task-board (3-tier enrichment + orchestrator cross-reference).

---

### Era 19 — The Plugin Era: from Electron app to Claude Code plugin (2026-04-08 → 2026-04-11)

The biggest architectural change in FORGE's history. FORGE stopped being an Electron desktop application and became a pure Claude Code plugin.

**Why the pivot happened:** The Electron app had three fundamental friction points that no amount of UI polish could fix:
1. **Updates required re-scaffolding.** Fixing an agent prompt in FORGE meant rebuilding the app and copying updated files to every project. Template drift was constant.
2. **Distribution required building installers.** Electron packaging, Node.js dependency management, platform-specific builds. A team member joining required a full install chain.
3. **Maintenance required IPC boilerplate.** Every feature needed four layers: main process handler, preload bridge, type declaration, renderer store. A simple config change touched 4+ files.

A Claude Code plugin solves all three. Change once in the plugin, all projects get it immediately. Team members install via `claude plugin install forge`. No build step, no IPC, no main/preload/renderer split.

**What was built in 4 days:**

The plugin (v0.2.0) shipped with:

- **28 agents** — every agent from the Electron app, stripped of IPC/Svelte/Electron references, upgraded with `maxTurns`, `effort`, and concrete `"Use when:"` descriptions
- **18 skills** — replacing 17 slash commands that were migrated from `commands/forge/*.md` to `skills/<name>/SKILL.md` format, plus a new `/forge:overview` skill. Skills use `context: fork` for 92% token savings.
- **11 hook scripts across 7 event types** — SessionStart (3: deps install, context measurement, banner), PreToolUse (3 with 5 matchers: bash-guard, workflow-guard, role-based access), PostToolUse (1: audit logging), Stop (1: incomplete pipeline detection), PostCompact (1: context reinjection), SubagentStart (1: lifecycle tracking), SubagentStop (1: verdict extraction)
- **17 MCP tools** — structured access to board (4 tools), project config (2), pipeline state (3), modules (2), model routing (6). ESM server at `mcp/server.js` with Zod schemas and error handling.
- **4 lib modules** — config-store (persistent config resolution), usage-store (per-project quota tracking), router (pure model recommendation with 4-priority fallback), openai-adapter (OpenAI Responses API via built-in fetch)
- **Enforcement hooks** — bash-guard blocks `cat`/`grep`/`find`/`sed` with exit code 2, forcing dedicated tools. workflow-guard blocks source writes outside pipeline conditions. ctx-pre-tool enforces role-based file access. Inspired by GSD and Disciplined Process Plugin research.
- **Git integration** — opt-in branch creation before implementer, auto-commit after tests, auto-PR via `gh` after documenter. Safety-first: git failures never block the pipeline.
- **Test execution** — opt-in `testCommand` in project.json. 60s timeout. Emits `[suggest] debug` on failure, never auto-fixes.
- **Subagent lifecycle tracking** — SubagentStart/SubagentStop hooks record agent_id, startedAt, completedAt, durationMs, and extracted reviewer verdict outcome in `run-active.json`.
- **Context resilience** — PostCompact hook reinjects critical FORGE rules from `forge-rules.md` after mid-session context compression. Stop hook detects incomplete pipelines with 30-minute staleness guard.
- **Model routing** — `forge-config.json` with provider registry, model catalog, per-agent preferred/fallback mappings. Budget modes (economy/standard/performance). OpenAI Codex as first external provider. Quota exhaustion detection.

**What was stripped:** All Electron/Svelte/IPC content removed from 22 agents, 7 templates, and all documentation. 4 Electron-specific skill files deleted. 89 dead board items removed. The Electron app at `C:\Users\cuj\Forge` is frozen permanently.

**What was gained that Electron couldn't do:**

- Plugin updates reach all projects instantly — no re-scaffolding, no version drift
- Multiple terminal windows can run parallel pipelines via git worktrees
- MCP tools provide structured state access without IPC boilerplate
- Hook enforcement is per-tool-call, not per-UI-action — more granular control
- The plugin dogfoods itself (FORGE develops FORGE using its own pipeline)

**What was lost:** The visual UI — reactive sidebar, LIVE tab with agent cards, gate bars with diff previews, HEALTH dashboard with verdict graphs. These are deferred to an optional web dashboard in the backlog, not rebuilt in the plugin. The terminal + Claude Code's native agent viewer are the glass wall now.

**Shipped in this era:**
- Plugin v0.2.0 with `.claude-plugin/plugin.json` manifest
- 134 Electron violations identified and fixed across agents, skills, templates
- Full Electron strip of 22 agents, 2 commands, 7 templates
- Skills migration: 17 commands → 18 skills with `context: fork`
- MCP server: 17 tools, 4 lib modules, Zod schemas, isError pattern
- Model routing: 6 MCP tools, config-store, usage-store, router, openai-adapter
- Enforcement hooks: bash-guard, workflow-guard, ctx-pre-tool (3 blocking hooks)
- Lifecycle hooks: SubagentStart/Stop tracking, PostCompact reinjection, Stop advisory
- Git integration: branch creation, auto-commit, auto-PR (opt-in)
- Test execution: configurable testCommand, 60s timeout, debug suggest
- Agent upgrade: all 28 agents got maxTurns, effort, concrete descriptions
- Board rebuilt: 55 open tasks, 89 dead items removed
- Competitive research: GSD distribution, Compound Engineering, enforcement patterns

---

### Era 20 — Lifecycle Enforcement: from prompt trust to structural truth (2026-04-12)

Era 19 built the plugin. Era 20 made it honest.

**Before:** The plugin had 28 agents, 17 MCP tools, and 11 hooks — but the lifecycle was held together by prompt instructions. Skills told the model "call `forge_create_run`" — and the model usually did. Skills told the model "check Gate #2 before applying" — and the model sometimes did. Gate timestamps were overwritten on approval. `run-active.json` was missing the fields its readers expected. Orphaned runs disappeared when `index.json` was lost. `/forge:debug` and `/forge:refactor` operated outside the run lifecycle entirely. And the commands-to-skills migration was never committed — old command files at git HEAD were shadowing the new skills at runtime.

The glass wall was cracked: the system could look truthful while silently running out of sequence.

**What changed:** A systematic enforcement sweep that replaced prompt trust with structural truth at every gap:

1. **Gate timestamps preserved.** `forge_set_gate(approved)` now reads the existing gate file to preserve the original pending `createdAt` instead of overwriting it. The run registry uses the gate's pending timestamp, not the run creation time.

2. **`run-active.json` initialized at pipeline start.** `forge_create_run` now writes the top-level marker (`startedAt`, `pipelineType`, `mode`) that `workflow-guard.js` and `forge-status.js` need. The pipeline is visible from the moment it's created, not from the first agent spawn.

3. **Orphaned run recovery.** New `rebuildIndex()` function reconstructs `index.json` from authoritative `r-*/run.json` files on disk. Called lazily by `listRuns()` when the index is missing or empty. Runs can no longer become permanently invisible.

4. **Debug and refactor joined the lifecycle.** Both skills rewritten from prose to structured format with `forge_create_run`, step tracking, and explicit gate writes. All five pipeline types (plan, implement, apply, debug, refactor) now participate in the run lifecycle.

5. **Commands-to-skills migration committed.** The 17 old `commands/forge/*.md` files were deleted from the working tree during the migration but never committed. Git HEAD still had them, and Claude Code's plugin loader was reading committed state — old prose commands were shadowing modern skills. One focused commit (`fbc54f3`) fixed all 17 shadows.

6. **Init cleans legacy commands.** `/forge:init` now removes stale `.claude/commands/forge/` files before checking if the project is initialized. Legacy projects get cleaned on re-init.

7. **Apply gate enforcement — structural, not prompt.** The SKILL.md prompt check (STEP 1b) was added but runtime tests proved the model bypasses it. The real fix: `workflow-guard.js` now hard-blocks source file writes during apply runs unless `gate-pending.json` shows gate2 approved. Exit code 2, unconditional, cannot be bypassed by the model. This is the first write-boundary enforcement in FORGE — a structural sequencing invariant, not a suggestion.

8. **Implementation-architect agent.** New conditional agent (`implementation-architect`) that narrows broad plans to the next smallest safe implementation slice. Invoked before the coder when the plan has 8+ tasks, crosses 3+ directories, or contains risky keywords. Writes `docs/context/slice-brief.md`. The coder scopes to it.

**What this exposed:** Prompt-level branching is not reliable for safety-critical sequencing. The model optimizes for task completion and treats "if X then stop" as optional. Structural enforcement (hooks that block at the write boundary) is the only reliable mechanism for invariants that must hold.

**Shipped in this era:**
- Gate timestamp preservation in `forge_set_gate` and run registry sync
- `run-active.json` initialization in `forge_create_run`
- `rebuildIndex.js` with lazy healing in `listRuns()`
- `/forge:debug` structured lifecycle skill (38 lines)
- `/forge:refactor` structured lifecycle skill (40 lines, reviewer-style always included)
- Commands-to-skills migration commit (fbc54f3: 34 files, 715 insertions, 223 deletions)
- `/forge:init` legacy command cleanup (STEP 1a commands, 1b hooks)
- `/forge:init` `.gitignore` hygiene (STEP 1c) + tracked-state detection with remediation guidance (STEP 1d)
- `/forge:apply` STEP 1b prompt-level gate check (defense-in-depth)
- `/forge:apply` structural gate enforcement in `workflow-guard.js` (hard block, exit 2)
- `/forge:apply` handoff-to-gate feature matching (word-based, filler removal, stemming)
- `/forge:apply` worktree path isolation (source writes outside worktree blocked, exit 2)
- Structural worktree binding: `forge_create_run` auto-resolves worktree from gate2 feature match, writes to `run-active.json`
- Structural commit-before-merge: `forge-worktree.js merge` auto-commits real worktree changes
- Safe merge conflict handling: abort on conflict, preserve worktree/branch, exit non-zero
- `/forge:apply` worktree merge-back wiring (Steps 8-9 in skill + structural in merge script)
- Template cleanup: removed 12 stale hook files + 3 settings.json from all templates
- `implementation-architect` agent (138 lines) with conditional routing in implement skill
- Coder `slice-brief.md` reading rule
- Worktree auto-creation at gate2 in `gate-sync.js`
- Apply-phase worktree context injection via `apply-context-inject.js`
- Plugin now has 29 agents, 19 skills, 13 hooks, 22 MCP tools

---

### Era 21 — The Wrapper TUI: FORGE in the same terminal as Claude (2026-04-15)

Era 20 made the plugin structurally honest. Era 21 made it visible without leaving the work.

**Before:** To watch FORGE run, the user had to leave Claude. The dashboard was an HTTP sidecar — start a separate Node server (`npm run dashboard`), open a browser tab at `localhost:7878`, deal with port conflicts when a second session started, and live with project mismatch when two sessions from two repos fought over the same port. Every gate, every run, every board check was a context switch out of the terminal and back. `/forge:dashboard` existed as a skill but only produced an in-chat text snapshot — for a live view you had to alt-tab to the browser. The glass wall was visible, but through a different window. Transparency without proximity.

**What changed:** A pivot from browser-based sidecar to terminal-native split-pane TUI, delivered as three coherent artefacts plus an unwiring sweep:

1. **Wrapper prototype — the new primary surface.** `scripts/forge-wrapper-proto.mjs` spawns Claude as a `node-pty` child, parses its output through `@xterm/headless` to preserve the cell grid, and paints it into the left pane of a `blessed` split screen. The right pane polls `buildDashboardState` every 2s and renders active runs, pending gates, recent completions, and top-priority TODOs. Color-aware cell rendering preserves Claude's own styling; SGR mouse reporting routes the wheel to the xterm buffer (no more wheel-to-arrow translation); `Ctrl+B` `Q` quits cleanly with explicit alt-screen restoration and a 500ms SIGKILL fallback.

2. **Observer — the primary terminal surface.** `scripts/forge-observer.mjs` gives the four-section dashboard as a standalone full-screen Ink (React) app, for users who run native `claude` in one terminal pane and FORGE state in another. No wrapping, no PTY. SGR mouse reporting is enabled so any click refreshes; `Shift`+click-drag remains the user-side text-selection gesture.

3. **Sidecar unwired, not deleted.** `"dashboard": "node scripts/dashboard-server.mjs"` removed from `package.json`. `/forge:dashboard` skill repointed: renders the in-chat snapshot for the current session and points users at the wrapper prototype for the live experience. `scripts/dashboard-server.mjs` and its three regression tests stay on disk during the transition phase; a later cleanup slice removes them once the wrapper path is fully validated.

4. **Truecolor banner stashed.** The legacy Electron app's Braille-pattern flame + RGB-gradient FORGE wordmark (`scripts/forge-banner-truecolor.js`) was lifted from `C:\Users\cuj\Forge\banner.js` and committed verbatim for use in a future wrapper splash. Zero dependencies, self-contained.

**What this exposed:** Terminals cannot simultaneously do app-captured mouse (buttons, drag-drop) and native click-drag text selection on the same pane — it's protocol-level mutually exclusive, not a library limitation. Every serious TUI with a mouse UI (vim, tmux, htop, lazygit, k9s) accepts `Shift`+click-drag as the selection override, because Windows Terminal and friends treat Shift as the "bypass the app" modifier. FORGE adopted the same convention. The tension motivates the next era's direction: interactive right-pane actions (gate approve/discard, merge retry, drag-drop task reordering) and pixel-art worker cards — now possible without compromising the copy-paste story, because Shift is the release valve.

**Shipped in this era:**
- Wrapper mouse wheel scroll via SGR mouse reporting (commit `f12f85c`)
- Wrapper color-aware Claude pane — per-cell reads of xterm's `IBufferCell`, ANSI SGR diff-emission, wide-char continuation handling (commit `bafbd81`)
- Wrapper right-pane dashboard polling with 2s refresh + blessed color markup + tag-escaped user strings (commit `ffbe9df`)
- Observer prototype + non-TTY smoke test (commit `633d465`)
- Direction change: wrapper TUI primary, sidecar legacy; `/forge:dashboard` reframed; npm script removed; docs updated (commit `473721c`)
- Legacy truecolor banner + flame stashed for future splash (commit `cfb9bab`)
- Quit-path hardening on the wrapper: alt-screen restoration, mouse-tracking cleanup, 500ms SIGKILL fallback (commit `2b4fd44`, from the prior end of the day)
- New utility: `scripts/png-to-sprite.mjs` for converting PNG assets to half-block truecolor terminal sprites (reusable for future worker cards)

---

### What's planned next

*Source: `.pipeline/board.json` — 41 open items as of 2026-04-15.*

**Parallel sessions with worktree isolation:** Start task B while task A is still running. Each pipeline run gets its own git worktree. Design includes stuck detection, crash recovery, atomic commits per task, cost tracking per session. Sub-tasks: dependency analysis for wave scheduling, stuck loop detection, crash recovery with forensics.

**Wrapper TUI maturation:** Era 21 delivered the prototype pivot. Remaining work: promote the wrapper to a finalized `bin/forge` launcher (wrapper script stays; launcher wires `forge` on PATH). Add right-pane mouse interactions — clickable gate approve/discard, merge-blocked retry, drag-drop task reordering — leveraging the Shift-to-select tradeoff. Pixel-art worker cards driven by `scripts/png-to-sprite.mjs` once sprite PNGs are authored. Cost tracking display per run. Hard-delete the legacy HTTP sidecar files and `scripts/forge-tui.mjs` once the wrapper path is fully validated across platforms.

**External model routing (Codex/OpenAI):** The `forge_call_external` adapter, router, config, and usage tracking are built and tested (auth + request format verified). Blocked on user's OpenAI API billing. When resolved, one test call activates it.

**Knowledge and learning:** Knowledge refresh (prune stale `docs/solutions/`), session history search (have we seen this error before?), Context7 MCP integration for live framework docs (parked — rate limit concern).

**Pipeline resilience:** Pipeline stage restart (restart from a specific failed agent), worktree crash recovery with forensic synthesis from surviving tool calls.

**Distribution:** Plugin settings (`add-plugin-settings`), user config at install time, enterprise docs for Azure/Bedrock/Vertex.

**Discoverability and UX:** Agent overview skill (evaluate if native `/agents` is enough), plugin data persistence via `${CLAUDE_PLUGIN_DATA}`, scope guardian check in gotcha-checker.

### Design decisions — what FORGE deliberately does not do

**No Electron app.** The Electron desktop application at `C:\Users\cuj\Forge` is frozen as of April 2026. The plugin approach solves distribution, updates, and maintenance friction that no amount of UI improvement could fix. The visual UI (LIVE tab, gate bars, HEALTH dashboard) is deferred to an optional web dashboard, not rebuilt. See `docs/DECISIONS.md` entry for 2026-04-10.

**No test coverage agent (yet).** A nyquist-auditor agent was prototyped and deleted. It wrote manual test stubs that connected to nothing — no runner reads them, nobody checked them. Test coverage tooling is the right idea but the wrong time. The `testCommand` field in project.json provides the foundation — when test execution is mature, a coverage agent should be designed as part of that loop.

**No spec agent.** A spec-agent was prototyped and deleted. The planner's Q&A step (via `[questions]`/`[/questions]` signals) already clarifies scope when ambiguous. A separate spec step would produce a document the planner immediately re-reads to ask roughly the same questions — a detour to the same destination.

**No multi-runtime support.** FORGE is Claude Code-only. GSD supports 9 runtimes. Compound Engineering supports 5+ via a Bun converter. FORGE deliberately chose depth over breadth — enforcement hooks, MCP tools, subagent lifecycle tracking, and PostCompact reinjection are Claude Code-specific features that would require significant abstraction to port. The trade-off is accepted.

**Skills replaced commands.** The 17 `commands/forge/*.md` files were migrated to 21 `skills/<name>/SKILL.md` files in v0.2.0+ (17 replacements + 4 new: `/forge:overview`, `/forge:refresh-docs`, `/forge:resume`, `/forge:help`). Skills use `context: fork` for 92% token savings — the skill prompt runs in a forked context rather than loading the full conversation. The old `commands/forge/` directory was removed. All skill `name:` fields carry the `forge:` prefix to prevent command-shadowing collisions with Claude Code's native commands.

---

*Last updated: 2026-04-14. For complete technical reference, see [FORGE-REFERENCE.md](FORGE-REFERENCE.md). For architecture decisions, see `docs/DECISIONS.md`. For the update recipe, see `docs/FORGE-OVERVIEW-RECIPE.md`.*
