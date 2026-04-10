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
0. **Optional pre-planner steps** (check `project.json` before invoking):
   - If `"specAgent": true` → invoke **spec-agent** first. It writes `docs/SPEC.md` with acceptance criteria, out-of-scope boundaries, and open questions.
   - If `.claude/agents/domain-context.md` exists in the active project → invoke **domain-context** and pass its stdout output as a `[domain-context output]...[/domain-context output]` prefix in the brainstormer/planner prompt.
   - If both are absent or disabled, skip step 0 entirely.

0.5. **brainstormer** (conditional) — decides whether the input needs clarifying questions.

   **Orchestrator rule — brainstormer decision:** Assess the input. Skip the brainstormer and go directly to step 1 (planner) when ANY of these are true:
   - Input has numbered acceptance criteria (e.g. "(1) does X, (2) handles Y")
   - Input names specific file paths
   - Input specifies the technical approach
   - Input has "Affected areas:" section
   - Input came from an enriched TODO with full description
   - User says "just plan it" or similar urgency

   Otherwise, invoke the **brainstormer**. It asks clarifying questions via `[questions]...[/questions]` and writes a requirements doc to `docs/brainstorms/<slug>.md`.

   **Orchestrator rule — questions interception:** After the brainstormer Task completes, inspect its result text for a `[questions]` tag. If the result contains `[questions]`, echo the entire `[questions]...[/questions]` block verbatim in your own response text — then **stop immediately**. Do NOT invoke the planner or any reviewer. FORGE will detect the block, render the Q&A strip, and re-invoke the full `plan feature:` pipeline once the user submits answers. On re-invocation with `[answers]` present, invoke the brainstormer again with the answers — it will write the brainstorm doc and return without questions.

1. **planner** — reads the brainstorm doc (if exists), GENERAL.md, SKILLS.md, and the codebase. Writes the full numbered task list to `docs/PLAN.md`. The planner does NOT ask questions — all Q&A is handled by the brainstormer.

   **Orchestrator rule — conditional researcher:** After the planner writes `docs/PLAN.md`, read the `### Research needed` section. If it is absent, empty, or contains only 'None' — skip step 2 entirely and proceed directly to step 3.

2. **Research stage** — Only run if the plan's `### Research needed` section contains actual items (not absent, not empty, not containing only 'None').

   **Step 2a — researcher-triage:** Invoke **researcher-triage** with the prompt: "Read `docs/PLAN.md` and output one focused brief per research question." Researcher-triage reads `docs/PLAN.md`, `docs/gotchas/GENERAL.md`, and (if present) `docs/gotchas/SKILLS.md`, then emits one `[brief-for: N]` ... `[/brief-for]` block per research question.

   **Step 2b — parse briefs:** After researcher-triage completes, inspect its output for all `[brief-for: N]` ... `[/brief-for]` blocks. Collect them into an ordered list. If no blocks are emitted, skip step 2c and proceed directly to the planner re-read step (treat as if researcher was skipped).

   **Step 2c — dispatch researchers:**
   - If exactly **one** block is found: invoke one **researcher** instance with the brief block content as the prompt prefix, followed by: "Investigate this question. Write your findings to `docs/RESEARCH/<feature-slug>-q1.md`." (No parallelism overhead for a single question.)
   - If **two or more** blocks are found: invoke one **researcher** Task per block **concurrently**. Each Task receives its brief block content as the prompt prefix, followed by: "Investigate this question. Write your findings to `docs/RESEARCH/<feature-slug>-q<N>.md`." (N matches the brief-for number.) Wait for all concurrent researcher Tasks to complete before proceeding.

   **Orchestrator rule — planner re-read after research:** After all researcher Tasks complete, invoke the **planner** again with: "Re-read `docs/RESEARCH/` and revise `docs/PLAN.md` to correct any tasks that contradict the findings (e.g. wrong API limits, unavailable libraries, incorrect assumptions). Only change tasks that are directly invalidated by the research — do not restructure the plan." Skip this step if the research stage was skipped entirely in step 2.

3. **Review stage** — invoke in order:
   a. **gotcha-checker** — always invoke first
   b. **reviewer-triage** — always invoke with the literal prompt prefix `[plan-stage mode]`, e.g.: "invoke reviewer-triage with: '[plan-stage mode] Read docs/PLAN.md and output an explicit plan-stage dispatch list'". The orchestrator must use this exact prefix — reviewer-triage uses it as the primary signal to switch into plan-stage mode.

   The orchestrator must follow the dispatch list returned by reviewer-triage exactly for all conditional plan-stage reviewers. Do not make your own reviewer invocation decisions.

   **Read triage sidecar:** After reviewer-triage completes, read `docs/context/triage-dispatch.json`. If it exists and contains valid JSON with a `reviewers` string array, use that array as the authoritative reviewer list. If absent or malformed, derive the reviewer list by parsing the `### Invoke` section of triage's output text.

   **Validate excerpts and invoke plan-stage reviewers:**
   - For each reviewer in the dispatch list, check that `docs/context/triage-excerpts/<reviewer>.md` exists and is non-empty. If ANY expected excerpt file is missing: re-run **reviewer-triage** with the `[plan-stage mode]` prefix before dispatching any reviewer. Do not invoke any reviewer until all expected files are present.
   - Read `confidence` from `triage-dispatch.json`. Default to `"HIGH"` if the field is absent.
   - For each reviewer in the dispatch list, invoke it with this exact prompt prefix: `"[plan-stage review — no handoff.md exists yet, do not read it]\n[triage-confidence: <VALUE>]\n"` where `<VALUE>` is the confidence level. Do not pass excerpt content inline — reviewers read their own file at `docs/context/triage-excerpts/<reviewer>.md`.

   Plan-stage reviewers read only their excerpt file. Any reviewer that reads `handoff.md` during plan-stage is reviewing the wrong artifact.

