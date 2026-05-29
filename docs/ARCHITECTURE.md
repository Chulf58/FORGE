# Architecture — FORGE Plugin

## Stack
Claude Code plugin: Node.js hooks (CJS), Markdown agents/skills, JSON config, MCP server (ESM), packages/forge-core (ESM + Zod), orchestrator state machines (ESM).

## Overview
FORGE is a Claude Code plugin that provides AI-powered development pipelines. It injects 25 agents, 31+ skills, and ~53 hook scripts into any project where the plugin is installed. The plugin orchestrates multi-agent workflows (plan, implement, review, apply, debug, refactor, ideate) against the user's codebase, with each pipeline run isolated in a git worktree. A knowledge base with index-backed retrieval accumulates learnings across runs and auto-injects relevant gotchas into agent prompts at dispatch time.

The attention-first redesign (commits 619b2c3b + 3f967726) introduced a deterministic orchestrator layer (`mcp/lib/orchestrator/`) that replaces prose-following LLM workers for plan-stage and implement-stage pipelines.

## Module map

| Module | Description | Key files |
|--------|-------------|-----------|
| Pipeline Agents | 25 agent definitions forming plan, implement, review, apply, debug, and knowledge pipelines | `agents/*.md` |
| Skills | User-facing pipeline skills — full orchestration, gate management, status, and conversational entry points | `skills/*/SKILL.md` |
| Deterministic Orchestrator | State machines for plan-stage and implement-stage; stateless agent-dispatch primitive; Gap-1 knowledge auto-inject | `mcp/lib/orchestrator/` |
| MCP Server | 40 forge_* tools across 6 domain modules; persists pipeline state, model catalog, and knowledge | `mcp/server.js`, `mcp/lib/` |
| Knowledge Base | Structured project knowledge: gotchas (split-file), solutions, decisions; index-backed retrieval; kind-tagged entries | `mcp/lib/knowledge-store.js`, `mcp/lib/gotchas-index.mjs`, `mcp/lib/decisions-index.mjs`, `mcp/lib/tools/knowledge.js` |
| Run Registry | Durable run identity + lifecycle (Zod schemas, on-disk index) | `packages/forge-core/src/runs/` |
| Hooks | Session tracking, TDD gate, workflow guard, tool audit, context injection, loop detection, inline-capture (Check 5) | `hooks/*.js`, `hooks/hooks.json` |
| Parallel Sessions | Git worktree isolation + per-run autonomous worker process | `bin/forge-worktree.js`, `mcp/forge-worker.mjs` |
| Observer & Dashboard | Terminal-kit observer, blessed forge-tui, HTTP dashboard server | `scripts/forge-observer.mjs`, `scripts/forge-tui.mjs`, `scripts/dashboard-server.mjs` |
| Project Scaffolds | Bootstrap templates copied by /forge:init (6 stack types) | `scaffolds/` |
| LEAN Risk Gate | Post-handoff authoritative reviewer dispatch + per-phase parallel plan review | `scripts/lean-risk-classify.mjs`, `scripts/reviewer-dispatch.mjs` |
| TDD & Coverage Tooling | @covers tag impact map, covers-verify, gotchas-coverage-verify, wiring-verify | `scripts/covers-*.mjs`, `scripts/gotchas-coverage-verify.mjs`, `scripts/wiring-verify.mjs` |
| Audit & Observability | Tool-call anti-pattern detection, pipeline integrity checks, dead-code scan, critic pre-scan | `scripts/audit-tool-calls.mjs`, `scripts/integrity-check.mjs`, `scripts/critic-pre-scan.mjs` |
| Dev Tooling | Regression runner, agent validator, token audit, version bumping, post-apply lifecycle, changelog splicing | `scripts/run-tests.mjs`, `scripts/post-apply-lifecycle.mjs`, `scripts/splice-changelog.mjs` |
| Commands | Legacy slash commands (hello, doctor) not yet migrated to skills | `commands/forge/` |

## Deterministic orchestrator (attention-first redesign)

`mcp/lib/orchestrator/` has four modules, activated by env flags in `mcp/forge-worker.mjs`:

