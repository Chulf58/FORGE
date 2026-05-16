---
name: forge:implement
description: "Run the FORGE implement feature pipeline. Use when: user approved Gate #1 and wants to implement the planned feature."
argument-hint: "[feature name]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Dispatch worker (MANDATORY — do this FIRST, before anything else)

**Guard — check for an existing implement run before doing anything else:**

Call `forge_list_runs` with `fields: ["runId", "feature", "stages", "status"]`. Filter the results client-side:
- Match runs whose `feature` equals the feature name from `$ARGUMENTS` (or from `docs/PLAN.md` if `$ARGUMENTS` is absent).
- Among those matches, find any run where `stages.implement.status` is `"running"` or `"pending"`.

If such a run is found:
- Print: "Implement stage already running for '<feature>' (run <runId>). Use /forge:approve when Gate #2 is ready."
- Exit — do not create a new run.

If no such run is found, proceed normally.

**Before creating the run**, call `forge_classify_risk` with:
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading
- `filePaths`: `[]` (no files known at this stage; the coder-scout will populate file paths later)
- `forceReview`: `true` if `$ARGUMENTS` contains the literal token `[force-review]`, otherwise `false`

Present the classification result to the user:
```
Risk classification:
  Risk level:        <riskLevel>
  Triggered rules:   <advisories joined by ", " or "none">
  Plan-stage review: <planStageReview>
  Suggested reviewers: <reviewers joined by ", " or "none">
```

Present the resolved agent team to the user before proceeding:
```
Agent team for this run:
  Core agents:  coder-scout, coder, completeness-checker[, implementation-architect — if plan is large/complex]
  Reviewers:    <reviewers from forge_classify_risk, or "none — post-handoff classifier decides">
```
Waiting for approval — type 'go' or 'approve' to proceed, or describe changes to the team

