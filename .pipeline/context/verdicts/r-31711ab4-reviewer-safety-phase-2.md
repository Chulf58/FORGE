## Safety Review: Add conductor-managed dispatch context for in-session subagent attribution

### Issues
None identified.

### Verified

- [x] **Shell injection** — No shell commands spawn user-supplied data. File paths constructed via `path.join()` with validated runId (regex `^r-[a-zA-Z0-9]+$`). Skills write/delete dispatch-context via fixed paths — no interpolation.

- [x] **Secrets and credentials** — No API keys, tokens, or credentials handled. dispatch-context.json carries only `runId` and `createdAt` (ISO timestamp). No sensitive data in stderr messages.

- [x] **Content injection** — stderr writes plain text `[forge-dispatch-ctx] stale dispatch-context deleted` (line 180). No user/agent output rendered as markup.

- [x] **Path resolution & validation** — runId validated against `RUN_ID_RE = /^r-[a-zA-Z0-9]+$/` (line 263, 315) before any file ops. Prevents path traversal (`../`, `..\\`, `/etc/passwd` patterns all fail regex). dispatch-context file path hardcoded via `path.join(projectDir, '.pipeline', 'dispatch-context.json')` — projectDir already validated by `resolveProjectDir`.

- [x] **File deletion safety** — `cleanupStaleDispatchContext` deletes only `.pipeline/dispatch-context.json` (line 179). No path construction from untrusted input. Malformed JSON at line 172 triggers safe cleanup (delete + return, no throw). Stale threshold (>5 min) prevents accidental deletion of fresh files.

- [x] **Fail-open discipline** — All error paths (readFile absent/unreadable line 166, JSON parse error line 172, missing createdAt field line 176, invalid timestamp line 178, file read errors line 320) fall through silently or return null — no exceptions escape. Consistent with GENERAL.md fail-open contract (line 39: "absent/unreadable = non-terminal").

- [x] **Timestamp parsing safety** — `new Date(data.createdAt).getTime()` (line 177): invalid ISO strings produce `NaN`, caught by `isNaN(age)` check (line 178) which returns without deleting. Safe.

- [x] **Input validation** — runId field type-checked (`typeof ctx.runId === 'string'` line 315). createdAt field type-checked (`typeof data.createdAt === 'string'` line 176). No eval() or dynamic code execution on file contents.

- [x] **Testability export** — `cleanupStaleDispatchContext` exported from ctx-session-start.js (line 301) for test access. No security exposure — function is internal hook-only, not exposed to external callers.

### Per-criterion verdicts

- `AC-2: MET` — `resolveRunId` extended with 4th path at lines 308–321. Reads dispatch-context.json, validates runId against RUN_ID_RE, falls through on absent/unreadable/invalid. Existing 3-path precedence (env var, worktree-path, findActiveRun) preserved.

- `AC-3: MET` — subagent-start.js line 30 swaps to `resolveRunId(projectDir, payload)`. Symmetric with subagent-stop.js behavior (commit 6e1f820a). Attribution chain now consistent end-to-end.

- `AC-4: MET` — `cleanupStaleDispatchContext` implemented at lines 159–181. Checks createdAt >5 min (STALE_MS = 300_000), deletes stale file, logs to stderr, never throws. Exported for testability (line 301). Wired into main() at line 241 before cleanupStaleSingleton.

- `AC-5: MET` — skills/explore/SKILL.md instructs write `.pipeline/dispatch-context.json` before researcher Agent call, delete after (or on error). Exact file path and schema specified.

- `AC-6: MET` — skills/plan/SKILL.md instructs write dispatch-context before brainstormer Agent call, delete after. Placement adjacent to existing brainstormer dispatch.

### Verdict

**APPROVED** — No safety issues found. Path resolution is validated against a strict regex preventing traversal. All file operations scoped to `.pipeline/dispatch-context.json`. Error handling is fail-open throughout. Timestamp parsing is safe. No secrets or injection vectors present. All 10 tests pass.

