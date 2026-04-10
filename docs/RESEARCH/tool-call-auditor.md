# Research: PostToolUse Tool-Call Auditor

---

## Question: What does the PostToolUse hook payload actually look like — what fields are present beyond `session_id` and `tool_name`? Is `tool_input` definitely present and in what shape for Read, Grep, Glob, Write, Edit, Bash?

**Finding:** The PostToolUse stdin payload is fully documented and confirmed against the existing `ctx-post-tool.js` which already reads from it in production. The complete schema is:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { ... },
  "tool_response": { ... },
  "tool_use_id": "toolu_01ABC123..."
}
```

`tool_input` is always present. Shape per tool:

**Read:**
```json
{ "file_path": "/path/to/file.txt", "offset": 10, "limit": 50 }
```

**Write:**
```json
{ "file_path": "/path/to/file.txt", "content": "file content" }
```

**Edit:**
```json
{ "file_path": "/path/to/file.txt", "old_string": "original", "new_string": "replacement", "replace_all": false }
```

**Grep:**
```json
{ "pattern": "TODO.*fix", "path": "/path/to/dir", "glob": "*.ts", "output_mode": "content", "-i": true, "multiline": false }
```

**Glob:**
```json
{ "pattern": "**/*.ts", "path": "/path/to/dir" }
```

**Bash:**
```json
{ "command": "npm test", "description": "Run test suite", "timeout": 120000, "run_in_background": false }
```

`tool_response` is also present (the tool has already completed when PostToolUse fires). `tool_use_id` is a unique identifier for the specific tool invocation.

The plan's `logToolCall` function in task 1 sanitises `tool_input` by deleting `content`, `old_string`, `new_string`, and `notebook_content` before logging. This is correct: those are the large-payload fields. After sanitisation, the remaining fields for each tool are small strings and numbers (file paths, patterns, line counts) — safe to log at full length. The plan's 200-character truncation on remaining string values is a belt-and-suspenders guard.

**Source:**
- `https://code.claude.com/docs/en/hooks` — official PostToolUse schema
- `C:/Users/cuj/Forge/.claude/hooks/ctx-post-tool.js` lines 94–103 — confirms `payload.session_id` and `payload.tool_name` access pattern in production code
- `C:/Users/cuj/Forge/.claude/hooks/workflow-guard.js` lines 80–89 — confirms `payload.tool_input.file_path` access pattern for Write and Edit
- `C:/Users/cuj/Forge/docs/RESEARCH/context-monitor.md` — prior research confirming full payload schema

**Recommendation:** The coder can use the payload shape as documented. For the `logToolCall` function: build the sanitised input by spreading `payload.tool_input` and deleting `content`, `old_string`, `new_string`, `notebook_content`. Use `payload.tool_name`, `payload.tool_input`, and `Date.now()` directly — no special extraction needed.

---

## Question: Is `fs.promises.appendFile` the right primitive for JSONL writes, or is there a race condition risk when multiple tool calls complete rapidly?

**Finding:** `fs.promises.appendFile` is safe for this use case. The race condition concern is real in high-concurrency servers but does not apply here for two reasons:

