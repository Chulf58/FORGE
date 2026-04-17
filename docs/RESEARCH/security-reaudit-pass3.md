# Security Re-Audit — Pass 3 Verification

Audited by: verification pass (Claude Sonnet 4.6, 2026-04-17)
Scope: Verify all fixes claimed in commits 9fa33ad, d69f0e6, b78abb4, 8f7e16a.
Source: `security-audit-pass3.md` (original findings), live file reads of all affected files.

---

## Finding-by-finding verification

---

### [HIGH ORIGINAL] Unvalidated `cwd` from stdin used as filesystem root in five hooks

**Claimed fix:** `9fa33ad` — shared `resolveProjectDir(payload)` helper in `hooks/hook-utils.js`; all 5 hooks now use it.

**Verification:**

`hooks/hook-utils.js` exists and implements `resolveProjectDir(payload)` with three validation rules:
1. `payload.cwd` must be a non-empty string (falls back on falsy)
2. `payload.cwd` must be an absolute path (`path.isAbsolute()`)
3. `payload.cwd` must exactly match `process.cwd()` (strict equality, not prefix match)

On any violation the function emits a `console.error` warning and returns `process.cwd()` — never an untrusted path.

All five hooks confirmed to import and call `resolveProjectDir`:
- `hooks/subagent-start.js:6,64` — `require('./hook-utils')`, `resolveProjectDir(payload)`
- `hooks/subagent-stop.js:6,80` — same pattern
- `hooks/apply-context-inject.js:18,36` — same pattern
- `hooks/ctx-session-start.js:7,144` — same pattern
- `hooks/ctx-stop.js:10,30` — same pattern

The fix is correct and complete. The strict equality check (not a prefix/starts-with match) means a tampered `cwd` that shares a prefix with the real project dir but extends it is also rejected.

**Status: RESOLVED**

---

### [HIGH ORIGINAL] `hooks/gate-sync.js:38` — project root derived from `payload.tool_input.file_path`

**Claimed fix:** `d69f0e6` — `hooks/gate-sync.js` now uses `resolveProjectDir(payload)` instead of file_path derivation.

**Verification:**

`hooks/gate-sync.js:18` imports `resolveProjectDir` from `./hook-utils`.
`hooks/gate-sync.js:40` calls `const projectRoot = resolveProjectDir(payload);` with the comment:
> "Resolve project root from validated hook cwd — never from the file path, which could be attacker-controlled via a crafted tool_input.file_path."

The old `path.dirname(path.dirname(filePath))` pattern is completely absent from the file. `filePath` is still read (to check whether the file ends with `.pipeline/gate-pending.json` at line 36) but is never used to derive a directory root used for registry operations.

`projectRoot` flows to `createRun`, `getRun`, `listRuns`, `updateRun`, `createWorktree` — all of which now receive a validated root from `process.cwd()`.

**Status: RESOLVED**

---

### [HIGH ORIGINAL] `skills/apply/SKILL.md` — feature name unsanitized in git commit / gh pr create

**Claimed fixes:** `b78abb4` — prompt-level sanitization in `skills/apply/SKILL.md`; `8f7e16a` — mechanical sanitization via `sanitizeFeatureName()` in `mcp/lib/sanitize.js` applied at `forge_create_run`.

**Verification — mechanical layer (`mcp/lib/sanitize.js`):**

`sanitizeFeatureName(raw)` strips the following characters via regex before truncating to 200 chars:
- `"` (double quote — breaks `"..."` shell quoting)
- `\` (backslash — escape injection)
- `` ` `` (backtick — command substitution)
- `$` (dollar sign — variable/subshell substitution)
- `\r`, `\n` (newlines — command injection)
- `\x00-\x1f`, `\x7f` (C0/C1 control characters)

Pattern: `/["\\`$\r\n\x00-\x1f\x7f]/g` — comprehensive coverage of the classic shell double-quote injection set.

**Verification — ingestion point (`mcp/server.js:962-963`):**

```js
const safeFeature = sanitizeFeatureName(feature);
const run = createRun({ ..., feature: safeFeature });
```

The sanitized value is stored in `run.json` and returned in the run object. The `run-active.json` marker at line 978 also stores `safeFeature` — so any downstream reader of either file gets the pre-sanitized value.

**Verification — prompt layer (`skills/apply/SKILL.md:17-18`):**

Step 1 now explicitly instructs the skill:
> "The `feature` field has been mechanically sanitized (shell-unsafe characters stripped) by `forge_create_run`. Use this sanitized `feature` value — not raw `$ARGUMENTS` — in Steps 5, 7, and 8 when constructing git commit messages and PR titles."

Step 5 (auto-commit, line 96) reinforces: "Use the sanitized `feature` field returned by `forge_create_run` in Step 1 as `<safe-feature>`. It has been mechanically sanitized at source — do not use raw `$ARGUMENTS` here."

Step 8 (worktree commit, line 115) also defers: "use the same sanitized feature name from Step 5; if Step 5 was skipped, sanitize now: strip `"`, `\`, `` ` ``, `$`, newlines, control characters."