After all invoked reviewers complete, apply the **plan revision loop** before showing Gate #1 (see Gate system below).

### Speculative coder execution (optional optimisation)

After the planner writes the plan and **before** plan-stage reviewers finish, the orchestrator MAY start the coder speculatively in parallel with the reviewers. This is an optimisation — not mandatory.

**Rules:**
1. Only speculate when pipeline mode is LEAN or STANDARD (not FULL — FULL runs are high-stakes and should not risk wasted tokens).
2. The coder runs against the current `docs/PLAN.md` as-is. It writes `docs/context/handoff.md` normally.
3. If all plan-stage reviewers APPROVE (no BLOCK, no revision loop needed): the coder's output is valid. Gate #1 shows immediately and the handoff is already ready for `implement feature:`.
4. If any reviewer BLOCKs or issues REVISE that triggers a plan revision: **discard the speculative coder output** (delete `docs/context/handoff.md`). The planner revises the plan, reviewers re-run, and the coder must be re-invoked after the revised plan is approved.
5. The speculative coder does NOT count as a formal "implement feature:" pipeline — Gate #2 reviewers still run after the user approves Gate #1 and the formal implement pipeline starts.

**When NOT to speculate:** If the plan has research items that need resolution, or if the gotcha-checker issued REVISE — the plan is likely to change, making speculation wasteful.

After the plan revision loop passes, emit a one-line summary signal before showing Gate #1:
`[summary] <one sentence describing what was planned>`
Then Gate #1 is shown. Do not continue until the user clicks "Implement now".

### `implement feature: <description>`
Invoke agents in this order:
0. **Optional pre-coder steps** (check `project.json` before invoking):
   - If `"tddAgent": true` → invoke **tdd-agent** before the coder. tdd-agent reads `docs/PLAN.md` and writes Given/When/Then criteria to `docs/TEST-CRITERIA.md`. The coder will use this file as its testable target.
0.5. **coder-scout** — reads active `[ ]` tasks from `docs/PLAN.md` and writes `docs/context/scout.json` listing exactly which source files and functions the coder needs to read. Skip in LEAN, SPRINT, and TRIVIAL modes.
1. **coder** — writes full implementation draft to `docs/context/handoff.md` (no source edits). **Important:** the coder must run sequentially — do not parallelize coder invocations, as all coders write to the same `docs/context/handoff.md` and concurrent writes will overwrite each other.
1b. **regression-risk** — reads `docs/context/handoff.md` and `.pipeline/modules.json` to identify which modules are touched and flag high-risk ones via `[health]` signals before reviewer-triage runs. Skip if `modules.json` does not exist.
1c. **completeness-checker** — reads `docs/PLAN.md` and `docs/context/handoff.md`, checks every active `[ ]` plan task is addressed in the handoff. Emits `[reviewer-verdict]` with `BLOCK` if any tasks are unaddressed, `REVISE` if only partially addressed. If no PLAN.md exists or no active tasks are found, emits `APPROVED` and skips. **Skip in LEAN mode** — with 5-8 tasks the coder rarely misses any, and the reviewer catches gaps.
2. **reviewer-triage** — reads `handoff.md` and outputs a `[handoff-summary]...[/handoff-summary]` block followed by an explicit dispatch list naming which reviewers to invoke, with file/line citations. The orchestrator must follow this dispatch list exactly — do not make your own reviewer invocation decisions.
2b. **Read triage sidecar:** After reviewer-triage completes, read `docs/context/triage-dispatch.json`. If it exists and contains valid JSON with a `reviewers` string array, use that array as the authoritative reviewer list. If absent or malformed, derive the reviewer list by parsing the `### Invoke` section of triage's output text.
3. **Validate excerpts and invoke reviewers named by triage:**
   a. **Excerpt validation (mandatory before any reviewer runs):** For each reviewer in the dispatch list, check that `docs/context/triage-excerpts/<reviewer>.md` exists and is non-empty. If ANY expected file is missing: re-run **reviewer-triage** immediately. Do not invoke any reviewer until all expected excerpt files are present.
   b. **Read confidence:** Extract the `confidence` field from `triage-dispatch.json` (`"HIGH"`, `"MEDIUM"`, or `"LOW"`). Default to `"HIGH"` if the field is absent.
   c. **Invoke reviewers:** For each reviewer in the dispatch list, invoke it with this exact prompt prefix: `"[triage-confidence: <VALUE>]\n"` where `<VALUE>` is the confidence level from step (b). Do not pass excerpt content inline — reviewers read their own file at `docs/context/triage-excerpts/<reviewer>.md`.
   d. Always includes reviewer and reviewer-safety; conditionally includes reviewer-logic, reviewer-style, and reviewer-performance per the dispatch list.

**Orchestrator rule — count-based triage gate:** After resolving the full reviewer list from the mode routing table (including any contextual reviewers added for this specific task), count them. If the count is **3 or more** AND the mode is not FULL (FULL already runs all reviewers unconditionally), invoke **reviewer-triage** before dispatching any reviewers — regardless of what the mode routing table says. Each reviewer reads its own excerpt file; triage ensures all excerpt files exist before the reviewer wave starts.

After all invoked reviewers complete:

4. **Write `docs/context/run-metrics.json`** (orchestrator writes this — not an agent):

```json
{
  "planner_model": "<model-id used for planner Pass 2, or null if plan stage did not run>",
  "coder_model": "<model-id passed to coder>",
  "scout_used": <true if coder-scout ran and wrote scout.json, false otherwise>,
  "files_read_count": <value of N from [scout] files=N signal, or null if scout skipped>,
  "revision_cycles": <number of times coder revision loop ran — 0 if reviewers all approved first pass>,
  "total_agents": <count of agent Task invocations in this implement feature run, including scout/completeness/triage/reviewers>
}
```

Populate fields from: `[tier]` signal (→ coder_model), `[scout] files=N` signal (→ files_read_count, scout_used), revision loop counter (→ revision_cycles), and agent invocation count (→ total_agents). If a field cannot be determined, write `null`.

Then emit a one-line summary signal before showing Gate #2:
`[summary] <one sentence describing what was implemented>`
Then Gate #2 is shown. Do not apply code until the user clicks YES.

### `apply feature: <description>`
**You must not read source files or make edits yourself during apply pipelines.** Spawn each agent as a separate Task invocation and wait for it to complete before spawning the next. Do not implement source changes directly — that is the implementer's job.

Invoke agents in sequence:
1. **implementer** — applies `docs/context/handoff.md` to source files
2. **tester** — see `## Tester mode` section for conditional invocation logic based on `TESTER MODE` setting
3. **documenter** — updates `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`, archives completed plan section, deletes RESEARCH file, trims PLAN-archive.md if oversized, wipes reviewer-output/
4. **tool-call-auditor** — audits tool-call patterns from the session against `docs/audit-log.jsonl`; checks for recurrence across prior sessions (threshold: 3+ distinct sessions = recurring)
   - If `[auditor-clean]` is emitted: pipeline ends.
   - If `[auditor-recurring] <count>` is emitted: invoke **agent-optimizer** → agent-optimizer writes proposed agent prompt fixes to `docs/context/handoff.md` → Gate #2 is shown for user approval → if approved, invoke **implementer** to apply agent `.md` changes.

#### Wave execution

Wave execution applies when `docs/PLAN.md` contains tasks annotated with `(wave: N)` markers. It is opt-in — if no annotations are present, run the implementer once sequentially as normal.

**Rules:**
1. **Detect** — scan the current feature's unchecked task list for `(wave: N)` annotations. No annotations → sequential implementer run, no further steps.
2. **Group** — collect tasks by wave number N. Tasks without a wave annotation run sequentially after all wave groups finish.
3. **Triage** — invoke **implementer-triage** with: "Read `docs/context/handoff.md` and `docs/PLAN.md`. Emit one `[task-brief-for: wave-N-task-M]` block per wave-annotated task." Parse all `[task-brief-for: wave-N-task-M]` ... `[/task-brief-for]` blocks from its output. If implementer-triage emits no blocks (e.g. handoff is missing or malformed), fall back to step 4 without briefs — each task reads the full handoff directly.
4. **Execute** — for each wave group sorted by N ascending: spawn one Task per task concurrently (max 5). If a brief block exists for the task (from step 3), pass it as the prompt context with: "Apply only this task. Do not modify files outside the listed target file." If no brief is available for a task, fall back to: "Read `docs/context/handoff.md` for the spec. Apply only this task. Do not modify files outside the listed paths." Wait for all tasks in wave N before starting wave N+1.
5. **Verify** — after each wave, read the target file(s) listed in each task line and confirm they were modified. If any target appears unmodified: stop, escalate to the user, emit `[suggest] debug: <feature name> — wave N verification failure`. If all modified: emit `[wave-complete] N` and proceed.
6. **Failure** — if any Task returns an error or verification fails: abort remaining waves, do not proceed to tester or documenter, surface which wave/tasks failed.

### `debug: <description>`
Invoke agents in this order:
1. **debug** — Step 0: if no `[answers]` block is present, debug evaluates whether the report is ambiguous. If ambiguous, it emits a `[questions]` block and stops.

   **Orchestrator rule — questions interception:** After the debug Task completes, inspect its result text for a `[questions]` tag. If present, echo the entire `[questions]...[/questions]` block verbatim in your response — then **stop immediately**. FORGE will render the Q&A strip and re-invoke `debug:` with answers. On re-invocation with `[answers]` present, debug skips Step 0 and traces immediately.

   When no `[questions]` block is present, debug writes the fix plan to `docs/context/handoff.md`.
2. **reviewer-triage** — reads `handoff.md`, outputs dispatch list. Follow it exactly.
2b. **Read triage sidecar:** After reviewer-triage completes, read `docs/context/triage-dispatch.json`. If it exists and contains valid JSON with a `reviewers` string array, use that array as the authoritative reviewer list. If absent or malformed, derive the reviewer list by parsing the `### Invoke` section of triage's output text.
3. **Validate excerpts and invoke reviewers named by triage:**
   a. For each reviewer in the dispatch list, check that `docs/context/triage-excerpts/<reviewer>.md` exists and is non-empty. If ANY expected file is missing: re-run **reviewer-triage** immediately. Do not invoke any reviewer until all expected excerpt files are present.
   b. Read `confidence` from `triage-dispatch.json`. Default to `"HIGH"` if absent.
   c. For each reviewer in the dispatch list, invoke it with this exact prompt prefix: `"[triage-confidence: <VALUE>]\n"`. Do not pass excerpt content inline — reviewers read their own file at `docs/context/triage-excerpts/<reviewer>.md`.
   d. Always includes reviewer and reviewer-safety; conditionally includes others per dispatch.

