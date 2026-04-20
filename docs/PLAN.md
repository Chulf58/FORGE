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

---

### Feature: SessionStart auto-split observer pane (Windows Terminal)

- [ ] 1. Update `hooks/mcp-deps-install.js` to target `scripts/forge-observer.mjs` (not the proto path) in the observer launcher generator (`hooks/mcp-deps-install.js`)
  Verify the `observerScriptPath` variable at line 430 points to `scripts/forge-observer.mjs`. If it already does, this task is a no-op (confirm and skip). The feature request references `scripts/forge-observer-proto.mjs` but the live file is `scripts/forge-observer.mjs` — the generator must stay in sync.
  Verify: `hooks/mcp-deps-install.js` line building `observerScriptPath` concatenates `pluginRoot` with `scripts/forge-observer.mjs`, matching the existing `bin/forge-observer.cmd` content.

- [ ] 2. Create `hooks/observer-autosplit.js` — new SessionStart hook that opens the observer in a Windows Terminal split pane (`hooks/observer-autosplit.js`)
  CommonJS hook script. Protocol: readline + timeout pattern (5 s, crlfDelay: Infinity), always exits 0 (never blocks session start). Logic:
  1. **Subagent guard:** if `process.env.CLAUDE_CODE_TEAM_NAME` is set, emit `[forge-observer-autosplit] skipping — subagent session (CLAUDE_CODE_TEAM_NAME set)` to stderr and exit 0. Also walk parent-process check: read `process.env.CLAUDE_CODE_SESSION_ARGS` or similar for `--parent-session-id`; if found, skip. If neither env var is available, skip the parent-process walk (out of scope; log a note).
  2. **Platform guard:** if `process.platform !== 'win32'`, exit 0 silently (macOS/Linux are out of scope for this slice).
  3. **wt.exe detection:** use `child_process.execFileSync('where', ['wt.exe'], ...)` (with stdio: 'ignore', timeout 2000). If it throws, emit `[forge-observer-autosplit] wt.exe not found — skipping split` to stderr and exit 0.
  4. **Build command:** resolve absolute path to `bin/forge-observer.cmd` from `CLAUDE_PLUGIN_ROOT` env var (`path.join(pluginRoot, 'bin', 'forge-observer.cmd')`). Build the `wt.exe` invocation array: `['wt.exe', '-w', '0', 'sp', '-V', '--size', '0.35', '--', 'cmd', '/c', observerCmdPath]`. No shell string interpolation — use `execFile` or `spawn` with explicit args array.
  5. **Spawn:** use `child_process.spawn('wt.exe', [...args], { detached: true, stdio: 'ignore' })` and call `.unref()` so the hook process can exit without waiting. Wrap in try/catch; on any error emit `[forge-observer-autosplit] spawn failed: <msg>` to stderr and exit 0.
  6. **Success log:** emit `[forge-observer-autosplit] opened observer split pane` to stderr and exit 0.
  Verify: file exists at `hooks/observer-autosplit.js`, starts with `'use strict'`, never exits with code != 0, and all three skip paths (subagent, non-Windows, no wt.exe) emit a `[forge-observer-autosplit]` prefixed stderr line and exit 0.

- [ ] 3. Register `hooks/observer-autosplit.js` in `hooks/hooks.json` under `SessionStart` (`hooks/hooks.json`)
  Append a new entry in the `SessionStart` array: `{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/observer-autosplit.js\"" }] }`. Place it as the last entry in the SessionStart array (after `usage-clear-quota-flags`). Use the exact same JSON structure as existing SessionStart entries. Do not modify any other section.
  Verify: `hooks/hooks.json` is valid JSON, the `SessionStart` array contains an entry pointing to `observer-autosplit.js`, and all paths in the file still use `${CLAUDE_PLUGIN_ROOT}`.

- [ ] 4. Create `scripts/test-observer-autosplit.mjs` — unit tests for the three guard paths and command-string shape (`scripts/test-observer-autosplit.mjs`)
  ESM test file. No external test runner — plain `assert` from Node `assert/strict`. Three test cases:
  1. **Subagent skip:** set `process.env.CLAUDE_CODE_TEAM_NAME = 'test'` before requiring the module's testable exports; verify the guard returns the skip signal without calling `spawn`. Use a mock/stub for `child_process` or extract the logic into a pure `shouldSkip(env)` helper that the test can call directly.
  2. **wt.exe missing:** mock `execFileSync` to throw; verify the hook logs the skip message and does not call `spawn`.
  3. **Command string shape:** given a mock `pluginRoot = 'C:\\plugin'`, verify the constructed args array equals `['-w', '0', 'sp', '-V', '--size', '0.35', '--', 'cmd', '/c', 'C:\\plugin\\bin\\forge-observer.cmd']`.
  The test must not call `spawn` or open any real processes. Print `[PASS]` lines for each test and exit 0 on success, exit 1 on any failure.
  Verify: running `node scripts/test-observer-autosplit.mjs` exits 0 and prints three `[PASS]` lines; the file contains no `spawn` calls that could open real WT panes.

- [ ] 5. Update `bin/forge.cmd` comment to point at the observer-primary path (`bin/forge.cmd`)
  The file is auto-generated by `hooks/mcp-deps-install.js`. Update the generator (in the `wrapperLauncherContent` string in `hooks/mcp-deps-install.js`) to change the second comment line from its current text to: `REM For the observer-primary UX, use bin/forge-observer.cmd to launch the dashboard.`. This ensures every regenerated `bin/forge.cmd` carries the pointer without requiring a separate edit on each session.
  Verify: the `wrapperLauncherContent` string in `hooks/mcp-deps-install.js` includes the updated comment text referencing `bin/forge-observer.cmd`; the structure (first `@echo off` line, comment lines, optional claude env-var line, exec line) is preserved.

### Research needed

- **Subagent session detection — env var name:** The feature request mentions `CLAUDE_CODE_TEAM_NAME` and walking the process tree for `--parent-session-id`. The exact env var or CLI arg that Claude Code sets on subagent spawns needs verification against Claude Code source or docs. If `CLAUDE_CODE_TEAM_NAME` is wrong, the guard will fail and every subagent session will attempt a split. The implementer should grep Claude Code hooks documentation or the existing `hooks/subagent-start.js` for the authoritative env var before coding task 2.
- **`wt.exe` args for split-pane — `-V` vs `split-pane` subcommand:** The reference invocation uses positional `sp -V` (shorthand). Verify this is stable across Windows Terminal versions (1.x vs 1.2x). The long form `wt.exe new-tab --profile ... split-pane` is more stable but more verbose. If short-form `sp` fails on older WT, the implementer should prefer the long form.

### Approach summary

**Key decisions:**
- New dedicated hook file (`observer-autosplit.js`) rather than extending `mcp-deps-install.js`: separation of concerns — the installer handles file generation, the autosplit handles UX spawning. Easier to disable/remove independently.
- Guard order: subagent check first (env var, cheapest), then platform check, then `wt.exe` detection. All three are fail-open exits — session start is never blocked.
- Pure-function extraction for testability: the `shouldSkip` helper and command-string builder are extracted so the unit test can exercise them without spawning real processes.

**Trade-offs accepted:**
- No process-tree walk for `--parent-session-id` in this slice — relies on `CLAUDE_CODE_TEAM_NAME` only. If that env var is not set for all subagent types, some subagent sessions may open extra panes. Acceptable as a first slice; process-tree walk is a follow-up.
- `bin/forge.cmd` is auto-generated; the comment update lives in the generator, not the file. This means the change only takes effect after the next SessionStart regeneration.
