---
name: forge:apply
description: "Run the FORGE apply pipeline. Use when: user approved Gate #2 and wants to apply the implementation to source files."
argument-hint: "[feature name]"
allowed-tools: "Read Glob Grep"
model: claude-sonnet-4-6
---

## When to use this skill

**Normal flow:** After gate2 approval the existing worker resumes automatically and handles apply (documenter, lifecycle, commit gate). The conductor does NOT need to invoke /forge:apply — just wait for the commit gate and then /forge:approve.

**Manual recovery only:** Use /forge:apply when the original worker died, failed, or was killed before reaching the commit gate. This spawns a fresh apply worker to pick up where the dead worker left off.

## STEP 1 — Verify gate and dispatch worker (MANDATORY — do this FIRST)

### 1a. Verify this is manual recovery (MANDATORY — check BEFORE anything else)

**The normal flow does NOT use /forge:apply.** After gate2 approval, the existing worker resumes automatically and handles apply (documenter, lifecycle, commit gate). The conductor just waits for the commit gate and then runs /forge:approve.

**Only proceed if the original worker is confirmed dead.** Check:
1. Call `forge_list_runs` with `status: "gate-pending"` to find the source run (implement/debug/refactor). Call `forge_get_run` on it.
2. If the run has `status: "failed"` or `status: "discarded"` or `failureReason` is non-null: the worker is dead. Proceed to Step 1b.
3. If the run is `gate-pending` with `gateState.gate === "gate2"` and `gateState.status === "approved"`: the worker should be resuming. Print "Worker should be resuming after gate2 approval — wait for the commit gate. Only use /forge:apply if the worker is confirmed dead (status: failed/discarded)." and STOP.
4. If the run is still `running`: the worker is alive. Print "Worker is still running — wait for it to finish." and STOP.

### 1b. Verify Gate #2 approval

Call `forge_check_gate` to read the current gate state. If the MCP tool is unavailable, fall back to reading `.pipeline/gate-pending.json` directly.

**Proceed only if ALL of these are true:**
- The gate data exists (not null, not missing)
- `gate` is `"gate2"`
- `status` is `"approved"`

**If any check fails**, stop immediately. Print:
"Gate #2 has not been approved. Run /forge:implement (or /forge:debug, /forge:refactor) and then /forge:approve before applying."

Do NOT proceed. Do NOT spawn a worker.

### 1c. Dispatch worker

Call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"apply"`
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading
- `spawnWorker`: `true`
- `useWorktree`: `false`

The worker runs the apply pipeline autonomously — documenter, lifecycle cleanup — then pauses at a **commit gate** for user approval before committing and merging.

Report to the user:
- Run ID: `<runId>`
- Log file: `<logFile>` (tail with `tail -f <logFile>` to follow progress)
- "Apply running in background. The worker will pause at a commit gate before committing — use /forge:approve when ready."

Do NOT invoke documenter directly. Do NOT check for existing runs first. Every /forge:apply invocation creates exactly one new run.

Exit — do not proceed to further steps.

<!-- Steps 2–7 below are executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 2 — Resolve worktree and read handoff (worker)

### 2a. Resolve worktree (do this FIRST)

Check if a worktree-backed run exists for this feature. Use `forge_list_runs` filtered by `pipelineType` values `"implement"`, `"refactor"`, and `"debug"` to find all completed runs for this feature. Among all matches, select the most recent one (by `createdAt`). Call `forge_get_run` on it to check for a non-null `worktreePath`.

If the run has a `worktreePath` AND the directory exists on disk: save it as `<worktreePath>`. All agent work in STEP 3 happens inside this path. Persist it in two places:

1. **Update the run itself:** call `forge_update_run` with the current apply `runId` and `worktreePath: "<worktreePath>"`. This lets the worker process (forge-worker.mjs) resolve the correct gate file path.
2. **Update run-active.json:** read `.pipeline/run-active.json`, add/update the `worktreePath` field with the resolved path, write the file back (preserve all other fields). The workflow-guard hook uses this field to block source writes outside the worktree.

If no worktree-backed run is found, or the directory does not exist: agents work in the main project directory as before. Do NOT write `worktreePath` to `run-active.json` or the run. Skip the worktree targeting block below.

### 2b. Read handoff

If a worktree was resolved: read `<worktreePath>/docs/context/handoff.md` for the approved implementation.
If no worktree: read `docs/context/handoff.md` from the main project root.

> See **Model routing** in CLAUDE.md.

## Git integration config check

Read `gitIntegration` from `.pipeline/project.json` (prefer `forge_read_project` MCP tool, fall back to Read). If `gitIntegration` is not an object, or `gitIntegration.enabled` is not `true`, skip git branch creation (step 3.1) and auto-PR (step 7). Missing fields use defaults: `branchPrefix: "forge/"`, `autoCommit: false`, `autoPR: false`.

## STEP 3 — Run apply pipeline (worker)

**If a worktree was resolved in Step 2b:** When spawning documenter, prepend this to the agent's prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/src/main.js`, `<worktreePath>/docs/context/handoff.md`, etc.
> Do NOT read or write files in the main project root.

