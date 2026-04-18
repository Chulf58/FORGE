# Security Pass 4 — Pass 2 (Red-Team Adversarial Audit)

Date: 2026-04-17  
Framing: command injection and path traversal

---

## 1. `bin/forge-worktree.js` — exec variant + validateSlug coverage

**RESOLVED.** Uses `execFileSync` throughout — no shell string is ever passed to a subprocess. `validateSlug` is called at the top of every slug-consuming function: `create`, `merge`, `delete`. The `cleanup` function has no `slug` argument but reads directory entries from the filesystem; it validates each entry name inline with the same `/^[a-zA-Z0-9_-]+$/` regex before passing it to `execFileSync`, and skips any entry that fails. The `list` function does not call `execFileSync` with a directory-derived name at all — it filters with the same regex before reading subdirectories. No injection surface found.

---

## 2. `hooks/mcp-deps-install.js` — exec variant + npm ci

**RESOLVED.** Uses `execFileSync` throughout via the inner `runNpm` helper. The `npm ci` / `npm install` branch is chosen based on whether `package-lock.json` exists — `npm ci` is preferred when the lockfile is present, `npm install` only falls back when there is no lockfile. Neither variant uses a shell string. All paths are constructed with `path.join` from trusted sources (`pluginRoot` derived from `__dirname` or `CLAUDE_PLUGIN_ROOT`). The `.cmd` launcher write path is similarly anchored to `pluginRoot`. No injection surface found.

---

## 3. `hooks/hook-utils.js` — exports

**RESOLVED.** All three functions are exported: `resolveProjectDir`, `resolvePluginRoot`, and `stripAnsi`. The module.exports line at line 115 confirms all three are present.

---

## 4. Five payload.cwd hooks — resolveProjectDir coverage

**RESOLVED for 4 of 5; one nuance in forge-banner.**

- `hooks/subagent-start.js` — calls `resolveProjectDir(payload)` at line 64. RESOLVED.
- `hooks/subagent-stop.js` — calls `resolveProjectDir(payload)` at line 89. RESOLVED.
- `hooks/apply-context-inject.js` — calls `resolveProjectDir(payload)` at line 36. RESOLVED.
- `hooks/ctx-session-start.js` — calls `resolveProjectDir(payload)` at line 144 for the stale-lock notice path. RESOLVED.
- `hooks/ctx-stop.js` — calls `resolveProjectDir(payload)` at line 30. RESOLVED.
- `hooks/forge-banner.js` — does NOT call `resolveProjectDir`. This is intentional and correct: the banner hook reads only the plugin's own `forge-banner.txt` (via `resolvePluginRoot`) and writes nothing to the project directory. It has no project-dir-scoped file operations. Not a gap.

---

## 5. `hooks/gate-sync.js` — resolveProjectDir and resolvePluginRoot usage

**RESOLVED.** `projectRoot` is set via `resolveProjectDir(payload)` at line 40, with an explicit comment ("never from the file path, which could be attacker-controlled via a crafted tool_input.file_path"). All `listRuns` / `getRun` / `updateRun` / `createRun` calls use `projectRoot`. The plugin module path is resolved via `resolvePluginRoot()` at line 55. One residual detail: `filePath` from `payload.tool_input.file_path` is used directly for `fs.readFileSync(filePath)` at line 45 and for the gate-repair `fs.writeFileSync(filePath, ...)` at line 148 and 220. This filePath is attacker-controlled but its content is JSON that gets parsed and re-serialized — no code execution path. The only write is back to the same file path the model just wrote, with structured JSON output. Impact is limited to writing to an arbitrary path the attacker controls, not executing code. This is a **known accepted risk** since the hook only fires PostToolUse when the model's Write/Edit tool was already approved, meaning the path was already written by a tool-use the session trusted. Not a new finding.

---

## 6. `hooks/forge-banner.js` and `hooks/subagent-start.js` / `hooks/subagent-stop.js` — resolvePluginRoot for CLAUDE_PLUGIN_ROOT

**RESOLVED.** `forge-banner.js` calls `resolvePluginRoot()` at line 25 to derive `bannerPath` — never uses `CLAUDE_PLUGIN_ROOT` directly. `subagent-start.js` calls `resolvePluginRoot()` inside `getForgeAgentSet()` at line 27 to locate the `agents/` directory. `subagent-stop.js` does the same at line 24. In all three cases `resolvePluginRoot()` validates and anchors against `__dirname` — a tampered `CLAUDE_PLUGIN_ROOT` is rejected if it doesn't match the hook-derived root.

