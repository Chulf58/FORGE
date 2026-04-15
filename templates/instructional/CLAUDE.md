<!-- Instructional template: pipeline ends after Gate #1 approval. No implementer, no tester, no Gate #2. -->

# FORGE Pipeline Orchestration

This project is managed through the FORGE pipeline. Every prompt is routed to a specific pipeline based on its prefix. Read this file before responding to any prompt.

---

## Agent invocation rule — working directory

When invoking ANY subagent via the Agent tool, always include the project's absolute folder path in the prompt. Use this format at the start of the prompt:

`Working directory: <absolute project folder path>`

This ensures the agent can resolve relative paths (e.g. `docs/PLAN.md`) to absolute paths if needed. Without this, agents may fail to find files when the Claude CLI's working directory doesn't match the project folder.

---

## Pipeline routing

### `plan feature: <description>`
Invoke agents in sequence:
1. **planner** — Step 0: if no `[answers]` block is present in the prompt, emits a `[questions]` block (2–5 clarifying questions) and stops. On re-invocation with `[answers]` present: skips Step 0 and writes the full numbered task list to `docs/PLAN.md`
2. **researcher** — investigates technical unknowns from the plan, writes to `docs/RESEARCH/`
3. **Review stage** — invoke in order:
   a. **gotcha-checker** — always invoke first
   b. **reviewer-triage** — always invoke with the literal prompt prefix `[plan-stage mode]`, e.g.: "invoke reviewer-triage with: '[plan-stage mode] Read docs/PLAN.md and output an explicit plan-stage dispatch list'". The orchestrator must use this exact prefix — reviewer-triage uses it as the primary signal to switch into plan-stage mode.

   The orchestrator must follow the dispatch list returned by reviewer-triage exactly for all conditional plan-stage reviewers. Do not make your own reviewer invocation decisions.

   Plan-stage reviewers read `docs/PLAN.md` and `docs/RESEARCH/` — not `handoff.md`.

After all invoked reviewers complete, apply the **plan revision loop** before showing Gate #1 (see Gate system below).

After the plan revision loop passes, Gate #1 is shown. Do not continue until the user clicks "Implement now".

Instructional projects do not have an apply step — the pipeline ends after Gate #1 approval.

### `implement feature: <description>`
Invoke agents in this order:
1. **coder** — writes full implementation draft to `docs/context/handoff.md` (no source edits)
2. **reviewer-triage** — reads `handoff.md` and outputs an explicit dispatch list naming which reviewers to invoke, with file/line citations. The orchestrator must follow this dispatch list exactly — do not make your own reviewer invocation decisions.
3. **Invoke reviewers named by triage** — always includes reviewer and reviewer-safety; conditionally includes reviewer-logic, reviewer-style, and reviewer-performance per the dispatch list.
4. **tool-call-auditor** — audits tool-call patterns from the session against `docs/audit-log.jsonl`
   - If `[auditor-clean]` is emitted: pipeline ends.
   - If `[auditor-recurring] <count>` is emitted: invoke **agent-optimizer** → agent-optimizer writes proposed agent prompt fixes to `docs/context/handoff.md` → Gate #2 is shown for user approval → if approved, invoke **implementer** to apply agent `.md` changes.

After all invoked reviewers complete and the auditor runs, the pipeline ends unless agent-optimizer is triggered. Instructional projects have no Gate #2 and no apply step unless `[auditor-recurring]` causes one.

### `debug: <description>`
Invoke agents in this order:
1. **debug** — traces root cause, writes fix plan to `docs/context/handoff.md`
2. **reviewer-triage** — reads `handoff.md`, outputs dispatch list. Follow it exactly.
3. **Invoke reviewers named by triage** — always includes reviewer and reviewer-safety; conditionally includes others per dispatch.

---

## Gate system

- **Gate #1** — shown after `plan feature:` completes. User must approve before `implement feature:` runs.
- **No Gate #2** — instructional projects have no apply pipeline and no code review gate.

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

For every operation, pick the cheapest dedicated tool that does the job. The table below is the decision reference. The FORGE plugin's `bash-guard` hook enforces a subset of this as a backstop — the table is the primary guidance and should make the backstop rarely fire.

| Need to… | Use | Common mistake |
|---|---|---|
| Read a file | `Read` | `cat` / `head` / `tail` in Bash (blocked by bash-guard); also `node -e 'require("./foo.json")…'` for JSON (slow Node startup, raw stdout, no formatting) |
| Find files by pattern | `Glob` | `find` / `ls` in Bash (blocked) |
| Search inside file contents | `Grep` | `grep` / `rg` in Bash (blocked) |
| Extract fields from a local JSON file | `Read` the file, parse and filter in your response | `node -e "const x=require('./foo.json'); …"` — same data with ~100–300 ms of Node startup, raw stdout, and no rendering control |
| Check the board state (TODOs, planned) | `forge_read_board` MCP tool, or `Read .pipeline/board.json` | Shelling out with `node -e` to filter; reading `.pipeline/*` directly when MCP is available |
| Check dashboard state (active runs, pending gates, recent completions, board summary) | `forge_dashboard_state` MCP tool | Reading `.pipeline/runs/*.json` by hand |
| Check a specific run's full record | `forge_get_run` MCP tool with the run ID | `Read .pipeline/runs/r-*/run.json` when MCP is available |
| Check the active-run pointer / current unit | `forge_get_active_run` MCP tool | `Read .pipeline/run-active.json` directly |
| Check the pending gate | `forge_check_gate` MCP tool | `Read .pipeline/gate-pending.json` directly |
| Edit an existing file | `Edit` | `sed` / `awk` (blocked) |
| Create a new file | `Write` | `echo > file` / `cat <<EOF > file` (blocked) |
| Run tests | Bash → the project's configured test command | — |
| Run a project script | Bash → the script directly | `node -e '…'` inline (write a script file instead — preserves provenance and is re-runnable) |
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
