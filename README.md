# FORGE

**FORGE turns Claude Code into a pipeline that plans, reviews, and ships features under human gates — and gets sharper every time it runs.**

It doesn't replace Claude Code; it orchestrates it. The model proposes, specialist reviewers check, deterministic harness rules enforce, and you approve at the few moments that actually matter.

---

## Why FORGE is different

Most "AI dev" wrappers just re-prompt the model and hope. FORGE pushes the leverage *below* the model — and compounds what it learns.

### 🧠 It has a learning loop — FORGE gets smarter the more you use it

This is the part people don't expect. FORGE runs a **compound knowledge store** that turns every run into reusable institutional memory:

- **Three kinds of knowledge, all retrievable:** `gotcha` (project pitfalls), `solution` (past fixes), and `decision` (logged architectural choices) — each index-backed and tagged by `kind` so the pipeline can weigh "⚠ hard gotcha" differently from "prior solution" or "you'd be reversing a logged decision."
- **Retrieval is first-class — and can't-skip in the deterministic path:** every agent looks up project gotchas via `forge_get_constraints` before acting. In the opt-in deterministic orchestrator, FORGE goes further and *auto-injects* the task-relevant gotchas into each agent's prompt at dispatch (Gap-1) — so retrieval can't be skipped under pressure the way voluntary lookups can.
- **A quality gate on every write:** new knowledge is rejected unless it carries a `trigger` ("when X, do Y") and `sourceEvidence` (provenance). No vague, un-actionable notes pollute the store.
- **Evidence merges instead of duplicating:** when a new learning collides with an existing one, FORGE appends the new evidence to the existing entry rather than dropping it or spawning a near-duplicate.
- **Everyone can teach it:** `/forge:learn` lets you record a lesson directly, an inline-capture hook offers to capture substantive work automatically, and the planner mines each session for new patterns — all through the same quality gate.

The result: the gotcha that bit you in run #3 is the gotcha auto-injected into the coder's prompt in run #40, before it can bite again.

### 🎛️ Attention-first — every stop changes an outcome

Human attention is the scarcest resource in the loop, so FORGE spends it deliberately. Gates exist only where a pause *changes a decision or prevents a mistake* — not as ceremony. There are exactly two review gates (plan, implementation) plus a commit gate, and the pipeline refuses to let you approve past an unresolved blocker.

### ⚙️ Deterministic where it counts — no LLM drift in the control loop

Routing and orchestration don't go through another model that can wander:

- **Reviewer dispatch is a pure function** — `reviewer-dispatch.mjs` scans the change for risk surfaces (shell, fs writes, auth, network, schema, tests) and picks the matching reviewers. No "mode dial," no LLM deciding who reviews.
- **An opt-in deterministic orchestrator (experimental)** can drive the plan/implement state machine in plain JS — a fresh subagent per phase, no LLM in the control loop. Off by default; the gate resume + per-phase-review paths are still being hardened.

### 🧱 Policy at the harness layer, not the prompt

The model can't be trusted to follow inconvenient instructions, so the rules live *under* it: PreToolUse hooks hard-block bad edits (TDD without a test, commits inside a gated worktree, stuck-loop dispatch storms), and the approve token only unlocks on **typed user input**, sanitized of injected context. The prompt asks nicely; the hooks make it true.

---

## The pipeline

```
/forge:plan "add OAuth login"
   → grill your intent (grounded in the codebase + knowledge store)
   → planner + researcher + gotcha-checker → reviewers critique in parallel
   → Gate #1: you read the plan and approve

/forge:implement
   → coder-scout maps the files → coder writes the change
   → reviewers check safety · logic · boundary · performance · tests
   → Gate #2: you read the verdicts and approve

/forge:apply
   → documenter updates the changelog + architecture docs
   → commit gate → merge
```

Nothing touches your source until Gate #2, and nothing lands on `main` until you approve the commit.

---

## What's inside (v0.6.0)

- **25 specialist agents** — planner, researcher, coder + coder-scout, 5 reviewers (safety/logic/boundary/performance/tests), technical-skeptic, documenter, architect, critic, and more — each a Claude instance with a defined role, tool scope, and model tier.
- **33 skills** — the `/forge:*` slash commands that orchestrate agents into pipelines.
- **29 hook scripts** across the session lifecycle — enforcement, context injection, board hygiene.
- **40 MCP tools** — structured access to runs, gates, the board, the knowledge store, and model routing.
- **16 modules** — including the deterministic orchestrator and the compound knowledge base.
- **Per-agent model routing** across Anthropic tiers (Haiku/Sonnet/Opus by role), with an external-provider path for future expansion.
- **All state is local** in `.pipeline/` — board, run history, gates, knowledge indexes. Nothing leaves your project; FORGE is stateless between sessions.

---

## Install & start

```bash
git clone https://github.com/Chulf58/FORGE.git
claude --plugin-dir /path/to/forge-plugin
```

Then, in any project: `/forge:init` once to scaffold local state, and `/forge:plan "<feature>"` to start. `/forge:status` and `/forge:dashboard` show where things stand.

---

## Commands

| Command | What it does |
|---------|-------------|
| `/forge:plan "<feature>"` | Plan a feature → Gate #1 |
| `/forge:implement` | Build the approved plan → Gate #2 |
| `/forge:apply` | Apply + commit the approved work |
| `/forge:approve` · `/forge:discard` | Act on the pending gate |
| `/forge:status` · `/forge:dashboard` | Where things stand |
| `/forge:debug` · `/forge:refactor` · `/forge:resume` · `/forge:todo` | Debug · restructure · resume · backlog |

---

## Docs

- [FORGE-OVERVIEW.md](docs/FORGE-OVERVIEW.md) — what FORGE is, design principles, comparisons
- [FORGE-REFERENCE.md](docs/FORGE-REFERENCE.md) — full agent/skill/hook/MCP tables, signal protocol, model routing
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map and key file locations

## License

MIT
