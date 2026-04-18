# Security Final Pass — Post-Fix Verification Audit

**Auditor:** Claude Sonnet 4.6 (1M context), 2026-04-17
**Scope:** Verify all 7 previously-tracked findings; hunt for new issues in hooks, MCP server, skills, and config.
**Method:** Live file reads of all affected files. No assumptions from prior audit notes.

---

## Finding-by-finding verification

---

### [FINDING 1] 5 hooks unvalidated `payload.cwd` — claimed fix: `resolveProjectDir` in `hook-utils.js`

**Files read:** `hooks/hook-utils.js`, `hooks/subagent-start.js`, `hooks/subagent-stop.js`, `hooks/apply-context-inject.js`, `hooks/ctx-session-start.js`, `hooks/ctx-stop.js`

**Verification:**

`hooks/hook-utils.js` implements `resolveProjectDir(payload)` with three strict validation rules:
1. `payload.cwd` must be a non-empty string (falsy falls back silently)
2. `payload.cwd` must be an absolute path (`path.isAbsolute()`)
3. `payload.cwd` must exactly match `process.cwd()` (strict equality, not prefix match)

On any violation: falls back to `process.cwd()` and emits a `console.error` warning. Never throws. Never returns an untrusted path.

All five hooks confirmed using `resolveProjectDir`:
- `subagent-start.js` line 6 (import), line 64 (call)
- `subagent-stop.js` line 6 (import), line 89 (call)
- `apply-context-inject.js` line 18 (import), line 36 (call)
- `ctx-session-start.js` line 7 (import), line 144 (call)
- `ctx-stop.js` line 10 (import), line 30 (call)

The strict equality check (not starts-with) closes the path-extension attack where a tampered `cwd` shares a prefix with the real project dir but extends it.

**Status: RESOLVED**

---

### [FINDING 2] `gate-sync.js` project root from `file_path` — claimed fix: `resolveProjectDir` used

**File read:** `hooks/gate-sync.js`

**Verification:**

Line 18: `const { resolveProjectDir, resolvePluginRoot } = require('./hook-utils');`
Line 40: `const projectRoot = resolveProjectDir(payload);`
Comment at line 38–39: "Resolve project root from validated hook cwd — never from the file path, which could be attacker-controlled via a crafted tool_input.file_path."

The old `path.dirname(path.dirname(filePath))` pattern is completely absent. `filePath` from `payload.tool_input` is only used for:
1. String suffix check: `normalized.endsWith('.pipeline/gate-pending.json')` — pure string comparison, no I/O
2. `fs.readFileSync(filePath, ...)` to read the gate file contents — reads the actual file the model just wrote, which is intentional and safe (the file is within the project by construction; an attacker can't redirect the read to an arbitrary path without also controlling the Write tool's actual target, which Claude Code validates)
3. `fs.writeFileSync(filePath, ...)` for gate repair — same logic; writing back to the file the hook was triggered on

All run registry operations (`createRun`, `getRun`, `listRuns`, `updateRun`, `createWorktree`) use the validated `projectRoot` from `resolveProjectDir(payload)`.

**Status: RESOLVED**

---

### [FINDING 3] Feature name unsanitized in git commit/PR — claimed fix: `sanitizeFeatureName` at `forge_create_run` + skill instructions

**Files read:** `mcp/lib/sanitize.js`, `mcp/server.js` (forge_create_run handler), `skills/apply/SKILL.md`

**Verification — `sanitize.js`:**

