# Security Final Pass 2 — Post-Fix Verification

Audited by: red-team pass (Claude Sonnet 4.6 1M, 2026-04-17)
Scope: Verify all 10 fixes claimed in the original brief; hunt for new issues.
Method: Direct file reads of every affected file, cross-referenced against previous audit
reports (`security-reaudit-pass3.md`).

---

## Fix verification — item by item

---

### 1. `bin/forge-worktree.js` — execSync slug injection (CRITICAL RCE)

**Claimed fix:** `execFileSync` throughout, `validateSlug()` present.

**Verification:**

- Line 13: `const { execFileSync } = require('child_process');` — `execSync` is not imported.
- `validateSlug(s)` at line 23–28: regex `/^[a-zA-Z0-9_-]+$/` enforced; exits 1 on failure.
- `validateSlug(slug)` called at the top of `create()`, `merge()`, `deleteWorktree()`.
- All `git` invocations use `run('git', [...])` which wraps `execFileSync` — no shell string.
- `cleanup()` at line 246: filesystem-derived directory names also filtered with the same regex before use as git args.

**Status: RESOLVED** — no `execSync` import, validateSlug covers all slug-consuming paths.

---

### 2. `cleanup()` / `list()` directory name validation

**Claimed fix:** regex filter on filesystem-derived names.

**Verification:**

- `list()` line 108: `.filter(d => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name))` — entries failing the pattern are silently dropped before any git call or `path.join`.
- `cleanup()` line 246: same `/^[a-zA-Z0-9_-]+$/.test(d.name)` check; invalid names emit a warning to stderr and `continue` — they are never passed to git.

**Status: RESOLVED** — both functions validate filesystem-derived names before using them in execFileSync args.

---

### 3. `hooks/ctx-session-start.js` runId path traversal

**Claimed fix:** `resolveProjectDir` helper from `hook-utils.js`.

**Verification:**

- `ctx-session-start.js` line 7: `const { resolveProjectDir } = require('./hook-utils');`
- Line 144: `const projectDir = resolveProjectDir(payload);`
- `resolveProjectDir` in `hook-utils.js` (lines 22–47): validates `payload.cwd` is absolute AND exactly equals `process.cwd()`; falls back to `process.cwd()` on any violation.
- The hook no longer uses `payload.cwd` directly for any path construction.

**Status: RESOLVED** — `resolveProjectDir` correct; hook uses only the validated result.

---

### 4. `mcp/server.js` — CLAUDE_PROJECT_DIR not canonicalized (MEDIUM)

**Claimed state in brief:** "still open (MEDIUM)"

**Verification:**

`resolveProjectDir()` in `mcp/server.js` line 35–37:
```js
function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
```
No `path.resolve()`, no `path.normalize()`, no validation that the value is absolute or within expected bounds. An attacker who can set `CLAUDE_PROJECT_DIR` to an arbitrary string (e.g. `../../etc/passwd/../project`) gets that string passed to `join(projectDir, '.pipeline', ...)` in every MCP tool handler.

In practice, `CLAUDE_PROJECT_DIR` is set by Claude Code itself (the MCP spec), so the attack surface is limited to compromised Claude Code installations. Risk is medium in theory, low in practice.

**Status: STILL OPEN (MEDIUM)** — No change since previous audit. Fix: `path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())`.

---

### 5. `scripts/dashboard-server.mjs` — exec() with HOST

**Claimed state in brief:** "was legacy code"

**Verification:**

The `exec()` import is still present (line 20) and still called at line 629:
```js
exec(cmd + " " + url, () => {});
```
However, `url` is constructed entirely from controlled data: `HOST` is the string literal `"127.0.0.1"` (line 33) and `PORT` is `Number(process.env.FORGE_DASHBOARD_PORT) || 7878` (line 32).

`Number()` coerces any string to a number. `"127.0.0.1:7878 && rm -rf /"` → `NaN` → falls back to 7878. The URL is `"http://127.0.0.1:7878"` — a fixed string with no user-controlled component. The `exec()` call cannot be influenced by external input.

Also note: `exec()` here launches the system browser (`start`, `open`, `xdg-open`) with a localhost URL — not a network request. Shell injection is theoretically possible only if `PORT` resolved to a malicious value, which `Number()` prevents by producing NaN for non-numeric input.

**Status: RESOLVED (by design)** — `exec()` remains but is safe; all inputs are bounded. Using `execFileSync(['start', url])` would be strictly better but the current form is not exploitable.

