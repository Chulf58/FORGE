# Active Plan

## Active Plan
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
