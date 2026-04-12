---
name: apply
description: "Run the FORGE apply pipeline. Use when: user approved Gate #2 and wants to apply the implementation to source files."
argument-hint: "[feature name]"
context: fork
allowed-tools: "Read Write Edit Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

## STEP 1 — Create run (MANDATORY — do this FIRST, before anything else)

Immediately call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"` if unavailable)
- `pipelineType`: `"apply"`
- `mode`: read mode from `.pipeline/project.json` `pipelineMode` field (or `"LEAN"` if unavailable)
- `feature`: the feature name from `$ARGUMENTS`, or read from `docs/PLAN.md` first heading

Save the returned `runId`. You MUST reference it in later steps.

Then call `forge_update_run` with that `runId` and `status: "running"`, `currentStep: "setup"`.

Do NOT skip this step. Do NOT check for existing runs first. Every /forge:apply invocation creates exactly one new run.

## STEP 2 — Read handoff and config

Read `docs/context/handoff.md` for the approved implementation.

## Model routing (optional)

Before spawning each agent, you may call `forge_get_model_recommendation` with the agent name and budget mode to check the optimal model. If the recommendation differs from the agent's frontmatter `model:` field, pass the recommended model via the Agent tool's `model` parameter. This is advisory — if the MCP tool is unavailable, use the frontmatter default.

## Git integration config check

Read `gitIntegration` from `.pipeline/project.json` (prefer `forge_read_project` MCP tool, fall back to Read). If `gitIntegration` is not an object, or `gitIntegration.enabled` is not `true`, skip ALL git steps below. Missing fields use defaults: `branchPrefix: "forge/"`, `autoCommit: false`, `autoPR: false`.

## STEP 3 — Run apply pipeline

Update the run: call `forge_update_run` with the `runId` and `currentStep: "implementer"`.

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
   - Run `git add -A` then `git commit -m "feat(forge): <feature name>"`
   - Feature name: the unsanitized `$ARGUMENTS` or plan heading (human-readable, not the slug)
   - If nothing to commit (exit code 1 or output contains "nothing to commit"): log "[git-integration] Nothing to commit — skipping" and continue
   - If pre-commit hooks fail: log the error output and continue. Do NOT use `--no-verify`.
   - Never amend, never force, never skip hooks

6. **Documenter:** updates CHANGELOG, ARCHITECTURE, DECISIONS, captures solution, cleans artefacts.
   After documenter completes: call `forge_update_run` with the `runId` and `status: "completed"`, `currentStep: "done"`.

7. **Auto-PR** (opt-in — only if `gitIntegration.autoPR`):
   - Check `gh --version` first. If gh is not installed, log "[git-integration] gh CLI not found — skipping PR creation" and continue.
   - Push the branch: `git push -u origin HEAD`
   - If push fails: log the error and skip PR creation. Emit `[suggest] git push failed — push manually and create PR`
   - Create PR: `gh pr create --title "feat(forge): <feature name>" --body "Applied via FORGE pipeline"`
   - If PR creation fails: log the full error. Do NOT retry.

## Error handling for all git steps

Every git step is wrapped in its own error handling. Failures log with `[git-integration]` prefix and continue — they NEVER block the pipeline. The pipeline must complete (implementer → documenter) regardless of git operation failures.

Forbidden operations: `--force`, `--force-with-lease`, `--amend`, `--no-verify`, `git reset`, `git clean`, `git stash`. If any of these appear in a git command, do NOT run it.

$ARGUMENTS
