<!-- Instructional template: pipeline ends after Gate #1 approval. No implementer, no tester, no Gate #2. -->

# FORGE Pipeline — Runtime Instructions

These rules govern how FORGE operates in any project where the plugin is installed.

## Change philosophy

Choose the smallest safe implementation that solves the stated problem. No speculative abstractions. No unrelated cleanup. Prefer existing patterns over new structure.

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

When invoking ANY subagent, include `Working directory: <absolute project folder path>` at the start of the prompt.

## Approach-first protocol (MANDATORY)

Before ANY direct file edit, present the approach to the user — what will change, which files, why — and wait for explicit approval. Only user words like "yes", "go", "do it", "approved" count. Narrating intent ("let me fix", "I'll update") is NOT self-authorization. This applies even for obvious one-line fixes, even in auto mode. Workers are exempt (they operate autonomously inside pipelines).

---

## Pipeline routing

### `plan feature: <description>`
Invoke agents in sequence:
1. **planner** — Step 0: if no `[answers]` block is present in the prompt, emits a `[questions]` block (2–5 clarifying questions) and stops. On re-invocation with `[answers]` present: skips Step 0 and writes the full numbered task list to `docs/PLAN.md`
2. **researcher** — investigates technical unknowns from the plan, writes to `docs/RESEARCH/`
3. **Review stage** — invoke in order:
   a. **gotcha-checker** — always invoke first
   b. **Reviewer dispatch** — run `scripts/reviewer-dispatch.mjs --stage=plan` to deterministically select which reviewers to invoke based on plan task keywords.

   Plan-stage reviewers read `docs/PLAN.md` and `docs/RESEARCH/` — not `handoff.md`.

After all invoked reviewers complete, apply the **plan revision loop** before showing Gate #1 (see Gate system below).

After the plan revision loop passes, Gate #1 is shown. Do not continue until the user clicks "Implement now".

Instructional projects do not have an apply step — the pipeline ends after Gate #1 approval.

### `implement feature: <description>`
Invoke agents in this order:
1. **coder** — writes full implementation draft to `docs/context/handoff.md` (no source edits)
2. **Reviewer dispatch** — run `scripts/reviewer-dispatch.mjs --stage=implement` to deterministically select reviewers based on handoff risk patterns.
3. **Invoke dispatched reviewers** — the script returns the exact reviewer list; invoke each one.

After all invoked reviewers complete, the pipeline ends. Instructional projects have no Gate #2 and no apply step.

### `debug: <description>`
Invoke agents in this order:
1. **debug** — traces root cause, writes fix plan to `docs/context/handoff.md`
2. **Reviewer dispatch** — run `scripts/reviewer-dispatch.mjs --stage=implement` to select reviewers.
3. **Invoke dispatched reviewers** based on the script's output.

---

## Gate system

- **Gate #1** — shown after `plan feature:` completes. User must approve before `implement feature:` runs.
- **No Gate #2** — instructional projects have no apply pipeline and no code review gate.

### Inline gate approval

When the user approves gate1, execute inline — no `/forge:approve` skill needed:
1. `forge_check_gate` — extract `runId`, `gate`, `feature`
2. `forge_set_gate({ gate, feature, status: "approved", runId })`
3. `forge_update_run({ runId, gateState: { ...existing, status: "approved", approvedAt: <now ISO> } })` — do NOT set `status: "completed"`. The run stays `gate-pending` with an approved gateState until commit+merge.
4. Print: "Gate 1 approved for '<feature>'. Run /forge:implement to start implementation."

### Reviewer conflict protocol

Each reviewer owns a non-overlapping domain. Verdicts are combined by these rules:

| reviewer-safety | reviewer (boundary) | reviewer-logic | reviewer-performance | reviewer-style | Outcome |
|---|---|---|---|---|---|
| BLOCK | any | any | any | any | Hard-blocked — non-overrideable. Safety violations are never demoted. |
| APPROVED | BLOCK | any | any | any | Blocked — coder revision required. |
| APPROVED | APPROVED | BLOCK | any | any | Blocked — coder revision required. |
| APPROVED | APPROVED | APPROVED | BLOCK | any | Blocked — coder revision required. |
| APPROVED | APPROVED | APPROVED | APPROVED | BLOCK | **Demote to REVISE** — coder fixes style issues inline. |

A reviewer must not BLOCK for issues outside its domain.

### Plan revision loop