---

### 6. `hooks/mcp-deps-install.js` — fragile execSync

**Claimed fix:** now uses `execFileSync`.

**Verification:**

- Line 10: `const { execFileSync } = require('child_process');` — `execSync` is not imported.
- `runNpm()` at lines 108–118: uses `execFileSync(process.execPath, [npmCli].concat(args), ...)` or `execFileSync('npm', args, ...)` — both forms pass arguments as arrays, no shell interpolation.
- `discoverClaudePath()` at line 27: `execFileSync(pathTool, ['claude'], ...)` — fixed binary, fixed args.
- Launcher `.cmd` file written via string concatenation at lines 173 and 191–201:
  - `process.execPath` — runtime-controlled, not user input.
  - `serverPath`, `wrapperJsPath` — built from `pluginRoot` via `path.join`.
  - `claudePath` — result of `discoverClaudePath()`, which validates via `fs.existsSync`.
  - The written `.cmd` file is used by the MCP launcher, not by this hook itself — no self-injection.

**Status: RESOLVED** — no `execSync`; all subprocess calls use `execFileSync` with array args.

---

### 7. `hooks/ctx-session-start.js:159` — sessionId in temp file name (MEDIUM)

**Claimed state in brief:** "still open (MEDIUM, not fixed)"

**Verification:**

Line 158–160 in `ctx-session-start.js`:
```js
const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
await fs.promises.writeFile(bridgePath, ...);
```

`sessionId` comes from `payload.session_id` (line 139) with no validation before use in `path.join`.

**Contrast with `ctx-post-tool.js`:** That hook validates `sessionId` at line 193 before using it in temp file names:
```js
if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) { exitOk(); return; }
```

`ctx-session-start.js` does NOT apply this guard before writing the bridge file at line 158. A payload with `session_id: "../../../etc/cron.d/evil"` would produce `path.join(os.tmpdir(), 'claude-ctx-../../../etc/cron.d/evil.json')` which on Unix resolves outside `tmpdir()`.

The fix in `ctx-post-tool.js` exists but was not backported to `ctx-session-start.js`.

**Status: STILL OPEN (MEDIUM)** — `ctx-post-tool.js` is fixed; `ctx-session-start.js` is not.

**Fix (one-liner):** Add before line 158:
```js
if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) { exitOk(); return; }
```

---

### 8. Terminal escape injection in logs (`stripAnsi`)

**Claimed fix:** `stripAnsi` exported from `hook-utils.js`.

**Verification:**

`hook-utils.js` lines 107–113: `stripAnsi(value)` implemented, removes CSI sequences, OSC sequences, and C0/C1 control characters (preserving `\t`, `\n`, `\r`). Exported at line 115.

Usage is caller-dependent — the function is available for any hook to import and use before logging untrusted values.

**Status: RESOLVED** — `stripAnsi` is correctly implemented and exported.

---

### 9. `scripts/dashboard-server.mjs` — runId path traversal in POST handlers

**Claimed fix:** `isValidRunId()` validation in POST handlers.

**Verification:**

