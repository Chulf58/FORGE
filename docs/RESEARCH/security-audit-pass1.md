# Security Audit — Pass 1: Credential Leakage + Supply Chain

Audit date: 2026-04-17
Auditor: Claude (adversarial pass, no prior context of intent)
Scope: `C:\Users\cuj\forge-plugin` — all JS, JSON, MD files; full git history checked.

---

## Findings

---

### [HIGH] Gemini API key embedded in HTTP request URL (logged by servers, proxies, CDNs)

**File:** `mcp/lib/gemini-adapter.js:40`
**Description:** The Gemini API key is appended as a query parameter in the URL string. HTTP servers, load balancers, reverse proxies, and CDN edge nodes routinely log full request URLs including query parameters. This means the plaintext key will appear in any network infrastructure log between the process and Google's servers. By contrast, the OpenAI adapter correctly uses an `Authorization: Bearer` header which is never logged by standard infrastructure.
**Evidence:**
```js
const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`;
// ...
response = await fetch(url, { method: 'POST', ... });
```
**Risk:** Anyone with access to network logs, proxy logs, or any HTTP debugging tool (Fiddler, mitmproxy, corporate DLP) on the path between the user's machine and Google's API will see the raw `GEMINI_API_KEY` value in plaintext. This is additionally exposed in error messages: if the fetch throws a network error, the URL (with key embedded) may appear in Node.js error stack traces that get written to `mcp_stderr.txt` or stderr logs.
**Recommendation:** Switch to the `x-goog-api-key` HTTP header instead of a query parameter. Google's Gemini API accepts this header:
```js
const url = `${GEMINI_BASE}/${modelId}:generateContent`;
// ...
response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  },
  body: JSON.stringify(body),
});
```
This matches how the OpenAI adapter already handles its key and eliminates URL-based leakage entirely.

---

### [HIGH] Gemini API key leaks into error messages returned to the LLM

**File:** `mcp/lib/gemini-adapter.js:98` and `mcp/lib/gemini-adapter.js:105`
**Description:** When the Gemini API returns a non-2xx response, the full `responseText` body is included in the thrown error. Google's error bodies for authentication failures (401) include the request URL in their JSON payload — and that URL contains the raw API key. Additionally, the JSON parse failure path slices `responseText` but does not sanitize it.
**Evidence:**
```js
// Line 98 — full response body included in error:
throw new Error('Gemini API error ' + response.status + ': ' + responseText);