`sanitizeFeatureName(raw)` strips via regex `/["\\`$\r\n\x00-\x1f\x7f]/g`:
- `"` — double quote (breaks `"..."` shell quoting)
- `\` — backslash (escape injection)
- backtick — command substitution
- `$` — variable/subshell substitution
- `\r`, `\n` — command injection via newline
- `\x00-\x1f`, `\x7f` — C0/C1 control chars

Truncated to 200 chars after stripping.

**Verification — `mcp/server.js` forge_create_run handler (lines 979-980):**

```js
const safeFeature = sanitizeFeatureName(feature);
const run = createRun({ projectRoot: projectDir, sessionId, pipelineType, mode, feature: safeFeature });
```

The sanitized value is stored in `run.json` and returned in the run object. `run-active.json` also receives `safeFeature` at line 1023 (the `feature` field in the marker). All downstream reads of either file get the pre-sanitized value.

**Verification — `skills/apply/SKILL.md`:**

Step 1 (line 17): "The `feature` field has been mechanically sanitized (shell-unsafe characters stripped) by `forge_create_run`. Use this sanitized `feature` value — not raw `$ARGUMENTS` — in Steps 5, 7, and 8 when constructing git commit messages and PR titles."

Step 5 (line 96): reinforces the sanitized-value-only instruction.
Step 8 (line 115): fallback sanitization instructions for the worktree commit path when Step 5 was skipped.

**Residual note — worktree path shell quoting:**

`git -C <worktreePath>` in Steps 8 and 9 has no quoting guidance. The worktree path is generated under `.worktrees/<runId>/` where `runId` matches `r-[a-z0-9]+` — no spaces or shell-special chars. Non-exploitable in current path generation scheme, but the skill does not enforce quoting.

**Status: RESOLVED** (mechanical layer complete; worktree path quoting gap is a documentation note, not a live exploit)

---

### [FINDING 4] `[reviewer-verdict]` parsed from any agent — claimed fix: `isReviewerAgent` guard in `subagent-stop.js`

**File read:** `hooks/subagent-stop.js`

**Verification:**

`isReviewerAgent(agentType)` function defined at lines 48–52:
```js
function isReviewerAgent(agentType) {
  if (!agentType) return false;
  const normalized = agentType.startsWith('forge:') ? agentType.slice('forge:'.length) : agentType;
  return normalized.startsWith('reviewer');
}
```

Line 138: `const verdict = isReviewerAgent(agentType) ? extractVerdict(lastMessage) : null;`

This is the correct guard. `extractVerdict()` is now called ONLY when `isReviewerAgent(agentType)` is true — i.e., only agents whose type normalizes to a name starting with `reviewer`. Non-reviewer FORGE agents (planner, coder, documenter, implementation-architect, gotcha-checker, etc.) will always get `outcome = 'completed'` regardless of message content. A forged `[reviewer-verdict]` line in a planner output will be silently ignored.

The previous re-audit (security-reaudit-pass3.md) reported this as STILL OPEN. That was incorrect — the fix IS present in the current file. The previous re-audit appears to have read a stale version.

**Status: RESOLVED**

---

### [FINDING 5] `CLAUDE_PLUGIN_ROOT` dynamic import not validated — claimed fix: `resolvePluginRoot` in `hook-utils.js`

**Files read:** `hooks/hook-utils.js`, `hooks/gate-sync.js`, `hooks/apply-context-inject.js`

**Verification — `resolvePluginRoot()` in `hook-utils.js` (lines 66–89):**

The function uses the hook file's own location as the trust anchor: `path.resolve(__dirname, '..')` (one level up from `hooks/`). For `CLAUDE_PLUGIN_ROOT`:
1. Absent → use hook-derived root (no warning)
2. Present but not absolute → warn + fall back
3. Present, absolute, but `path.normalize(fromEnv) !== trusted` → warn + fall back
4. Present, absolute, matching → accept

This correctly prevents a tampered env var from redirecting dynamic `import()` to an attacker-controlled path.

**Verification — `gate-sync.js` (lines 18, 55):**

```js
const { resolveProjectDir, resolvePluginRoot } = require('./hook-utils');
// ...
const pluginRoot = resolvePluginRoot();
const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
```

`resolvePluginRoot()` is called before the dynamic import. The path is validated before import.

**Verification — `apply-context-inject.js` (lines 18, 41):**

```js
const { resolveProjectDir, resolvePluginRoot, stripAnsi } = require('./hook-utils');
// ...
const pluginRoot = resolvePluginRoot();
const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
```

Same pattern. `resolvePluginRoot()` called, validated path used for import.

The previous re-audit (security-reaudit-pass3.md) reported this as STILL OPEN. That was incorrect — both hooks now use `resolvePluginRoot()` from `hook-utils.js`.

**Status: RESOLVED**

---

### [FINDING 6] `forge-config.json` read without schema validation — claimed fix: `validateForgeConfig` in `config-store.js`

**Files read:** `mcp/lib/config-store.js`, `mcp/lib/gemini-adapter.js`

**Verification — `validateForgeConfig` in `config-store.js`:**

`validateForgeConfig(config, configPath)` performs:
- `providers`: required array; each entry must be an object with `id` (non-empty string), `type` (must be in `KNOWN_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'gemini'])`), and `envVar` (must match `ENV_VAR_RE = /^[A-Z][A-Z0-9_]{0,99}$/`)
- `models`: optional array; each entry must be an object with `id` and `providerId` (non-empty strings)
- `agentModelMap`: optional object; each value must be an object

`readForgeConfig` calls `validateForgeConfig(config, candidate)` on line 125 — between parse and return. Invalid config throws before any caller can act on it.

The `ENV_VAR_RE` constraint on `envVar` (`/^[A-Z][A-Z0-9_]{0,99}$/`) blocks injection attempts like `$(...)`  or path traversal characters in the env var name used as an API key reference.

**Verification — Gemini adapter URL construction (`gemini-adapter.js` line 59):**

```js
const url = `${GEMINI_BASE}/${modelId}:generateContent`;
```

`modelId` is interpolated directly into the URL without `encodeURIComponent`. The previous audit flagged this as a URL injection risk. However, examining the call chain:
- `modelId` comes from `forge-config.json` `models[].id` field
- `validateForgeConfig` validates that `models[].id` is a non-empty string, but does NOT restrict characters (no URL-safe pattern check)
- A `modelId` containing `../` or `?key=injected` could manipulate the URL path or add query parameters

**This remains a documentation gap.** In practice, the `GEMINI_BASE` URL uses HTTPS so `../` traversal only affects the path component (can't reach a different host), and query parameter injection would only add keys to the legitimate Gemini endpoint. Risk is LOW in the current single-user model but could be elevated if config is shared.

**Status: RESOLVED** (schema validation added; Gemini modelId URL-encoding gap is NEW — see NEW FINDINGS below)

---

### [FINDING 7] `forge_update_config` accepts arbitrary `testCommand` — no fix claimed

**File read:** `mcp/server.js`

**Verification:**

Line 362: `ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand"]`
Lines 382-385: validates only that `testCommand` is a string type; no content validation.