- `isValidRunId()` at lines 43–45: `RUN_ID_RE = /^r-[a-zA-Z0-9]+$/`; returns false for anything not matching.
- `/api/gate-action` handler lines 562–563: `if (!isValidRunId(runId)) return json(res, 400, ...)` — validates before `getRun(projectDir, runId)`.
- `/api/merge-action` handler lines 589–590: same guard applied before `getRun`.
- `getRun` in `packages/forge-core` uses the `runId` in `path.join(projectDir, '.pipeline', 'runs', runId, 'run.json')`. With the regex guard in place, traversal characters (`..`, `/`, `\`) are rejected at the HTTP boundary.

**Status: RESOLVED** — `isValidRunId` gates all POST handlers before any path construction.

---

### 10. MCP tools — raw `z.string()` runId (fixed with `runIdSchema`)

**Claimed fix:** `runIdSchema` and `runIdOrBareSchema` Zod constraints applied.

**Verification:**

`mcp/server.js` lines 21–31:
```js
const runIdSchema = z.string().regex(/^r-[a-zA-Z0-9]+$/, ...);
const runIdOrBareSchema = z.string().regex(/^(r-)?[a-zA-Z0-9]+$/, ...);
```

Applied to:
- `forge_set_gate` — `runId: runIdSchema.optional()` (line 487)
- `forge_get_run` — `runId: runIdSchema` (line 1044)
- `forge_update_run` — `runId: runIdSchema` (line 1181)
- `forge_create_worktree` — `runId: runIdSchema` (line 1232)
- `forge_resume_run` — `runId: runIdOrBareSchema` (line 1263)

All tools that accept a runId and use it in path construction are covered.

**Status: RESOLVED** — `runIdSchema` enforced at the Zod boundary for all runId-accepting tools.

---

## New findings — hunt for issues not in the original brief

---

### NEW-1. `ctx-session-start.js` — `transcriptPath` used in `getLastUsage()` without validation (LOW)

**File:** `hooks/ctx-session-start.js:29`, called from line 149.

**Description:**

`transcriptPath` is taken directly from `payload.transcript_path` (line 140) and passed to `getLastUsage()`. Inside `getLastUsage()`:
```js
await fs.promises.access(transcriptPath);
const raw = await fs.promises.readFile(transcriptPath, 'utf8');
```

No validation that `transcriptPath` is absolute, within an expected directory, or matches any format. An attacker controlling the payload can supply `transcriptPath: "/etc/passwd"` and the hook reads that file.

**Impact:** Information disclosure — the hook reads the file, parses it as JSONL, and silently discards non-matching lines. No data is emitted to stdout/stderr from this read path. The worst case is reading a sensitive file and discarding its contents. The hook does not write to `transcriptPath`.

**Assessment:** LOW — exfiltration requires a separate mechanism; the read result is consumed and discarded. Not remotely exploitable in the Claude Code threat model (local hook, attacker controls payload only if they control Claude Code itself). But it is a pattern worth sanitizing for defense in depth.

---

### NEW-2. `scripts/dashboard-server.mjs` — `resolveProjectDir()` uses raw env var (LOW)

**File:** `scripts/dashboard-server.mjs:47–49`.

```js
function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
```

Same pattern as `mcp/server.js` — no `path.resolve()`, no validation. The dashboard server is a developer utility run manually (`node scripts/dashboard-server.mjs`), and `CLAUDE_PROJECT_DIR` is set by the operator, not by external input. Risk is lower than in the MCP server context but still inconsistent.

**Assessment:** LOW / documentation gap — same fix as item 4: `path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd())`.

---

### NEW-3. `gate-sync.js` / `apply-context-inject.js` — `resolvePluginRoot()` from `hook-utils.js` now used (RESOLVED from previous OPEN)

**Verification:**

Previous audit (`security-reaudit-pass3.md`) reported that `gate-sync.js` and `apply-context-inject.js` did not validate `CLAUDE_PLUGIN_ROOT` before dynamic import. Checked the current state:

`gate-sync.js` line 55: `const pluginRoot = resolvePluginRoot();`

`resolvePluginRoot()` in `hook-utils.js` lines 66–88:
- Uses `path.resolve(__dirname, '..')` as the trusted anchor.
- If `CLAUDE_PLUGIN_ROOT` is absent: returns trusted anchor (no warning).
- If present but not absolute: warns + falls back.
- If present, absolute, but mismatched after `path.normalize()`: warns + falls back.
- If present, absolute, matching: accepts.

This fix was NOT in the previous audit's "STILL OPEN" list — it was apparently added between the last reaudit and now. Both hooks import and use `resolvePluginRoot()`.

**Status: RESOLVED** — dynamic import path is now anchored to `__dirname`, with env var accepted only if it matches exactly.

---

### NEW-4. `mcp/lib/gemini-adapter.js` — `modelId` interpolated directly into URL without encoding (MEDIUM)

**File:** `mcp/lib/gemini-adapter.js:59`.

```js
const url = `${GEMINI_BASE}/${modelId}:generateContent`;
```

`modelId` is the caller-supplied string from `forge_call_external` — which does accept it as a free `z.string()` in `mcp/server.js:686`. No `encodeURIComponent()` is applied. A `modelId` containing `/../` or `?key=injected` could manipulate the API endpoint path or inject query parameters.

**Mitigating factors:**
- `modelId` comes from the LLM (the MCP tool call), not from an HTTP request body or user-typed input.
- The Gemini API key is sent as a header (`x-goog-api-key`), not a query param — so `?key=` injection doesn't exfiltrate the real key.
- Path traversal in the URL affects only which Gemini endpoint is called, not the local filesystem.

**Assessment:** MEDIUM — URL injection against a third-party API. Not a local security issue but could be used to call unintended Gemini endpoints. Fix: `encodeURIComponent(modelId)` at line 59.

This was noted as STILL OPEN in `security-reaudit-pass3.md` and remains unaddressed.

**Status: STILL OPEN (MEDIUM)**

---

### NEW-5. `scripts/dashboard-server.mjs` — `gateRoot` in `handleGateAction()` taken from `run.worktreePath` without canonicalization (LOW)

**File:** `scripts/dashboard-server.mjs:97–98`.

```js
const gateRoot = run.worktreePath || projectDir;
const gatePath = join(gateRoot, ".pipeline", "gate-pending.json");
```

`run.worktreePath` is read from `getRun()` which reads from `.pipeline/runs/<runId>/run.json`. The `runId` is validated by `isValidRunId()` before the lookup, but `worktreePath` inside the run JSON is not re-validated. A corrupted or maliciously crafted `run.json` could set `worktreePath: "/etc"` and cause the gate write at line 107 to touch `/etc/.pipeline/gate-pending.json`.

**Mitigating factors:** The `worktreePath` is written by `createWorktree()` in `packages/forge-core`, which builds it as `join(absRoot, '.worktrees', runId)` — a controlled path. Only a corrupted `run.json` (requiring prior write access to `.pipeline/`) would trigger this.

**Assessment:** LOW — second-order path injection requiring local write access to plant a malicious `run.json`. No external attack vector.

---

## Summary table

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `forge-worktree.js` execSync slug injection (RCE) | CRITICAL | **RESOLVED** |
| 2 | `cleanup()` / `list()` directory name validation | HIGH | **RESOLVED** |
| 3 | `ctx-session-start.js` runId path traversal | HIGH | **RESOLVED** |
| 4 | `mcp/server.js` CLAUDE_PROJECT_DIR not canonicalized | MEDIUM | **STILL OPEN** |
| 5 | `dashboard-server.mjs` exec() with HOST | MEDIUM | **RESOLVED** (safe by construction) |
| 6 | `mcp-deps-install.js` fragile execSync | MEDIUM | **RESOLVED** |
| 7 | `ctx-session-start.js:159` sessionId in temp file | MEDIUM | **STILL OPEN** |
| 8 | Terminal escape injection in logs | MEDIUM | **RESOLVED** |
| 9 | `dashboard-server.mjs` runId path traversal | MEDIUM | **RESOLVED** |
| 10 | MCP tools raw `z.string()` runId | MEDIUM | **RESOLVED** |
| NEW-1 | `ctx-session-start.js` transcriptPath unvalidated read | LOW | **NEW — OPEN** |
| NEW-2 | `dashboard-server.mjs` resolveProjectDir() raw env var | LOW | **NEW — OPEN** |
| NEW-3 | gate-sync/apply-context-inject CLAUDE_PLUGIN_ROOT import | MEDIUM | **RESOLVED** (was previously OPEN) |
| NEW-4 | `gemini-adapter.js` modelId not URL-encoded | MEDIUM | **STILL OPEN** (carried from pass3) |
| NEW-5 | `handleGateAction()` worktreePath from run.json unchecked | LOW | **NEW — OPEN** |

---

## Remaining open items — priority order

1. **MEDIUM — `ctx-session-start.js` sessionId validation (item 7)**
   File: `hooks/ctx-session-start.js`
   Fix: Add `if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) { exitOk(); return; }` before line 158.
   `ctx-post-tool.js` already has this guard — backport only.

2. **MEDIUM — Gemini `modelId` URL encoding (NEW-4 / carried from pass3)**
   File: `mcp/lib/gemini-adapter.js:59`
   Fix: `const url = \`${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent\`;`

3. **MEDIUM — `mcp/server.js` CLAUDE_PROJECT_DIR canonicalization (item 4)**
   File: `mcp/server.js:36`
   Fix: `return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());`
   Add `import { resolve } from 'node:path';` (already imported as `resolve` on line 6).

4. **LOW — `dashboard-server.mjs` resolveProjectDir raw env var (NEW-2)**
   File: `scripts/dashboard-server.mjs:47–49`
   Fix: Same pattern as item 3 — wrap in `resolve()`.

5. **LOW — `ctx-session-start.js` transcriptPath read without validation (NEW-1)**
   File: `hooks/ctx-session-start.js` `getLastUsage()` function.
   Fix: Check that `transcriptPath` is an absolute path before reading, or validate it starts with a known transcript directory prefix.

6. **LOW — `handleGateAction()` worktreePath from run.json (NEW-5)**
   Low priority given the second-order nature. Acceptable to defer.
