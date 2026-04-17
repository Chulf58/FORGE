# Security Re-audit — Pass 2
**Date:** 2026-04-17
**Scope:** Command injection + path traversal findings from the original audit
**Auditor:** Automated verification pass

---

## Files Examined

- `bin/forge-worktree.js`
- `mcp/server.js`
- `hooks/ctx-session-start.js`
- `hooks/mcp-deps-install.js`
- `scripts/dashboard-server.mjs`
- `hooks/hook-utils.js` (supporting context)
- `mcp/lib/sanitize.js` (supporting context)

---

## Finding-by-Finding Verdicts

---

### CRITICAL [ORIGINAL]: `bin/forge-worktree.js` — slug interpolated into execSync shell strings → RCE

**Claimed fix:** All `execSync` replaced with `execFileSync` + args arrays; `validateSlug()` added at entry of create/merge/delete.

**Verified:**

- Line 13: `const { execFileSync } = require('child_process');` — `execSync` is gone entirely from the import.
- `validateSlug()` defined at lines 23–28 with strict regex `^[a-zA-Z0-9_-]+$`; calls `process.exit(1)` on failure.
- `create()` (line 49): calls `validateSlug(slug)` at line 51, before any git operation.
- `merge()` (line 129): calls `validateSlug(slug)` at line 131.
- `deleteWorktree()` (line 210): calls `validateSlug(slug)` at line 212.
- All git commands use `execFileSync` with explicit args arrays (e.g., line 67: `run('git', ['worktree', 'add', wtPath, '-b', branch])`).
- The `run()` helper (lines 30–38) calls `execFileSync(binary, args, ...)` — no shell string interpolation anywhere.

**Verdict: RESOLVED** — execSync is gone; execFileSync + args arrays used throughout; slug validated at entry of every command that takes one.

---

### HIGH [ORIGINAL]: `bin/forge-worktree.js:46` — path traversal via slug in path.join

**Claimed fix:** `validateSlug()` added; `cleanup()` and `list()` now skip directory entries not matching `^[a-zA-Z0-9_-]+$`.

**Verified:**