`skills/apply/SKILL.md` line 90-93 instructs the orchestrator to run `testCommand` via Bash with `timeout: 60000`. This is direct shell execution of whatever string is stored.

Risk assessment unchanged: in the single-user model, the person setting `testCommand` and the person running the apply pipeline are the same. Not an exploit in the current deployment model.

**Status: STILL OPEN** (informational; risk unchanged — LOW in single-user model)

---

## New findings from this pass

---

### [NEW — LOW] `subagent-start.js` and `subagent-stop.js` use raw `CLAUDE_PLUGIN_ROOT` for `fs.readdirSync` (no `resolvePluginRoot` call)

**Files:** `hooks/subagent-start.js` line 27, `hooks/subagent-stop.js` line 23

**Description:**

Both hooks contain this pattern for building the FORGE agent allowlist:
```js
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const agentsDir = path.join(pluginRoot, 'agents');
const entries = fs.readdirSync(agentsDir);
```

This does NOT use `resolvePluginRoot()` from `hook-utils.js`. The unvalidated env var is used to call `fs.readdirSync` — read-only filesystem I/O, NOT a dynamic `import()`.

**Risk assessment:**

If `CLAUDE_PLUGIN_ROOT` is set to an attacker-controlled directory:
- If the directory has no `.md` files: `_forgeAgents = null` → fail-open (all FORGE agents recorded) — the safe outcome
- If the directory contains crafted `.md` files: the allowlist is populated with attacker-chosen names — could suppress tracking of real FORGE agents or add fake ones

This cannot execute arbitrary code. The worst case is allowlist manipulation, which affects only subagent tracking metadata, not pipeline enforcement decisions.

**Recommendation:** Use `resolvePluginRoot()` consistently for any operation that uses `CLAUDE_PLUGIN_ROOT`. This is a defense-in-depth improvement, not an urgent fix.

---

### [NEW — LOW] `forge-banner.js` uses raw `CLAUDE_PLUGIN_ROOT` for `fs.readFileSync`

**File:** `hooks/forge-banner.js` line 24

**Description:**

```js
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const bannerPath = path.join(pluginRoot, 'forge-banner.txt');
const banner = fs.readFileSync(bannerPath, 'utf8');
process.stderr.write(banner + '\n');
```

