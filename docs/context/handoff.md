# Handoff: Fix stale run-active.json pointer pollution

## Overview

When a FORGE pipeline run finishes (status `completed`, `failed`, or `discarded`), two races cause `run-active.json` to remain on disk with stale content: (1) a new agent dispatch against the old `runId` still appends to the terminal run's `agents` array and refreshes `currentUnit`, and (2) `ctx-session-start.js` nulls out `currentUnit` rather than deleting the file, leaving a zero-identity stub that poisons `forge_get_active_run`. This fix adds a terminal-run guard in `subagent-start.js` (fail-open) and upgrades the cleanup in `ctx-session-start.js` from null-write to file deletion.

## Files to create

_(none)_

## Files to modify

### `hooks/subagent-start.js`

**Change:** Add `TERMINAL_STATUSES` constant and `readRunStatus` helper (copied verbatim from `ctx-session-start.js`) after `isForgeAgent` and before `main`. Then insert the terminal-run guard between the `isForgeAgent` check and the agents-push.

**Find (insertion point for helper — after `isForgeAgent` function, before `async function main`):**
```js
  return allowlist.has(normalized);
}

async function main(rawInput) {
```

**Replace with:**
```js
  return allowlist.has(normalized);
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'discarded']);

/**
 * Read the status of a run from the local registry at
 * .pipeline/runs/<runId>/run.json. Returns the status string or null when
 * the run file is absent, unreadable, unparseable, or missing a status.
 * Defensive — never throws.
 */
function readRunStatus(projectDir, runId) {
  if (!runId || typeof runId !== 'string') return null;
  try {
    const runPath = path.join(projectDir, '.pipeline', 'runs', runId, 'run.json');
    const raw = fs.readFileSync(runPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.status === 'string' ? parsed.status : null;
  } catch (_) {
    return null;
  }
}

async function main(rawInput) {
```

---

**Change:** Insert terminal-run guard between the `isForgeAgent` check and the agents-push in `main`.

**Find:**
```js
  if (!isForgeAgent(agentType)) {
    exitOk();
    return;
  }

  // Push new entry into agents array (mutate in-place)
  const nowTs = Date.now();
```

**Replace with:**
```js
  if (!isForgeAgent(agentType)) {
    exitOk();
    return;
  }

  // Terminal-run guard: if the run referenced by run-active.json is already
  // done (completed / failed / discarded), do not append to it — that would
  // re-animate a finished run and set a stale currentUnit. Fail-open: if
  // the registry is unreadable or the runId is absent, proceed as today.
  const runStatus = readRunStatus(projectDir, data.runId || null);
  if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
    process.stderr.write('[forge-subagent] skipping append to terminal run ' + (data.runId || '(unknown)') + '\n');
    exitOk();
    return;
  }

  // Push new entry into agents array (mutate in-place)
  const nowTs = Date.now();
```

---

### `hooks/ctx-session-start.js`

**Change:** In the terminal-run branch of `emitStaleUnitNoticeIfAny`, replace the `writeFileSync` null-write with `fs.unlinkSync` so the stale file is removed rather than left as a zero-identity stub.

**Find:**
```js
    if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
      try {
        data.currentUnit = null;
        fs.writeFileSync(runActivePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (_) {
        // Cleanup failed — fall through silently. We deliberately do NOT
        // emit the misleading notice in this case either; the marker just
        // stays on disk until the next cleanup attempt or a successful
        // start/stop cycle.
      }
      return false;
    }
```

**Replace with:**
```js
    if (runStatus && TERMINAL_STATUSES.has(runStatus)) {
      try {
        fs.unlinkSync(runActivePath);
      } catch (_) {
        // Cleanup failed — fall through silently. We deliberately do NOT
        // emit the misleading notice in this case either; the marker just
        // stays on disk until the next cleanup attempt or a successful
        // start/stop cycle.
      }
      return false;
    }
```

---

### `docs/gotchas/GENERAL.md`

**Change:** Add `## run-active.json lifecycle contract` section after the existing `## Pipeline state files` section (before `## Signal protocol`).

**Find:**
```markdown
---

## Signal protocol — bracket-prefix lines from agents
```

**Replace with:**
```markdown
---

## run-active.json lifecycle contract

`.pipeline/run-active.json` is a temporary pointer file tracking the in-progress pipeline run.

| Role | Owner |
|------|-------|
| Create / initialise | `forge_create_run` and `forge_resume_run` MCP tools |
| Append agent entries | `hooks/subagent-start.js` (SubagentStart event) |
| Delete on terminal run | `hooks/ctx-session-start.js` → `emitStaleUnitNoticeIfAny` |
| Clear `currentUnit` on agent stop | `hooks/subagent-stop.js` (SubagentStop event) |

**Terminal statuses:** `completed`, `failed`, `discarded`. Any run whose `run.json` carries one of these statuses is terminal.

**Fail-open rule:** if `run.json` is absent, unreadable, or unparseable, both hooks treat the run as non-terminal and proceed normally.

**Why delete, not null-write:** writing `{ currentUnit: null }` back to disk preserves the `runId` identity field, allowing `subagent-start.js` to read and re-append to a finished run on the next agent dispatch. Deletion is the cleanest teardown — `subagent-start.js` already exits silently when the file is absent (lines 74-81).

---

## Signal protocol — bracket-prefix lines from agents
```

