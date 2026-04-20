---
name: forge:apply
description: "Run the FORGE apply pipeline. Use when: user approved Gate #2 and wants to apply the implementation to source files."
argument-hint: "[feature name]"
allowed-tools: "Read Write Edit Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run (MANDATORY — do this FIRST, before anything else)

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"apply"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading

Save the returned `runId` and `feature` from the run object. The `feature` field has been mechanically sanitized (shell-unsafe characters stripped) by `forge_create_run`. Use this sanitized `feature` value — not raw `$ARGUMENTS` — in Steps 5, 7, and 8 when constructing git commit messages and PR titles.

Then call `forge_update_run` with that `runId` and `status: "running"`, `currentStep: "setup"`.

Do NOT skip this step. Do NOT check for existing runs first. Every /forge:apply invocation creates exactly one new run.

## STEP 1b — Verify Gate #2 approval (MANDATORY — do not skip)

Call `forge_check_gate` to read the current gate state. If the MCP tool is unavailable, fall back to reading `.pipeline/gate-pending.json` directly.

**Proceed only if ALL of these are true:**
- The gate data exists (not null, not missing)
- `gate` is `"gate2"`
- `status` is `"approved"`

**If any check fails**, stop immediately. Print:
"Gate #2 has not been approved. Run /forge:implement (or /forge:debug, /forge:refactor) and then /forge:approve before applying."

Do NOT proceed to STEP 2. Do NOT read the handoff. Do NOT spawn agents.

## STEP 2 — Read handoff and config

Read `docs/context/handoff.md` for the approved implementation.

> See **Model routing** in CLAUDE.md.

## Git integration config check

Read `gitIntegration` from `.pipeline/project.json` (prefer `forge_read_project` MCP tool, fall back to Read). If `gitIntegration` is not an object, or `gitIntegration.enabled` is not `true`, skip steps 1, 5, and 7 below (branch creation, auto-commit, auto-PR). Missing fields use defaults: `branchPrefix: "forge/"`, `autoCommit: false`, `autoPR: false`.

**Note:** Steps 2, 3, 4, 6, and 8 always run regardless of gitIntegration settings. Step 8 (worktree merge-back) is lifecycle closure, not a git integration preference.

## STEP 2b — Resolve worktree (if applicable)

Check if a worktree-backed implement run exists for this feature. Use `forge_list_runs` filtered by `pipelineType: "implement"` to find the most recent completed implement run. Call `forge_get_run` on it to check for a non-null `worktreePath`.

If the run has a `worktreePath` AND the directory exists on disk: save it as `<worktreePath>`. All agent work in STEP 3 happens inside this path. Then persist it into the active run marker so enforcement hooks can read it:

- Read `.pipeline/run-active.json`
- Add/update the `worktreePath` field with the resolved path
- Write the file back (preserve all other fields)

This is mandatory — the workflow-guard hook uses this field to block source writes outside the worktree.

If no worktree-backed run is found, or the directory does not exist: agents work in the main project directory as before. Do NOT write `worktreePath` to `run-active.json`. Skip the worktree targeting block below.

## STEP 3 — Run apply pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "implementer"`.

**If a worktree was resolved in Step 2b:** When spawning implementer and documenter, prepend this to each agent's prompt:

> Your working directory for this run is: `<worktreePath>`
> Read and write all project files using absolute paths under this directory.
> For example: `<worktreePath>/src/main.js`, `<worktreePath>/docs/context/handoff.md`, etc.
> Do NOT read or write files in the main project root.

**If no worktree was resolved:** spawn agents without the path prefix (they work in the main project directory).

1. **Git branch creation** (opt-in — only if `gitIntegration.enabled`):
   - Derive feature slug: use `$ARGUMENTS` if provided, else read the first `## Feature:` heading from `docs/PLAN.md`
   - Sanitize slug: lowercase, replace spaces/special chars with hyphens, strip anything not `[a-z0-9-]`, truncate to 50 chars
   - If slug is empty after sanitization, log "[git-integration] Could not derive feature slug — skipping branch creation" and continue without a branch
   - Run: `git checkout -b <branchPrefix><slug>`
   - If branch already exists: try `git checkout <branchPrefix><slug>` instead (reuse existing branch)
   - If checkout fails (dirty working tree, etc.): log the error and continue on current branch. Never stash, reset, or clean.

2. **Implementer-triage** (STANDARD/FULL, if waves exist): splits handoff per task

3. **Implementer:** applies handoff to source files

