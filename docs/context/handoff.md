# Handoff: 8 enforcement findings fix

## Overview

Eight surgical fixes across hooks and the MCP server. Each fix is minimal — no surrounding refactors.

---

## Files to modify

### Finding 1 — `hooks/workflow-guard.js`

**Bug:** `isPipelineActive()` expires the advisory guard after 5 minutes via wall-clock age. Long coder runs silently lose advisory protection.

**Root cause:** Line 55 — `if (Date.now() - data.startedAt > MARKER_MAX_AGE_MS || data.startedAt > Date.now()) return false;` — a hard 5-minute wall-clock cut-off, regardless of whether the run is still live.

**Change:** Replace the wall-clock age check with a run-registry lookup. If `run-active.json` has a non-empty `runId` and that run's `run.json` does not carry a terminal status (`completed`, `failed`, `discarded`), the pipeline is active. Fail-open: if `run.json` is absent/unreadable, treat as non-terminal.

Also remove the now-unused `MARKER_MAX_AGE_MS` constant.

```js
// BEFORE (lines 9, 45-60):
const MARKER_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

async function isPipelineActive() {
  const markerPath = path.join(process.cwd(), '.pipeline', 'run-active.json');
  try {
    await fs.promises.access(markerPath);
    const raw = await fs.promises.readFile(markerPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data.startedAt !== 'number') return false;
    if (Date.now() - data.startedAt > MARKER_MAX_AGE_MS || data.startedAt > Date.now()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// AFTER:
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

async function isPipelineActive() {
  const projectDir = process.cwd();
  const markerPath = path.join(projectDir, '.pipeline', 'run-active.json');
  let runId;
  try {
    const raw = await fs.promises.readFile(markerPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.runId) return false;
    runId = data.runId;
  } catch (_) {
    return false;
  }
  // Cross-reference the run registry for terminal status.
  // Fail-open: if run.json is absent or unreadable, treat as non-terminal.
  try {
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = await fs.promises.readFile(runPath, 'utf8');
    const run = JSON.parse(raw);
    if (run && run.status && TERMINAL_STATUSES.has(run.status)) return false;
  } catch (_) {
    // run.json absent or unreadable — fail open (non-terminal assumed)
  }
  return true;
}
```

---

### Finding 8 — `hooks/workflow-guard.js` (same file, second change)

**Bug:** `isSourceFile()` excludes `/agents/` unconditionally. This means both the advisory path AND the apply-gate enforcement path skip agent files. Agent files are behavior-critical and must be gated on apply.

**Root cause:** Lines 66-70 — `'/agents/'` appears in the `excluded` array used by a single `isSourceFile` function called from both paths.

**Change:** Add an `includeAgents` parameter (default `true`). Callers of the advisory path pass `{ includeAgents: false }` to preserve existing behavior. The apply-gate caller (`checkApplyGateAndHandoff`) uses the default (`true`), so agents/ is included there.

```js
// BEFORE (lines 62-78):
function isSourceFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalised = filePath.replace(/\\/g, '/');
  // Exclude pipeline, docs, config, and agent directories — everything else is source
  const excluded = [
    '/.pipeline/', '/docs/', '/.claude/', '/templates/',
    '/node_modules/', '/.git/', '/mcp/', '/hooks/', '/agents/',
    '/skills/', '/bin/',
  ];
  for (const ex of excluded) {
    if (normalised.includes(ex)) return false;
  }
  // Exclude standalone config/doc files at project root
  if (normalised.endsWith('.md')) return false;
  if (normalised.endsWith('.json') && !normalised.includes('/src/')) return false;
  return true;
}

// AFTER:
function isSourceFile(filePath, { includeAgents = true } = {}) {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalised = filePath.replace(/\\/g, '/');
  // Exclude pipeline, docs, config directories — everything else is source.
  // agents/ is excluded only for the advisory path (includeAgents: false).
  const excluded = [
    '/.pipeline/', '/docs/', '/.claude/', '/templates/',
    '/node_modules/', '/.git/', '/mcp/', '/hooks/',
    '/skills/', '/bin/',
  ];
  if (!includeAgents) excluded.push('/agents/');
  for (const ex of excluded) {
    if (normalised.includes(ex)) return false;
  }
  // Exclude standalone config/doc files at project root
  if (normalised.endsWith('.md')) return false;
  if (normalised.endsWith('.json') && !normalised.includes('/src/')) return false;
  return true;
}
```