---

### `docs/CHANGELOG.md`

**Change:** Prepend a new dated entry at the top of the file for the stale run-active.json fix.

**Find (first line of file):**
```markdown
## [2026-04-18] gate-enforcement: mechanical gate backstop for coder/implementer dispatch
```

**Replace with:**
```markdown
## [2026-04-19] fix(hooks): stale run-active.json pointer pollution

### Motivation
Two gaps caused `run-active.json` to persist stale content after a pipeline run finished:
1. `hooks/subagent-start.js` would append to the `agents` array of a terminal run (status `completed`/`failed`/`discarded`), re-animating it and setting a fresh `currentUnit`.
2. `hooks/ctx-session-start.js` cleared `currentUnit` by null-writing back to disk rather than deleting the file, leaving a zero-identity stub that passes the missing-file guard in `subagent-start.js`.

### Fix
- **`hooks/subagent-start.js`** — added `TERMINAL_STATUSES` and `readRunStatus` helper (identical logic to the existing copy in `ctx-session-start.js`). Inserted a terminal-run guard between the `isForgeAgent` check and the agents-push: if the run referenced by `run-active.json` is terminal, the hook logs a stderr note and exits without writing. Fail-open: unreadable or missing registry → proceed as before.
- **`hooks/ctx-session-start.js`** — in `emitStaleUnitNoticeIfAny`, replaced the `writeFileSync` (null-write) in the terminal branch with `fs.unlinkSync(runActivePath)`. The surrounding try/catch is kept; failure falls through silently.

### Rationale: deletion over null-write
Deleting the file is the correct teardown: (a) `subagent-start.js` already exits silently when the file is absent (lines 74-81), so absence is a safe terminal state; (b) null-writing preserves the `runId` identity field, allowing `subagent-start.js` to read and re-append to a finished run on the next agent dispatch.

### Files changed
- `hooks/subagent-start.js` — added helper + terminal-run guard
- `hooks/ctx-session-start.js` — delete-on-terminal in `emitStaleUnitNoticeIfAny`
- `docs/gotchas/GENERAL.md` — added `## run-active.json lifecycle contract` section

---

## [2026-04-18] gate-enforcement: mechanical gate backstop for coder/implementer dispatch
```

---

## Notes for Implementer

- Apply the two `hooks/subagent-start.js` edits in order: helper first, then the guard inside `main`. The second replacement is independent of line numbers but depends on the helper being present in the file.
- The `runActivePath` variable in `ctx-session-start.js` is already a local `const` inside `emitStaleUnitNoticeIfAny` (line 96). The `unlinkSync` call uses it directly — no new variable needed.
- The `readRunStatus` function uses synchronous `fs.readFileSync` to match the existing copy in `ctx-session-start.js`. The surrounding `main` in `subagent-start.js` is async, but synchronous reads are fine here — the helper is called once per hook invocation on a small JSON file.
- The CHANGELOG prepend: the entire block from `## [2026-04-19]` through the closing `---` is inserted before the existing first line. The rest of the file is untouched.

## Self-review

- **Async:** No new async calls. `readRunStatus` uses synchronous `fs.readFileSync` — intentional and safe (matches source pattern, called once per hook invocation). `fs.unlinkSync` is sync — `emitStaleUnitNoticeIfAny` is a sync function. No await/catch gaps introduced.
- **State mutations:** In `subagent-start.js` guard path: `data` is read but not mutated before early exit — clean. In `ctx-session-start.js` terminal branch: the previous `data.currentUnit = null` mutation is removed entirely; `unlinkSync` operates on the path string only.
- **Edge cases:**
  - `data.runId` absent or null: `readRunStatus` returns `null` immediately (guard: `if (!runId || typeof runId !== 'string') return null`). Guard condition `runStatus && ...` is false → fall through. Correct.
  - `run.json` missing: `readFileSync` throws, caught by try/catch, returns `null` → fall through. Correct.
  - `run.json` present but `status` field absent or non-string: returns `null` → fall through. Correct.
  - `unlinkSync` fails (file already deleted by concurrent cleanup, permissions): caught by try/catch, falls through silently. Correct.
  - Non-terminal run with stale `currentUnit`: unlink path not taken; existing stale-notice logic unchanged. Correct.
- **Return checks:** `readRunStatus` return is guarded with `if (runStatus && TERMINAL_STATUSES.has(runStatus))` — handles both `null` and non-terminal strings. Correct.
- **No `console.log`** — stderr only via `process.stderr.write`. Correct per GENERAL.md hook protocol.
- **No `.pipeline/` files in handoff** — confirmed. No board.json, features.json, or other pipeline config files referenced.

## Doc hints
arch-update: false
decision: true
