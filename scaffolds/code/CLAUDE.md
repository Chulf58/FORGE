# FORGE Pipeline — Runtime Instructions

These rules govern how FORGE operates in any project where the plugin is installed.

## Change philosophy

Choose the smallest safe implementation that solves the stated problem. No speculative abstractions. No unrelated cleanup. Prefer existing patterns over new structure.

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

When invoking ANY subagent, include `Working directory: <absolute project folder path>` at the start of the prompt.

---

## Common patterns (referenced by pipeline sections below)

### Reviewer dispatch

Reviewer selection is handled by `scripts/reviewer-dispatch.mjs` — a deterministic script that maps risk patterns to specific reviewers. No LLM triage agent needed.

- **Implement/debug/refactor stage:** the script scans `docs/context/handoff.md` for risk patterns (shell/spawn, fs writes, auth/crypto, network, schema changes, etc.) and returns the matching reviewer list.
- **Plan stage:** the script keyword-scans active task lines in `docs/PLAN.md` and maps domain keywords to reviewers.
- **FULL mode:** all 5 reviewers always run regardless of pattern matching.

### Revision loops

All revision loops share this pattern:
1. Initialize counter to 0. Increment after each cycle.
2. The revising agent reads **only the blocking reviewer's output** from `docs/context/reviewer-output/` and revises the target doc.
3. Re-run the reviewer dispatch script and re-invoke the dispatched reviewers against the revised doc.
4. **Stop conditions** (check before each cycle): counter reached limit (3 for plan, 2 for coder/debug/refactor); same BLOCK reason returned unchanged (circuit breaker); all verdicts are REVISE with 0 BLOCKs (early exit — warnings don't gate).

---

## Pipeline routing

### `plan feature: <description>`

0. If `"specAgent": true` in `project.json` → invoke **spec-agent** first. If `.claude/agents/domain-context.md` exists → invoke **domain-context**, pass output as `[domain-context output]...[/domain-context output]` prefix.
0.5. **brainstormer** (conditional) — skip if input has acceptance criteria, file paths, technical approach, "Affected areas:", enriched TODO description, or urgency. If brainstormer emits `[questions]`, echo the block verbatim and **stop**. FORGE re-invokes with `[answers]`.
1. **planner** — writes `docs/PLAN.md`. If `### Research needed` section has items → proceed to step 2, else skip to step 3.
2. **researcher** — investigates technical unknowns, writes to `docs/RESEARCH/`.
3. **gotcha-checker** → **reviewer dispatch** (see common pattern above).
4. Apply **plan revision loop** if any reviewer BLOCKs/REVISEs.
5. Emit `[summary] <one sentence>` → Gate #1.

### `implement feature: <description>`

0. If `"tddAgent": true` → invoke **tdd-agent** first.
0.5. **coder-scout** — writes `docs/context/scout.json`. Skip in LEAN/SPRINT.
1. **coder** — writes `docs/context/handoff.md`. Run sequentially (never parallelize).
1b. **completeness-checker** — skip in LEAN mode.
2. **Reviewer dispatch** (see common pattern).
3. Apply **coder revision loop** if any mandatory reviewer BLOCKs.
4. Emit `[summary] <one sentence>` → Gate #2.

### `debug: <description>` / `failed test: <description>`

1. **debug** — may emit `[questions]` (handle same as brainstormer). Writes `docs/context/handoff.md`.
2. **Reviewer dispatch** → revision loop if blocked.
3. Emit `[summary]` → Gate #2. Apply via `apply debug:`.

### `refactor: <file or area>`

1. **refactor** → writes `docs/context/handoff.md`.
2. **Reviewer dispatch** — always includes reviewer-style for refactor pipelines.
3. Revision loop if blocked → `[summary]` → Gate #2. Apply via `apply refactor:`.

### `apply feature:` / `apply debug:` / `apply refactor:`

**Do not read source files or make edits yourself.** Spawn each agent as a Task.
1. **implementer** — applies `docs/context/handoff.md`. If plan has `(wave: N)` annotations, follow wave execution rules (see FORGE-REFERENCE.md).
2. **documenter** — updates CHANGELOG, ARCHITECTURE, archives plan section, captures solution.
3. **post-apply-lifecycle** — cleans up pipeline artifacts, archives completed work.

---

## Gate system

- **Gate #1** — after plan reviewers complete. Must approve before implement.
- **Gate #2** — after implement/debug/refactor reviewers complete. Must approve before apply.

### Reviewer conflict protocol

| reviewer-safety | reviewer (boundary) | reviewer-logic | reviewer-performance | reviewer-style | Outcome |
|---|---|---|---|---|---|
| BLOCK | any | any | any | any | Hard-blocked — non-overrideable |
| APPROVED | BLOCK | any | any | any | Blocked — revision required |
| APPROVED | APPROVED | BLOCK | any | any | Blocked — revision required |
| APPROVED | APPROVED | APPROVED | BLOCK | any | Blocked — revision required |
| APPROVED | APPROVED | APPROVED | APPROVED | BLOCK | Demote to REVISE — implementer fixes inline |

---

## Pipeline mode routing

When absent, use LEAN. **These tables are binding** — do not add/substitute agents.

### plan feature:
| Mode | Agents |
|------|--------|
| SPRINT | planner → Gate #1 |
| LEAN | planner → researcher? → dispatched reviewers → Gate #1 |
| STANDARD | planner → researcher? → gotcha-checker → dispatched reviewers → Gate #1 |
| FULL | planner → researcher → gotcha-checker → all 5 reviewers → Gate #1 |

### implement feature:
| Mode | Agents |
|------|--------|
| SPRINT | coder → Gate #2 |
| LEAN | coder → dispatched reviewers → Gate #2 |
| STANDARD | scout → coder → completeness → dispatched reviewers → Gate #2 |
| FULL | scout → coder → completeness → all 5 reviewers → Gate #2 |

### debug: / refactor:
| Mode | Agents |
|------|--------|
| SPRINT | agent only → Gate #2 |
| LEAN | agent → dispatched reviewers → Gate #2 |
| STANDARD | agent → dispatched reviewers → Gate #2 |
| FULL | agent → all 5 reviewers → Gate #2 |

---

## Model routing
Before each agent invocation, call `forge_get_model_recommendation` with the agent name and dispatch based on the response. If unavailable, fall back to the agent's frontmatter `model:` field. FULL mode: promote all reviewers from haiku to sonnet.

---

## Docs structure

| File | Written by | Purpose |
|------|-----------|---------|
| `docs/PLAN.md` | planner | Active plan |
| `docs/RESEARCH/<feature>.md` | researcher | Technical findings |
| `docs/context/handoff.md` | coder / debug / refactor | Implementation draft |
| `docs/context/scout.json` | coder-scout | Files/functions the coder needs |
| `docs/CHANGELOG.md` | documenter | Shipped changes |
| `docs/ARCHITECTURE.md` | documenter | Module structure |
| `docs/gotchas/GENERAL.md` | architect / user | Project-wide gotchas |

---

## Signals

- `[suggest] <text>` — clickable suggestion chip
- `[todo] <task text>` — adds to FORGE TODO board. **Never use `TodoWrite`.**
- `[questions]...[/questions]` — Q&A strip (planner/brainstormer/debug only)
- `[summary] <one sentence>` — emitted before each gate
- `[pipeline-summary] mode=<mode> verdict=<verdict>` — after every gate/apply
- `[wave-complete] N` — wave verification passed

---

## Orchestrator discipline

**Do not explore before starting the pipeline.** When a pipeline prefix is received, invoke the first agent immediately. Pre-pipeline exploration wastes 50–100k tokens.

**Do not use bash for file writes.** Use Write or Edit tools.

## Reading discipline

- Plan-phase: `docs/PLAN.md` and relevant source files
- Plan-stage reviewers: `docs/PLAN.md`, `docs/RESEARCH/`, `docs/gotchas/GENERAL.md` — NOT `handoff.md`
- Implement-stage reviewers: `docs/context/handoff.md` first, up to 3 source files if essential
- Apply-phase: `docs/context/handoff.md` and changed files only
- Large files: grep for target, read N to N+400

## Tool efficiency

| Need to… | Use | Not… |
|---|---|---|
| Read a file | `Read` | `cat`/`head`/`tail`/`node -e require` |
| Find files | `Glob` | `find`/`ls` |
| Search contents | `Grep` | `grep`/`rg` |
| Board state | `forge_read_board` or `Read .pipeline/board.json` | `node -e` |
| Dashboard | `forge_dashboard_state` | manual `.pipeline/runs/` reads |
| Edit file | `Edit` | `sed`/`awk` |
| Create file | `Write` | `echo >`/`cat <<EOF` |
| Git/npm/process | Bash | — |

**No subagents for file reads.** Use Read/Grep/Glob directly.

---

## Project gotchas

@docs/gotchas/GENERAL.md