---

## 7. `mcp/server.js` — resolveProjectDir() path.resolve usage

**RESOLVED.** The function at line 35–37 is:
```js
function resolveProjectDir() {
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}
```
`resolve` is imported as `{ resolve }` from `"node:path"` at line 5. The call wraps the result in `path.resolve()`, so even if `CLAUDE_PROJECT_DIR` is a relative path, it is normalized to absolute. No traversal possible since the value is used only as a base for `path.join` calls, and run IDs are validated against `runIdSchema` (`/^r-[a-zA-Z0-9]+$/`) before any join. RESOLVED.

---

## 8. `scripts/dashboard-server.mjs` — isValidRunId in POST handlers + resolveProjectDir

**RESOLVED.** Both POST handlers (`/api/gate-action` at line 558 and `/api/merge-action` at line 583) call `isValidRunId(runId)` and return 400 if it fails, before any `getRun` or filesystem operation. `isValidRunId` enforces `/^r-[a-zA-Z0-9]+$/`. The `resolveProjectDir()` function at line 47–49 uses `process.env.CLAUDE_PROJECT_DIR || process.cwd()` — it does NOT call `path.resolve()` unlike the MCP server version. This means if `CLAUDE_PROJECT_DIR` is a relative path, it lands as a relative base for `join()` calls. In practice the sidecar is run from a known working directory and `CLAUDE_PROJECT_DIR` is expected to be absolute, but the lack of `resolve()` is a **minor gap** — not exploitable for traversal given the run ID validation, but inconsistent with the MCP server pattern. **STILL OPEN (low severity):** `resolveProjectDir()` in `dashboard-server.mjs` should wrap with `resolve()` to match the MCP server defensive pattern.

---

## 9. `hooks/ctx-session-start.js` line ~158 — sessionId sanitization in temp file path

**RESOLVED.** Line 158:
```js
const safeSessionId = String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '');
```
Applied before constructing `bridgePath` via `path.join(os.tmpdir(), 'claude-ctx-' + safeSessionId + '.json')`. All non-alphanumeric/non-hyphen/non-underscore characters are stripped, including path separators and dots. A crafted `session_id` like `../../etc/passwd` becomes `etcpasswd` and lands safely in `os.tmpdir()`. RESOLVED.

---

## 10. `hooks/ctx-session-start.js` — getLastUsage() transcriptPath validation

**PARTIALLY RESOLVED / STILL OPEN (low severity).** `getLastUsage(transcriptPath)` at line 28 receives `payload.transcript_path` directly (line 140: `const transcriptPath = payload.transcript_path`). The function has a null-guard (`if (!transcriptPath) return null`) and wraps `fs.promises.access` + `readFile` in try/catch. However there is no validation that `transcriptPath` is an absolute path or that it stays within an expected directory. An attacker who can forge the hook payload (already a privileged position) could supply `transcript_path: "/etc/passwd"` or a path to any readable file on disk. The file is then read, split on newlines, and each line is JSON-parsed — non-JSON lines are silently skipped, so reading a non-JSONL file just returns null. The content is never echoed to any output. **Impact: information is not leaked externally, but an attacker can trigger arbitrary file reads within the hook's process permissions.** Since hook payloads come from Claude Code (trusted runtime), this is low severity. To fully close it, add a check that `transcriptPath` is absolute and contains the expected Claude transcript directory pattern before the `access` call.

---

## Summary table

| # | Surface | Status |
|---|---------|--------|
| 1 | forge-worktree.js exec + validateSlug | RESOLVED |
| 2 | mcp-deps-install.js exec + npm ci | RESOLVED |
| 3 | hook-utils.js exports | RESOLVED |
| 4 | 5 payload.cwd hooks → resolveProjectDir | RESOLVED |
| 5 | gate-sync.js resolveProjectDir + resolvePluginRoot | RESOLVED (filePath write risk accepted) |
| 6 | forge-banner / subagent hooks → resolvePluginRoot | RESOLVED |
| 7 | mcp/server.js resolveProjectDir → path.resolve | RESOLVED |
| 8 | dashboard-server.mjs isValidRunId + resolveProjectDir | STILL OPEN (low) — missing path.resolve() wrap |
| 9 | ctx-session-start.js sessionId sanitization | RESOLVED |
| 10 | ctx-session-start.js transcriptPath validation | STILL OPEN (low) — no path/directory constraint |