Call `forge_create_run` (only after user approves) with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"implement"`
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading
- `spawnWorker`: `true`
- `classificationId`: the `classificationId` value from the `forge_classify_risk` result
- `reviewerOverrides`: the `reviewers` array from the `forge_classify_risk` result
- `stages`: `{ "implement": { "agents": ["coder-scout", "coder", "completeness-checker"], "status": "pending" } }`

Do NOT pass `useWorktree: true` — the worker creates its own worktree via `forge_create_worktree` inside the pipeline.

The worker runs the full implement pipeline autonomously — worktree creation, coder-scout, coder, completeness-checker, reviewers, and Gate #2. It pauses at Gate #2 waiting for approval via `/forge:approve`.

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Gate #2 will pause the worker. Use /forge:approve when ready."

Do NOT invoke coder, completeness-checker, or reviewers directly. Do NOT check for existing runs first. Every /forge:implement invocation creates exactly one new run with its own worktree.

Exit — do not proceed to further steps.

<!-- Steps 1b–6 below are executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 1b — Resolve worktree (worker — do this FIRST)

Call `forge_get_run` with the `runId`. Inspect the run's `worktreePath` field:

- **If `run.worktreePath` is non-null** (this run was advanced from a prior stage that already created a worktree — e.g. plan stage → implement stage via `forge_advance_stage`): log `[worktree] reusing existing worktree from prior stage: <run.worktreePath>` and use that path as `<worktreePath>` for all subsequent steps. Do NOT call `forge_create_worktree` — it would throw "already has a worktree".

- **If `run.worktreePath` is null** (direct `/forge:implement` invocation, no preceding plan stage): call `forge_create_worktree` with the `runId`. This creates `.worktrees/<runId>/` with branch `forge/<runId>` and persists `worktreePath` and `branchName` on the run record. Save the returned `worktreePath`. If `forge_create_worktree` fails, log `[worktree] creation failed: <error>` and fall back to working in the main project root.

Do NOT proceed without resolving `<worktreePath>`.

## STEP 1c — Resolve configured agent list (worker)

Call `forge_get_run` with the `runId`. Extract `stages.implement.agents` from the returned run object.

- If `stages.implement.agents` is a non-empty array, use it as the **configured agent list**.
- If `stages.implement.agents` is absent, null, or an empty array, fall back to `["coder-scout", "coder", "completeness-checker"]` as the **configured agent list**.

After resolving the configured agent list, filter it to known agents: `coder-scout`, `coder`, `completeness-checker`, `implementation-architect`. For any name not in this set, log `[implement] dropping unknown agent <name> from configured list — not a recognized implement-stage agent` and remove it from the list. Proceed with the filtered list.

Save the configured agent list — Steps 3.1 and 3.3 gate on it (see below).

## STEP 2 — Read plan and check blockers

Read `<worktreePath>/docs/PLAN.md` for the approved plan. Use the worktree path, not the main project root.

Check if the target task has a non-empty `blockedBy` array (via `forge_read_board` or reading `.pipeline/board.json` in the main project). If the task is blocked, warn the user: "This task is blocked by: [blocker IDs]. Resolve blockers first or confirm you want to proceed anyway." Wait for confirmation before continuing.

> See **Model routing** in CLAUDE.md.

## STEP 2b — Scoping check (conditional implementation-architect)

After reading the plan, assess whether the next implementation slice needs narrowing. Apply this checklist against the active `[ ]` task lines in the current feature section (or the current phase's task lines when running inside the Phase Execution Loop):

1. **Large plan** — count the active `[ ]` task lines. More than 8 = structurally complex.
2. **Broad file spread** — extract the file paths from task lines (text in backticks). Count unique top-level directories (e.g. `src/main/`, `src/renderer/`, `hooks/`). Three or more = cross-cutting.
3. **Risky keywords** — any task description contains: "migrate", "refactor", "rename across", "shared state", "store", "schema", "cross-module", or "move from".

**If ANY condition is true:** invoke `implementation-architect` before the coder.

- Spawn the `implementation-architect` agent. Prepend the worktree path instruction (same as below). Pass the feature name in the prompt.
- It reads the plan and writes `<worktreePath>/docs/context/slice-brief.md`
- The coder will then scope to the slice brief instead of the full plan

**If NONE are true:** skip directly to Step 3.

## STEP 2c — Phase detection (conditional per-phase execution)

After reading the plan (Step 2), scan the active feature section in `<worktreePath>/docs/PLAN.md` for phase headings. Match any heading level (`##`, `###`, or `####`) with the pattern `Phase <number>` followed by an optional label after a dash/em-dash (e.g. `#### Phase 1 — Citation grounding`). The canonical level is `####` (H4, nesting inside `### Feature:`), but accept H2-H4 for backward compatibility with older plans.

**If one or more phase headings are found:**

1. Build an ordered list of phases. For each heading, extract:
   - `index`: 0-based (Phase 1 = index 0, Phase 2 = index 1, etc.)
   - `label`: the full heading text (e.g. `Phase 1 — Citation grounding`)
   - `taskLines`: the `- [ ]` task lines between this heading and the next phase heading (or feature section end)

2. Initialise the run phases array by calling `forge_update_run` with:
   ```
   phases: [
     { index: 0, label: "Phase 1 — <label>", status: "pending" },
     { index: 1, label: "Phase 2 — <label>", status: "pending" },
     ...
   ]
   ```

3. Execute the **Phase Execution Loop** (below) instead of the single-pass Steps 2b–5c. After the loop, proceed to the completeness-checker (Step 3.3) and then Gate #2 (Step 6).

**If NO phase headings are found:** skip this step. Proceed to Step 2b — the single-pass flow is the default and remains unchanged.

### Phase Execution Loop

For each phase in index order:

**a. Mark phase running:**
Call `forge_update_run` with `phases: [{ index: <N>, label: "<label>", status: "running" }]`.

**b. Run Steps 2b through 5c scoped to this phase only:**
Execute the scoping check (Step 2b), then the test-author wave (Step 3.0 below), then coder-scout (Step 3.1), coder (Step 3.2), test stage (Step 3.2b), reviewer dispatch (Step 3.4), reviewers (Step 3.5), and verdict handling (Steps 5b-5c) exactly as written in their respective sections below, with one modification: **scope every coder and implementation-architect prompt to this phase's task lines only.** Prepend the following to the coder prompt:

> `[phase-scope: <label>]` Only implement the following tasks from the plan — do NOT implement tasks from other phases:
>
> (insert this phase `- [ ]` task lines here)

**Step 3.0 — test-author wave (conditional):**

Scan the current phase's `- [ ]` task lines for backtick-quoted file paths matching `*-test.{js,mjs}`.

- **If at least one test-file task is found:** dispatch the `test-author` agent with the following prompt prefix:

  > `[phase-scope: <label>]` Only write test files for the following tasks from the plan — do NOT implement any source files:
  >
  > (insert this phase `- [ ]` task lines here)

  The test-author writes failing test files scoped to the phase's task lines and writes a JSON artefact to `.pipeline/context/test-author-output.json`.

  **Red-phase verification:** after the test-author completes, run a single batched invocation:

  ```
  node --test <file1> <file2> ... <fileN>
  ```

  (where the file list is taken from `testFiles` in `.pipeline/context/test-author-output.json`).

  Check the exit code using `scripts/wave-split.mjs` `redPhaseAbort({ exitCode, testFile })`. If `aborted: true` (exit 0), abort with: `[wave-split] handoff invalid — aborting phase` — the red-phase failed to fail. Do NOT proceed to the coder for this phase.

  If exit non-zero (red bar confirmed), proceed to Step 3.1.

  The coder receives the artefact path as a prompt signal: `[test-author-output: .pipeline/context/test-author-output.json]`. The coder reads the JSON artefact to discover which test files to make pass — it does NOT receive the test-author's session content, reasoning trace, or context. This isolation is the mechanism that prevents Red+Green collapse.

- **If no test-file tasks are found:** log `[wave-split] phase has no test files — skipping test-author` and advance directly to Step 3.1 (coder-scout).

The coder-scout, reviewer dispatch, test stage, and reviewers operate on the same `<worktreePath>` files as normal — no scoping modification needed for those steps.

**Green-phase verification (after coder runs in Step 3.2):** re-run the same batched `node --test` invocation. The exit code must be 0. If non-zero, route through the standard reviewer-REVISE loop (Step 5b) — the coder revision loop applies until the tests pass or the maximum revision count is reached.

**c. Handle the phase verdict (after Step 5b):**

- **BLOCK** (any reviewer emitted BLOCK):
  Update phase: `forge_update_run` with `phases: [{ index: <N>, label: "<label>", status: "blocked", reviewerVerdict: "BLOCK" }]`.
  Then call `forge_update_run` with `status: "failed"` and `failureReason: "reviewer BLOCK in phase <N> — <reviewer>: <first line of violation>"`. Do NOT write `gate-pending.json`. Do NOT continue to the next phase, do NOT proceed to the completeness-checker, do NOT open Gate #2. Exit the worker.

- **REVISE-unresolved** (max reviewer iterations `N >= 2` reached with unresolved warnings):
  Do NOT create a worktree commit — the code did not fully pass review.
  Update phase: `forge_update_run` with `phases: [{ index: <N>, label: "<label>", status: "revise-unresolved", reviewerVerdict: "REVISE", committedAt: null }]`.
  Then call `forge_update_run` with `status: "failed"` and `failureReason: "REVISE unresolved in phase <N> after 2 revision passes — <comma-joined unresolved AC-IDs>"`. Do NOT write `gate-pending.json`. Do NOT continue to the next phase. Exit the worker.

- **APPROVED** (all reviewers approved, or reviewers were skipped):
  Create a worktree git commit (mirrors skills/apply/SKILL.md:149 and skills/ship/SKILL.md:145 — do NOT use `git add -A`, which would stage worktree-only swaps like CLAUDE.md from bin/forge-worktree.js:126 createWorktree):
  - Run `git -C <worktreePath> diff --name-only HEAD` to list changed files.
  - For each file in the output, stage it individually: `git -C <worktreePath> add <file>`.
  - Then: `git -C <worktreePath> commit -m "forge: <label> [<runId>]"`. Capture the short commit hash.
  Update phase: `forge_update_run` with `phases: [{ index: <N>, label: "<label>", status: "completed", reviewerVerdict: "APPROVED", committedAt: "<now ISO>" }]`.
  **Reset the worker's safety-valve timer** so the next phase gets its own 60-min budget instead of sharing one ceiling across all phases. Write an empty file at `<worktreePath>/.pipeline/worker-reset/<runId>` (create the directory first if absent). This path follows the `resetPillPath(worktreePath, runId)` convention from `mcp/lib/worker-paths.js` — it is intentionally in the WORKTREE, not the main project root, because both the skill (writer) and the worker (reader) operate inside the worktree. The forge-worker.mjs harness watches that path, calls `resetWorkerTimer()` on detection, and unlinks the file. No response is needed — fire and forget.
  Continue to the next phase.