Then update the two call sites in `main()`:

```js
// Line 222 — apply-gate enforcement call (keep default includeAgents: true):
if (isSourceFile(filePath)) {   // no change needed — default is true

// Line 248 — advisory call (add { includeAgents: false }):
// BEFORE:
  if (!isSourceFile(filePath)) { exitOk(); return; }
// AFTER:
  if (!isSourceFile(filePath, { includeAgents: false })) { exitOk(); return; }
```

---

### Finding 2 — `hooks/routing-enforcement.js`

**Bug:** `PIPELINE_AGENTS` is a hardcoded `Set` (lines 30-39). New agents added to `agents/*.md` are silently missed.

**Root cause:** Static constant — never re-scanned.

**Change:** Replace the hardcoded Set with a dynamic scan function, mirroring the pattern in `subagent-start.js`. Cache the result in a module-level variable (per-process lifetime is correct — the hook is short-lived). Require `hook-utils.js` for `resolvePluginRoot`.

```js
// BEFORE (lines 18-39):
const fs = require('fs');
const path = require('path');
const readline = require('readline');
// ...
const PIPELINE_AGENTS = new Set([
  'agent-optimizer', 'architect', 'brainstormer', 'cleanup', 'coder',
  // ... (28 entries) ...
  'tool-call-auditor',
]);

// AFTER:
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolvePluginRoot } = require('./hook-utils');

// Dynamically derived from agents/*.md on first call.
// undefined = not yet probed; null = failed (fail-open); Set = ok
let _pipelineAgents = undefined;

function getPipelineAgentSet() {
  if (_pipelineAgents !== undefined) return _pipelineAgents;
  try {
    const agentsDir = path.join(resolvePluginRoot(), 'agents');
    const entries = fs.readdirSync(agentsDir);
    const names = entries
      .filter(n => n.endsWith('.md'))
      .map(n => n.slice(0, -3)); // strip .md
    if (names.length === 0) {
      _pipelineAgents = null; // empty dir — fail open
      return _pipelineAgents;
    }
    _pipelineAgents = new Set(names);
    return _pipelineAgents;
  } catch (_) {
    _pipelineAgents = null;
    return _pipelineAgents;
  }
}

function isPipelineAgent(name) {
  const set = getPipelineAgentSet();
  if (!set) return true; // allowlist unavailable → fail open (enforce on all)
  return set.has(name);
}
```

Then replace the `PIPELINE_AGENTS.has(subagentType)` call on line 96:

```js
// BEFORE:
  if (!PIPELINE_AGENTS.has(subagentType)) { exitOk(); return; }

// AFTER:
  if (!isPipelineAgent(subagentType)) { exitOk(); return; }
```

Note: the fail-open direction differs between subagent-start.js (record all when allowlist unavailable) and routing-enforcement.js (enforce on all when allowlist unavailable). For enforcement the fail-open in the direction of *enforcing* is safer — it prevents silently bypassing routing checks.

---

### Finding 3 — `hooks/approval-token.js`

**Bug:** `detectActions()` uses `indexOf` which matches substrings: "pushback" triggers push, "recommit" and "commitment" trigger commit.

**Root cause:** Lines 74-79 — `lower.indexOf(keyword)` has no word-boundary constraint.

**Change:** Replace `indexOf` with `RegExp.exec()` using `\b` word-boundary anchors. The `isNegated` function needs a character index, which `exec()` provides via `match.index`.

```js
// BEFORE (lines 71-81):
function detectActions(message) {
  const lower = message.toLowerCase();
  const detected = [];
  for (const [action, keyword] of Object.entries(ACTION_KEYWORDS)) {
    const idx = lower.indexOf(keyword);
    if (idx !== -1 && !isNegated(lower, idx)) {
      detected.push(action);
    }
  }
  return detected;
}

// AFTER:
function detectActions(message) {
  const lower = message.toLowerCase();
  const detected = [];
  for (const [action, keyword] of Object.entries(ACTION_KEYWORDS)) {
    const re = new RegExp('\\b' + keyword + '\\b', 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      if (!isNegated(lower, m.index)) {
        detected.push(action);
        break; // one non-negated match per action is sufficient
      }
    }
  }
  return detected;
}
```

---

### Finding 4 — `hooks/gate-enforcement.js`