| File | Role | Activation |
|------|------|-----------|
| `agent-dispatch.mjs` | Stateless SDK `query()` wrapper; loads `agents/<type>.md` for model + systemPrompt; path-traversal guard on agentType | both plan + implement paths |
| `plan-stage.mjs` | `runPlanStageOrchestrator` — runs planner → gotcha-checker (+ researcher if needed) → reviewer loop with REVISE cap (M<2) → gate1 | `FORGE_ORCHESTRATOR_PLAN=on` |
| `implement-stage.mjs` | `runImplementStageOrchestrator` — runs coder-scout → coder → completeness-checker → reviewer loop with REVISE cap → gate2 (exit-and-resume defer-gate: writes gate2 then returns; resumes at apply on re-invocation with `orchestratorState.phase='apply'`) | `FORGE_ORCHESTRATOR_IMPLEMENT=on` |
| `knowledge-inject.mjs` | `buildInjectedKnowledge(keywords, projectDir)` — tokenizes feature name → calls `searchConstraints` → formats matched gotcha sections as injectable prompt block for Gap-1 auto-inject | injected as `deps.buildInjectedKnowledge` |

## MCP Server domain modules (as of 2026-05-28)

`mcp/server.js` is a thin ESM shell that calls `register(server, shared)` on 6 domain modules.

| Domain module | Tool count | Responsibility |
|---------------|-----------|----------------|
| `mcp/lib/tools/board.js` | 9 | Board, tasks, notes, project, blocked-by |
| `mcp/lib/tools/run-gate.js` | 3 | Active run pointer + gate read/write |
| `mcp/lib/tools/modules.js` | 2 | Module-map read + assignment |
| `mcp/lib/tools/model-mgmt.js` | 8 | Router, external call, usage, catalog |
| `mcp/lib/tools/run-lifecycle.js` | 12 | Create/get/list/update/classify/resume/advance/escalate/respond-to-escalation/worktree/dashboard/kill |
| `mcp/lib/tools/knowledge.js` | 6 | Constraints, patterns, learning (+ `mergeEvidenceOnConflict`), criteria read+write, get-linked |
| `mcp/lib/tools/shared.js` | — | Shared helpers + Zod schemas (not a tool module) |

Total: 40 tools, verified by `mcp/server-registration-test.mjs`.

## Knowledge base (post-redesign)

The knowledge layer now has three retrieval paths and a `kind` tag on all returned entries:

| Retrieval path | Source | Module |
|----------------|--------|--------|
| `searchConstraints(projectDir, keyword)` | Reads every `.md` in `docs/gotchas/` (flat section scan) | `mcp/lib/knowledge-store.js` — returns `kind: 'gotcha'` |
| `searchGotchasIndex(projectDir, keyword)` | Reads `docs/gotchas/index.json` (title/tags/keywords match) | `mcp/lib/gotchas-index.mjs` — returns `kind: 'gotcha'` |
| `buildDecisionsIndex(projectDir)` / `searchDecisionsIndex(projectDir, keyword)` | Parses `docs/DECISIONS.md` h2 headings into records; reads `docs/decisions-index.json` for search | `mcp/lib/decisions-index.mjs` — returns `kind: 'decision'` |

`forge_add_learning` now accepts `mergeEvidenceOnConflict: true` — on a title-conflict, `appendEvidence` merges the new `sourceEvidence` into the existing entry instead of returning a conflict error.

`docs/gotchas/` is split into topic files: `GENERAL.md` (thin, reserved for top-level stack rules) + `gates.md`, `hooks.md`, `run-lifecycle.md`, `worker-runtime.md`, `mcp-server.md`, `git-worktree.md`, `plan-review.md`, `agent-roles.md`, `tooling-limitations.md`, `conductor-discipline.md`, `vendoring.md` + `index.json` (search index, 37+ records).

`scripts/gotchas-coverage-verify.mjs` verifies every `index.json` record is backed by a matching heading in its source file and queryable through `searchGotchasIndex`. Exit 0 = pass, exit 1 = gaps.

## LEAN Risk Gate / Reviewer dispatch

`scripts/reviewer-dispatch.mjs` is the single authoritative reviewer dispatcher for both plan-stage and implement-stage:

- **Whole-plan mode** (`--stage=plan --run-id=...`): keyword-scans active task lines to select reviewers; outputs `{ reviewers, reasons }` JSON.
- **Per-phase parallel mode** (`dispatchPerPhase`): exported function splits a phased plan into per-phase reviewer sets (cap: 25 dispatches per run). Technical-skeptic runs per phase; gotcha-checker runs once over the whole plan as a holistic backstop.
- **Implement-stage** (`--stage=implement`): delegates to `lean-risk-classify.mjs`, maps `triggeredRules` to specific reviewer agents.

## Entry points

