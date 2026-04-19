# Active Plan

## Active Plan

### Feature: Git Integration for Apply Pipeline

- [ ] 1. Add `gitIntegration` to `ALLOWED_CONFIG_KEYS` in `mcp/server.js` (`mcp/server.js`)
  Append `"gitIntegration"` to the `ALLOWED_CONFIG_KEYS` array at line 262. The value is an object — the allowlist check gates on the key name only; no type validation of the object is required at this layer.
  Verify: `ALLOWED_CONFIG_KEYS` in `mcp/server.js` includes `"gitIntegration"`; `forge_set_project_config` accepts `{ gitIntegration: { enabled: false } }` without returning an "Unknown config key" error.

- [ ] 2. Add git helper functions to `skills/apply/SKILL.md` — branch creation step (`skills/apply/SKILL.md`) (wave: 1)
  Before the pipeline sequence section, add a `## Git integration` section describing the full git workflow. All steps are gated on `gitIntegration.enabled === true` in `.pipeline/project.json` (read via `forge_read_project` or Read fallback). Define the branch name as `${branchPrefix}${slug}` where `branchPrefix` defaults to `"forge/"` and `slug` comes from `$ARGUMENTS` or the first `### Feature:` heading in `docs/PLAN.md`. Document the branch creation step: run `git checkout -b <branch>` via Bash. If it fails (branch exists, dirty tree, or any error): log the error to output, emit a one-line warning, and **continue** — never abort the pipeline.
  Verify: `skills/apply/SKILL.md` contains a `## Git integration` section; branch name derivation from `$ARGUMENTS` and PLAN.md fallback is described; error-and-continue behaviour is explicit; step is gated on `gitIntegration.enabled`.

- [ ] 3. Add auto-commit step to `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 2)
  Within the same `## Git integration` section, document the post-implementer + post-test commit step. Only runs when `gitIntegration.autoCommit === true`. Commit message format: `"feat(forge): <feature name>"`. Steps: `git add -A`, then `git commit -m "<message>"`. Handle two known failure cases explicitly: (a) nothing to commit — detect by exit code or output containing "nothing to commit"; log and skip silently. (b) pre-commit hook failure — log full output, emit a one-line warning, and continue. Never use `--no-verify`. Never amend. Never force.
  Verify: `skills/apply/SKILL.md` documents the commit step under `## Git integration`; commit message format is `feat(forge): <feature name>`; "nothing to commit" is handled as a silent skip; pre-commit hook failure is logged and continued; `--no-verify`, `--amend`, and force flags are explicitly forbidden.

- [ ] 4. Add auto-PR step to `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 3)
  Within the same `## Git integration` section, document the post-documenter PR step. Only runs when `gitIntegration.autoPR === true`. Before attempting PR creation: (a) check `gh` is installed via `gh --version`; if missing, log "gh CLI not found — skipping PR creation" and skip. (b) run `git push -u origin <branch>` first; if push fails, log the error and skip PR creation. Then run `gh pr create --title "feat(forge): <feature name>" --body "Applied by FORGE apply pipeline."`. If `gh pr create` fails (not authenticated, repo not found, etc.): log the full error output and continue — do not abort. Never `git push --force`.
  Verify: `skills/apply/SKILL.md` documents the PR step; `gh --version` check precedes any `gh pr create` call; `git push` precedes `gh pr create`; all failure modes (gh missing, push fails, gh pr fails) log and continue; `--force` push is explicitly forbidden.

- [ ] 5. Integrate git steps into the pipeline sequence in `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 4)
  Update the `## Pipeline sequence` numbered list to include git steps at the correct positions:
  1. Git branch creation (if `gitIntegration.enabled`) — **before** implementer-triage
  2. Implementer-triage (unchanged)
  3. Implementer (unchanged)
  4. Test execution (unchanged)
  5. Auto-commit (if `gitIntegration.autoCommit`) — **after** tests pass (or after implementer if no tests)
  6. Documenter (unchanged)
  7. Auto-PR (if `gitIntegration.autoPR`) — **after** documenter
  Verify: `## Pipeline sequence` in `skills/apply/SKILL.md` lists git branch as step before implementer-triage; auto-commit appears after test execution; auto-PR appears after documenter; all three steps are gated on their respective config flags.

- [ ] 6. Document `gitIntegration` config in `docs/gotchas/GENERAL.md` (`docs/gotchas/GENERAL.md`)
  Add a new `## Git integration — apply pipeline` section. Document: the config schema (full JSON block with all four fields and their defaults), where it lives (`.pipeline/project.json`), what each field does, slug derivation order (`$ARGUMENTS` → first `### Feature:` heading in `docs/PLAN.md`), commit message format, PR title format, and the non-destructive safety guarantees (no force push, no amend, no `--no-verify`). Keep under 30 lines.
  Verify: `docs/gotchas/GENERAL.md` contains a `## Git integration` section; the config JSON block shows all four fields with correct defaults; slug derivation and commit/PR formats are documented; safety guarantees are listed.

### Research needed

- Confirm `gh pr create` flag name for PR body on Windows (some versions use `--body`, some use `--body-file`). The plan assumes `--body` with inline text — Researcher should verify the minimum supported `gh` CLI version and flag availability.
- Confirm whether `git checkout -b` is the correct command when the project may use git worktrees (where branches may already be checked out in another worktree and the error message differs from the normal "branch already exists" case).

### Approach summary

