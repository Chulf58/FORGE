# Research: One Chat Phase 1b — Intent Confirmation UI

## Question 1: Does `triggerRun()` exist, and what is the call path for `ipc.run()`?

**Finding:** There is no `triggerRun()` function. The PromptBar component has an `async function submit()` (line 64 in PromptBar.svelte) that directly calls `ipc.run()`. The full call stack is:

1. **PromptBar.svelte line 64** — `async function submit()` is the entry point
2. **PromptBar.svelte line 108** — Direct call to `ipc.run(fullPrompt, projectFolder, editor.mode, editor.continueSession, sessionId)`
3. **src/renderer/src/lib/ipc.ts line 30-38** — Typed wrapper `export function run()` that delegates to `window.claude.run()`
4. **src/preload/index.ts** — contextBridge exposes the handler
5. **src/main/handlers/runner.ts line 53** — `ipcMain.handle('run-claude', ...)` receives the call with destructured parameters: `{ prompt, projectFolder, mode, continueSession, sessionId, testerEnabled }`

The call does NOT pass pipeline/mode overrides separately — the `mode` parameter is already the selected mode (e.g., `'plan feature'`, `'implement feature'`, `'direct'`, `'explore'`, etc.). This comes from `editor.mode` in the store, which is set by ModeRow callbacks.

**Implications for Intent Confirmation UI:**
- To add per-run intent override, `ipc.run()` would need two new optional parameters:
  - `overridePipelineType?: string` (to override the mode prefix like "plan feature")
  - `overridePipelineMode?: string` (to override the PIPELINE MODE injection like "lean", "standard", "full")
- These would thread through the preload, IPC signature, and main handler
- The main handler's `buildAgentsJson()` call (line 128) already reads `pipelineMode` from `project.json`, but could be overridden if a parameter is passed

**Source:** 
- `src/renderer/src/components/prompt/PromptBar.svelte` (lines 64, 108)
- `src/renderer/src/lib/ipc.ts` (lines 30-38)
- `src/main/handlers/runner.ts` (lines 53, 128)

**Recommendation:** For the Intent Confirmation UI feature, plan to add optional override parameters to `ipc.run()` if the user selects a non-default intent during Gate #1. The modal would need to capture the override and pass it through this chain before submission.

---

## Question 2: What is the current shape of `ipc.run()` signature — does it accept pipeline/mode overrides?

**Finding:** The `ipc.run()` function currently has this signature (src/renderer/src/lib/ipc.ts lines 30-38):

```typescript
export function run(
  prompt: string,
  folder: string,
  mode: string,
  continueSession = false,
  sessionId: string | null = null,
  testerEnabled = false,
): Promise<RunResult> {
  return c().run(prompt, folder, mode, continueSession, sessionId, testerEnabled)
}
```

The `ClaudeAPI` type (src/renderer/src/types/claude.d.ts lines 243-250) defines:

```typescript
run(
  prompt: string,
  folder: string,
  mode: string,
  continueSession: boolean,
  sessionId: string | null,
  testerEnabled?: boolean
): Promise<RunResult>
```

**Current parameters:**
- `prompt` — the full prompt with mode prefix (e.g., "plan feature: do X")
- `folder` — project folder path
- `mode` — the pipeline/mode ID (e.g., "plan feature", "direct", "explore")
- `continueSession` — whether to reuse the active session
- `sessionId` — active session ID if continuing
- `testerEnabled` — optional boolean to include tester agent

**No pipeline/mode overrides currently exist.** The `mode` parameter is the only pipeline selector, and the PIPELINE MODE value (lean/standard/full) comes from reading `project.json` in the main process (src/main/shared.ts line 1160).

**Source:** 
- `src/renderer/src/lib/ipc.ts` (lines 30-38)
- `src/renderer/src/types/claude.d.ts` (lines 243-250)
- `src/main/shared.ts` (lines 1157-1160, 1266-1267)

**Recommendation:** To support per-run intent override, add two optional parameters:
- `pipelineModeOverride?: string` — if present, inject this instead of reading from project.json
- This requires updating both the renderer-side `ipc.run()` wrapper and the preload/main handler signatures

---

## Question 3: How does ModeRow work — what props does it accept and is there a pattern for conditional visibility?

**Finding:** ModeRow (src/renderer/src/components/prompt/ModeRow.svelte) is a straightforward selector component that:

**Props (lines 5-19):**
```typescript
{
  mode: ModeId,                           // Currently selected mode
  pipelineMode: string,                   // Project's PIPELINE MODE (lean/standard/full)
  sessionId: string | null,               // Active session ID (if any)
  continueSession: boolean,               // Whether to reuse session
  onmodechange: (mode: ModeId) => void,   // Callback when user selects a mode
  oncontinuechange: (val: boolean) => void // Callback when continue checkbox toggled
}
```

**Rendering (lines 26-50):**
- A flexbox row with mode buttons (lines 27-35) that loop through `USER_MODES` from `src/renderer/src/lib/promptHelpers`
- Each button calls `onmodechange(m.id)` on click
- A spacer div (line 37)
- A conditional "SAME SESSION" checkbox (line 39-48) that only renders if `sessionId` is truthy

**Button disabled state (line 21-23):**
```typescript
function isModeDisabled(_m: ModeId): boolean {
  return false;
}
```

Currently always returns `false` — all modes are always enabled. This is the hook for conditionally disabling modes.

**Styling:**
- Mode-specific active colors defined by CSS data attributes (lines 85-109)
  - "explore" and "sprint" use blue
  - "direct" uses green
  - Default/pipeline modes use gold

**Usage in PromptBar (lines 199-206):**
```svelte
<ModeRow
  mode={editor.mode}
  pipelineMode={proj.pipelineMode}
  sessionId={run.sessionId}
  continueSession={editor.continueSession}
  onmodechange={(m) => editorStore.setMode(m)}
  oncontinuechange={(v) => editorStore.setContinueSession(v)}
/>
```

**Conditional visibility pattern:** ModeRow itself has no built-in visibility toggling. The pattern in the codebase for conditionally hiding rows is `{#if condition}` blocks wrapping components. For example, the continue session checkbox (line 39) uses `{#if sessionId}`.

**Source:** 
- `src/renderer/src/components/prompt/ModeRow.svelte` (complete file)
- `src/renderer/src/components/prompt/PromptBar.svelte` (lines 199-206)

**Recommendation:** 
- ModeRow is flexible and minimal — it can already be hidden with `{#if condition}` if needed
- The `isModeDisabled()` function can be extended to disable specific modes (e.g., prevent non-intent-selected modes during Gate #1 confirmation)
- No changes to ModeRow are required for Intent Confirmation UI; the feature would live in a separate modal that appears before or overlaying the PromptBar
- If intent override modal needs to present a "preview" of the effective mode, it would read from the same `ModeId` type and `USER_MODES` list

---

## Summary: Technical Readiness for Intent Confirmation UI

| Component | Readiness | Notes |
|-----------|-----------|-------|
| IPC run() signature | **NEEDS CHANGES** | Add optional override parameters for pipeline/mode |
| PromptBar submit() flow | **READY** | Direct, clean path; no refactoring needed |
| ModeRow component | **READY** | Minimal, flexible; can be conditionally shown/hidden |
| Pipeline definition constants | **READY** | PIPELINES and USER_MODES already exported and usable |
| Main process mode handling | **READY** | buildAgentsJson() already reads pipelineMode; just needs override param |

The architecture is well-structured for adding per-run intent override. The main work is threading new optional parameters through the IPC boundary.
