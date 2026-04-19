# Handoff: gate-enforcement

## Overview

This implements `hooks/gate-enforcement.js`, a PreToolUse hook that mechanically blocks Agent-tool dispatches for the `coder` and `implementer` subagents unless the corresponding gate (`gate1` or `gate2` respectively) is recorded as approved in `.pipeline/gate-pending.json`. It backstops the `feedback_gate_approval.md` memory rule with mechanical enforcement after a live failure on 2026-04-18 where Gate #2 was collapsed into a status line with no human pause. The hook mirrors the structure of `hooks/routing-enforcement.js` exactly (CommonJS, readline+timeout, exitOk/exitBlock helpers, deny envelope).

---

## Files to create

### `hooks/gate-enforcement.js`

```javascript
'use strict';

// PreToolUse hook: enforce FORGE gate approvals before dispatching coder/implementer.
//
// WHY THIS EXISTS — 2026-04-18 live failure:
//   On two slices (observer-launcher, forge-config-migration), the main conversational
//   Claude reported reviewer verdicts and dispatched the implementer in the SAME turn,
//   collapsing Gate #2 into a status line with no human-in-loop pause.
//   The memory entry feedback_gate_approval.md was strengthened after the incident,
//   but the user explicitly requested mechanical enforcement — not just behavioral.
//
// WHAT THIS DOES:
//   Intercepts every Agent tool call. If the subagent_type is 'coder' (requires gate1
//   approved) or 'implementer' (requires gate2 approved), it reads
//   .pipeline/gate-pending.json and blocks the dispatch unless that gate is recorded
//   with status "approved".
//
// KNOWN LIMITATION:
//   This hook enforces that an approval *record exists on disk*, not that the orchestrator
//   actually presented the gate summary to the user and waited. The discipline of
//   presenting-and-waiting remains a behavioral constraint (memory + agent prompts).
//   A future improvement could cross-check gate.presentedAt against a session timestamp,
//   but that is out of scope here.
//
// TRIVIAL / SPRINT mode:
//   Both modes bypass gates by design (no reviewers, no approval steps). When
//   pipelineMode is 'TRIVIAL' or 'SPRINT', the hook exits cleanly with a stderr note.
//   Missing or malformed project.json: enforcement proceeds (safer default — do not
//   assume bypass when mode is unknown).

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STDIN_TIMEOUT_MS = 10_000;

const GATE_AGENTS = {
  'coder': 'gate1',
  'implementer': 'gate2',
};

// Modes that bypass gates by design.
const BYPASS_MODES = new Set(['TRIVIAL', 'SPRINT']);

function exitOk() { process.exit(0); }

function exitBlock(msg) {
  // PreToolUse deny envelope — honored by the Claude Code validator.
  // stderr + exit 2 as belt-and-suspenders fallback.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: msg,
      },
    }) + '\n'
  );
  console.error(msg);
  process.exit(2);
}

function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return { ok: false, missing: true, data: null };
  }
  try {
    return { ok: true, missing: false, data: JSON.parse(raw) };
  } catch (_) {
    return { ok: false, missing: false, data: null };
  }
}

async function main(rawInput) {
  // Step 1: parse payload — fail-open on parse error.
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  // Step 2: only interested in Agent tool calls.
  if (payload.tool_name !== 'Agent') { exitOk(); return; }

  // Step 3: extract subagent_type.
  const rawType = payload.tool_input && payload.tool_input.subagent_type;
  if (!rawType || typeof rawType !== 'string') { exitOk(); return; }

  // Step 4: normalize — strip 'forge:' prefix if present (defensive).
  const subagentType = rawType.startsWith('forge:') ? rawType.slice(6) : rawType;

  // Step 5: only coder and implementer cross gates.
  const requiredGate = GATE_AGENTS[subagentType];
  if (!requiredGate) { exitOk(); return; }

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

  // Step 8: read gate-pending.json.
  const gatePath = path.join(projectDir, '.pipeline', 'gate-pending.json');
  const gateResult = readJsonFile(gatePath);

  if (!gateResult.ok) {
    exitBlock(
      'FORGE: Gate ' + requiredGate + ' has not been recorded for subagent "' + subagentType + '". ' +
      'Write .pipeline/gate-pending.json with status:"approved" (via /forge:approve or the ' +
      'forge_set_gate MCP tool) before dispatching this agent.'
    );
    return;
  }

  const gate = gateResult.data;

  // Require gate field to match expected gate stage.
  if (gate.gate !== requiredGate) {
    exitBlock(
      'FORGE: .pipeline/gate-pending.json is for ' + gate.gate + ' but subagent "' + subagentType +
      '" requires ' + requiredGate + ' approved. Mismatched gate pending.'
    );
    return;
  }

  // Require approved status.
  if (gate.status !== 'approved') {
    exitBlock(
      'FORGE: Gate ' + requiredGate + ' is pending (not approved) for feature "' +
      (gate.feature || 'unknown') + '". Present the gate summary to the user and await ' +
      'explicit approval before dispatching the ' + subagentType + '.'
    );
    return;
  }

  // Step 9: gate is present, correct stage, and approved — allow.
  exitOk();
}

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

---

## Files to modify

### `hooks/hooks.json`

**Change:** Add a new PreToolUse entry for `gate-enforcement.js`, placed immediately after the existing `routing-enforcement.js` entry (which also matches "Agent"). Both hooks fire; that is correct — Claude Code runs all matching hooks.

**Find:**
```json
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/routing-enforcement.js\""
          }
        ]
      }
    ]
  }
}
```

**Replace with:**
```json
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/routing-enforcement.js\""
          }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/gate-enforcement.js\""
          }
        ]
      }
    ]
  }
}
```

---

### `docs/gotchas/GENERAL.md`

**Change:** Add a new section documenting the gate enforcement contract. Insert it immediately after the `## Hook scripts — stdin/stdout protocol` section (after the closing `---` of that section) and before the `## PostCompact hook` section.