**d. Reset per-phase state between phases:**
Before starting the next phase, clear `<worktreePath>/.pipeline/context/reviewer-output/` (delete all files in the directory) so reviewer verdicts from the previous phase do not bleed into the next. Verdict bodies have already been persisted in step 5b-pre, so they survive this clear. Reset the revision counter `N` to 0 and the test counter `T` to 0 for each new phase.

**After the loop completes** (all phases done — BLOCK and REVISE-unresolved verdicts exit the worker before reaching here): proceed to the completeness-checker (Step 3.3 — run once against the full plan, not per-phase) and then Gate #2 (Step 6).


## STEP 3 — Run coder pipeline

**All agents in this step work inside the worktree.** When spawning each agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Coder-scout:**
   - If `"coder-scout"` is NOT in the configured agent list (from Step 1c): log `[implement] skipping coder-scout — not in configured agent list` and skip to step 2.
   - Run via Bash: `node scripts/coder-scout.mjs --root <worktreePath>` with `timeout: 30000`.
   - If exit 0 and stdout JSON has `ok: true`: log the `signal` field from stdout. `scout.json` is written — proceed to step 2.
   - If exit non-zero, stdout is malformed, or `ok` is not `true`: log `[coder-scout] script failed: <reason from stdout or stderr>`. Skip scout and proceed to coder without scout context — the coder can still function without it.
2. **Coder:** writes changes directly to `<worktreePath>` source files using Edit/Write/Bash tools, then writes `<worktreePath>/docs/context/handoff.md` as a reviewer-readable audit summary. When a test-author wave ran for this phase (Step 3.0), prepend the following signal to the coder's prompt so it knows where to find the test artefact:

   > `[test-author-output: .pipeline/context/test-author-output.json]`

   The coder reads the JSON artefact at that path to discover which test files to make pass. It does NOT receive the test-author's session content — the JSON artefact only.

   - Post-coder coverage check: after the coder writes `<worktreePath>/docs/context/handoff.md`, run:
     ```
     node scripts/covers-verify.mjs --handoff=docs/context/handoff.md --root=<worktreePath>
     ```
     # covers-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.
     Capture stderr. The script emits `[covers] <N> tests resolved, <M> gaps` as a diagnostic — log it but do NOT treat it as a control signal. If the script emits any `[covers-gap] <srcFile>` lines, collect them and append a `## Covers gaps` section to `<worktreePath>/docs/context/handoff.md` listing each gap (for reviewer visibility). A gap does NOT block the pipeline. A non-zero exit code from covers-verify (test failures) is also logged but does NOT block the pipeline at this step — reviewers see the test results in the handoff.
   - Post-coder wiring check: after the coverage check, run:
     ```
     node scripts/wiring-verify.mjs --handoff=docs/context/handoff.md --root=<worktreePath>
     ```
     # wiring-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.
     Capture stderr. The script emits `[wiring] <N> exports verified, <M> gaps` as a diagnostic — log it but do NOT treat it as a control signal. If the script emits any `[wiring-gap] <symbol>` lines, collect them and append a `## Wiring gaps` section to `<worktreePath>/docs/context/handoff.md` listing each gap (for reviewer visibility). A gap does NOT block the pipeline.
   - Post-coder verification: for each file listed under `## Files to create` and `## Files to modify` in `<worktreePath>/docs/context/handoff.md`, run:
     `node scripts/verify-output.mjs --file=<absoluteFilePath> --since=<coderStartedAtMs>`
     where `coderStartedAtMs` is the epoch-ms timestamp recorded when the coder agent was spawned.
     - Exit 0 (`ok: true`): file was written or updated — continue.
     - Exit 1 (file absent) or exit 2 (`mtime < since`): file was NOT written — treat as truncation; re-invoke the coder or surface the issue before continuing.
     - If ALL declared files pass mtime check, changes are confirmed. Save the full git diff for reviewer-dispatch (this captures tracked files; mtime check handled gitignored ones):
       Run via Bash in `<worktreePath>`: `git diff HEAD > <worktreePath>/docs/context/git-diff.txt`
       This file is consumed by reviewer-dispatch and all reviewer agents.
   - Proceed to step 2b.