**If no worktree was resolved:** spawn the agent without the path prefix (it works in the main project directory).

1. **Git branch creation** (opt-in — only if `gitIntegration.enabled`):
   - Derive feature slug: use `$ARGUMENTS` if provided, else read the first `## Feature:` heading from `docs/PLAN.md`
   - Sanitize slug: lowercase, replace spaces/special chars with hyphens, strip anything not `[a-z0-9-]`, truncate to 50 chars
   - If slug is empty after sanitization, log "[git-integration] Could not derive feature slug — skipping branch creation" and continue without a branch
   - Run: `git checkout -b <branchPrefix><slug>`
   - If branch already exists: try `git checkout <branchPrefix><slug>` instead (reuse existing branch)
   - If checkout fails (dirty working tree, etc.): log the error and continue on current branch. Never stash, reset, or clean.

2. **Test execution** (opt-in — only if `testCommand` is set in project.json):
   - Run the test command via Bash with `timeout: 60000`
   - On success (exit 0): log "Tests passed" and continue
   - On failure (non-zero exit): show full output, emit `[suggest] debug — tests failed after apply`. Do NOT auto-fix or retry.

3. **Documenter:** updates CHANGELOG, ARCHITECTURE, DECISIONS, captures solution.

   Record `documenterStartedAt = Date.now()` (epoch-ms) immediately before spawning the documenter.

   After documenter completes, verify its output via mtime check — do NOT use `git diff` (gitignored files never appear in git diff output):

   For each expected doc file the documenter should have written (typically `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and any solution file under `docs/solutions/`), run:
   ```
   node scripts/verify-output.mjs --file=<absoluteDocFilePath> --since=<documenterStartedAt>
   ```
   - Exit 0 (`ok: true`): file was written or updated — continue.
   - Exit 1 (file absent) or exit 2 (`mtime < since`): documenter did NOT write this file. Re-invoke the documenter once with a note identifying the missing or stale file. If the second run also fails the mtime check, log `[apply] documenter output unverified: <file>` and continue — do NOT loop further.

   After mtime verification passes (or the single retry is exhausted), proceed to step 3b.

3b. **Post-apply lifecycle cleanup** (always runs, not gated by gitIntegration):
   - Run via Bash: `node scripts/post-apply-lifecycle.mjs "<safe-feature>"` (use the sanitized `feature` from Step 1). Set `timeout: 30000`.
   - On exit 0: log `[lifecycle] cleanup done`.
   - On non-zero exit: log `[lifecycle] cleanup failed: <stderr output>` and continue. Do NOT retry. This is non-blocking.

3c. **Commit apply changes** (always runs — closes TODO `38bca814`):

   Worker owns ALL commits inside the worktree — the conductor at the commit gate only merges. This step commits the documenter's CHANGELOG/ARCHITECTURE/PLAN.md updates AND any uncommitted source changes left over from the implement/debug/refactor stage (single-pass implement runs don't have per-phase commits).

   - When `<worktreePath>` is non-null:
     - Run via Bash: `git -C <worktreePath> diff --name-only HEAD` to find changed files.
     - For each file in the output, stage it individually: `git -C <worktreePath> add <file>` (do NOT use `git add -A`).
     - Then: `git -C <worktreePath> commit -m "feat(forge): <safe-feature> [<runId>]"`.
     - If nothing to commit: log `[worktree] No changes to commit — skipping.` and proceed to Step 4.
     - If commit fails: log `[worktree] Commit failed: <error>` and proceed to Step 4 (the conductor will surface uncommitted files via the verify step in approve Step 4).

   - When `<worktreePath>` is null (apply runs without a worktree):
     - Same flow against the main project root: `git diff --name-only HEAD`, `git add <file>` per file, `git commit -m "feat(forge): <safe-feature> [<runId>]"`.
     - Same fallthrough on errors.

   Forbidden ops: `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`. Worker does not bypass any safeguard.

## STEP 4 — Commit gate (worker writes gate and exits)

After documenter + lifecycle cleanup AND the apply commit (Step 3c) are done, write the commit gate and exit. The conductor handles only the merge.

1. Write gate file first (the worker exits on status change, so the file must exist before updating the run):
   - Use `forge_set_gate` or write directly:
   - If worktree: `<worktreePath>/.pipeline/gate-pending.json`
   - If no worktree: `.pipeline/gate-pending.json`
   - Content: `{"runId":"<runId>","gate":"commit","feature":"<feature name>","status":"pending","createdAt":"<now ISO>"}`
2. Call `forge_update_run` with the `runId`, `status: "gate-pending"`, and `gateState: {"gate":"commit","status":"pending","feature":"<feature name>","createdAt":"<now ISO>"}`
3. Present a summary: list changed files (from `git diff --name-only` or `git -C <worktreePath> status --porcelain`), note test results if any.
4. The worker exits after writing the gate. Use /forge:approve when ready — the conductor handles the merge (Step 4 of the approve skill). Never wait for the worker.

**Conductor reminder:** When the user says "approve" for a commit gate, invoke `/forge:approve` via the Skill tool — never manually call `forge_set_gate`. The approve skill's Step 4 handles the merge.

$ARGUMENTS