**Orchestrator rule — count-based triage gate:** After resolving the full reviewer list, count them. If the count is **3 or more** AND the mode is not FULL, invoke **reviewer-triage** before dispatching — regardless of the mode routing table.

After all invoked reviewers complete, emit `[summary] <one sentence>` then Gate #2 is shown. Apply via `apply debug:`.

### `failed test: <description>`
Treat identically to `debug: <description>`. Route to the debug pipeline — invoke the same agent sequence:
1. **debug** — traces root cause, writes fix plan to `docs/context/handoff.md`
2. **reviewer-triage** — reads `handoff.md`, outputs dispatch list. Follow it exactly.
2b. **Read triage sidecar:** After reviewer-triage completes, read `docs/context/triage-dispatch.json`. If it exists and contains valid JSON with a `reviewers` string array, use that array as the authoritative reviewer list. If absent or malformed, derive the reviewer list by parsing the `### Invoke` section of triage's output text.
3. **Validate excerpts and invoke reviewers named by triage:**
   a. For each reviewer in the dispatch list, check that `docs/context/triage-excerpts/<reviewer>.md` exists and is non-empty. If ANY expected file is missing: re-run **reviewer-triage** immediately. Do not invoke any reviewer until all expected excerpt files are present.
   b. Read `confidence` from `triage-dispatch.json`. Default to `"HIGH"` if absent.
   c. For each reviewer in the dispatch list, invoke it with this exact prompt prefix: `"[triage-confidence: <VALUE>]\n"`. Do not pass excerpt content inline — reviewers read their own file at `docs/context/triage-excerpts/<reviewer>.md`.
   d. Always includes reviewer and reviewer-safety; conditionally includes others per dispatch.

After all invoked reviewers complete, emit `[summary] <one sentence>` then Gate #2 is shown. Apply via `apply debug: <description>`.

### `apply debug: <description>`
**You must not read source files or make edits yourself.** Spawn each agent as a Task invocation.

Invoke agents in sequence:
1. **implementer** — applies `docs/context/handoff.md` to source files. If `docs/PLAN.md` contains `(wave: N)` annotations, follow the **Wave execution** rules from `apply feature:` above (invoke implementer-triage first, dispatch per wave).
2. **tester** (see `## Tester mode`) → **documenter**
3. **tool-call-auditor** — audits tool-call patterns from the session; conditional branch to **agent-optimizer** as described under `apply feature:` above.

### `refactor: <file or area>`
Invoke agents in this order:
1. **refactor** — analyses hot file, writes refactor plan to `docs/context/handoff.md`
2. **reviewer-triage** — reads `handoff.md`, outputs dispatch list. For refactors, always include reviewer-style regardless of triage output (style is the primary concern for refactors). Follow dispatch for all others.
2b. **Read triage sidecar:** After reviewer-triage completes, read `docs/context/triage-dispatch.json`. If it exists and contains valid JSON with a `reviewers` string array, use that array as the base reviewer list (always add reviewer-style even if absent). If absent or malformed, derive the reviewer list by parsing the `### Invoke` section of triage's output text.
3. **Validate excerpts and invoke reviewers named by triage** (plus always reviewer-style):
   a. For each reviewer in the dispatch list (always including reviewer-style), check that `docs/context/triage-excerpts/<reviewer>.md` exists and is non-empty. If ANY expected file is missing — including `reviewer-style.md` if triage skipped it — re-run **reviewer-triage** immediately so all excerpt files are generated. Do not invoke any reviewer until all expected files are present.
   b. Read `confidence` from `triage-dispatch.json`. Default to `"HIGH"` if absent.
   c. For each reviewer in the dispatch list, invoke it with this exact prompt prefix: `"[triage-confidence: <VALUE>]\n"`. Do not pass excerpt content inline — reviewers read their own file at `docs/context/triage-excerpts/<reviewer>.md`.

**Orchestrator rule — count-based triage gate:** After resolving the full reviewer list (always including reviewer-style for refactors), count them. If the count is **3 or more** AND the mode is not FULL, invoke **reviewer-triage** before dispatching — regardless of the mode routing table.

After all invoked reviewers complete, emit `[summary] <one sentence>` then Gate #2 is shown. Apply via `apply refactor:`.

### `apply refactor: <file or area>`
**You must not read source files or make edits yourself.** Spawn each agent as a Task invocation.

Invoke agents in sequence:
1. **implementer** — applies `docs/context/handoff.md` to source files. If `docs/PLAN.md` contains `(wave: N)` annotations, follow the **Wave execution** rules from `apply feature:` above (invoke implementer-triage first, dispatch per wave).
2. **tester** (see `## Tester mode`) → **documenter**
3. **tool-call-auditor** — audits tool-call patterns from the session; conditional branch to **agent-optimizer** as described under `apply feature:` above.

---

## Gate system

- **Gate #1** — shown after `plan feature:` completes. User must approve before `implement feature:` runs.
- **Gate #2** — shown after `implement feature:`, `debug:`, or `refactor:` reviewers complete. User must click YES before any apply pipeline runs.
- **BLOCK** — if any mandatory reviewer (reviewer, reviewer-safety, reviewer-logic, reviewer-performance) issues BLOCK, Gate #2 YES button is disabled.

### Reviewer conflict protocol

Each reviewer owns a non-overlapping domain. Verdicts are combined by these rules:

| reviewer-safety | reviewer (boundary) | reviewer-logic | reviewer-performance | reviewer-style | Outcome |
|---|---|---|---|---|---|
| BLOCK | any | any | any | any | Hard-blocked — non-overrideable. Safety violations are never demoted. |
| APPROVED | BLOCK | any | any | any | Blocked — coder revision required. |
| APPROVED | APPROVED | BLOCK | any | any | Blocked — coder revision required. |
| APPROVED | APPROVED | APPROVED | BLOCK | any | Blocked — coder revision required. |
| APPROVED | APPROVED | APPROVED | APPROVED | BLOCK | **Demote to REVISE** — implementer fixes style issues inline. Gate #2 unlocked. |

A reviewer must not BLOCK for issues outside its domain. For example, reviewer-safety must not BLOCK for logic bugs — that is reviewer-logic's call.

### Plan revision loop

When any plan-stage reviewer issues BLOCK or REVISE:
1. **Initialize a revision counter to 0** before entering the loop. Increment it by 1 after each revision cycle completes.
2. The planner reads **all reviewer outputs** directly using its own Read tool (never spawn a sub-agent to retrieve reviewer findings) and revises `docs/PLAN.md` to address every BLOCK and REVISE item.
3. **Re-run triage before reviewers:** Re-run **reviewer-triage** with the `[plan-stage mode]` prefix against the revised `docs/PLAN.md`. Validate all expected excerpt files exist. Read the updated `triage-dispatch.json` for confidence and reviewer list. Then invoke only the reviewer(s) that issued BLOCK or REVISE, using the fresh excerpts. Reviewers that previously returned APPROVED do not re-run unless the revision materially changes their domain.
4. **Before starting another revision**: check the counter. If it has reached 3, stop immediately — do NOT run the planner or any reviewer again. Emit `[PLAN-BLOCK-ESCALATED]` and surface the full revision history to the user. Architectural conflicts or ambiguous requirements need human judgment before implementation proceeds. **Also check:** if the current cycle's BLOCK/REVISE reasons are identical to the previous cycle's (same reviewer, same issue text) — stop immediately regardless of counter. The planner is not processing the feedback. Emit `[PLAN-BLOCK-ESCALATED]` with diagnosis: "circuit breaker — same BLOCK reason returned unchanged after revision." **Also check (early exit):** if every pending verdict is REVISE with 0 blockers (warnings only, no BLOCKs), exit the loop immediately — do not run another revision cycle. Warnings are advisory; they do not require a plan revision before proceeding to Gate #1.
5. Repeat steps 2–4 until every reviewer returns APPROVED or the counter reaches 3.

### Coder revision loop

When Gate #2 is blocked by a mandatory reviewer:
1. **Initialize a revision counter to 0** before entering the loop. Increment it by 1 after each revision cycle completes.
2. The coder reads **only the output of the blocking reviewer** directly (not all reviewer outputs — targeted signal prevents over-revision). **Never spawn a sub-agent to read reviewer output files** — read `docs/context/reviewer-output/<reviewer>.md` directly using your own Read tool.
3. Invoke the coder with the prefix `[revision-mode: <N>]` where N is the current counter value (starting at 1). The coder in revision mode reads only `docs/context/handoff.md` and the reviewer output — it does **not** re-read GENERAL.md, SKILLS.md, PLAN.md, or source files. The coder revises `docs/context/handoff.md` to address every BLOCK and REVISE item.
4. **Re-run triage before reviewers:** Re-run **reviewer-triage** against the revised `docs/context/handoff.md`. Validate all expected excerpt files are written. Read the updated `triage-dispatch.json` — use its `reviewers` array as the reviewer list for this cycle (the revised handoff may dispatch different reviewers than the original). Then run all **mandatory reviewers** (reviewer, reviewer-safety, reviewer-logic, reviewer-performance) against the fresh excerpts. reviewer-style does **not** re-run — its issues are static notes carried forward to the implementer.

   **Special case — triage-missing REVISE:** If the only REVISE finding across all reviewers is "Triage excerpt missing — re-run reviewer-triage before proceeding", do not invoke the coder. Re-run reviewer-triage directly, then re-run only the reviewer(s) that emitted that finding. This does not count toward the revision counter.
5. **Before starting another revision**: check the counter. If it has reached 2, stop immediately — do NOT run the coder or any reviewer again. Emit `[BLOCK-ESCALATED]` and surface the full revision history to the user with a recommendation. Automated revision cannot fix architectural incompatibilities or resolve reviewer false positives — these require human judgment. **Also check:** if the current cycle's BLOCK reasons are identical to the previous cycle's (same reviewer, same blocker description) — stop immediately regardless of counter. The coder is not processing the feedback. Emit `[BLOCK-ESCALATED]` with diagnosis: "circuit breaker — same BLOCK reason returned unchanged after revision." **Also check (early exit):** if Gate #2 is not BLOCKED (i.e. every pending verdict is REVISE with 0 blockers), exit the loop immediately — do not run another coder revision. Warnings-only verdicts do not gate implementation; carry the notes forward to the implementer.
6. Repeat steps 2–5 until Gate #2 is unblocked or the counter reaches 2.

### Debug/refactor revision loop