1. **Claude Code executes tool calls sequentially.** Even when using the `Task` tool to spawn parallel sub-agents, each sub-agent runs in its own session with its own `session_id`, which means a separate audit file per session (`claude-audit-{sessionId}.jsonl`). Within a single session, tool calls are issued one at a time — the next tool call fires only after the PostToolUse hook from the previous one completes (hooks run synchronously in Claude Code's execution model).

2. **Even if two hook invocations somehow overlapped**, `appendFile` on a POSIX system is atomic for small writes because the OS serialises writes to the same file descriptor using the file's byte-range lock. On Windows, `fs.promises.appendFile` opens with `FILE_SHARE_READ | FILE_SHARE_WRITE` which means concurrent appends can interleave, but the per-session guarantee above makes this moot.

The existing hooks (`ctx-post-tool.js`, `ctx-session-start.js`) both use `fs.promises.writeFile` with fire-and-forget `.catch(() => {})` for their bridge files — the same pattern is appropriate for the audit file. The plan specifies fire-and-forget for the append, which is correct: a failed log entry is non-fatal and should not affect Claude's execution.

`fs.promises.appendFile` creates the target file if it does not exist — confirmed in Node.js documentation. No pre-creation step is needed.

**Source:**
- `C:/Users/cuj/Forge/.claude/hooks/ctx-post-tool.js` lines 74–78 — existing fire-and-forget write pattern
- `C:/Users/cuj/Forge/.claude/hooks/ctx-session-start.js` lines 72–79 — same pattern for bridge file write
- Node.js docs: `fs.promises.appendFile` creates file if absent, appends otherwise

**Recommendation:** Use `fs.promises.appendFile(auditPath, line + '\n', 'utf8').catch(() => {})` exactly as the plan describes. No mutex, no queue, no stream needed. The per-session file name (`claude-audit-{sessionId}.jsonl`) is the key safety property — keep it.

---

## Question: Does `os.tmpdir()` reliably resolve on Windows to a writable path, and is the path stable within a session?

**Finding:** `os.tmpdir()` is reliable for normal Windows user sessions and is already the established pattern in this codebase. All three existing hook files (`ctx-post-tool.js`, `ctx-session-start.js`, `workflow-guard.js`) use `path.join(os.tmpdir(), ...)` for their temp files. The existing bridge file pattern (`claude-ctx-{session_id}.json`) has been confirmed to work on this Windows 11 machine.

On Windows, `os.tmpdir()` returns the value of the `TEMP` environment variable, which resolves to `C:\Users\<user>\AppData\Local\Temp` in all standard user sessions. This path is:
- **Writable** — user has full write access to their own AppData\Local\Temp
- **Stable within a session** — `TEMP` does not change during a running process
- **Not `/tmp/`** — hardcoding `/tmp/` would fail on Windows; `os.tmpdir()` is the correct cross-platform approach

There is a known Node.js edge-case bug (issue #60582, v24.11.0) where `os.tmpdir()` returns `undefined\temp` if `TEMP` and `TMP` environment variables are both unset. This only affects sandboxed CI environments where env vars are stripped — not normal Windows user sessions. The existing hooks do not guard against this, so no special handling is needed beyond what already exists.

The plan correctly identifies that `/tmp/` hardcoded paths will fail on Windows and requires `path.join(os.tmpdir(), ...)`. Both audit file paths in task 1 must use `os.tmpdir()`:
- `path.join(os.tmpdir(), 'claude-audit-' + sessionId + '.jsonl')` for the per-session JSONL
- `path.join(os.tmpdir(), 'claude-audit-latest.txt')` for the latest-session pointer

**Source:**
- `C:/Users/cuj/Forge/.claude/hooks/ctx-post-tool.js` lines 50, 64 — `path.join(os.tmpdir(), ...)` pattern confirmed in production
- `C:/Users/cuj/Forge/.claude/hooks/ctx-session-start.js` line 73 — same pattern
- Node.js issue #60582 — edge case in sandboxed env; does not affect this deployment
- Node.js docs: `os.tmpdir()` reads `TEMP` env var on Windows

**Recommendation:** Use `path.join(os.tmpdir(), ...)` for all temp file paths. Do not hardcode `/tmp/`. The existing `ctx-post-tool.js` is the exact template to follow — the audit file path construction should mirror the bridge file path construction already on line 50.

---

## Question: What is the correct frontmatter format for a Haiku agent — specifically the tools list syntax used in existing agents like `integrity-checker.md` and `nyquist-auditor.md`?

**Finding:** Both `integrity-checker.md` and `nyquist-auditor.md` were read directly. The confirmed frontmatter format is:

```markdown
---
name: integrity-checker
description: <one-sentence description>
model: claude-haiku-4-5-20251001
tools:
  - Read
  - Glob
  - Grep
---
```

Key details:
- `model:` value is `claude-haiku-4-5-20251001` (confirmed in both files, also the value used in `gotcha-checker.md` per prior research)
- `tools:` is a YAML block list (one tool per line with `  - ` prefix), not an inline array
- Tool names are capitalised as single words matching their Claude Code tool names: `Read`, `Glob`, `Grep`, `Write`, `Bash`
- The `description:` field is present in both Haiku agents and used to describe when to invoke the agent

For the `tool-call-auditor` agent, the plan specifies `tools: [Read, Write]`. The correct YAML format for this is:

```markdown
---
name: tool-call-auditor
description: <description>
model: claude-haiku-4-5-20251001
tools:
  - Read
  - Write
---
```

**Source:**
- `C:/Users/cuj/Forge/.claude/agents/integrity-checker.md` lines 1–9 — confirmed frontmatter format
- `C:/Users/cuj/Forge/.claude/agents/nyquist-auditor.md` lines 1–10 — confirmed frontmatter with Write tool

**Recommendation:** Use the block list YAML format (one tool per indented line) as shown in both reference agents. The plan's description of `tools: [Read, Write]` in prose must be rendered as a YAML block list in the actual file — the inline array form `tools: [Read, Write]` is valid YAML but inconsistent with every other agent in this codebase. Use the block form.

---

## Question: What anti-patterns should the audit agent prioritise — are there any known token-heavy patterns from existing FORGE pipeline runs that should be specifically called out?

**Finding:** There is no `docs/audit-log.jsonl` file yet (the feature does not exist), so there is no empirical tool-call data from past runs. However, the PLAN.md and prior research files provide direct evidence of known token-heavy patterns that were serious enough to be addressed as dedicated pipeline features:

**Confirmed anti-patterns from FORGE's own development history:**

1. **Repeated Read of large files** — `src/main/index.ts` is read by almost every pipeline agent (planner, coder, researcher, gotcha-checker, integrity-checker, reviewer-logic, tester). The file is 800+ lines. Multiple agents reading it in full in a single session is the single highest-impact repeated-read pattern. Confirmed by PLAN.md feature "Optimize Tester and Documenter Agent Token Usage" which explicitly cited tester consuming ~77k tokens per run due to reading too many files.

2. **Read of entire directories** — the tester agent's original prompt read "everything relevant" rather than scoping to handoff-listed files. The plan explicitly fixed this. An agent re-implementing this pattern (reading all files in `src/renderer/src/stores/`, for example) would appear as multiple Read calls against the same directory tree.

3. **Blind writes** — the implementer and coder agents are the ones most likely to write files without a prior Read, especially if skipping the mandatory pre-read of `docs/gotchas/GENERAL.md` or `docs/PLAN.md`. The plan's coder-gaps fix (task 3 of "Fix Coder Agent Prompt Gaps") explicitly added GENERAL.md to the mandatory pre-read list precisely because the coder was writing handoffs without having read it. A blind Write to a file like `src/main/index.ts` without a preceding Read is a high-severity anti-pattern — the agent cannot safely modify a file it has not read.

4. **Repeated Grep with the same pattern** — the gotcha-checker runs several Grep searches across the codebase. If an agent re-runs the same grep pattern (e.g. `ipcMain.handle`) multiple times within a session, it wastes context.

5. **Tool storm on Read** — reading `docs/PLAN.md` is performed by at least five agents in a typical pipeline run. In a single long session (e.g. during a `plan feature:` → `apply feature:` sequence with re-invocations), the same large PLAN.md may be read 10+ times. The 3-read threshold in the plan is reasonable as a detection floor; the audit agent should flag files read 3 or more times.

**Severity mappings from the plan:**
- Repeated Read = `low` (expected in some cases; flag for review)
- Repeated Grep = `low` (same pattern)
- Tool storm (20+ uses of one tool) = `medium`
- Blind write (Write/Edit with no prior Read of the same path) = `high`

**Additional anti-patterns worth considering** (not in the plan spec but grounded in FORGE context):
- Reading `src/main/index.ts` more than 5 times (this specific file is large and frequently over-read — a dedicated threshold may be useful as a future enhancement)
- Writing to `docs/handoff.md` more than 3 times (indicates a re-generation loop that should have been caught earlier)

The plan's four anti-patterns (Repeated Read, Repeated Grep, Tool Storm, Blind Write) cover the highest-value cases. The audit agent should implement exactly these four as specified without expanding scope.

**Source:**
- `C:/Users/cuj/Forge/docs/PLAN.md` lines 88–105 — "Optimize Tester and Documenter Agent Token Usage" feature citing 77k token tester runs and "reads too many files"
- `C:/Users/cuj/Forge/docs/PLAN.md` lines 9–26 — "Fix Coder Agent Prompt Gaps" confirming GENERAL.md was not being read before writes
- `C:/Users/cuj/Forge/docs/PLAN.md` lines 652–673 — PostToolUse Tool-Call Auditor feature spec with severity mappings

**Recommendation:** Implement the four anti-patterns exactly as the plan specifies. For the Repeated Read threshold (3+) and Tool Storm threshold (20+), use the values from the plan — they are appropriate for FORGE's pipeline scale. Do not add thresholds for specific file names in the initial version; the generic path-based detection covers the important cases.