An attacker-controlled `CLAUDE_PLUGIN_ROOT` could redirect the read to any file on the filesystem and write its contents to stderr (the user's terminal). This could leak sensitive file contents into the terminal (e.g., private keys, config with passwords if they are plain text files the attacker can target).

The output goes to `stderr` only — not `stdout`, not into model context. It's visible in the terminal but not injected into the conversation.

**Risk assessment:** LOW. Requires ability to set `CLAUDE_PLUGIN_ROOT` in the process environment (same-user access implies local compromise already). The output channel is stderr (terminal only), limiting impact.

**Recommendation:** Use `resolvePluginRoot()` here as well. Trivial fix — same pattern as `gate-sync.js`.

---

### [NEW — LOW] Gemini `modelId` interpolated into URL without `encodeURIComponent`

**File:** `mcp/lib/gemini-adapter.js` line 59

**Description:**

```js
const url = `${GEMINI_BASE}/${modelId}:generateContent`;
```

`modelId` is read from `forge-config.json` `models[].id`. `validateForgeConfig` validates it is a non-empty string but does not enforce URL-safe characters. A `modelId` value such as `gemini-1.5-flash?key=injected` would append a query parameter to the URL; `../../v1/other-endpoint:generateContent` would manipulate the path component.

**Risk assessment:** LOW. `GEMINI_BASE` is hardcoded HTTPS with no path traversal past the domain possible via relative URLs in modern `fetch()`. Query parameter injection only affects the Gemini endpoint itself. `modelId` comes from `forge-config.json` which the user controls — this is not attacker-controlled input in the normal deployment model.

**Recommendation:** `encodeURIComponent(modelId)` at line 59. One-character fix. Defense in depth.

---

### [INFORMATIONAL] `workflow-guard.js` reads `run-active.json` and `gate-pending.json` using `process.cwd()` directly (not `resolveProjectDir`)

**File:** `hooks/workflow-guard.js`

**Description:**

`workflow-guard.js` is a PreToolUse hook. Its `checkApplyGateAndHandoff` function (line 128) reads `run-active.json` and `gate-pending.json` using `process.cwd()` directly (line 129):
```js
const projectDir = process.cwd();
```

It does NOT call `resolveProjectDir(payload)`. However, `process.cwd()` is always the authoritative value (it cannot be tampered via stdin payload) — `resolveProjectDir` exists to *validate* that `payload.cwd` matches `process.cwd()`, but either way the safe path is `process.cwd()`. Using `process.cwd()` directly is equivalent in safety.

`filePath` from `tool_input` reaches only path comparison logic (`isSourceFile`, worktree boundary check) — never to filesystem I/O for registry files.

**Status:** Informational — no action required. The code is correct.

---

### [INFORMATIONAL] `ctx-stop.js` gate feature string written to `additionalContext` without `stripAnsi`

**File:** `hooks/ctx-stop.js` line 59

**Description:**

```js
warnings.push('Gate ' + (data.gate || '?') + ' is pending approval for "' + (data.feature || 'unknown') + '".');
```

`data.feature` is read from `gate-pending.json` and interpolated into an advisory message sent via `additionalContext`. The message goes into model context (not stderr/terminal). ANSI escape sequences in `data.feature` would be included in the model's prompt context, but model prompt injection via `additionalContext` is constrained by Claude Code's own prompt handling. Not a terminal injection vector since the output channel is model context, not `stderr`.

**Status:** Informational — low impact since the injection surface is model context (advisory text, not a command). `stripAnsi` would still be good hygiene.

---

## Summary table

| Finding | Severity | Prior Status | Current Status | Notes |
|---|---|---|---|---|
| 5 hooks unvalidated `payload.cwd` | HIGH | RESOLVED | **RESOLVED** | `resolveProjectDir` confirmed in all 5 hooks |
| `gate-sync.js` project root from `file_path` | HIGH | RESOLVED | **RESOLVED** | `resolveProjectDir(payload)` at line 40; old `path.dirname` pattern fully absent |
| Feature name unsanitized in git commit/PR | HIGH | RESOLVED | **RESOLVED** | `sanitizeFeatureName()` at `forge_create_run`; skill references sanitized value; both layers confirmed |
| `[reviewer-verdict]` parsed from any agent | MEDIUM | STILL OPEN (prior re-audit incorrect) | **RESOLVED** | `isReviewerAgent` guard at `subagent-stop.js:138` confirmed present; prior re-audit read stale file |
| `CLAUDE_PLUGIN_ROOT` dynamic import not validated | MEDIUM | STILL OPEN (prior re-audit incorrect) | **RESOLVED** | `resolvePluginRoot()` from `hook-utils.js` used in both `gate-sync.js` and `apply-context-inject.js`; prior re-audit read stale files |
| `forge-config.json` read without schema validation | MEDIUM | STILL OPEN | **RESOLVED** | `validateForgeConfig` present and called in `readForgeConfig`; enforces providers/models/agentModelMap structure and `envVar` format |
| `forge_update_config` accepts arbitrary `testCommand` | LOW | STILL OPEN | **STILL OPEN** | No content validation added; risk unchanged — LOW/Informational in single-user model |
| NEW: `subagent-start/stop.js` use raw `CLAUDE_PLUGIN_ROOT` for `readdirSync` | LOW | — | **NEW** | Not dynamic import; allowlist manipulation only; recommend `resolvePluginRoot()` for consistency |
| NEW: `forge-banner.js` uses raw `CLAUDE_PLUGIN_ROOT` for `readFileSync` → stderr | LOW | — | **NEW** | Could leak file content to terminal; recommend `resolvePluginRoot()` |
| NEW: Gemini `modelId` not URL-encoded | LOW | — | **NEW** | Config-controlled, not attacker-controlled; `encodeURIComponent(modelId)` is a one-char fix |
| INFO: `workflow-guard.js` uses `process.cwd()` directly | INFO | — | **INFORMATIONAL** | Equivalent safety to `resolveProjectDir`; no action needed |
| INFO: `ctx-stop.js` gate feature in `additionalContext` without `stripAnsi` | INFO | — | **INFORMATIONAL** | Model context only, not terminal; low impact |