4. **Test execution** (opt-in — only if `testCommand` is set in project.json):
   - Run the test command via Bash with `timeout: 60000`
   - On success (exit 0): log "Tests passed" and continue
   - On failure (non-zero exit): show full output, emit `[suggest] debug — tests failed after apply`. Do NOT auto-fix or retry.

5. **Auto-commit** (opt-in — only if `gitIntegration.autoCommit`):
   - Use the sanitized `feature` field returned by `forge_create_run` in Step 1 as `<safe-feature>`. It has been mechanically sanitized at source — do not use raw `$ARGUMENTS` here. (Defense in depth: `"`, `\`, `` ` ``, `$`, newlines, and control characters have already been stripped.)
   - Run `git add` with the specific files the implementer changed (use `git diff --name-only` and `git status --porcelain` to identify them). Do NOT use `git add -A` — it stages untracked files that may contain secrets or agent artifacts. Then `git commit -m "feat(forge): <safe-feature>"`
   - If nothing to commit (exit code 1 or output contains "nothing to commit"): log "[git-integration] Nothing to commit — skipping" and continue
   - If pre-commit hooks fail: log the error output and continue. Do NOT use `--no-verify`.
   - Never amend, never force, never skip hooks

6. **Documenter:** updates CHANGELOG, ARCHITECTURE, DECISIONS, captures solution, cleans artefacts.
   After documenter completes: call `forge_update_run` with the `runId` and `status: "completed"`, `currentStep: "done"`.

7. **Auto-PR** (opt-in — only if `gitIntegration.autoPR`):
   - Check `gh --version` first. If gh is not installed, log "[git-integration] gh CLI not found — skipping PR creation" and continue.
   - Push the branch: `git push -u origin HEAD`
   - If push fails: log the error and skip PR creation. Emit `[suggest] git push failed — push manually and create PR`
   - Create PR: `gh pr create --title "feat(forge): <safe-feature>" --body "Applied via FORGE pipeline"`
   - If PR creation fails: log the full error. Do NOT retry.

8. **Worktree commit** (mandatory when a worktree was resolved in Step 2b — NOT gated by gitIntegration):
   - This commits the implementer's and documenter's changes onto the worktree branch so Step 9 can merge them. This is infrastructure, not a user preference.
   - Run via Bash: `git -C <worktreePath> add` with the specific files the implementer changed (use `git -C <worktreePath> diff --name-only` and `git -C <worktreePath> status --porcelain`). Do NOT use `git add -A`.
   - Then: `git -C <worktreePath> commit -m "feat(forge): <safe-feature>"` (use the same sanitized feature name from Step 5; if Step 5 was skipped, sanitize now: strip `"`, `\`, `` ` ``, `$`, newlines, control characters)
   - If nothing to commit (exit code 1 or output contains "nothing to commit"): log `[worktree] No changes to commit on worktree branch — skipping.` and continue to Step 9.
   - If commit fails for any other reason: log `[worktree] Commit failed: <error>` and continue. Step 9 merge will likely be a no-op but will not crash.
   - Do NOT use `--no-verify`. Do NOT amend. Do NOT force.
   - If no worktree was resolved in Step 2b: skip this step entirely.

9. **Worktree merge-back** (automatic when a worktree-backed implement run exists):
   - Check if a worktree was used for this feature. Read `gate-pending.json` — if it has a `feature` field, use `forge_list_runs` filtered by `pipelineType: "implement"` to find the most recent completed implement run. Call `forge_get_run` on it to check for a non-null `worktreePath`. If no worktree-backed run is found, skip this step silently.
   - If a worktree exists: extract the `runId` from the implement run. Run via Bash: `node bin/forge-worktree.js merge <runId>` (use the absolute path via `$CLAUDE_PLUGIN_ROOT` if available, else relative from project root).
   - On success (exit 0): log `[worktree] Merged forge/<runId> into main and cleaned up worktree.`
   - On failure (non-zero exit): log `[worktree] Merge failed — resolve manually with: git merge forge/<runId>` and continue. Do NOT delete the worktree on failure. Do NOT force-merge. Do NOT retry. The worktree is left intact for manual inspection.
   - If the worktree directory does not exist on disk (already cleaned up): skip silently.

## Error handling for all git steps

Every git step is wrapped in its own error handling. Failures log with `[git-integration]` prefix and continue — they NEVER block the pipeline. The pipeline must complete (implementer → documenter) regardless of git operation failures. Worktree merge failures log with `[worktree]` prefix and also continue without blocking.

Forbidden operations: `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`. If any of these appear in a git command, do NOT run it.

$ARGUMENTS