**Residual concern — worktree path quoting (pass3 medium finding):**

The original medium finding about `<worktreePath>` lacking shell-quoting guidance in Step 8 is not explicitly addressed. The skill still reads:
```
git -C <worktreePath> add -A
git -C <worktreePath> commit -m "feat(forge): <safe-feature>"
```
No quoting guidance is given for `<worktreePath>`. The worktree path is generated by `forge_create_worktree` under `.worktrees/<runId>/` — paths containing only alphanumeric characters and hyphens — so in practice this is unexploitable. But the prompt language does not enforce quoting.

This is a documentation gap rather than a live exploitable path. The mechanical sanitization of the feature name (the primary risk) is complete and correct.

**Status: RESOLVED** (mechanical layer correct; worktree path quoting guidance gap noted but not exploitable in current path generation)

---

### [MEDIUM ORIGINAL] `[reviewer-verdict]` signal parsed from any agent output (`hooks/subagent-stop.js:128`)

**Claimed fix:** None listed in the fix commits.

**Verification:**

`hooks/subagent-stop.js` has an `isForgeAgent()` allowlist check at line 112 that exits early for non-FORGE agents. However, the allowlist check gates on whether the agent is a FORGE agent at all — it does NOT restrict `extractVerdict()` to reviewer-typed agents.

Lines 125-128:
```js
const lastMessage = payload.last_assistant_message || null;
const verdict = extractVerdict(lastMessage);
const outcome = verdict !== null ? verdict : 'completed';
```

This executes for ANY FORGE agent: planner, coder, implementation-architect, gotcha-checker, documenter, etc. If any of these agents echo a `[reviewer-verdict] {...}` line in their output (e.g. because they quoted it from a file they read), the hook records the forged verdict as that agent's outcome.

The original recommendation — restrict `extractVerdict()` to the reviewer agent subtypes — was not implemented.

**Status: STILL OPEN**

---

### [MEDIUM ORIGINAL] `CLAUDE_PLUGIN_ROOT` dynamic import not validated (`hooks/gate-sync.js`, `apply-context-inject.js`)

**Claimed fix:** None listed in the fix commits.

**Verification:**

Both files still use the identical pattern:
```js
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
```

No validation that `pluginRoot` is an absolute path, matches `path.resolve(__dirname, '..')`, or is within expected bounds before constructing the dynamic import URL. If `CLAUDE_PLUGIN_ROOT` is set to an attacker-controlled directory, an arbitrary `.js` file is imported with full Node.js privileges.

The fallback `path.resolve(__dirname, '..')` is safe when `CLAUDE_PLUGIN_ROOT` is unset, but the env var takes precedence without any sanity check.

**Status: STILL OPEN**

---

### [MEDIUM ORIGINAL] `forge-config.json` read without schema validation

**Claimed fix:** None listed in the fix commits.

**Verification:**

`mcp/lib/config-store.js` (`readForgeConfig`) parses with `JSON.parse` and returns the raw object without any structural validation. The callers in `mcp/server.js` access `config.providers`, `config.models`, and `config.agentModelMap` trusting the schema.

No schema validation (Zod, JSON Schema, or manual field checks) was added.

The secondary risk from the original finding — `modelId` URL injection in the Gemini adapter — also remains unaddressed. `mcp/lib/gemini-adapter.js` still interpolates `modelId` directly into the API URL without `encodeURIComponent`.

**Status: STILL OPEN**

---

### [LOW ORIGINAL] `forge_update_config` accepts arbitrary `testCommand` strings

**Claimed fix:** None listed in the fix commits.

**Verification:**

`mcp/server.js` line 345: `ALLOWED_CONFIG_KEYS` includes `"testCommand"`. Lines 365-368 validate only that the value is a string — no content validation, no allowlist of test runner patterns, no stripping of shell metacharacters.

This is unchanged from the original finding. The original audit rated this Informational/Low due to the single-user model, and that risk assessment still applies.

