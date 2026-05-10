---
name: forge:refactor
description: "Run the FORGE refactor pipeline. Use when: user wants to clean up, restructure, or improve existing code."
argument-hint: "[file or area to refactor]"
allowed-tools: "Read Write Glob Grep Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Dispatch worker (MANDATORY — do this FIRST, before anything else)

**Before creating the run**, call `forge_classify_risk` with:
- `feature`: the short refactor summary from `$ARGUMENTS`
- `filePaths`: `[]` (no files known at this stage)
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
  Core agents:  refactor, reviewer-style (always included for refactor)
  Reviewers:    <reviewers from forge_classify_risk, merged with post-handoff classifier output>
```
Waiting for approval — type 'go' or 'approve' to proceed, or describe changes to the team

Call `forge_create_run` (only after user approves) with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"refactor"`
- `feature`: a short summary of the refactor target from `$ARGUMENTS` (e.g. "split handlers.js into per-domain modules")
- `spawnWorker`: `true`
- `classificationId`: the `classificationId` value from the `forge_classify_risk` result

Do NOT pass `useWorktree: true` — the worker creates its own worktree as part of the pipeline.

The worker runs the full refactor pipeline autonomously — worktree creation, refactor agent, reviewers, and Gate #2. It pauses at Gate #2 waiting for approval via `/forge:approve`.

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Gate #2 will pause the worker. Use /forge:approve when ready."

Do NOT invoke the refactor agent or reviewers directly. Do NOT check for existing runs first. Every /forge:refactor invocation creates exactly one new run with its own worktree.

Exit — do not proceed to further steps.

<!-- Steps 1b–2 below are executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 1b — Resolve worktree (worker — do this FIRST)

Call `forge_get_run` with the `runId`. Inspect the run's `worktreePath` field:

- **If `run.worktreePath` is non-null** (advanced from a prior stage that already created a worktree): log `[worktree] reusing existing worktree from prior stage: <run.worktreePath>` and use that path as `<worktreePath>`. Do NOT call `forge_create_worktree` — it would throw "already has a worktree".

- **If `run.worktreePath` is null**: call `forge_create_worktree` with the `runId`. This creates `.worktrees/<runId>/` with branch `forge/<runId>` and persists `worktreePath` and `branchName` on the run record. Save the returned `worktreePath`. If the call fails, log `[worktree] creation failed: <error>` and fall back to working in the main project root.

Do NOT proceed without resolving `<worktreePath>`.

> See **Model routing** in CLAUDE.md.

## STEP 2 — Run refactor pipeline

**All agents in this step work inside the worktree.** When spawning each agent, prepend this to its prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/docs/context/handoff.md`, `<worktreePath>/docs/PLAN.md`, etc.
> Do NOT read or write files in the main project root.

1. **Refactor agent:** analyzes the target file or area, writes refactor plan to `<worktreePath>/docs/context/handoff.md`

2. **Coder:** reads the refactor agent's plan from `<worktreePath>/docs/context/handoff.md`, implements the refactoring by writing changes directly to `<worktreePath>` source files using Edit/Write/Bash tools, then rewrites `<worktreePath>/docs/context/handoff.md` as a reviewer-readable audit summary of the actual changes made.
   - Post-coder verification: for each file listed under `## Files to create` and `## Files to modify` in `<worktreePath>/docs/context/handoff.md`, run:
     `node scripts/verify-output.mjs --file=<absoluteFilePath> --since=<coderStartedAtMs>`
     where `coderStartedAtMs` is the epoch-ms timestamp recorded when the coder agent was spawned.
     - Exit 0 (`ok: true`): file was written or updated — continue.
     - Exit 1 (file absent) or exit 2 (`mtime < since`): file was NOT written — treat as truncation; re-invoke the coder or surface the issue before continuing.
     - If ALL declared files pass mtime check, changes are confirmed.
   - Post-coder wiring check: after the mtime checks, run:
     ```
     node scripts/wiring-verify.mjs --handoff=docs/context/handoff.md --root=<worktreePath>
     ```
     # wiring-verify.mjs runs as a Bash subprocess, not a registered agent — no agent-roles.json entry needed.
     Capture stderr. The script emits `[wiring] <N> exports verified, <M> gaps` as a diagnostic — log it but do NOT treat it as a control signal. If the script emits any `[wiring-gap] <symbol>` lines, collect them and append a `## Wiring gaps` section to `<worktreePath>/docs/context/handoff.md` listing each gap (for reviewer visibility). A gap does NOT block the pipeline.
   - Proceed to step 2b.

2b. **Test stage** (between coder and reviewer dispatch):

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