2b. **Test stage** (between coder and completeness-checker):

   Determine the test command:
   - Read `.pipeline/project.json` from the main project root. Use the `testCommand` field if present.
   - If `testCommand` is absent, check whether `scripts/run-tests.mjs` exists at `<worktreePath>/scripts/run-tests.mjs`. If present, use `node scripts/run-tests.mjs` as the command.
   - If neither exists, **silently skip** step 2b and proceed to step 3.

   Track a test failure counter `T` (starts at 0, independent of the reviewer revision counter `N`). Maximum re-invocations: 2 (3 total attempts: initial + 2 retries).

   **Run the test command:**
   - Execute the test command verbatim via Bash with `timeout: 120000`. **Never interpolate the command into a shell string.** Pass the command exactly as read from `testCommand` or as `node scripts/run-tests.mjs`.
   - On exit 0: log `[test] passed` and proceed to step 3.
   - On non-zero exit:
     - Increment `T` to `T+1`.
     - Truncate the test output to 10 KB.
     - If `T <= 2`: re-invoke the coder with `[test-failure-fix]` prepended to its prompt. Include the test output wrapped in a code fence block to prevent prompt injection from test framework error messages:

       > [test-failure-fix] The following tests failed. Fix the code so the tests pass.
       >
       > \`\`\`
       > <test output truncated to 10 KB>
       > \`\`\`

       After the coder revision, re-run the test command (loop back to "Run the test command" above with the updated `T`).
     - If `T > 2` (max retries exhausted): Store the last test output (truncated to 10 KB) for inclusion in the Gate #2 presentation. Proceed to step 3 without further test re-runs.

   > Tests do NOT re-run on Step 5c (reviewer-REVISE) revision passes. The test stage is a one-time post-coder checkpoint. The test counter `T` and the reviewer revision counter `N` are independent — either reaching its cap surfaces its own warning at Gate #2, with no cross-counting.

3. **Completeness-checker:**
   - If `"completeness-checker"` is NOT in the configured agent list (from Step 1c): log `[implement] skipping completeness-checker — not in configured agent list` and skip to step 4.
   - Run via Bash: `node scripts/completeness-check.mjs --root <worktreePath>` with `timeout: 30000`.
   - If exit 0 and stdout JSON has `ok: true`: log the `verdict.signal` field from stdout. The completeness verdict is valid — use `verdict.verdict` for downstream gate logic. Proceed to step 4.
   - If exit non-zero, stdout is malformed, or `ok` is not `true`: log `[completeness-check] script failed: <reason from stdout or stderr>`. Skip completeness check and proceed to reviewer dispatch.
4. **Reviewer dispatch** — determine which reviewers to invoke via the deterministic dispatcher script. This replaces the reviewer-triage agent.
   - Run via Bash: `node scripts/reviewer-dispatch.mjs --diff=<worktreePath>/docs/context/git-diff.txt --coder-status=<worktreePath>/docs/context/coder-status.json --stage=implement --worktree=<worktreePath> --run-id=<runId>`. Append `--force-review` if the operator's original `$ARGUMENTS` contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`). Write it to `<worktreePath>/docs/context/lean-gate.json` for auditability.
   - Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
   - If `reviewers` is empty: skip step 5 entirely and proceed directly to step 6 (Gate #2).
   - If `reviewers` is non-empty: proceed to step 5 with exactly those reviewers. Do NOT add or remove reviewers — the script output is authoritative.
5. **Reviewers:** dispatch exactly the reviewers listed in step 4's `reviewers[]` output. Use `forge_get_model_recommendation` for each and spawn them (in parallel when multiple). No reviewer-triage agent — the script already determined the list.

   **Before spawning each reviewer**, prepend the following signal lines to the reviewer's prompt so the reviewer writes its verdict to the per-run directory:

   > `[reviewer-output-dir: <worktreePath>/.pipeline/context/reviewer-output/]`

   Additionally, when `<worktreePath>/docs/context/findings.json` exists, prepend `[findings: <worktreePath>/docs/context/findings.json]` to each reviewer's prompt — the dispatch script writes this file; the reviewer agents read it to scope analysis to pre-identified findings.

   **Special case — `reviewer-style`:** When `reviewer-style` appears in the dispatch list, run the deterministic script first:
   - Run via Bash: `node scripts/reviewer-style-check.mjs --root <worktreePath>` with `timeout: 30000`.
   - If exit 0 and stdout JSON has `ok: true`: use the script's `[reviewer-verdict]` signal directly. Write the script output to `<worktreePath>/.pipeline/context/reviewer-output/reviewer-style.md` (the script does this automatically). Skip spawning the `reviewer-style` agent for this run.
   - If exit non-zero or `ok: false` or stdout is malformed: log `[reviewer-style-check] script fallback`. Spawn the `reviewer-style` agent as normal fallback.
   - Other reviewers in the list run in parallel as usual (only `reviewer-style` uses the script path).

5b-pre. **Persist verdict bodies for audit trail:**

   Before processing the verdicts (BLOCK/REVISE/APPROVED branching) or clearing the reviewer-output dir between phases, copy each reviewer's output file to a per-run verdict directory:

   - Run `mkdir -p <worktreePath>/.pipeline/context/verdicts/` via Bash.
   - For each reviewer in the dispatched list, copy `<worktreePath>/.pipeline/context/reviewer-output/<reviewer>.md` to `<worktreePath>/.pipeline/context/verdicts/<runId>-<reviewer>-<phase>.md`.
   - Phase value: `implement` for non-phased runs; `phase-<index>` (e.g. `phase-1`) when running inside the Phase Execution Loop.
   - These files persist beyond the inter-phase reviewer-output clear and beyond Gate #2 — they are the audit trail for failed runs.

5b. **Reviewer verdict handling** (only when step 5 ran):

   Track a revision counter `N` (starts at 0, incremented before each coder re-invocation). Maximum iterations: 2.

   - Before reading `[reviewer-verdict]` signals, mtime-check each reviewer's verdict file. For each reviewer in the dispatched list, run:
     `node scripts/verify-output.mjs --file=<worktreePath>/.pipeline/context/reviewer-output/<reviewer>.md --since=<reviewerStartedAtMs>`
     where `reviewerStartedAtMs` is the epoch-ms timestamp recorded when that reviewer was spawned.
     - Exit 0: verdict file is fresh — accept the signal.
     - Exit 1 or exit 2: verdict file is absent or stale — treat as **no-verdict** (do NOT read the signal from this file, even if one is present). Log: `[verdict-check] <reviewer> verdict file stale or missing — treating as no-verdict`.
     A reviewer with no-verdict is treated as REVISE-unresolved: proceed to the REVISE branch below (with the no-verdict reviewer counted as unresolved).
   - Collect all `[reviewer-verdict]` signals from reviewer outputs that passed the mtime check (in `<worktreePath>/.pipeline/context/reviewer-output/`)
   - If ANY reviewer emitted **BLOCK**: call `forge_update_run` with `status: "failed"` and `failureReason: "reviewer BLOCK: <reviewer> — <first line of the violation>"`. Do NOT write `gate-pending.json`. Do NOT call `forge_update_run` with `status: "gate-pending"`. Do NOT open Gate #2. Log the block reason and exit the worker. The reviewer output remains available at `<worktreePath>/.pipeline/context/reviewer-output/` for post-failure inspection.
   - If ANY reviewer emitted **REVISE** or yielded no-verdict (and none BLOCK):
     - If `N < 2`: increment `N` to `N+1`.
       1. Collect all `AC-<N>: NOT_MET` lines from reviewer output files in `<worktreePath>/.pipeline/context/reviewer-output/`. Extract the AC-IDs (e.g. `AC-2`, `AC-4`).
       2. Read `<worktreePath>/docs/context/criteria.json` if it exists. Exclude any AC-ID whose `status` is `"accepted"` or `"deferred"` from the failed list.
       3. Re-invoke the coder with `[revision-mode: N]` prepended to its prompt. If the failed-criteria list is non-empty, also prepend `[failed-criteria: <comma-joined AC-IDs>]` (e.g. `[failed-criteria: AC-2, AC-4]`). Pass all REVISE warnings as context. Then proceed to step 5c.
     - If `N >= 2`: call `forge_update_run` with `status: "failed"` and `failureReason: "REVISE unresolved after 2 revision passes — <comma-joined unresolved AC-IDs>"`. Do NOT write `gate-pending.json`. Do NOT open Gate #2. Log the unresolved AC-IDs and exit the worker.
   - If ALL reviewers emitted **APPROVED**: proceed to Gate #2 normally.

5c. **Re-run reviewers after coder revision** (only when step 5b triggered the `N < 2` re-invoke path):

   After the revised coder output is written to `<worktreePath>/docs/context/handoff.md`:
   - Re-save the git diff: run `git diff HEAD > <worktreePath>/docs/context/git-diff.txt` in `<worktreePath>`.
   - Re-run the dispatcher script (step 4) using the same `--diff=<worktreePath>/docs/context/git-diff.txt --coder-status=<worktreePath>/docs/context/coder-status.json` invocation and dispatch the resulting reviewers (step 5). Collect their `[reviewer-verdict]` signals. Return to step 5b verdict handling with the updated `N`.

   > Note: the reviewer dispatch (step 4) is NOT re-run on revision passes. A REVISE verdict already proves reviewer scrutiny is warranted, so the classifier is bypassed and reviewers always run in the revision loop.

6. **Gate #2:** Write gate file first, then update the run (the worker exits on status change, so the file must exist first):
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<feature name>","status":"pending","applyKeyword":"apply feature: <feature>"}`
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - **Per-phase summary (only when phases were detected in Step 2c):**
     Before the implementation summary, present a phase table:
     ```
     ## Phase summary
     | Phase | Status | Reviewer | Commit |
     |-------|--------|----------|--------|
     ```
     For each phase from the run phases array, add a row:
     - `completed` + `APPROVED`: `| N — <label> | completed | APPROVED | yes |`
     - `revise-unresolved`: `| N — <label> | revise-unresolved | REVISE (unresolved) | no |`
     - `blocked`: `| N — <label> | BLOCKED | BLOCKED — <block reason> | no |`
     - `pending` (not reached due to earlier BLOCK): `| N — <label> | pending | — | — |`

     If any phase was blocked, add a prominent warning: "Phase loop stopped at Phase N — <label> due to reviewer BLOCK. Remaining phases were not executed."

     If any phase was `revise-unresolved`, add a note: "Phase(s) <N> completed with unresolved REVISE warnings — review before approving."

     When no phases were detected (single-pass run), do NOT show the phase table — the Gate #2 presentation is unchanged from the single-pass flow.
   - Present the implementation summary to the user (include the reviewer dispatch decision: "Reviewers skipped — classifier found no risk surface" or "Reviewers ran — classifier matched: <rules>"). If `N > 0` (at least one revision loop ran), prepend: "Coder revised N time(s). Final reviewer verdict: <APPROVED|REVISE>." to the summary. If the final verdict is REVISE (max iterations reached), also list the unresolved warnings.
   - If `T > 2` (test stage exhausted its retry budget), include a non-blocking warning: "Tests did not pass after 3 attempts. Last test output:" followed by the stored test output (truncated to 10 KB). Note: "Tests can be disabled by removing `testCommand` from `.pipeline/project.json`."
   - Ask user to type /forge:approve or /forge:discard

$ARGUMENTS