// Line 105 — slice of response body (may still contain key-bearing URL):
throw new Error('Gemini response JSON parse failed: ' + responseText.slice(0, 200));
```
In `mcp/server.js:707`, this error message is then returned directly to the LLM as an MCP tool result:
```js
return errorResult("External call failed: " + callErr.message);
```
**Risk:** A 401 response from Gemini (e.g., expired key, wrong project) will include error JSON that echoes the request URL. That URL contains the raw API key. The key then travels through: `callErr.message` → `errorResult()` → MCP tool response → Claude's context window → Claude's conversation transcript (stored on disk). The OpenAI adapter has the same shape (`openai-adapter.js:93`) but OpenAI's 401 bodies do not echo the request URL since the key is in a header, so the practical risk is lower there.
**Recommendation:** Before including `responseText` in thrown errors, strip any query parameter containing `key=`:
```js
function sanitizeResponseText(text) {
  // Remove any ?key=... that Google might echo back
  return (text || '').replace(/[?&]key=[^&\s"']*/g, '?key=REDACTED');
}
throw new Error('Gemini API error ' + response.status + ': ' + sanitizeResponseText(responseText));
```

---

### [MEDIUM] `settings.local.json` contains permitted Bash commands that read an external credential file

**File:** `.claude/settings.local.json:76-77`
**Description:** The local settings file (correctly gitignored) contains two allowlisted Bash commands that extract the `OPENAI_API_KEY` value from a batch file at `C:/Users/cuj/set-key.bat`. These are stored verbatim in the allow-list and reveal both the existence of the credential file and its path on disk.
**Evidence:**
```json
"Bash(sed -n 's/.*OPENAI_API_KEY=//p' /c/Users/cuj/set-key.bat)",
"Bash(export OPENAI_API_KEY=$\\(sed -n 's/.*OPENAI_API_KEY=//p' /c/Users/cuj/set-key.bat)"
```
**Risk:** `settings.local.json` is gitignored and not committed, so this is not a git exposure. However: (1) if the file is ever accidentally committed or shared, the credential file path is revealed; (2) the allowlisted commands grant Claude Code the ability to read and echo `set-key.bat` content in a future session with no additional approval prompt. This is the intended workflow, but the pattern normalizes credential extraction via Claude — any future prompt injection in a document processed by Claude could trigger these pre-approved commands.
**Recommendation:** Store `OPENAI_API_KEY` as a permanent Windows environment variable instead of in a batch file. Remove these two allow-list entries. The `forge-config.default.json` already documents this as the correct approach.

---

### [MEDIUM] `forge_call_external` accepts arbitrary `modelId` with no allowlist validation

**File:** `mcp/server.js:666-726`
**Description:** The `forge_call_external` tool validates that `providerId` matches an enabled provider in config, and resolves the API key from that provider's `envVar`. However, `modelId` is passed directly to the adapter with no validation against the config's `models` array. An adversarial or confused caller can pass any model string, including one designed to probe for information about the endpoint (e.g., `../../admin` in a REST path, or a model name crafted to trigger a revealing error message from the API).
**Evidence:**
```js
// mcp/server.js:666-697 — modelId accepted as-is:
inputSchema: z.object({
  providerId: z.string(),
  modelId: z.string(),   // no enum validation against config.models
  prompt: z.string(),
  ...
}),
// modelId flows directly to the adapter:
result = await callOpenAI(prompt, modelId, apiKey, { maxTokens, reasoningEffort });
result = await callGemini(prompt, modelId, apiKey, { maxTokens });
// In gemini-adapter.js:40 — modelId interpolated into URL path:
const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`;
```
For the Gemini adapter specifically, `modelId` is interpolated directly into the URL path. A modelId containing `../` or `?key=injected&other=` could manipulate the URL structure. In practice the fetch will fail or return an error, but those errors may contain the API key in the response body (per Finding 2).
**Recommendation:** Validate `modelId` against the `config.models` array filtered by `providerId` before calling the adapter. Add a regex guard for the Gemini URL path parameter: `if (!/^[\w.-]+$/.test(modelId)) return errorResult('Invalid modelId')`.

---

### [MEDIUM] `bin/forge.cmd` is auto-generated and committed with a machine-specific absolute path — path disclosure

**File:** `bin/forge.cmd:5`
**Description:** The `forge.cmd` launcher is auto-generated by `hooks/mcp-deps-install.js` on every SessionStart and written to `bin/forge.cmd`. The current committed version contains the absolute path of the user's Node.js installation (`C:\Users\cuj\OneDrive - Nemlig.com\...`) and the absolute path of the Claude binary (`C:\Users\cuj\.local\bin\claude.exe`). The file appears in `git status` as modified (not gitignored), meaning it was previously committed with a different path and is tracked.
**Evidence:**
```batch
set "FORGE_CLAUDE_CMD=C:\Users\cuj\.local\bin\claude.exe"
"C:\Users\cuj\OneDrive - Nemlig.com\Skrivebord\node-v24.14.0-win-x64\node.exe" "C:\Users\cuj\forge-plugin\bin\forge.js" %*
```
**Risk:** (1) If this repo is published to GitHub (the `plugin.json` references `https://github.com/Chulf58/FORGE`), committed versions of `forge.cmd` disclose the developer's username, OneDrive folder name, and local file system layout — all useful for targeted phishing or social engineering. (2) It won't work on any other machine since the paths are absolute. (3) The OneDrive path contains the corporate name "Nemlig.com", disclosing employer information.
**Recommendation:** Add `bin/forge.cmd` and `bin/forge-mcp-server.cmd` to `.gitignore`. These files are correctly described in code comments as auto-generated — they should never be committed. The generator in `mcp-deps-install.js` creates them fresh on each session.

---

### [LOW] `mcp/package.json` uses `^` (caret) ranges for all 8 dependencies — no exact pinning

**File:** `mcp/package.json:6-15`
**Description:** All dependencies use caret ranges (`^`), which allow npm to silently install any compatible minor or patch version. This means `npm install` (triggered automatically on every session by `mcp-deps-install.js`) can pull a different version than what was tested.
**Evidence:**
```json
"@modelcontextprotocol/sdk": "^1.29.0",
"@xterm/headless": "^6.0.0",
"blessed": "^0.1.81",
"ink": "^5.0.0",
"node-pty": "^1.1.0",
"pngjs": "^7.0.0",
"react": "^18.0.0",
"zod": "^3.25.0"
```
The `mcp/package-lock.json` is committed, which mitigates this for `npm ci` scenarios. However, `mcp-deps-install.js` calls `npm install` (not `npm ci`), which **does** update `package-lock.json` when a newer compatible version exists and will install the newer version. A supply-chain compromise of any of these packages at a compatible semver version would be auto-installed on the next user session.
**Risk:** Low in practice because the lockfile is committed and `npm install` will only upgrade within `^` bounds. But for a plugin that auto-installs on every session for every user, this is a meaningful surface — a compromised patch release of `@modelcontextprotocol/sdk` or `zod` would be automatically adopted.
**Recommendation:** Change `npm install` to `npm ci` in `mcp-deps-install.js:138`. `npm ci` always installs exactly what the lockfile specifies, never updates it, and is faster. Also consider switching to exact pinning (`"zod": "3.25.0"`) for the most security-critical packages.

---

### [LOW] `forge-config.default.json` is committed with Gemini enabled by default — users who set `GEMINI_API_KEY` will make live API calls without explicit opt-in

**File:** `forge-config.default.json:24-29`
**Description:** The default config ships with Gemini `enabled: true` and OpenAI `enabled: false`. When a user sets the `GEMINI_API_KEY` environment variable for any reason and installs this plugin, Gemini calls will start automatically via `forge_call_external` and `/forge:supervise` without any explicit per-provider opt-in step.
**Evidence:**
```json
{
  "id": "gemini",
  "enabled": true,
  ...
}
```
**Risk:** Low — the user must have set `GEMINI_API_KEY` themselves. But the plugin does not require the user to explicitly opt in by flipping `enabled: true`; it assumes consent via key presence. If a user sets the key for a different tool and also installs this plugin, they may incur quota usage or API charges without expecting it.
**Recommendation:** Default all external providers to `enabled: false`. Require explicit opt-in in the config. Document this clearly in the install flow. The current notes field says "Enable by setting OPENAI_API_KEY and flipping enabled to true" — apply the same pattern to Gemini.

---

### [LOW] `forge_update_config` allowlist does not include `gitIntegration` — documented feature is ungated

**File:** `mcp/server.js:344`
**Description:** The `gitIntegration` config key is documented in `docs/gotchas/GENERAL.md` as settable via `forge_update_config`, but it is absent from `ALLOWED_CONFIG_KEYS`. This means either: (a) the documentation is wrong and git integration cannot be configured via MCP (it can only be set by manually editing `project.json`), or (b) the allowlist is incomplete.
**Evidence:**
```js
// mcp/server.js:344
const ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand"];
// gitIntegration is missing — the GENERAL.md docs say:
// "Set via MCP: forge_update_config with key "gitIntegration" and an object value."
```
**Risk:** Low security impact — the allowlist is a correctness guard, not a security boundary. However, if a future change adds `gitIntegration` to the allowlist without type-checking it as an object, a caller could pass a string or array and corrupt `project.json`. The git integration feature (`autoCommit`, `autoPR`) has meaningful side effects and deserves the same type validation as other keys.
**Recommendation:** Either add `gitIntegration` to `ALLOWED_CONFIG_KEYS` with an object-type check, or correct the documentation. If added, validate that the value is a plain object with the expected shape before writing.

---

### [LOW] No lockfile for `packages/forge-core` — `mcp-deps-install.js` installs it on every session

**File:** `hooks/mcp-deps-install.js:111`
**Description:** `mcp-deps-install.js` attempts to install dependencies for both `mcp/` and `packages/forge-core/`. The `mcp/` directory has a committed `package-lock.json`. However, `packages/forge-core/` has no committed `package.json` or lockfile (confirmed: `git ls-files packages/` returns empty). The install target is silently skipped when `package.json` is absent (`if (!fs.existsSync(packageJson)) continue`), but the install target declaration implies the directory was intended to have managed dependencies.
**Evidence:**
```js
const installTargets = [
  { label: 'mcp', dir: path.join(pluginRoot, 'mcp') },
  { label: 'forge-core', dir: path.join(pluginRoot, 'packages', 'forge-core') }, // no package.json exists
];
```
**Risk:** Low for now (it's skipped silently). If a `packages/forge-core/package.json` is ever added without also adding a lockfile, the next session will do an unlocked `npm install` pulling whatever the registry serves at that moment — with no integrity guarantee.
**Recommendation:** Either remove the `forge-core` install target from `mcp-deps-install.js` (if the package genuinely has no npm dependencies), or add a `package.json` + `package-lock.json` to the tracked files.

---

### [INFORMATIONAL] No hardcoded API key values found anywhere in the codebase

**What was checked:** Grepped all `.js`, `.json`, `.md` files recursively for: `sk-`, `ghp_`, `gho_`, `AKIA`, `AIza`, and patterns matching base64-encoded key formats. Also read `forge-config.default.json`, `.pipeline/forge-config.json`, and `.pipeline/usage.json` in full.
**Result:** No plaintext API key values found. All three config files store only environment variable names (`envVar: "GEMINI_API_KEY"`), never values. The `.pipeline/usage.json` contains only usage counters and timestamps.

---

### [INFORMATIONAL] `mcp/package-lock.json` is committed — primary supply chain protection is in place

**What was checked:** `git ls-files mcp/package.json mcp/package-lock.json` — both are tracked. The lockfile pins exact resolved versions and SHA-512 integrity hashes for all transitive dependencies. This is the correct posture.
**Caveat:** The install hook uses `npm install` not `npm ci`, so the lockfile can drift (see Low finding above).

---

### [INFORMATIONAL] Plugin manifest source URL points to GitHub — no integrity pinning

**File:** `.claude-plugin/plugin.json:7`
**Description:** `"repository": "https://github.com/Chulf58/FORGE"` — the plugin manifest references a GitHub repo URL. Claude Code's marketplace distribution uses HTTPS, which provides transport security but no content integrity guarantee beyond the TLS certificate. There is no hash pinning or signed manifest.
**Risk:** If the GitHub account `Chulf58` were compromised, a malicious version of the plugin could be pushed and distributed to users who have auto-update enabled. This is a standard risk for all Claude Code plugins distributed via the marketplace, not specific to this implementation. No immediate exploit surface — informational.

---

### [INFORMATIONAL] `settings.local.json` is correctly gitignored — no credential exposure via git

**What was checked:** `.gitignore` contains `.claude/settings.local.json`. Verified with `git ls-files .claude/settings.local.json` — returns empty (not tracked). The file contains machine-specific permission entries and the credential-file path patterns noted in the Medium finding above, but none of this is in git history.

---

## Summary

| Severity | Count | Items |
|---|---|---|
| Critical | 0 | — |
| High | 2 | Gemini key in URL (infrastructure logging); Gemini key in error messages returned to LLM |
| Medium | 3 | settings.local.json credential-file allow-list; unvalidated modelId in forge_call_external; forge.cmd path disclosure in git |
| Low | 4 | npm install vs npm ci (lockfile drift); Gemini enabled by default; gitIntegration allowlist gap; forge-core missing lockfile |
| Informational | 4 | No hardcoded keys found; lockfile committed; marketplace URL no integrity pinning; settings.local.json correctly gitignored |

## Priority fix order

1. **[HIGH] `gemini-adapter.js:40`** — Move API key from URL query param to `x-goog-api-key` header. One-line fix, eliminates infrastructure log leakage.
2. **[HIGH] `gemini-adapter.js:98,105`** — Sanitize `responseText` before including in error strings. Prevents key echo-back from appearing in Claude's context.
3. **[MEDIUM] `mcp/server.js:666`** — Add `modelId` validation against `config.models` filtered by provider. Add path-char guard before Gemini URL interpolation.
4. **[MEDIUM] `.gitignore`** — Add `bin/forge.cmd` and `bin/forge-mcp-server.cmd` to `.gitignore`. These are auto-generated and should not be committed.
5. **[LOW] `mcp-deps-install.js:138`** — Change `npm install` to `npm ci` to prevent lockfile drift on auto-install.
