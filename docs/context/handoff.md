# Handoff: SessionEnd and FileChanged lifecycle hooks

## Summary
Adds `hooks/session-end.js` (end-of-session protocol reminder) and `hooks/file-changed.js` (gate/board context injection), registered in `hooks/hooks.json`.

## Files to create

### `hooks/session-end.js`
```javascript
'use strict';

// SessionEnd hook — advisory reminder when end-of-session protocol appears incomplete.
// Never blocks (exit 0 always). Emits stderr reminder when source-modifying agents
// ran but handoff.md or CHANGELOG.md are stale (older than 60 minutes).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 10000;
const FRESHNESS_MS = 60 * 60 * 1000; // 60 minutes

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    process.exit(0);
    return;
  }

  const projectDir = resolveProjectDir(payload);

  // Check sessionEndReminder opt-out in project.json
  try {
    const projRaw = await fs.promises.readFile(
      path.join(projectDir, '.pipeline', 'project.json'),
      'utf8',
    );
    const projData = JSON.parse(projRaw);
    if (projData.sessionEndReminder === false) {
      process.exit(0);
      return;
    }
  } catch (_) { /* missing or unreadable — default to enabled */ }

  // Check whether any source-modifying agents (implementer or coder) completed
  let sourceAgentRan = false;
  try {
    const activeRaw = await fs.promises.readFile(
      path.join(projectDir, '.pipeline', 'run-active.json'),
      'utf8',
    );
    const activeData = JSON.parse(activeRaw);
    if (Array.isArray(activeData.agents)) {
      sourceAgentRan = activeData.agents.some((a) => {
        const t = typeof a.agent_type === 'string' ? a.agent_type : '';
        return (t.includes('implementer') || t.includes('coder')) && a.completedAt;
      });
    }
  } catch (_) { /* run-active absent or unreadable — skip check */ }

  if (!sourceAgentRan) {
    process.exit(0);
    return;
  }

  const now = Date.now();
  const stale = [];

  // Check handoff.md freshness
  try {
    const stat = await fs.promises.stat(
      path.join(projectDir, 'docs', 'context', 'handoff.md'),
    );
    if ((now - stat.mtimeMs) > FRESHNESS_MS) {
      stale.push('docs/context/handoff.md');
    }
  } catch (_) {
    stale.push('docs/context/handoff.md (missing)');
  }

  // Check CHANGELOG.md freshness
  try {
    const stat = await fs.promises.stat(
      path.join(projectDir, 'docs', 'CHANGELOG.md'),
    );
    if ((now - stat.mtimeMs) > FRESHNESS_MS) {
      stale.push('docs/CHANGELOG.md');
    }
  } catch (_) {
    stale.push('docs/CHANGELOG.md (missing)');
  }

  if (stale.length > 0) {
    process.stderr.write(
      '[forge-session-end] End-of-session protocol reminder: source-modifying agent ran ' +
      'but the following files appear stale (>60 min): ' + stale.join(', ') + '. ' +
      'Run the documenter agent and update CHANGELOG before closing.\n',
    );
  }

  process.exit(0);
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
```

### `hooks/file-changed.js`
```javascript
'use strict';

// FileChanged hook — injects additionalContext when gate-pending.json or
// board.json change on disk, so Claude sees the updated pipeline state
// without needing an explicit read.
//
// Defensive on payload field name: Claude Code FileChanged payload field name
// was not confirmed in available documentation; the hook probes payload.file,
// payload.path, payload.filePath, and payload.file_path in order and uses
// the first non-empty string found. If none resolves, exits 0 silently.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir } = require('./hook-utils');

const STDIN_TIMEOUT_MS = 10000;

/**
 * Extract the changed file path from the payload using multiple candidate
 * field names, because the exact Claude Code FileChanged payload field is
 * not confirmed in documentation available at authoring time.
 *
 * @param {object} payload - parsed hook stdin payload
 * @returns {string} changed file path, or empty string if not found
 */
function resolveChangedFilePath(payload) {
  const candidates = ['file', 'path', 'filePath', 'file_path'];
  for (const key of candidates) {
    const val = payload[key];
    if (val && typeof val === 'string') return val;
  }
  return '';
}

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    process.exit(0);
    return;
  }

  const changedPath = resolveChangedFilePath(payload);
  if (!changedPath) {
    process.exit(0);
    return;
  }

  // Normalise to forward slashes for cross-platform suffix matching
  const normalised = changedPath.replace(/\\/g, '/');
  const isGatePending = normalised.endsWith('.pipeline/gate-pending.json');
  const isBoardJson = normalised.endsWith('.pipeline/board.json');

  if (!isGatePending && !isBoardJson) {
    process.exit(0);
    return;
  }

  const projectDir = resolveProjectDir(payload);
  let additionalContext = '';

  if (isGatePending) {
    try {
      const raw = await fs.promises.readFile(
        path.join(projectDir, '.pipeline', 'gate-pending.json'),
        'utf8',
      );
      const data = JSON.parse(raw);
      const gate = data.gate || 'unknown';
      const status = data.status || 'unknown';
      const feature = data.feature || 'unknown';
      additionalContext =
        '[FORGE] gate-pending.json changed: gate=' + gate +
        ' status=' + status +
        ' feature="' + feature + '".' +
        (status === 'approved'
          ? ' Gate is now approved — the next pipeline step may proceed.'
          : status === 'pending'
          ? ' Gate is pending — awaiting approval before the next step.'
          : '');
    } catch (_) {
      // File unreadable after change (e.g. deleted) — exit silently
      process.exit(0);
      return;
    }
  }

  if (isBoardJson) {
    additionalContext =
      '[FORGE] board.json changed externally — new TODOs or status changes ' +
      'may have been written. Use forge_read_board to see the current board state.';
  }

  if (additionalContext) {
    process.stdout.write(JSON.stringify({ additionalContext }));
  }

  process.exit(0);
}

// -- Stdin reader with timeout guard -----------------------------------------
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
```

## Files to modify

### `hooks/hooks.json`
**Change:** Insert `SessionEnd` and `FileChanged` entries before `SubagentStart`.

**Find:**
```json
    "SubagentStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.js\""
          }
        ]
      },
```

**Replace with:**
```json
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end.js\""
          }
        ]
      }
    ],
    "FileChanged": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/file-changed.js\""
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-start.js\""
          }
        ]
      },
```

## Blockers
- FileChanged payload field name is unconfirmed — hook probes `file`, `path`, `filePath`, `file_path` defensively; verify against a live Claude Code session and narrow `resolveChangedFilePath` if the actual field is known.
- FileChanged matcher requirement is unconfirmed — the hooks.json entry omits `matcher` (matching the pattern of `SessionEnd`); if Claude Code requires a glob to make `FileChanged` fire at all, add `"matcher": "**/.pipeline/*.json"` to the `FileChanged` entry.
- SessionEnd payload shape unconfirmed — hook relies only on `payload.cwd` via `resolveProjectDir`, which falls back to `process.cwd()` when absent; correctness is maintained regardless.

## Verification
- Both hooks call `process.exit(0)` followed by `return` on every early-exit branch to prevent async fall-through after the readline close handler.
- `file-changed.js` emits no stdout for non-matching paths; the stdout write is guarded by the `additionalContext` non-empty check.

## Doc hints
arch-update: true
decision: true

**Decision:** `file-changed.js` probes four candidate field names (`file`, `path`, `filePath`, `file_path`) rather than assuming one, because the Claude Code FileChanged payload shape was not confirmed at authoring time. The first non-empty string wins; if none resolves, the hook exits silently — fail-open, never blocking.