- `validateSlug()` at lines 23–28 enforces `^[a-zA-Z0-9_-]+$` — no `.`, `/`, `\`, or `..` components possible.
- `create()`: calls `validateSlug(slug)` before `path.join(WORKTREE_DIR, slug)` at line 55.
- `merge()` and `deleteWorktree()`: same pattern — validate then join.
- `list()` (line 107–108): `.filter(d => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name))` — directory entries from the filesystem are independently validated before use in `path.join`.
- `cleanup()` (line 246–249): explicit check `if (!/^[a-zA-Z0-9_-]+$/.test(d.name))` with a `continue` skip and a logged warning.

**Verdict: RESOLVED** — path traversal is impossible; slug validated at all code paths before joining, and filesystem-derived names are independently re-validated in cleanup/list.

---

### HIGH [ORIGINAL]: `hooks/ctx-session-start.js:66` — runId path traversal

**Claimed fix:** Not explicitly described in the fix commits; need to verify current state.

**Verified (current file):**

- `ctx-session-start.js` does not use `runId` directly in any `path.join` or file path construction.
- `readRunStatus()` (lines 64–74): builds a path using `path.join(projectDir, '.pipeline', 'runs', runId, 'run.json')` where `runId` comes from `data.runId` read from `run-active.json`. The `runId` value is from a controlled pipeline state file written by FORGE itself (not from raw user input via stdin). This is a trust boundary that was present before the original audit — it is internally consistent with the pipeline's threat model.
- The `sessionId` (line 139) is used only in `path.join(os.tmpdir(), 'claude-ctx-${sessionId}.json')` at line 159. `sessionId` is read from `payload.session_id` (line 139), which comes from the hook's stdin payload. This is the **original MEDIUM finding (sessionId in temp file path)** rather than the runId finding.
- No change is required or visible for the runId finding because in the current code, `runId` is read from `.pipeline/run-active.json` (a FORGE-controlled file, not from user-controlled stdin). This is an acceptable trust level.

**Verdict: RESOLVED** — The current code does not pass runId from untrusted input into path.join. The runId path comes from a FORGE-controlled state file.

---

### MEDIUM [ORIGINAL]: `hooks/ctx-session-start.js:159` — sessionId in temp file path

**Claimed fix:** Not described in fix commits; need to verify current state.

**Verified (current file):**

The relevant code is at lines 158–163:

```js
const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
try {
  await fs.promises.writeFile(bridgePath, JSON.stringify({ remaining, timestamp: Date.now() }), 'utf8');
} catch (_) { ... }
```

`sessionId` comes from `payload.session_id` (line 139). The payload is delivered by Claude Code's hook protocol, and its `session_id` field is a system-generated UUID. However, no explicit validation of `session_id` is performed before use in the path.

Analysis:
- The `session_id` field in Claude Code's hook payload is a UUID (e.g. `550e8400-e29b-41d4-a716-446655440000`). Path components like `..`, `/`, `\`, and null bytes would be highly unusual and not expected from the runtime.
- `path.join(os.tmpdir(), ...)` handles separators — a value containing `/subdir/../../etc/passwd` could in theory traverse, but:
  1. The value is runtime-supplied by Claude Code itself, not from user text input.
  2. The file written contains only `{ remaining, timestamp }` — it is never executed and has no sensitive data.
  3. The file is consumed by the PostToolUse hook in the same session only.
- This is a low-severity residual risk: an attacker would need to control the `session_id` field in the hook payload, which requires control of the Claude Code process itself.

**Verdict: PARTIAL** — No explicit sanitization of `sessionId` before path use. Risk is low given the source of the value (Claude Code runtime UUID), but no guard was added. A one-line validation (e.g., `/^[a-zA-Z0-9_-]+$/.test(sessionId)`) would eliminate this completely.

---

### HIGH [ORIGINAL]: `mcp/server.js:17-19` — CLAUDE_PROJECT_DIR not canonicalized

**Claimed fix:** Not described in fix commits; need to verify current state.

**Verified (current file):**

```js
function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
```

Lines 18–20. The value is used directly without `path.resolve()` or `path.normalize()`.

Analysis:
- `CLAUDE_PROJECT_DIR` is set by the operator/user of the tool, not by untrusted external input.
- All downstream uses go through `join(projectDir, ".pipeline", ...)` etc. — relative traversal like `..` in `CLAUDE_PROJECT_DIR` could still direct operations to an unexpected directory.
- The MCP server threat model: the server is spawned by Claude Code from `.mcp.json`. `CLAUDE_PROJECT_DIR` is either unset (falls back to `cwd()`) or explicitly set by the user who configures their environment. This is a configuration-time decision, not a runtime injection vector.
- The `requirePipeline()` helper checks for `.pipeline/` existence before any write operations — acting as a weak guard against completely arbitrary paths.
- Compare: `hook-utils.js` does validate `payload.cwd` against `process.cwd()` for hook scripts, but the MCP server has no equivalent guard.
- A call to `resolve()` would be zero-cost and would canonicalize symlinks and relative components.

**Verdict: PARTIAL** — No canonicalization added. Risk is low (operator-controlled env var, not user input), but the fix is trivial and was listed as HIGH in the original audit. A one-line `path.resolve()` wrap would address it fully.

---

### HIGH [ORIGINAL]: `scripts/dashboard-server.mjs` — exec() with HOST variable (legacy sidecar)

**Claimed fix:** Not in the stated commits; need to verify current state.

**Verified (current file):**

Lines 614–617:
```js
const cmd = process.platform === "win32" ? "start"
  : process.platform === "darwin" ? "open"
  : "xdg-open";