**Find:**
```markdown
Always read stdin completely before processing. Use a readline + timeout pattern:

```js
const rl = readline.createInterface({ input: process.stdin });
let input = '';
rl.on('line', (line) => { input += line + '\n'; });
rl.on('close', () => { main(input).catch(() => process.exit(0)); });
```

---

## PostCompact hook — do not use for context reinjection
```

**Replace with:**
```markdown
Always read stdin completely before processing. Use a readline + timeout pattern:

```js
const rl = readline.createInterface({ input: process.stdin });
let input = '';
rl.on('line', (line) => { input += line + '\n'; });
rl.on('close', () => { main(input).catch(() => process.exit(0)); });
```

---

## Gate enforcement (mechanical, PreToolUse)

`hooks/gate-enforcement.js` blocks Agent-tool dispatches for `coder` and `implementer` unless the corresponding gate is approved on disk:

- **`coder`** requires `gate1` approved before dispatch.
- **`implementer`** requires `gate2` approved before dispatch.
- All other subagent types pass through unconditionally.
- `pipelineMode: TRIVIAL` or `SPRINT` bypasses gate checks (these modes have no reviewer gates by design) — a stderr note is logged.
- **To satisfy the hook:** write `.pipeline/gate-pending.json` with `{ "gate": "gate1"|"gate2", "status": "approved", "feature": "..." }` — use `/forge:approve` or the `forge_set_gate` MCP tool.
- Missing gate file, wrong gate stage, or non-approved status all produce an exit-2 deny with a descriptive block message.
- This hook enforces the *existence* of an approval record, not the discipline of presenting-and-waiting — that remains a behavioral constraint enforced by memory and agent prompts.

---

## PostCompact hook — do not use for context reinjection
```

---

### `docs/CHANGELOG.md`

**Change:** Prepend a new entry at the very top of the file (before the existing `## [2026-04-18] forge-config-migration` entry).

**Find:**
```markdown
## [2026-04-18] forge-config-migration: diff-aware auto-migration on SessionStart (Part A + Part B)
```

**Replace with:**
```markdown
## [2026-04-18] gate-enforcement: mechanical gate backstop for coder/implementer dispatch

### Motivation
On 2026-04-18, the main conversational Claude collapsed Gate #2 on two live slices
(observer-launcher, forge-config-migration) — reviewer verdicts and implementer dispatch
happened in the same turn with no human-in-loop pause. Memory entry `feedback_gate_approval.md`
was updated with stronger framing, but the user requested mechanical enforcement.

### Mechanism
- New `hooks/gate-enforcement.js` (PreToolUse, matches "Agent") blocks Agent dispatches for
  `coder` (requires gate1 approved) and `implementer` (requires gate2 approved).
- Reads `.pipeline/gate-pending.json`; blocks on missing file, wrong gate stage, or non-approved status.
- Bypasses enforcement for `pipelineMode: TRIVIAL` and `SPRINT` (no gates in those modes).
- Fails open on stdin parse errors; fails open on malformed project.json (unknown mode → enforce).
- All other subagent types pass through unconditionally.
- Registered in `hooks/hooks.json` as a second "Agent" PreToolUse matcher alongside `routing-enforcement.js`.

### Files changed
- `hooks/gate-enforcement.js` — new file (~130 lines)
- `hooks/hooks.json` — added gate-enforcement entry under PreToolUse → Agent
- `docs/gotchas/GENERAL.md` — added "Gate enforcement (mechanical, PreToolUse)" section

### Known limitation
The hook enforces existence of the approval record, not the discipline of presenting-and-waiting.
That behavioral guarantee remains in memory + agent prompts.

---

## [2026-04-18] forge-config-migration: diff-aware auto-migration on SessionStart (Part A + Part B)
```

---

## Edge cases handled