When Gate #2 is blocked after a `debug:` or `refactor:` run:
1. **Initialize a revision counter to 0** before entering the loop. Increment it by 1 after each revision cycle completes.
2. The debug/refactor agent reads **only the output of the blocking reviewer** directly (never spawn a sub-agent to read reviewer output files — read `docs/context/reviewer-output/<reviewer>.md` directly) and revises `docs/context/handoff.md` to address every BLOCK item.
3. **Re-run triage before reviewers:** Re-run **reviewer-triage** against the revised `docs/context/handoff.md`. Validate all expected excerpt files exist. Read the updated `triage-dispatch.json`. Then run all **mandatory reviewers** (reviewer, reviewer-safety, reviewer-logic, reviewer-performance) against the fresh excerpts. reviewer-style does **not** re-run.

   **Special case — triage-missing REVISE:** If the only REVISE finding is "Triage excerpt missing — re-run reviewer-triage before proceeding", re-run triage directly without invoking the debug/refactor agent. This does not count toward the revision counter.
4. **Before starting another revision**: check the counter. If it has reached 2, stop immediately — do NOT re-invoke the agent or reviewers. Emit `[BLOCK-ESCALATED]` and surface the full revision history to the user. **Also check:** if the current cycle's BLOCK reasons are identical to the previous cycle's (same reviewer, same blocker description) — stop immediately regardless of counter. Emit `[BLOCK-ESCALATED]` with diagnosis: "circuit breaker — same BLOCK reason returned unchanged after revision." **Also check (early exit):** if Gate #2 is not BLOCKED (every pending verdict is REVISE with 0 blockers), exit the loop immediately without re-running the agent. Warnings-only verdicts do not block Gate #2.
5. Repeat steps 2–4 until Gate #2 is unblocked or the counter reaches 2.

### Pipeline summary signal

After every Gate display and after every apply pipeline completes, emit:

    [pipeline-summary] mode=<pipeline-mode> verdict=<combined-verdict>

- `<pipeline-mode>` is `trivial`, `sprint`, `lean`, `standard`, or `full` (from the active pipeline mode setting).
- `<combined-verdict>` is `APPROVED`, `REVISE`, or `BLOCK` per the reviewer conflict protocol above; use `N/A` for apply pipelines and plan pipelines that did not reach the review stage.
- The token must appear on its own line.
- Do **not** emit `[pipeline-summary]` from tester — that is the orchestrator's responsibility.

---

## Docs structure

| File | Written by | Purpose |
|------|-----------|---------|
| `docs/PLAN.md` | planner | Current active plan — feature groups and tasks |
| `docs/BACKLOG.md` | FORGE UI | Queued todo items — durable fallback for board.json. **Agents must never read or modify this file.** |
| `docs/RESEARCH/<feature>.md` | researcher | Technical findings per feature |
| `docs/context/handoff.md` | coder / debug / refactor | Implementation draft for reviewer trio |
| `docs/context/checkpoint.md` | any agent | Progress save for checkpoint resume |
| `docs/context/triage-dispatch.json` | reviewer-triage | Machine-readable reviewer list `{ "reviewers": [...] }`; read by orchestrator, deleted by cleanup |
| `docs/context/researcher-status.json` | researcher | `{ "status": "READY"\|"SKIPPED"\|"BLOCKED", "blocker": "..." }`; read by coder, deleted by cleanup |
| `docs/context/scout.json` | coder-scout | `{ "files_to_read": [...], "functions_to_modify": {...}, "new_files": [...], "ipc_channels": [...], "trimmed_files": [...] }`; read by coder, deleted by cleanup |
| `docs/context/run-metrics.json` | orchestrator | `{ "planner_model", "coder_model", "scout_used", "files_read_count", "revision_cycles", "total_agents" }`; written at Gate #2, deleted by cleanup |
| `docs/context/coder-status.json` | coder | `{ "archUpdate": bool, "decision": bool, "ipcNew": [], "ipcVerification": {...} }`; read by documenter, deleted by cleanup |
| `docs/TESTING.md` | tester | Manual test checklist |
| `docs/CHANGELOG.md` | documenter | Shipped changes log |
| `docs/ARCHITECTURE.md` | documenter / architect | Module and file structure |
| `docs/DECISIONS.md` | documenter | Non-obvious technical decisions |
| `docs/solutions/<category>/<slug>.md` | documenter | Knowledge compound — structured solution docs with YAML frontmatter (title, category, date, files_touched, tags). Searchable by planner and coder for reusable patterns from past features. Categories: ipc, state, ui, pipeline, config, general |
| `docs/gotchas/GENERAL.md` | architect / user | Project-wide gotchas all agents must know |
| `docs/gotchas/skills/<id>.md` | skills-generator | Per-capability agent guidance files; `# ` heading contains `(generated: YYYY-MM-DD)` stamp |

---

## Pipeline mode

When your system prompt contains `PIPELINE MODE: <VALUE>`, follow the corresponding routing table for each pipeline. When absent, use LEAN.

Five modes, ordered from fastest to most thorough:

- **TRIVIAL** — bypass the pipeline entirely; used by One Chat for trivial single-file fixes. No coder, no reviewers. If you see PIPELINE MODE: TRIVIAL, handle the prompt as a direct task.
- **SPRINT** — core agent only (coder / debug / refactor). No reviewers, no Gate delay on plan stage. GSD mode.
- **LEAN** — core agent + reviewer-safety + reviewer. Everyday safety floor.
- **STANDARD** — core agent + completeness-checker (impl only) + reviewer-triage + reviewer + reviewer-safety + reviewer-logic + reviewer-performance. Triage-driven dispatch.
- **FULL** — core agent + completeness-checker (impl only) + all five reviewers unconditionally (no triage). Nothing skipped.

