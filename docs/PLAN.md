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

---

### Feature: SessionEnd and FileChanged lifecycle hooks

- [ ] 1. Create `hooks/session-end.js` — SessionEnd hook with end-of-session protocol reminder (`hooks/session-end.js`)
  CommonJS hook script. Reads stdin with the standard readline + timeout pattern (10 s timeout, crlfDelay: Infinity). Parses payload, calls `resolveProjectDir(payload)`. Reads `.pipeline/project.json`; if `sessionEndReminder === false`, exits silently. Reads `.pipeline/run-active.json`; if the agents array contains any agent whose type includes `implementer` or `coder` with a `completedAt` timestamp, checks whether `docs/context/handoff.md` was modified within the last 60 minutes AND whether `docs/CHANGELOG.md` was modified within the last 60 minutes. If source-modifying agents ran but either file is stale/missing, emits a reminder via `process.stderr.write(...)`. Never exits with code other than 0. All fs reads wrapped in try/catch; any failure is fail-open.
  Verify: file exists at `hooks/session-end.js`, starts with `'use strict'`, uses `require('./hook-utils')` for `resolveProjectDir`, and exits 0 in all branches including parse errors.

- [ ] 2. Create `hooks/file-changed.js` — FileChanged hook for gate-pending.json and board.json (`hooks/file-changed.js`)
  CommonJS hook script. Reads stdin with same readline + timeout pattern. Parses payload; extracts the changed file path from `payload.file` (or the field name used by Claude Code for FileChanged — flag in Research needed if unknown). If path does not end with `.pipeline/gate-pending.json` or `.pipeline/board.json`, exits 0 with no output. For gate-pending.json: reads the file, builds an `additionalContext` string describing the current gate status and feature name; emits `process.stdout.write(JSON.stringify({ additionalContext }))`. For board.json: emits `additionalContext` noting that new TODOs may have been added externally. All fs reads in try/catch; on any error, exits 0 silently.
  Verify: file exists at `hooks/file-changed.js`, starts with `'use strict'`, emits no stdout for non-matching file paths, and always exits 0.

- [ ] 3. Register both hooks in `hooks/hooks.json` (`hooks/hooks.json`)
  Append a `"SessionEnd"` top-level key with one entry: `{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end.js\"" }] }`. Append a `"FileChanged"` top-level key with one entry using the same command pattern pointing to `hooks/file-changed.js`. Use the exact same JSON structure as the existing `Stop` and `SessionStart` entries. No `matcher` field is needed for SessionEnd; check Claude Code docs for whether FileChanged requires a matcher or glob pattern — flag in Research needed.
  Verify: `hooks/hooks.json` is valid JSON, contains both `"SessionEnd"` and `"FileChanged"` keys, and all paths use `${CLAUDE_PLUGIN_ROOT}`.

### Research needed

- **FileChanged payload field name:** The exact field name in the stdin payload that carries the changed file path for the `FileChanged` hook event is unknown. Common candidates are `payload.file`, `payload.path`, `payload.filePath`. The implementer must verify against Claude Code hook documentation or source before coding `hooks/file-changed.js`.
- **FileChanged hook matcher/glob:** Whether the `FileChanged` hook declaration requires a `matcher` field (file glob pattern) in `hooks/hooks.json`, or whether the hook fires unconditionally and filtering is the script's responsibility. If a matcher is needed, the correct syntax for matching `.pipeline/*.json` must be verified.
- **SessionEnd payload shape:** Confirm what fields (if any) the `SessionEnd` hook payload provides beyond `cwd`. In particular, whether it carries `session_id` or a timestamp that could help with staleness detection.

### Approach summary

**Key decisions:**
- SessionEnd is advisory-only (stderr reminder, never blocking) — matches the established pattern of ctx-stop.js. Configurable via `sessionEndReminder` boolean in project.json with default-true semantics (no key = enabled).
- FileChanged uses `additionalContext` stdout output for the two monitored files — consistent with how ctx-session-start.js injects context — and is a silent no-op for all other paths.
- Both hooks follow the exact stdin/readline + timeout pattern from ctx-stop.js and ctx-session-start.js to ensure consistency with the rest of the hook fleet.

**Trade-offs accepted:**
- The 60-minute freshness window for the SessionEnd handoff/CHANGELOG check is a heuristic — it will produce false negatives for very long sessions and false positives if the user legitimately updated the files hours earlier. This is acceptable for an advisory-only reminder.

**Uncertainties:**
- FileChanged hook payload field name and matcher syntax are unknown — implementer must verify before coding. Plan tasks 2 and 3 are fully specified except for these two fields.