- **Missing gate file** (`gate-pending.json` absent): `exitBlock` with message explaining the gate must be written and approved before dispatch.
- **Malformed gate file** (invalid JSON): treated as missing — same `exitBlock` (the `readJsonFile` helper returns `ok: false` for both cases).
- **Wrong gate stage** (gate1 pending but dispatching `implementer` which needs gate2, or vice versa): `exitBlock` naming both the pending gate and the required gate.
- **Pending status** (`status !== "approved"`): `exitBlock` naming the feature and the agent, instructing to present and await explicit approval.
- **TRIVIAL mode**: `exitOk()` with stderr log `[gate-enforcement] pipelineMode TRIVIAL: gates bypassed by design`.
- **SPRINT mode**: same bypass as TRIVIAL.
- **Unknown pipelineMode** (e.g. a custom or future mode not in the bypass set): enforcement proceeds — safer default is to require a gate.
- **Missing project.json**: `readJsonFile` returns `ok: false, missing: true`; the `if (projectResult.ok && ...)` guard skips the bypass check; enforcement proceeds.
- **Malformed project.json**: same as missing — enforcement proceeds.
- **Non-pipeline subagent_type** (e.g. `researcher`, `reviewer-safety`, `documenter`, `planner`): `GATE_AGENTS[subagentType]` is `undefined`; hook calls `exitOk()` immediately.
- **Generic Agent use with no subagent_type or null**: guard `if (!rawType || typeof rawType !== 'string')` catches this; `exitOk()`.
- **`forge:` prefix on subagent_type** (defensive normalization): stripped before lookup so `forge:coder` and `coder` both enforce gate1.
- **stdin parse failure**: try/catch around `JSON.parse(rawInput)` calls `exitOk()` — fail-open.
- **`main()` unhandled throw**: `.catch(() => process.exit(0))` at both call sites — fail-open.

---

## Manual verification checklist

1. **No gate file → coder blocked:**
   Delete `.pipeline/gate-pending.json`. Dispatch `coder` subagent. Hook should block with "Gate gate1 has not been recorded" message.

2. **gate1 approved → coder passes:**
   Write `.pipeline/gate-pending.json` as `{"gate":"gate1","status":"approved","feature":"test"}`. Dispatch `coder`. Hook should allow (exit 0).

3. **gate1 approved, dispatch implementer → wrong gate stage blocked:**
   With gate1+approved still written, dispatch `implementer`. Hook should block with ".pipeline/gate-pending.json is for gate1 but subagent 'implementer' requires gate2" message.

4. **gate2 approved → implementer passes:**
   Write `.pipeline/gate-pending.json` as `{"gate":"gate2","status":"approved","feature":"test"}`. Dispatch `implementer`. Hook should allow.

5. **SPRINT mode bypass:**
   Write `.pipeline/project.json` with `{"pipelineMode":"SPRINT"}`. Delete or leave gate-pending.json absent. Dispatch `coder`. Hook should allow with stderr: `[gate-enforcement] pipelineMode SPRINT: gates bypassed by design`.

---

## Notes for Implementer

- The new `hooks/gate-enforcement.js` is standalone — no imports from other hooks, no new npm dependencies; only Node.js built-ins (`fs`, `path`, `readline`).
- The hooks.json edit adds a second "Agent" PreToolUse entry. Two hooks firing on the same matcher is valid and intentional — `routing-enforcement.js` runs first (listed first), then `gate-enforcement.js`. Both must exit 0 for the Agent call to proceed.
- Apply in this order: (1) create `hooks/gate-enforcement.js`, (2) edit `hooks/hooks.json`, (3) edit `docs/gotchas/GENERAL.md`, (4) edit `docs/CHANGELOG.md`.
- Hook changes require a Claude Code session restart to take effect.

---

## Self-review

- **Async:** `main()` is declared `async` to match the pattern from `routing-enforcement.js` but contains no `await` calls — all I/O uses synchronous `fs.readFileSync`. No async race conditions possible. Both call sites have `.catch(() => process.exit(0))` for any unhandled throws.
- **Error handling:** `readJsonFile` wraps `readFileSync` and `JSON.parse` in separate try/catch blocks, returning a structured `{ok, missing, data}` result. `main()` wraps the payload parse in try/catch. All unexpected error paths call `exitOk()` (fail-open). Intentional block paths call `exitBlock()`.
- **Edge cases:** Documented exhaustively in the section above — missing file, malformed JSON, wrong gate stage, pending status, TRIVIAL/SPRINT bypass, unknown mode, missing project.json, non-gated subagent types, `forge:` prefix normalization, null/empty subagent_type.
- **Return checks:** `readJsonFile` result checked via `if (!gateResult.ok)` before accessing `.data`. `gate.feature` uses `|| 'unknown'` fallback. `gate.gate` and `gate.status` are accessed only after the `gateResult.ok` guard.
- **No console.log:** Only `console.error()` for bypass-mode log and block message. `process.stdout.write` used only for the deny envelope JSON.
- **Scout gaps:** None — new standalone file, no cross-file dependencies to trace.

---

## Doc hints
arch-update: false
decision: false