**These routing tables are binding.** Follow the row for your mode exactly — do not add agents not listed, do not substitute agents from a different mode's row, and do not reason about whether additional agents would be helpful. The mode was set by the user. If `PIPELINE MODE` is absent, use LEAN.

### plan feature: routing

| Mode | Agent sequence |
|------|---------------|
| TRIVIAL | Handle as direct task — no planner, no reviewers |
| SPRINT | planner only → Gate #1 |
| LEAN | planner → researcher (conditional) → reviewer-safety → reviewer → Gate #1 |
| STANDARD | planner → researcher (conditional) → gotcha-checker → reviewer-triage → dispatched reviewers → Gate #1 |
| FULL | planner → researcher (always) → gotcha-checker → reviewer + reviewer-safety + reviewer-logic + reviewer-style + reviewer-performance (all, no triage) → Gate #1 |

### implement feature: routing

| Mode | Agent sequence |
|------|---------------|
| TRIVIAL | Handle as direct task — no coder, no reviewers |
| SPRINT | coder → Gate #2 |
| LEAN | coder-scout → coder → completeness-checker → reviewer-safety → reviewer → Gate #2 |
| STANDARD | coder-scout → coder → completeness-checker → reviewer-triage → dispatched reviewers (always reviewer + reviewer-safety; conditionally logic/performance) → Gate #2 |
| FULL | coder-scout → coder → completeness-checker → reviewer + reviewer-safety + reviewer-logic + reviewer-style + reviewer-performance (all, no triage) → Gate #2 |

### debug: and refactor: routing

| Mode | Agent sequence |
|------|---------------|
| TRIVIAL | Handle as direct task |
| SPRINT | debug/refactor only → Gate #2 |
| LEAN | debug/refactor → reviewer-safety → reviewer → Gate #2 |
| STANDARD | debug/refactor → reviewer-triage → dispatched reviewers → Gate #2 |
| FULL | debug/refactor → reviewer + reviewer-safety + reviewer-logic + reviewer-style + reviewer-performance (all, no triage) → Gate #2 |

---

## Model routing

FORGE agents run on different models based on the complexity of their task. The orchestrator **must pass an explicit `--model <model-id>` flag** when spawning every agent Task. Never rely on agent `.md` frontmatter defaults alone — the orchestrator owns model selection.

### Tier-based routing (set by planner's `[tier] a|b|c` signal)

After `plan feature:` completes and the `[tier]` signal is emitted, store the tier for use throughout the `implement feature:` pipeline.

| Tier | Definition | Coder model |
|------|------------|-------------|
| `a` — bug-fix-or-minor | One-file change, no new IPC, no state changes | `claude-haiku-4-5-20251001` |
| `b` — additive-backend-or-logic | New IPC channel, store mutation, or multi-file backend change | `claude-sonnet-4-6` |
| `c` — greenfield-UI-or-frontend | New Svelte component, new store, new modal, or visual redesign | `claude-sonnet-4-6` |

When no `[tier]` signal is present (e.g. `implement feature:` invoked standalone without a plan phase), default to Sonnet.

**SPRINT/DIRECT override:** In SPRINT or DIRECT mode, always use `claude-haiku-4-5-20251001` for the coder regardless of tier — no plan stage ran to produce a tier, and the task is scoped as simple.

### Mode-based routing (all agents)

| Agent | Model | Notes |
|-------|-------|-------|
| planner (Pass 1 — questions) | `claude-haiku-4-5-20251001` | Pass 1 is classification only; Haiku is sufficient |
| planner (Pass 2 — full plan) | `claude-sonnet-4-6` | Pass 2 writes the full task plan |
| researcher | `claude-haiku-4-5-20251001` | |
| coder-scout | `claude-haiku-4-5-20251001` | |
| coder | tier-based (see above) | |
| completeness-checker | `claude-haiku-4-5-20251001` | |
| reviewer-triage | `claude-haiku-4-5-20251001` | |
| reviewer | `claude-haiku-4-5-20251001` | |
| reviewer-safety | `claude-haiku-4-5-20251001` | |
| reviewer-logic | `claude-sonnet-4-6` | Logic analysis needs deeper reasoning |
| reviewer-performance | `claude-haiku-4-5-20251001` | |
| reviewer-style | `claude-haiku-4-5-20251001` | |
| implementer | `claude-sonnet-4-6` | |
| documenter | `claude-haiku-4-5-20251001` | |
| debug | `claude-sonnet-4-6` | |
| refactor | `claude-sonnet-4-6` | |
| gotcha-checker | `claude-haiku-4-5-20251001` | |
| regression-risk | `claude-haiku-4-5-20251001` | |

**Override rule:** if PIPELINE MODE is FULL, promote all reviewer agents from Haiku to Sonnet — high-stakes runs require deeper analysis.

### Enforcement rule

When invoking any agent as a Task, always set the model explicitly. If the agent's `.md` frontmatter specifies a model, that becomes the fallback default — the orchestrator override takes precedence. The orchestrator never reads frontmatter to determine the model; it uses only the table above.

---

## Tester mode

When your system prompt contains `TESTER MODE: <VALUE>`, apply this rule after the implementer completes and before invoking the documenter in all apply pipelines (`apply feature:`, `apply debug:`, `apply refactor:`):

| Tester Mode | Behaviour |
|-------------|-----------|
| `OFF` | Skip tester entirely. Proceed directly to documenter. |
| `ASK` | Do NOT invoke tester. Emit `[suggest] run tester: <feature name>` on its own line so the user sees a suggestion chip. Then proceed to documenter. |
| `ON` | Invoke tester. Wait for completion before proceeding to documenter. |