**Status: STILL OPEN** (risk level unchanged — LOW/Informational in single-user model)

---

## New issues found in this pass

---

### [NEW — Low] `workflow-guard.js` derives `projectDir` from `process.cwd()` (correct) but reads `run-active.json` and `gate-pending.json` paths using a raw `filePath` from `tool_input`

**File:** `hooks/workflow-guard.js:128-157`

**Description:**

`workflow-guard.js` is a PreToolUse hook. The `filePath` it receives comes from `payload.tool_input.file_path` (line 216) and is used in two ways:

1. Passed to `isSourceFile(filePath)` — a pure string classification function (no I/O). Safe.
2. Passed to `checkApplyGateAndHandoff(filePath)` — which reads `run-active.json` and `gate-pending.json` from `process.cwd()` (safe), but then compares `path.resolve(filePath)` against `path.resolve(worktreePath)` for the worktree enforcement check (line 189-192).

The worktree enforcement check (`normalizedWrite.startsWith(normalizedWt + '/')`) is defensive — it BLOCKS writes, not permits them. An attacker-controlled `filePath` that resolves outside the worktree path would receive a deny (the safe outcome). The function cannot be manipulated to permit writes it should block by providing a crafted `filePath`.

**Assessment:** The logic is sound. This is a note rather than a finding — `filePath` from `tool_input` flows only to read-only path comparison, not to filesystem I/O in this hook. No action required.

---

### [NEW — Note] `ctx-stop.js` does not use `resolveProjectDir` for the handoff path check (Check 4)

**File:** `hooks/ctx-stop.js:79`

**Description:**

Check 4 in `ctx-stop.js` constructs the handoff path as:
```js
const handoffPath = path.join(projectDir, 'docs', 'context', 'handoff.md');
```

`projectDir` at line 30 is correctly set via `resolveProjectDir(payload)`. This is correct — the handoff path uses the validated `projectDir`. No issue.

---

## Summary table

| Original Finding | Severity | Status | Notes |
|---|---|---|---|
| 5 hooks use `payload.cwd` without validation | HIGH | **RESOLVED** | `resolveProjectDir()` in `hook-utils.js` with strict equality + absolute path check; all 5 hooks confirmed |
| `gate-sync.js` project root from `tool_input.file_path` | HIGH | **RESOLVED** | Now uses `resolveProjectDir(payload)`; old `path.dirname()` pattern fully removed |
| Feature name unsanitized in git commit / PR title | HIGH | **RESOLVED** | `sanitizeFeatureName()` strips all shell-injection chars at `forge_create_run`; prompt layer defers to sanitized value; worktree path quoting gap is non-exploitable |
| `[reviewer-verdict]` parsed from any FORGE agent output | MEDIUM | **STILL OPEN** | `extractVerdict()` not restricted to reviewer agent subtypes; any FORGE agent echoing the signal has its outcome overwritten |
| `CLAUDE_PLUGIN_ROOT` dynamic import not validated | MEDIUM | **STILL OPEN** | No path validation before `import()`; env var takes precedence over safe `__dirname` fallback without sanity check |
| `forge-config.json` read without schema validation | MEDIUM | **STILL OPEN** | No structural validation in `readForgeConfig`; `modelId` URL injection in Gemini adapter also unaddressed |
| `forge_update_config` accepts arbitrary `testCommand` strings | LOW | **STILL OPEN** | No content validation; risk remains LOW/Informational in single-user model |

### Open items by priority

1. **MEDIUM — reviewer-verdict agent-type gate** (`hooks/subagent-stop.js`): restrict `extractVerdict()` to reviewer-typed agents before recording outcome. One-line fix — add a set of reviewer agent names and check before calling extractVerdict.

2. **MEDIUM — CLAUDE_PLUGIN_ROOT import validation** (`hooks/gate-sync.js`, `hooks/apply-context-inject.js`): after computing `pluginRoot`, assert `pluginRoot === path.resolve(__dirname, '..')` (or `path.normalize(pluginRoot) === path.normalize(path.resolve(__dirname, '..'))` for case-insensitive FS). Log and skip the import on mismatch.

3. **MEDIUM — forge-config.json schema + Gemini modelId encoding** (`mcp/lib/config-store.js`, `mcp/lib/gemini-adapter.js`): minimal schema validation on `providers[]` entries (type, envVar format); `encodeURIComponent(modelId)` in URL construction.

4. **LOW — testCommand content validation** (`mcp/server.js`): note-level; acceptable to defer in single-user deployment.