- **User invokes a skill** (e.g. `/forge:plan`) → Claude Code loads `skills/plan/SKILL.md` → skill calls MCP tools and orchestrates agents.
- **User starts naturally** → `/forge:chat` detects intent and routes to supervised editing or autonomous pipeline.
- **MCP tool call** → `mcp/server.js` dispatches to the appropriate domain module → reads/writes `.pipeline/` + `packages/forge-core` run registry.
- **Worker process (LLM path)** → `mcp/forge-worker.mjs` spawned per worktree run; polls gate state; 60-minute active-worker safety valve reset per phase; 6-hour gate-poll timeout.
- **Worker process (orchestrator path)** → `mcp/forge-worker.mjs` checks `FORGE_ORCHESTRATOR_PLAN` or `FORGE_ORCHESTRATOR_IMPLEMENT` env flags; if on, delegates to `mcp/lib/orchestrator/plan-stage.mjs` or `implement-stage.mjs` respectively. Orchestrator dispatches real `agents/<type>.md` definitions via `agent-dispatch.mjs` + Anthropic SDK.
- **Hook fires** (e.g. SubagentStop) → `hooks/hooks.json` routes to the appropriate script.
- **User runs `/forge:init`** → scaffolds `.pipeline/`, `docs/`, `CLAUDE.md` into the target project using templates from `scaffolds/`.

## Agent pipeline flow

```
Phase A:  /forge:grill-intent → (Pocock interview loop) → docs/briefs/<slug>.md
Phase B:  /forge:plan → planner → gotcha-checker (+ researcher if "### Research needed") →
          reviewer loop (reviewer-dispatch.mjs dispatches; REVISE retried up to M<2) → Gate #1
Phase C:  /forge:grill-plan → (plan walkthrough with user) → Gate #1 approval
          /forge:implement → coder-scout → coder → completeness-checker →
          reviewer loop (same REVISE cap) → Gate #2 (exit-and-resume) →
          → [on approval re-invocation] documenter (apply stage)
Phase D:  (part of implement orchestrator, or /forge:apply) → documenter → learnings-extractor
          → post-apply-lifecycle.mjs

Parallel:  /forge:ideate → critic (adversarial codebase analysis)
           /forge:debug → debug (bug intent Step 0 → classify → coder/refactor)
           /forge:refactor → refactor agent
```

**Note:** `docs/briefs/` replaced `docs/brainstorms/` as the grill-intent write path. The slug is validated by `scripts/sanitize-slug.mjs` before the brief is written.

Each agent reads from and writes to files in the target project (`docs/PLAN.md`, `docs/context/handoff.md`, `.pipeline/board.json`, etc.).

## TDD pipeline (wave-split)

When tasks include test-file work, the implement pipeline splits into TDD waves:

```
test-author (writes failing tests → red bar) → coder (implements → green bar) → regression suite
```

`hooks/tdd-guard.js` (PreToolUse Write/Edit/MultiEdit) enforces this: it blocks source edits in `hooks/`, `bin/`, `scripts/`, `mcp/` unless a paired test file exists. Exemptions via `.tddguardignore`.

## Data flow