When any plan-stage reviewer issues BLOCK or REVISE:
1. **Initialize a revision counter to 0** before entering the loop. Increment it by 1 after each revision cycle completes.
2. The planner reads **all reviewer outputs** and revises `docs/PLAN.md` to address every BLOCK and REVISE item.
3. Only the reviewer(s) that issued BLOCK or REVISE re-run against the updated plan. Reviewers that previously returned APPROVED do not re-run unless the revision materially changes their domain.
4. **Before starting another revision**: check the counter. If it has reached 3, stop immediately — do NOT run the planner or any reviewer again. Emit `[PLAN-BLOCK-ESCALATED]` and surface the full revision history to the user.
5. Repeat steps 2–4 until every reviewer returns APPROVED or the counter reaches 3.

### Coder revision loop

When a mandatory reviewer blocks:
1. **Initialize a revision counter to 0** before entering the loop. Increment it by 1 after each revision cycle completes.
2. The coder reads **only the output of the blocking reviewer** and revises `docs/context/handoff.md`.
3. All **mandatory reviewers** re-run against the updated handoff.
4. **Before starting another revision**: check the counter. If it has reached 2, stop immediately. Emit `[BLOCK-ESCALATED]` and surface the full revision history to the user.
5. Repeat steps 2–4 until unblocked or the counter reaches 2.

---

## Docs structure

| File | Written by | Purpose |
|------|-----------|---------|
| `docs/PLAN.md` | planner | Current active plan — feature groups and tasks |
| `docs/RESEARCH/<feature>.md` | researcher | Technical findings per feature |
| `docs/context/handoff.md` | coder / debug | Implementation draft for reviewer trio |
| `docs/context/checkpoint.md` | any agent | Progress save for checkpoint resume |
| `docs/CHANGELOG.md` | documenter | Shipped changes log |
| `docs/ARCHITECTURE.md` | documenter / architect | Module and file structure |
| `docs/DECISIONS.md` | documenter | Non-obvious technical decisions |
| `docs/gotchas/GENERAL.md` | architect / user | Project-wide gotchas all agents must know |

---

## Checkpoint resume

When an agent's context approaches its limit, it writes progress to `docs/context/checkpoint.md` and emits `[CONTEXT-CHECKPOINT]`. FORGE auto-resumes the same agent up to 5 times. Agents should read `docs/context/checkpoint.md` on resumption and continue from where they left off.

---

## Suggestion chips

Agents can emit `[suggest] <text>` on its own line to create a clickable suggestion chip in the FORGE UI. Use this to guide the user toward the next logical action:
- `[suggest] implement feature: <name>` — after plan

---

## TODO signals

To add items to FORGE's TODO tab, emit `[todo] <task text>` on its own line. FORGE will capture these and add them as TODO items in real time.

**Never use the `TodoWrite` tool to manage FORGE project tasks.** Always use `[todo]` signals instead.

---

## Planner questions signal

The planner's first pass may emit a `[questions]` / `[/questions]` block **instead of** writing a plan. FORGE intercepts this block and renders an inline Q&A strip.

Format rules:
- `[questions]` and `[/questions]` tags each appear on their own line
- Each question: `<id>. <text> [<opt1> / <opt2> / ...]` — options separated by ` / `
- Maximum 8 questions; maximum 8 options per question
- After emitting the block the planner **must stop** — no plan content may follow
- On re-invocation the prompt will contain an `[answers]` block — when answers are present, the planner skips question emission and writes the full plan

---

## Plan validity rule

**A plan in `docs/PLAN.md` is only valid if it was produced by the full `plan feature:` pipeline** (planner → researcher → gotcha-checker → reviewers running inside FORGE).

Plans written directly, via `claude --print`, or by any single-agent shortcut are **not valid**.

---

## EXPLORE mode rules

In EXPLORE mode (no pipeline prefix), agents may read any project file but **must not modify source files**. EXPLORE mode is for exploration, ideation, and answering questions — not for writing code. Use `[todo]` to surface ideas, `[suggest]` to recommend next pipeline steps.

---

## Reading discipline

Agents should read only what they need:
- For plan-phase agents (planner, researcher): read `docs/PLAN.md` and relevant files
- For plan-stage reviewers: read `docs/PLAN.md`, `docs/RESEARCH/`, and `docs/gotchas/GENERAL.md` — do not read `handoff.md`
- For implement-stage reviewers: read `docs/context/handoff.md` first
- Apply an N+400 line cap when reading large files

---

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