**Bug:** The TRIVIAL/SPRINT bypass reads `pipelineMode` from `.pipeline/project.json` (project-level default). A SPRINT run on a LEAN project still enforces gates; a LEAN run on a SPRINT project bypasses them.

**Root cause:** Lines 99-108 — only `project.json` is consulted. The per-run mode in `run-active.json` is never read.

**Change:** Read `run-active.json` first for its `mode` field. Fall back to `project.json` `pipelineMode` only when `run-active.json` is absent or has no `mode` field.

```js
// BEFORE (lines 96-109):
  const projectDir = process.cwd();

  // Step 7: check pipelineMode — bypass for TRIVIAL and SPRINT.
  const projectJsonPath = path.join(projectDir, '.pipeline', 'project.json');
  const projectResult = readJsonFile(projectJsonPath);
  if (projectResult.ok && projectResult.data) {
    const mode = projectResult.data.pipelineMode;
    if (mode && BYPASS_MODES.has(mode)) {
      console.error('[gate-enforcement] pipelineMode ' + mode + ': gates bypassed by design');
      exitOk();
      return;
    }
  }
  // Missing or malformed project.json: proceed with normal enforcement.

// AFTER:
  const projectDir = process.cwd();

  // Step 7: check pipelineMode — bypass for TRIVIAL and SPRINT.
  // Prefer the per-run mode from run-active.json; fall back to project.json.
  let resolvedMode = null;
  const runActivePath = path.join(projectDir, '.pipeline', 'run-active.json');
  const runActiveResult = readJsonFile(runActivePath);
  if (runActiveResult.ok && runActiveResult.data && runActiveResult.data.mode) {
    resolvedMode = runActiveResult.data.mode;
  } else {
    const projectJsonPath = path.join(projectDir, '.pipeline', 'project.json');
    const projectResult = readJsonFile(projectJsonPath);
    if (projectResult.ok && projectResult.data) {
      resolvedMode = projectResult.data.pipelineMode || null;
    }
  }
  if (resolvedMode && BYPASS_MODES.has(resolvedMode)) {
    console.error('[gate-enforcement] pipelineMode ' + resolvedMode + ': gates bypassed by design');
    exitOk();
    return;
  }
  // Missing or malformed files: proceed with normal enforcement.
```

---

### Finding 5 — `scripts/lean-risk-classify.mjs`

**Bug:** `extractFilePaths()` only matches `### \`path/to/file\`` level-3 headings (line 100). Coders using level-4 headings, bold paths, or list items with backtick paths silently skip path-based risk checks.

**Root cause:** Single regex on line 100.

**Change:** Add supplementary patterns. Deduplicate with a `Set`.

```js
// BEFORE (lines 96-106):
function extractFilePaths(filesSection) {
  if (!filesSection) return [];
  const paths = [];
  // Match level-3 headings containing a file path: ### `path/to/file.ext`
  const re = /^###\s+[`'"]?([^\s`'"]+)[`'"]?\s*$/gm;
  let m;
  while ((m = re.exec(filesSection)) !== null) {
    paths.push(m[1].replace(/\\/g, '/'));
  }
  return paths;
}