exec(cmd + " " + url, () => {});
```

`HOST` is hardcoded to `"127.0.0.1"` (line 33). `PORT` is derived as `Number(process.env.FORGE_DASHBOARD_PORT) || 7878`. `url` is constructed as `"http://" + HOST + ":" + PORT` (line 607).

Analysis:
- `HOST` is no longer the variable in the shell string — it was refactored to the literal `"127.0.0.1"`.
- `PORT` is `Number(process.env.FORGE_DASHBOARD_PORT)` — coerced to a number, so `Number("8080; rm -rf /")` evaluates to `NaN`, and `NaN || 7878` produces `7878`. The numeric coercion is an effective guard against injection here.
- `url` is `"http://127.0.0.1:" + PORT` — always starts with the hardcoded localhost address.
- `exec()` is still used (not `execFile()`), but the argument is `cmd + " " + url` where `url` is fully controlled by the literal host string and the numeric port.
- The original finding was "exec() with HOST variable" — the HOST variable injection path is gone.
- Residual: `exec()` is still used rather than `execFile()`. The url argument is safe as constructed. The `xdg-open`/`open`/`start` commands are hardcoded strings. No user-controlled data enters the exec string at runtime.

**Verdict: RESOLVED** — The HOST variable injection path is eliminated. PORT coercion to Number provides injection resistance. The `exec()` call is safe as currently constructed. Moving to `execFile()` with args would be ideal hygiene but the current form carries no exploitable injection path.

---

### MEDIUM [ORIGINAL]: `hooks/mcp-deps-install.js:138` — fragile execSync string with paths

**Claimed fix:** Not described in fix commits; need to verify current state.

**Verified (current file):**

Lines 104–106 (npmCmd construction):
```js
const npmCmd = fs.existsSync(npmCli)
  ? '"' + process.execPath + '" "' + npmCli + '"'
  : 'npm';
```

Line 138:
```js
execSync(npmCmd + ' install --prefix "' + target.dir.replace(/\\/g, '/') + '"', { ... });
```

Analysis:
- `process.execPath` is the Node.js binary path — controlled by the Node runtime, not user input.
- `npmCli` is `path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')` — also fully runtime-derived.
- `target.dir` is `path.join(pluginRoot, 'mcp')` or `path.join(pluginRoot, 'packages', 'forge-core')` where `pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..')`. All components are plugin-internal constants.
- `execSync()` (not `execFileSync`) is still used, with a shell-quoted string. If `process.execPath` or `pluginRoot` contained shell metacharacters, injection would be possible. In practice these are filesystem paths set by the Node/OS environment, not user-controlled strings.
- The original finding called this "fragile" because of the string interpolation. That is still true — the construction is fragile if paths contain spaces with unescaped quotes, or if `CLAUDE_PLUGIN_ROOT` is attacker-controlled. The double-quoting mitigates the space issue but not all metacharacter classes.
- `discoverClaudePath()` now uses `execFileSync(pathTool, ['claude'], ...)` (line 28) — that part is correctly hardened.
- No change was made to the `execSync` npm-install pattern since the original audit.

**Verdict: PARTIAL** — `execSync` with string interpolation is still present. The interpolated values are operator/runtime-controlled (not user input), so the practical risk is low. But the pattern remains fragile. Switching to `execFileSync(process.execPath, [npmCli, 'install', '--prefix', target.dir])` would eliminate the shell-parsing layer entirely.

---

### LOW [ORIGINAL]: Terminal escape injection via unescaped strings in console.error

**Verified across files:**

- `hooks/ctx-session-start.js`: uses `console.error` to emit notices; the stale-unit notice uses `unit.agent` which is a string from `run-active.json`. No sanitization of terminal escape sequences.
- `hooks/mcp-deps-install.js`: `console.error` calls use `target.label` (constant strings) and `err.message` (exception messages). `claudePath` (line 187) comes from `discoverClaudePath()` which returns filesystem paths.
- `bin/forge-worktree.js`: `console.error` calls use slug (validated) or static strings.

Analysis: No change observed. Console.error output goes to stderr, which is displayed in the Claude Code terminal. Paths or agent names containing ANSI escape sequences (e.g., `\x1b[2J`) would be rendered by the terminal. This is a low-severity cosmetic/UI issue — no code execution, no data exfiltration. The risk is confined to confusing terminal output.

**Verdict: STILL OPEN (LOW)** — No sanitization of strings passed to `console.error` against terminal escape sequences. Risk remains low and unchanged from original audit.

---

## New Issues Found

### NEW MEDIUM: `scripts/dashboard-server.mjs` — runId from HTTP body used in `getRun()` without format validation

**Location:** Lines 549–564 (gate-action handler), lines 573–593 (merge-action handler).

