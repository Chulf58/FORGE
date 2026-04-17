# FORGE

**FORGE gives Claude Code a structured workflow — plan, review, implement, apply — with human approval gates at every major transition.**

FORGE structures your Claude Code sessions into a multi-agent pipeline with planning gates, specialist reviewer waves, persistent project state, and human approval checkpoints. It does not replace Claude Code — it orchestrates it.

---

## The glass wall

When you submit a prompt to a plain AI tool, work disappears into a black box. You get a result. You don't know what decisions were made, what was considered and rejected, or why the output looks the way it does. If something is wrong you can't trace it.

FORGE is built on the opposite premise. The terminal is a live window into the work as it happens. You watch the planner reason through your feature. You watch the researcher investigate an unknown. You watch reviewer-safety raise a concern and the coder revise its approach in response. Every decision is visible as it streams.

Think of a restaurant with a glass-wall kitchen. You talk to the waiter — the interface that guides you, asks clarifying questions, and carries your request to the kitchen. The chefs are the specialist agents doing the work. You may not understand every technique, but you can see everything happening in real time. By the time your feature arrives — planned, reviewed, implemented, documented — you watched it being made.

Gates are the formal control points. The terminal is the continuous one.

---

## How it works

```
/forge:plan "add OAuth login"
    → planner + researcher + gotcha-checker run
    → reviewers check the plan in parallel
    → Gate #1: you read the plan and approve it

/forge:implement
    → coder writes implementation to handoff.md
    → reviewers check: safety, logic, style, performance
    → Gate #2: you read the verdicts and approve

/forge:apply
    → implementer applies changes to source files
    → documenter updates changelog and architecture docs
```

No code touches your project until you approve Gate #2.

---

## Install

### Local path

```bash
claude --plugin-dir /path/to/forge-plugin
```

### Marketplace

Marketplace distribution is in progress — use local path for now.

```bash
claude plugin marketplace add <your-forge-repo>
claude plugin install forge@forge-tools
```

---

## Quick start

Start a Claude Code session with the plugin loaded, then run these commands in any project:

```
/forge:init      — scaffold pipeline state for this project
/forge:plan      — plan a feature
/forge:status    — project snapshot
/forge:dashboard — pipeline and board overview
```

---

## Pipeline modes

Set per project in `.pipeline/project.json` (`pipelineMode` field). Controls how deep the review wave goes.

| Mode | When to use | Effect |
|------|-------------|--------|
| TRIVIAL | Single-file fix, no logic change | Bypass pipeline entirely |
| SPRINT | Easy task, high confidence | Core agent only, no reviewers |
| LEAN | Everyday default | Core + safety reviewer |
| STANDARD | Multi-file, cross-cutting changes | Core + completeness-checker + triage-dispatched reviewers |
| FULL | High-stakes, nothing skipped | Core + all 5 specialist reviewers |

---

## Gates

Two mandatory human checkpoints — nothing proceeds without your explicit approval.

**Gate #1 — Plan approval** (after `/forge:plan`)
You see the plan, task breakdown, and approach. `/forge:approve` moves to implementation. `/forge:discard` drops the plan.

**Gate #2 — Implementation approval** (after `/forge:implement`)
You see the implementation summary and all reviewer verdicts. `/forge:approve` moves to apply. `/forge:discard` drops the handoff.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/forge:init` | Scaffold pipeline state for this project |
| `/forge:plan` | Plan a feature — runs planners and reviewers, ends at Gate #1 |
| `/forge:implement` | Implement an approved plan — runs coder and reviewers, ends at Gate #2 |
| `/forge:apply` | Apply an approved implementation to source files |
| `/forge:debug` | Debug a broken behaviour — runs diagnostics and reviewers |
| `/forge:refactor` | Restructure existing code — runs refactor agent and reviewers |
| `/forge:approve` | Approve the pending gate and proceed |
| `/forge:discard` | Discard the pending gate and cancel the run |
| `/forge:status` | Project snapshot with next-step hints |
| `/forge:dashboard` | Active runs, pending gates, and board overview |
| `/forge:todo` | View and manage the task board |
| `/forge:resume` | Resume an interrupted pipeline run |

---

## What's included

- **29 specialist agents** — planner, researcher, coder, 5 reviewers (safety, logic, style, performance, boundary correctness), implementer, documenter, architect, ideator, and more
- **21 skills** — slash commands that orchestrate agents into pipelines
- **13 hook scripts** across 7 lifecycle events — enforcement, context injection, board hygiene
- **24 MCP tools** — structured access to pipeline state, board, gates, model routing, and dashboard
- **Multi-model routing** — per-agent model selection with Anthropic and Gemini support; the Gemini-backed supervisor agent produces implementation briefs from outside the Claude model family

---

## What's coming

A native TUI dashboard for monitoring pipelines without leaving the terminal and improved worktree-based parallel execution are in active development.

---

## Docs

- [FORGE-OVERVIEW.md](docs/FORGE-OVERVIEW.md) — what FORGE is, the glass wall principle, comparison with similar tools
- [FORGE-REFERENCE.md](docs/FORGE-REFERENCE.md) — full agent tables, signal protocol, hook system, MCP tools, model routing
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map and key file locations

---

## License

MIT