**Key decisions:**
- All git steps live in `skills/apply/SKILL.md` as natural language instructions — no new hook scripts or Node.js files needed. The apply skill already runs in `fork` context with `Bash` in its allowed-tools, so git CLI calls are native.
- Tasks 2–5 all touch `skills/apply/SKILL.md` but are sequenced waves 1→2→3→4 to avoid concurrent writes to the same file; each wave builds on the prior section content.

**Trade-offs accepted:**
- PR body is a static one-liner — no dynamic summary from handoff.md. Keeps the implementation simple; the user can edit the PR body after creation.
- Slug falls back to PLAN.md heading parsing rather than a structured config field — avoids adding a new config key but is fragile if the plan heading is unusual.

**Uncertainties:**
- `gh pr create` flag compatibility across versions and platforms (see Research needed above).

---

### Feature: Fix stale run-active.json pointer pollution

- [x] 1. Add `readRunStatus` helper and `TERMINAL_STATUSES` set to `hooks/subagent-start.js` (`hooks/subagent-start.js`)
  Copy the exact `TERMINAL_STATUSES` const (line 59) and `readRunStatus` function (lines 67-77) from `hooks/ctx-session-start.js` into `hooks/subagent-start.js`, placed after the `isForgeAgent` function and before `main`. The helper must be a synchronous `fs.readFileSync` read (to match the existing pattern) and must never throw.
  Verify: `hooks/subagent-start.js` contains `const TERMINAL_STATUSES = new Set(...)` and a `readRunStatus(projectDir, runId)` function whose body is identical in logic to the one in `ctx-session-start.js`.

- [x] 2. Add terminal-run guard to the agents-push block in `hooks/subagent-start.js` (`hooks/subagent-start.js`)
  Between the `isForgeAgent` check (line 102) and the agents-array push (line 106), insert the lifecycle guard. Read `data.runId`; call `readRunStatus(projectDir, data.runId)`; if the returned status is in `TERMINAL_STATUSES`, write `[forge-subagent] skipping append to terminal run <runId>` to stderr and call `exitOk()`. If the status is non-terminal, null, or the registry is unreadable, fall through (fail-open — proceed as today).
  Verify: when `run.json` for the active `runId` has `status: "completed"`, `"failed"`, or `"discarded"`, the hook exits at code 0 without pushing to `data.agents` and without writing `run-active.json`; a stderr line containing "skipping append to terminal run" is emitted.

- [x] 3. Extend `emitStaleUnitNoticeIfAny` in `hooks/ctx-session-start.js` to delete `run-active.json` on terminal run (`hooks/ctx-session-start.js`)
  In the terminal-run branch (lines 109-119), replace the `writeFileSync` that writes `data.currentUnit = null` back to `run-active.json` with `fs.unlinkSync(runActivePath)`. Keep the surrounding try/catch; on unlink failure, fall through silently (same as the existing write-failure path). The non-terminal stale-marker code path (lines 122-130) remains unchanged.
  Verify: after the fix, when `run.json` status is terminal, `run-active.json` is deleted from disk rather than written back as `{ ..., currentUnit: null }`; when `run.json` status is non-terminal, `run-active.json` is left intact and the stale-lock notice is still emitted.

- [x] 4. Document the `run-active.json` pointer lifecycle in `docs/gotchas/GENERAL.md` (`docs/gotchas/GENERAL.md`)
  Add a new `## run-active.json lifecycle contract` section (after the existing pipeline-state-files section). Document: who creates the file (`forge_create_run` / `forge_resume_run`), who appends to it (`subagent-start.js`), when it is deleted (SessionStart on terminal run detection), what "terminal" means (`completed`, `failed`, `discarded`), and the fail-open rule (unreadable or missing registry → treat as non-terminal, proceed). Keep under 20 lines.
  Verify: `docs/gotchas/GENERAL.md` contains a `## run-active.json lifecycle contract` section listing all four lifecycle roles and the terminal-status set.

- [x] 5. Add CHANGELOG entry in `docs/CHANGELOG.md` (`docs/CHANGELOG.md`)
  Prepend a new dated entry (2026-04-19) titled "fix(hooks): stale run-active.json pointer pollution". Summarise: the two gaps fixed (subagent-start terminal-run guard, ctx-session-start delete-on-terminal), the rationale for deletion over null-write, and the files changed.
  Verify: `docs/CHANGELOG.md` first entry is dated 2026-04-19 and mentions both `hooks/subagent-start.js` and `hooks/ctx-session-start.js`.

### Research needed

- None — the approach is fully specified and all referenced line numbers have been verified against the current file contents.

### Approach summary

**Key decisions:**
- Tasks 1 and 2 both modify `hooks/subagent-start.js` and are therefore sequential (task 2 depends on the helper added in task 1). Task 3 modifies a different file and could run in parallel with tasks 1-2, but the sequential ordering is cleaner for a 5-task fix with no parallelism benefit.
- Deletion (unlink) over null-write in the terminal path: the existing missing-file guard in `subagent-start.js` lines 74-81 already exits silently when the file is absent, so deletion is the cleanest teardown — writing `{}` would bypass that guard and allow a poisoned identity-less push.

**Trade-offs accepted:**
- Fail-open on unreadable registry: if `run.json` is missing or unparseable, both hooks treat the run as non-terminal and proceed as before. This preserves existing behaviour at the cost of not cleaning up when the registry is corrupt — acceptable because corrupt registries are rare and the symptom (stale pointer) is harmless in that case.