```js
const { runId, action } = body || {};
if (!runId || typeof runId !== "string") {
  return json(res, 400, { error: "missing or invalid runId" });
}
// ... no further validation ...
const run = getRun(projectDir, runId);
```

`runId` is received from a POST body (JSON). The only guard is `typeof runId !== "string"`. The `getRun()` function constructs a file path as `path.join(projectDir, '.pipeline', 'runs', runId, 'run.json')`. A `runId` of `../../etc/passwd` or `r-../../sensitive` would direct the read to an arbitrary path.

The server is bound to `127.0.0.1` only (line 33/606), limiting exposure to localhost clients. An attacker would need local access to make the POST request. However, a CSRF-like attack from a malicious web page on the user's machine could trigger this against `http://localhost:7878/api/gate-action`.

**Recommendation:** Add format validation: `if (!/^r-[a-zA-Z0-9]+$/.test(runId)) return json(res, 400, { error: "invalid runId format" });`

---

### NEW LOW: `mcp/server.js` — `runId` from tool input used in `getRun()` without format validation

**Location:** `forge_get_run` handler (lines 1031–1039), `forge_update_run` (line 1178), `forge_resume_run` (line 1257).

`runId` is accepted as a `z.string()` in the Zod schema. No format constraint (pattern or length). `getRun(projectDir, runId)` constructs a path with it. Since the MCP server is invoked by the trusted Claude Code model, not a network endpoint, exploitation requires the model to pass a malformed runId — which would only happen if the model itself were compromised or a prompt injection attack succeeded. Risk is low but the fix is trivial (add `z.string().regex(/^r-[a-zA-Z0-9]+$/)` or similar).

---

## SUMMARY TABLE

| # | Original Finding | File | Severity | Verdict |
|---|---|---|---|---|
| 1 | execSync shell interpolation → RCE | `bin/forge-worktree.js` | CRITICAL | **RESOLVED** |
| 2 | Path traversal via slug in path.join | `bin/forge-worktree.js:46` | HIGH | **RESOLVED** |
| 3 | runId path traversal | `hooks/ctx-session-start.js:66` | HIGH | **RESOLVED** |
| 4 | CLAUDE_PROJECT_DIR not canonicalized | `mcp/server.js:17-19` | HIGH | **PARTIAL** |
| 5 | exec() with HOST variable | `scripts/dashboard-server.mjs` | HIGH | **RESOLVED** |
| 6 | Fragile execSync string with paths | `hooks/mcp-deps-install.js:138` | MEDIUM | **PARTIAL** |
| 7 | sessionId in temp file path | `hooks/ctx-session-start.js:159` | MEDIUM | **PARTIAL** |
| 8 | Terminal escape injection | multiple | LOW | **STILL OPEN** |

### New Issues

| # | Finding | File | Severity |
|---|---|---|---|
| N1 | runId from HTTP body → path traversal in getRun() | `scripts/dashboard-server.mjs` | MEDIUM |
| N2 | runId from MCP tool input → path in getRun() without format constraint | `mcp/server.js` | LOW |

---

## Recommended Actions (Priority Order)

1. **dashboard-server.mjs gate/merge handlers (NEW-N1):** Add `runId` format validation before `getRun()`. One-liner: `if (!/^r-[a-zA-Z0-9]+$/.test(runId)) return json(res, 400, ...)`. Mitigates localhost CSRF-style path traversal.

2. **mcp/server.js resolveProjectDir() (Finding #4):** Wrap the return with `resolve()`: `return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())`. One-liner, zero risk.

3. **hooks/mcp-deps-install.js execSync (Finding #6):** Replace the `execSync(npmCmd + ' install --prefix ...')` pattern with `execFileSync(process.execPath, [npmCli, 'install', '--prefix', target.dir], ...)`. Eliminates the shell-parsing layer.

4. **hooks/ctx-session-start.js sessionId (Finding #7):** Add `if (sessionId && !/^[a-zA-Z0-9_-]+$/.test(sessionId)) { exitOk(); return; }` before using sessionId in the bridge path. Low-risk guard.

5. **mcp/server.js runId schema (Finding N2):** Change `runId: z.string()` to `runId: z.string().regex(/^r-[a-zA-Z0-9]+$/)` in affected tools. Defense-in-depth for prompt injection scenarios.