3. **Reviewer dispatch** — determine which reviewers to invoke via the deterministic dispatcher script.
   - Run via Bash: `node scripts/reviewer-dispatch.mjs --handoff=<worktreePath>/docs/context/handoff.md --stage=implement --pipeline=refactor`. Append `--force-review` if the operator's original `$ARGUMENTS` contains the literal token `[force-review]`.
   - Capture the stdout JSON (shape: `{ "reviewers": [...], "reasons": [...] }`). Write it to `<worktreePath>/docs/context/lean-gate.json` for auditability.
   - Log: `[reviewer-dispatch] reviewers=[<comma-joined>] reasons=[<comma-joined>]`.
   - The script always includes `reviewer-style` for refactor pipelines. If no other risk-surface rules triggered, `reviewer-style` is the only reviewer dispatched.
   - If `reviewers` is non-empty: proceed to step 4 with exactly those reviewers.
4. **Reviewers:** dispatch exactly the reviewers listed in step 3's `reviewers[]` output. Use `forge_get_model_recommendation` for each and spawn them (in parallel when multiple). No reviewer-triage agent — the script already determined the list.

   **Before spawning each reviewer**, prepend the following signal line to the reviewer's prompt so the reviewer writes its verdict to the per-run directory:

   > `[reviewer-output-dir: <worktreePath>/.pipeline/context/reviewer-output/]`

   **Special case — `reviewer-style`:** When `reviewer-style` appears in the dispatch list (it always does for refactor pipelines), run the deterministic script first:
   - Run via Bash: `node scripts/reviewer-style-check.mjs --root <worktreePath>` with `timeout: 30000`.
   - If exit 0 and stdout JSON has `ok: true`: use the script's `[reviewer-verdict]` signal directly. Write the script output to `<worktreePath>/.pipeline/context/reviewer-output/reviewer-style.md` (the script does this automatically). Skip spawning the `reviewer-style` agent for this run.
   - If exit non-zero or `ok: false` or stdout is malformed: log `[reviewer-style-check] script fallback`. Spawn the `reviewer-style` agent as normal fallback.
   - Other reviewers in the list run in parallel as usual.

4b-pre. **Persist verdict bodies for audit trail:**

   Before processing the verdicts (BLOCK/REVISE/APPROVED branching), copy each reviewer's output file to a per-run verdict directory:

   - Run `mkdir -p <worktreePath>/.pipeline/context/verdicts/` via Bash.
   - For each reviewer in the dispatched list, copy `<worktreePath>/.pipeline/context/reviewer-output/<reviewer>.md` to `<worktreePath>/.pipeline/context/verdicts/<runId>-<reviewer>-refactor.md`.
   - These files persist beyond Gate #2 — they are the audit trail for failed runs.

4b. **Reviewer verdict handling** (only when step 4 ran):

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
       3. Re-invoke the coder with `[revision-mode: N]` prepended to its prompt. If the failed-criteria list is non-empty, also prepend `[failed-criteria: <comma-joined AC-IDs>]` (e.g. `[failed-criteria: AC-2, AC-4]`). Pass all REVISE warnings as context. Then proceed to step 4c.
     - If `N >= 2`: call `forge_update_run` with `status: "failed"` and `failureReason: "REVISE unresolved after 2 revision passes — <comma-joined unresolved AC-IDs>"`. Do NOT write `gate-pending.json`. Do NOT open Gate #2. Log the unresolved AC-IDs and exit the worker.
   - If ALL reviewers emitted **APPROVED**: proceed to Gate #2 normally.

4c. **Re-run reviewers after coder revision** (only when step 4b triggered the `N < 2` re-invoke path):

   After the revised coder output is written to `<worktreePath>/docs/context/handoff.md`: Re-run the dispatcher script (step 3) and dispatch the resulting reviewers (step 4). Collect their `[reviewer-verdict]` signals. Return to step 4b verdict handling with the updated `N`.

   > Note: the reviewer dispatch (step 3) is NOT re-run on revision passes. A REVISE verdict already proves reviewer scrutiny is warranted, so the classifier is bypassed and reviewers always run in the revision loop.

5. **Gate #2:** Write gate file first, then update the run (the worker exits on status change, so the file must exist first):
   - Write `<worktreePath>/.pipeline/gate-pending.json`: `{"runId":"<the runId from Step 1>","gate":"gate2","feature":"<refactor summary>","status":"pending","applyKeyword":"apply refactor: <refactor summary>"}`
   - Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"gate2","status":"pending","feature":"<refactor summary>","createdAt":"<now ISO>"}` — the `runId` field is required so approve/discard can target this exact run unambiguously.
   - Present the refactor summary to the user (include the reviewer dispatch decision). If `N > 0` (at least one revision loop ran), prepend: "Coder revised N time(s). Final reviewer verdict: <APPROVED|REVISE>." to the summary.
   - If `T > 2` (test stage exhausted its retry budget), include a non-blocking warning: "Tests did not pass after 3 attempts. Last test output:" followed by the stored test output (truncated to 10 KB).
   - Ask user to type /forge:approve or /forge:discard

After gate2 approval the worker resumes automatically — it runs the apply steps (documenter, lifecycle) and pauses at a **commit gate**. The conductor does NOT invoke /forge:apply. Use /forge:approve on the commit gate to finalize.

## What to refactor
$ARGUMENTS