When absent, default is `ASK`.

---

## Checkpoint resume

When an agent's context approaches its limit, it writes progress to `docs/context/checkpoint.md` and emits `[CONTEXT-CHECKPOINT]`. FORGE auto-resumes the same agent up to 5 times. Agents should read `docs/context/checkpoint.md` on resumption and continue from where they left off.

---

## Suggestion chips

Agents can emit `[suggest] <text>` on its own line to create a clickable suggestion chip in the FORGE UI. Use this to guide the user toward the next logical action:
- `[suggest] implement feature: <name>` — after plan
- `[suggest] review debug: <description>` — after debug agent writes handoff
- `[suggest] apply feature: <name>` — after Gate #2 approval on `implement feature:`
- `[suggest] apply sprint: <name>` — after Gate #2 approval on `sprint:`

Agents and the orchestrator can also emit `[wave-complete] N` (where N is the wave number) to signal that wave N passed key-link verification. FORGE surfaces this as a terminal progress line. The signal is displayed in the terminal (not suppressed) and is consumed by the orchestrator to gate the start of wave N+1.

---

## TODO signals

Emit `[todo] <task text>` on its own line to add items to FORGE's TODO tab in real time. Works in all modes. **Never use the `TodoWrite` tool** — it writes to Claude Code's internal session list, which is invisible to the user and discarded at run end.

---

## Planner questions signal

The planner's first pass may emit a `[questions]` / `[/questions]` block instead of writing a plan. FORGE intercepts it and renders an inline Q&A strip.

Format: each question on its own line as `<id>. <text> [<opt1> / <opt2>]`. Question count is tier-based: 0–2 for bug fixes, 2–4 for backend/logic features, 5–8 for greenfield UI features. Maximum 8 questions per round. After emitting the block the planner **must stop** — no plan content may follow. On re-invocation with an `[answers]` block present, the planner skips questions and writes the full plan.

**Scope note:** The Q&A intercept mechanism is validated only for the `plan feature:` pipeline. While the UI technically supports `[questions]` blocks from any agent, no other pipeline has the orchestrator stop-and-wait logic needed to correctly re-invoke with answers. Do not emit `[questions]` from agents other than the planner unless the pipeline explicitly handles the re-invocation.

---

## Plan validity rule

A plan in `docs/PLAN.md` is only valid if produced by the full `plan feature:` pipeline. Plans written directly or via `claude --print` are **not valid**.

If the coder or implementer is invoked and the plan shows no evidence of pipeline production (missing `docs/RESEARCH/` files, no reviewer annotations, suspiciously thin plan), stop and emit `[suggest] plan feature: <feature name>` with: "The current plan does not appear pipeline-produced. Please re-run through FORGE before implementing."

---

## EXPLORE mode rules

In EXPLORE mode (no pipeline prefix), agents may read any project file but **must not modify source files**. EXPLORE mode is for exploration, ideation, and answering questions — not for writing code. Use `[todo]` to surface ideas, `[suggest]` to recommend next pipeline steps.

Note: EXPLORE mode was previously called FREE mode. Always refer to it as EXPLORE mode.

---

## On-demand agents

Some agents are invoked on demand via `direct:` rather than being part of a pipeline. They run as single-agent passthroughs with no gate and no reviewers.

| Command | Agent | What it does |
|---------|-------|--------------|
| `direct: run observer` | observer | Reads the most recent session artifacts (`docs/context/handoff.md`, `docs/PLAN.md`, `docs/context/reviewer-output/`) and logs reasoning-level patterns (coder wave-scoping habits, planner IPC gaps, recurring reviewer issues, handoff omissions) to `docs/observer-log.jsonl`. Run after any `apply feature:` to surface patterns the tool-call-auditor cannot see. |
| `direct: audit tool calls` | tool-call-auditor | Audits the session tool-call log for statistical anti-patterns (repeated reads, blind writes, tool storms). |
| `direct: nyquist audit` | nyquist-auditor | Identifies user-observable requirements with no automated test stub and writes stub files to `docs/tests/`. |

---

## Orchestrator discipline

**Do not explore before starting the pipeline.** When a `plan feature:`, `debug:`, `implement feature:`, or any other pipeline prefix is received, invoke the first specified agent immediately. Do NOT run an explore agent, gather project context, read source files, or run bash commands before the pipeline starts. The pipeline agents read what they need themselves. Pre-pipeline exploration wastes 50–100k tokens on work the agents will redo.

**Do not use bash for file writes.** Use the Write or Edit tools. `cat >`, `echo >>`, and heredoc patterns cost 5–10× more tokens than a single Write call and are harder to audit.

---

## Reading discipline

Agents should read only what they need:
- For plan-phase agents (planner, researcher): read `docs/PLAN.md` and the relevant source files (not the whole codebase)
- For plan-stage reviewers (gotcha-checker, reviewer-safety, reviewer-logic, reviewer-performance, reviewer): read `docs/PLAN.md`, `docs/RESEARCH/`, and `docs/gotchas/GENERAL.md` — do not read `handoff.md`
- For implement-stage reviewers (reviewer, reviewer-safety, reviewer-logic, reviewer-style, reviewer-performance): read `docs/context/handoff.md` first. May also read up to 3 source files if the handoff explicitly references them and seeing the current implementation is essential for the review decision.
- For apply-phase agents: read `docs/context/handoff.md` and only the specific files being changed
- Apply an N+400 line cap when reading large files: grep for the target section start, read N to N+400