// AFTER:
function extractFilePaths(filesSection) {
  if (!filesSection) return [];
  const seen = new Set();
  const add = (p) => { const n = p.replace(/\\/g, '/'); if (n) seen.add(n); };

  // Pattern 1 (primary): ### `path/to/file.ext` or ### path/to/file.ext
  const re1 = /^###\s+[`'"]?([^\s`'"]+)[`'"]?\s*$/gm;
  let m;
  while ((m = re1.exec(filesSection)) !== null) add(m[1]);

  // Pattern 2: #### `path/to/file.ext` (level-4 headings)
  const re2 = /^####\s+[`'"]?([^\s`'"]+)[`'"]?\s*$/gm;
  while ((m = re2.exec(filesSection)) !== null) add(m[1]);

  // Pattern 3: **`path/to/file.ext`** or **path/to/file.ext:**
  const re3 = /^\*\*[`']?([^`'*\s][^`'*]*?)[`']?\*\*:?\s*$/gm;
  while ((m = re3.exec(filesSection)) !== null) {
    const p = m[1].trim();
    if (p.includes('/')) add(p); // must look like a path
  }

  // Pattern 4: - `path/to/file.ext` or * `path/to/file.ext` (list items)
  const re4 = /^[-*]\s+`([^`]+)`/gm;
  while ((m = re4.exec(filesSection)) !== null) {
    const p = m[1].trim();
    if (p.includes('/')) add(p); // must contain / to distinguish from inline code
  }

  return Array.from(seen);
}
```

---

### Finding 6 — `mcp/lib/config-store.js`

**Bug:** Module-level `_cache` is only invalidated by `writeForgeConfig()`. External file edits (hand-editing, bootstrap hook) are invisible until MCP server restart.

**Root cause:** Lines 94, 109-113 — cache hit check uses only `pluginDataDir` + `projectDir`, never comparing the file's mtime.

**Change:** Store `mtime` alongside the cached data. On each `readForgeConfig()` call, `statSync` the file and compare. If mtime changed, discard cache and re-read.

```js
// BEFORE (lines 91-113):
// Module-level routing config cache — loaded once per session, invalidated on write.
let _cache = null; // { config, configPath, pluginDataDir, projectDir }

export function readForgeConfig(pluginDataDir, projectDir) {
  if (_cache !== null &&
      _cache.pluginDataDir === pluginDataDir &&
      _cache.projectDir === projectDir) {
    return { config: _cache.config, configPath: _cache.configPath };
  }
  // ... (rest of function, lines 115-144)

// AFTER:
// Module-level routing config cache — invalidated on write or when mtime changes.
// { config, configPath, pluginDataDir, projectDir, mtimeMs }
let _cache = null;

export function readForgeConfig(pluginDataDir, projectDir) {
  if (_cache !== null &&
      _cache.pluginDataDir === pluginDataDir &&
      _cache.projectDir === projectDir) {
    // Check mtime to detect external edits (hand-editing, bootstrap hook, etc.)
    try {
      const { statSync } = await import('node:fs'); // already imported at top — use synchronous
      // (statSync is already imported via the top-level import — see correction below)
    } catch (_) { /* ignore */ }
    // NOTE: Use the already-imported statSync from the top-level import block
    let currentMtime = 0;
    try {
      currentMtime = statSync(_cache.configPath).mtimeMs;
    } catch (_) {
      // file gone — force re-read
      _cache = null;
    }
    if (_cache !== null && currentMtime === _cache.mtimeMs) {
      return { config: _cache.config, configPath: _cache.configPath };
    }
    // mtime changed or file gone — fall through to re-read
    _cache = null;
  }
  // ... rest of function unchanged until cache assignment:
```

The import at the top of the file needs `statSync` added:

```js
// BEFORE (line 4):
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// AFTER:
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
```

And the cache assignment inside the loop (currently line 136) needs `mtimeMs` added:

```js
// BEFORE:
      _cache = { config, configPath: candidate, pluginDataDir, projectDir };

// AFTER:
      let mtimeMs = 0;
      try { mtimeMs = statSync(candidate).mtimeMs; } catch (_) { /* ignore */ }
      _cache = { config, configPath: candidate, pluginDataDir, projectDir, mtimeMs };
```

And clean up the stray bogus `await import` block added above — the full corrected `readForgeConfig` with the mtime check is:

```js
export function readForgeConfig(pluginDataDir, projectDir) {
  if (_cache !== null &&
      _cache.pluginDataDir === pluginDataDir &&
      _cache.projectDir === projectDir) {
    // Validate mtime to detect external edits — cheap (one stat call).
    let currentMtime = 0;
    try {
      currentMtime = statSync(_cache.configPath).mtimeMs;
    } catch (_) {
      _cache = null; // file gone — force re-read
    }
    if (_cache !== null && currentMtime === _cache.mtimeMs) {
      return { config: _cache.config, configPath: _cache.configPath };
    }
    _cache = null; // mtime changed — fall through to re-read
  }

  const candidates = [];
  if (pluginDataDir) {
    candidates.push(join(pluginDataDir, 'forge-config.json'));
  }
  candidates.push(join(projectDir, '.pipeline', 'forge-config.json'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      let raw;
      try {
        raw = readFileSync(candidate, 'utf-8');
      } catch (err) {
        throw new Error('forge-config.json read failed at ' + candidate + ': ' + err.message);
      }
      let config;
      try {
        config = JSON.parse(raw);
      } catch (err) {
        throw new Error('forge-config.json parse failed at ' + candidate + ': ' + err.message);
      }
      validateForgeConfig(config, candidate);
      let mtimeMs = 0;
      try { mtimeMs = statSync(candidate).mtimeMs; } catch (_) { /* ignore */ }
      _cache = { config, configPath: candidate, pluginDataDir, projectDir, mtimeMs };
      return { config, configPath: candidate };
    }
  }

  throw new Error(
    'forge-config.json not found. Searched: ' + candidates.join(', ') +
    '. Run /forge:init or copy forge-config.default.json to one of these locations.',
  );
}
```

---

### Finding 7 — `mcp/server.js`

**Bug:** A 401 response calls `markQuotaExhausted()`, which blocks all models on that provider for the session. A 401 is auth failure, not quota exhaustion.

**Root cause:** Lines 797-798 — the `isAuthError` branch calls `markQuotaExhausted(projectDir, currentProviderId)`.

**Change:** For 401 errors, return a descriptive error without marking the provider exhausted. For 403, also skip quota marking. Only 429 / "quota" string maps to `markQuotaExhausted`.

```js
// BEFORE (lines 793-801):
          const isAuthError = msg.includes("401");
          const isQuotaError = msg.includes("429") || msg.toLowerCase().includes("quota");

          if (isAuthError) {
            try { markQuotaExhausted(projectDir, currentProviderId); } catch (_) { /* best-effort */ }
          } else if (isQuotaError) {
            try { markModelQuotaExhausted(projectDir, currentProviderId, currentModelId); } catch (_) { /* best-effort */ }
          }

// AFTER:
          const isAuthError = msg.includes("401") || msg.includes("403");
          const isQuotaError = msg.includes("429") || msg.toLowerCase().includes("quota");

          if (isAuthError) {
            // Auth errors (401 invalid key, 403 forbidden) are NOT quota exhaustion.
            // Return immediately with a descriptive message — do NOT mark provider exhausted.
            return errorResult(
              "API key invalid, expired, or forbidden for provider \"" + currentProviderId +
              "\" (HTTP " + (msg.includes("401") ? "401" : "403") + "): " + msg
            );
          } else if (isQuotaError) {
            try { markModelQuotaExhausted(projectDir, currentProviderId, currentModelId); } catch (_) { /* best-effort */ }
          }
```

---

## Verification

pre-flight clean

## Blockers

None.

## Why these fixes are correct

1. **Finding 1:** The old code used `startedAt` age as a proxy for "is the run still live". `run.json` status is the authoritative signal. Non-terminal runs are active regardless of elapsed time.

2. **Finding 8:** The single `isSourceFile` function was shared between two logically different contexts. Adding an `includeAgents` parameter separates advisory (where we don't want noise on agent edits) from enforcement (where we must gate on agent edits).

3. **Finding 2:** Dynamic scan matches how `subagent-start.js` already works. The enforcement hook now can't drift from the actual agents directory.

4. **Finding 3:** Word-boundary regex eliminates false positives from "pushback", "recommit", "commitment" while preserving all true positives. The `exec()` loop also handles multiple occurrences of a keyword correctly.

5. **Finding 4:** Per-run `mode` is more specific than the project default. The fallback chain (run-active.json → project.json) follows the same precedence used elsewhere in the pipeline.

6. **Finding 5:** Adding three supplementary extraction patterns with path-validation guards (`includes('/')` for list items and bold paths) broadens coverage without introducing false positives from short inline code tokens.

7. **Finding 6:** One `statSync` call per cache hit is cheap (kernel metadata only, no read). It covers all external-edit scenarios including bootstrap hook writes and hand-editing.

8. **Finding 7:** 401 is "wrong API key" and 403 is "access denied on this endpoint" — neither indicates the provider's quota is exhausted. Returning an error immediately without marking exhausted preserves the ability to retry after fixing the key, and does not poison other models on the same provider.

## Regression risk

- **Finding 1:** If `run.json` is absent (pre-registry projects), `isPipelineActive()` returns `true` for any non-empty `runId`. This is the documented fail-open behavior — same as `subagent-start.js`.
- **Finding 8:** The advisory path now passes `{ includeAgents: false }` explicitly. Any caller that forgets the flag gets the safe default (`true` = include agents in enforcement). No silent regression.
- **Finding 2:** Fail-open is in the "enforce on all" direction when agent scan fails — more conservative than before, no less safe.
- **Finding 4:** Projects without `run-active.json` fall back to `project.json` as before. No behavior change for those projects.
- **Finding 7:** The early `return` on auth error means the retry loop is exited for 401/403. This is correct — retrying with the same key would always fail. The transient-reroute path is unaffected (503 only).