1. User describes work in natural language (via `/forge:chat` or directly)
2. `/forge:grill-intent` captures intent, motivation, success criteria → `docs/briefs/<slug>.md`
3. `/forge:plan` runs agents → `docs/PLAN.md`
4. `/forge:grill-plan` walks user through plan → inline edits → Gate #1
5. `/forge:implement` runs orchestrator → `docs/context/handoff.md`
6. User approves (Gate #2)
7. Apply stage: documenter → learnings-extractor → post-apply-lifecycle cleanup

## Knowledge accumulation

- `plan-extractor` agent: sweeps brainstorm + PLAN.md post-gate1, proposes up to 5 new learnings.
- `learnings-extractor` agent: reads handoff + reviewer verdicts + run outcome after apply, calls `forge_add_learning` (with `mergeEvidenceOnConflict` support for incremental evidence).
- `conductor-inject.js` hook: injects a summary of `docs/solutions/index.json` into every conductor SessionStart.
- `knowledge-inject.mjs` (Gap-1): `buildInjectedKnowledge` tokenizes the run's feature name, searches `docs/gotchas/` via `searchConstraints`, prepends matching sections to agent prompts at dispatch time.
- `compound-refresh` agent: archives stale `docs/solutions/` entries.

## Hooks (event map)

Event types wired in `hooks/hooks.json` (~53 hook scripts across 10 event types):

| Event | Key scripts |
|-------|-------------|
| SessionStart | mcp-deps-install, ctx-session-start, forge-banner, routing-log-clear, usage-clear-quota-flags, conductor-inject, worker-task-inject, module-coverage-check, observer-autosplit |
| UserPromptSubmit | anti-speculation-inject, conductor-prompt-inject, approval-token, observer-context-inject, worker-done-inject |
| PreToolUse | bash-guard (Bash), workflow-guard (Write/Edit), ctx-pre-tool (Write/Edit), tdd-guard (Write/Edit/MultiEdit), agent-loop-guard (Agent) |
| PostToolUse | ctx-post-tool (*), gate-sync (Write/Edit on gate-pending.json), doc-size-guard (Write/Edit) |
| SubagentStart | subagent-start, apply-context-inject |
| SubagentStop | subagent-stop (verdict/truncation detection), audit-trigger (tool-call audit) |
| Stop | ctx-stop (Checks 1–5: incomplete agents, pending gate, documenter-not-run, unapplied handoff, inline-capture marker) |
| PostCompact | ctx-post-compact (deliberate no-op) |
| SessionEnd | session-end |
| FileChanged | file-changed |

**Check 5 (ctx-stop.js):** when a fresh `docs/context/handoff.md` exists at session end (> 100 bytes, < 30 min old), writes `.pipeline/inline-capture-pending.json` as a marker queuing learning extraction for the next gate passage.

## Audit & observability

`audit-trigger.js` fires on every SubagentStop and synchronously runs `scripts/audit-tool-calls.mjs`. It detects four anti-patterns:
- `repeated-reads` — same file Read more than 3 times per agent session
- `blind-write` — Write/Edit called for a file never Read in the same session
- `tool-storm` — more than 20 tool calls in a single agent turn
- `role-violation` — conductor used Agent tool for ad-hoc (non-pipeline) work

Findings appended to `docs/audit-log.jsonl`.

## Run model

A **run** is the durable, identity-bearing, resumable logical unit of FORGE work. It has a stable `runId`, a persisted lifecycle (`created` → `running` → `gate-pending` → `completed`/`failed`/`discarded`), and on-disk state that survives Claude session restarts.

Run state lives at `.pipeline/runs/<runId>/run.json`; the lightweight registry index at `.pipeline/runs/index.json`. `orchestratorState` is a sibling field on `run.json` used by the deterministic orchestrator to persist revision counters and phase position across gate transitions.

**Worker timeouts** (in `mcp/lib/worker-timeouts.js`):
- Active-worker safety valve: 60 minutes, reset per phase via reset-pill
- Gate-poll timeout: 6 hours default, overridable via `FORGE_WORKER_GATE_TIMEOUT_MS`

## Per-project state (created by /forge:init)

The plugin writes no files on install. Projects get their pipeline state via `/forge:init`:

```
target-project/
├── .pipeline/
│   ├── board.json          — task board (TODO/PLANNED)
│   ├── project.json        — project config (tech stack, pipeline mode, capabilities)
│   ├── modules.json        — module registry (written by architect agent)
│   ├── agent-roles.json    — agent write permissions
│   ├── run-active.json     — per-session steering pointer (temporary)
│   ├── gate-pending.json   — pending gate approval (temporary)
│   ├── inline-capture-pending.json — marker written by ctx-stop Check 5 (temporary)
│   └── runs/
│       ├── index.json              — run registry index
│       └── <runId>/
│           ├── run.json            — durable per-run state (includes orchestratorState)
│           └── plan-extractor-proposals.json  — post-gate1 knowledge proposals
├── .worktrees/
│   └── <runId>/            — git worktree binding for an apply-stage run
├── docs/
│   ├── PLAN.md             — active plan (gitignored; lives only in worktree)
│   ├── ARCHITECTURE.md     — project architecture (written by architect)
│   ├── CHANGELOG.md        — change history
│   ├── DECISIONS.md        — dated decision log (parsed by decisions-index.mjs)
│   ├── decisions-index.json — generated index over DECISIONS.md
│   ├── audit-log.jsonl     — tool-call anti-pattern findings
│   ├── solutions/          — compound knowledge store (index.json + *.md)
│   ├── briefs/             — feature intent briefs (written by grill-intent; replaced brainstorms/)
│   ├── context/
│   │   ├── handoff.md      — implementation draft for reviewer pass
│   │   ├── scout.json      — coder-scout file list
│   │   ├── coder-status.json — coder task coverage sidecar
│   │   ├── slice-brief.md  — implementation-architect scoping output
│   │   └── reviewer-output/ — individual reviewer verdict files
│   └── gotchas/
│       ├── GENERAL.md      — top-level stack rules (thin; topic rules live in topic files)
│       ├── index.json      — search index (37+ records, title/tags/keywords)
│       ├── gates.md
│       ├── hooks.md
│       ├── run-lifecycle.md
│       ├── worker-runtime.md
│       ├── mcp-server.md
│       ├── git-worktree.md
│       ├── plan-review.md
│       ├── agent-roles.md
│       ├── tooling-limitations.md
│       ├── conductor-discipline.md
│       └── vendoring.md
└── CLAUDE.md               — project instructions for Claude Code
```
