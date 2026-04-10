# Research: Planner yes/no questions — Technical Findings

Date: 2026-03-18
Researcher: Claude Code (claude-sonnet-4-6)
Source: Direct read of all relevant source files.

---

## 1. Signal parsing in App.svelte — `onStdout` implementation

**File:** `src/renderer/src/App.svelte` (lines 146–167)

`onStdout` is registered inside `onMount` via `ipc.onStdout(cb)`. The callback receives a raw text chunk (not a guaranteed single line), so it immediately splits on `\n` and loops over the resulting `lines` array.

The existing signal dispatch pattern for every line is:

```
for (const line of lines) {
  if (line.startsWith(SUGGEST_PREFIX)) { /* handle */ continue }
  if (line.startsWith(TODO_PREFIX))    { /* handle */ continue }
  // fall-through: append to terminal + runBuffer
  runBuffer += line + '\n'
  runStore.incrementLineCount()
  session.appendLine(line, lineType)
  if (lineType === 'agent') agentsStore.detectAgentTransition(line)
}
```

Both `[suggest]` and `[todo]` use `continue` after handling — they are consumed and never sent to the terminal. This is the exact pattern the `[questions]` / `[/questions]` block parser must follow.

**Prefix constants (declared at module scope):**
```ts
const SUGGEST_PREFIX = '[suggest] '   // line 91
const TODO_PREFIX    = '[todo] '      // line 92
```

**`runBuffer`** is a plain `let` string accumulating all non-signal lines for the current run (used by `detectGates` at `onDone` time). The buffer is reset to `''` at the end of `onDone`.

**`classifyLine(text)`** returns a `LineType` string (`'normal'` | `'prose'` | `'run-divider'` | `'agent'`). It is only called for lines that reach the fall-through — signal lines never go through it.

### What to add for `[questions]` parsing

Add two more module-scope constants:
```ts
const QUESTIONS_OPEN  = '[questions]'
const QUESTIONS_CLOSE = '[/questions]'
```

Add a module-scope accumulator:
```ts
let questionBuffer: string[] = []
let inQuestionBlock = false
```

Inside the `for (const line of lines)` loop, before the existing signal checks:
```ts
if (line.trim() === QUESTIONS_OPEN)  { inQuestionBlock = true;  continue }
if (line.trim() === QUESTIONS_CLOSE) {
  inQuestionBlock = false
  // parse + dispatch (see PLAN.md Task 5)
  continue
}
if (inQuestionBlock) { questionBuffer.push(line); continue }
```

Signal lines consumed with `continue` are never written to `runBuffer` or `session` — matching the `[suggest]` / `[todo]` precedent exactly.

---

## 2. `triggerRun` / run re-submission

**File:** `src/renderer/src/lib/runner.ts`

```ts
export function triggerRun(prompt: string, mode: ModeId = 'free'): void
```

Signature: two arguments — `prompt` (the raw user text, without the mode prefix) and `mode` (a `ModeId` — defaults to `'free'`).

Internally it:
1. Guards on `runStore.isRunning()` — returns early if a run is active.
2. Builds `fullPrompt = mode === 'free' ? prompt : \`${mode}: ${prompt}\``
3. Calls `runStore.startRun(prompt, mode, false)`
4. Initialises agent cards via `agentsStore.initAgents`
5. Calls `uiStore.clearChips()`
6. Appends a `▶ ${fullPrompt}` header line to the terminal
7. Fires `ipc.run(fullPrompt, projectFolder, mode, false, sessionId)`

**How `PlannerQaStrip.submitAnswers()` must call it:**

```ts
import { triggerRun } from '../../lib/runner'

// prompt is the bare feature description (no "plan feature: " prefix)
// mode is 'plan feature'
triggerRun(promptWithAnswers, 'plan feature')
```

`triggerRun` prepends `plan feature: ` automatically. The `[answers]` block should be appended to the bare prompt text, NOT to the mode-prefixed string.

**Important:** `triggerRun` calls `uiStore.clearChips()` — the `PlannerQaStrip` must call `uiStore.clearPlannerQa()` *before* calling `triggerRun`, so the strip disappears before the new run header line is appended.

---

## 3. `ui.svelte.ts` store — current shape

**File:** `src/renderer/src/stores/ui.svelte.ts`

### Current `UIState` interface (all fields):
| Field | Type | Notes |
|---|---|---|
| `activeTab` | `TabId` | active right-panel tab |
| `openModal` | `'settings' \| 'wizard' \| 'agent-editor' \| 'import' \| null` | |
| `chips` | `string[]` | suggestion chips |
| `isBlocked` | `boolean` | true when any modal is open |
| `rightPanelVisible` | `boolean` | sidebar collapse |
| `fontsReady` | `boolean` | |
| `pendingArchitectRun` | `boolean` | triggers architect in App.svelte |
| `pendingImportFileCount` | `number \| null` | |

### Exported actions:
`setActiveTab`, `openModal`, `closeModal`, `setChips`, `clearChips`, `toggleRightPanel`, `setFontsReady`, `requestArchitectRun`, `clearArchitectRun`, `setPendingImportFileCount`, `clearPendingImportFileCount`

### What the plan adds (Tasks 3 & 4):

New fields to add to `UIState`:
```ts
plannerQuestions:  PlannerQuestion[]        // new interface — see below
plannerAnswers:    Record<string, string>
plannerQaPending:  boolean                  // derived: questions.length > 0
pendingPlanPrompt: string | null
```

**Note on `plannerQaPending` definition:** The correct definition is `plannerQuestions.length > 0` only — no `&& not all answered` clause. The flag becomes `true` the moment questions are set and stays `true` until `clearPlannerQa()` is called, regardless of whether answers have been filled in. The "all answered" check lives in the SUBMIT button's `disabled` binding in `PlannerQaStrip` (`disabled={Object.keys(answers).length < questions.length}`), not in this flag.

New interface:
```ts
interface PlannerQuestion {
  id:      string
  text:    string
  options: string[]
}
```

New actions to add: `setPlannerQuestions`, `setPlannerAnswer`, `clearPlannerQa`, `setPendingPlanPrompt`.

**No conflicts** with existing fields. The `openModal` union type already contains `'import'` (added by the Import feature) — no further change needed for the Q&A feature.

---

## 4. `ChipsStrip.svelte` — render condition and mount

**File:** `src/renderer/src/components/prompt/ChipsStrip.svelte`

Mount condition: the outer `{#if ui.chips.length > 0}` block. The component is always present in the DOM (unconditionally imported in `LeftColumn.svelte`) but renders nothing when `chips` is empty.

**CSS traits relevant to `PlannerQaStrip`:**
- `flex-shrink: 0` — required so it doesn't collapse inside the flex column
- `border-top: 1px solid var(--border)` — separates it from the terminal above
- `background: var(--panel)` — standard panel bg
- Chip style: `font-family: var(--font-label)`, `font-size: 9px`, `font-weight: 600`, `letter-spacing: 0.05em`, gold border (`var(--gold)`), gold text, `border-radius: 2px`, `padding: 3px 10px`

`PlannerQaStrip` should use `flex-shrink: 0` and `background: var(--panel)` to occupy the same layout slot. The gold border/bg colour scheme from Gate1Bar is the target visual style (see Gate1Bar CSS below).

---

## 5. `App.svelte` layout — component hierarchy around input

**File:** `src/renderer/src/components/layout/LeftColumn.svelte`

```svelte
<div class="left-column">   <!-- flex-direction: column; flex: 1 -->
  <Terminal />              <!-- flex: 1; overflow-y: auto — fills all remaining space -->
  <Gate1Bar />              <!-- flex-shrink: 0; shown when gate1.status !== 'hidden' -->
  <Gate2Bar />              <!-- flex-shrink: 0; shown when gate2.status !== 'hidden' -->
  <ChipsStrip />            <!-- flex-shrink: 0; shown when ui.chips.length > 0 -->
  <PromptBar />             <!-- flex-shrink: 0; always visible -->
</div>
```

`PlannerQaStrip` replaces `ChipsStrip` in this slot (Task 9 in PLAN.md):

```svelte
{#if ui.plannerQuestions.length > 0}
  <PlannerQaStrip />
{:else}
  <ChipsStrip />
{/if}
```

Both Gate bars and `ChipsStrip` use `flex-shrink: 0` — `PlannerQaStrip` must do the same. `PromptBar` is always the last child and always visible.

**`App.svelte` itself** only renders `<LeftColumn />` and `<RightPanel />` inside `.app-body`; all prompt-area layout decisions live in `LeftColumn.svelte`. `App.svelte` is where `onStdout` / `onDone` handlers are registered.

---

## 6. `isRunning()` — export status

**File:** `src/renderer/src/stores/run.svelte.ts` (line 36)

```ts
export function isRunning() { return state.status === 'running' }
```

**Already exported.** Returns a plain boolean (not a Svelte rune/derived — it reads reactive `$state` directly so it will be reactive in Svelte component contexts).

`runner.ts` already calls `runStore.isRunning()` as a guard before submitting a run (line 13 of `runner.ts`). The `PlannerQaStrip` does not need to call this directly — `triggerRun` handles the guard internally. `PromptBar.svelte` derives its own local `isRunning` from `run.status === 'running'` rather than importing this function.

**PLAN.md Task 13 is a no-op** — `isRunning()` already exists and is exported.

---

## 7. Gate1Bar visual style (reference for PlannerQaStrip)

**File:** `src/renderer/src/components/gates/Gate1Bar.svelte`

Key CSS patterns to replicate in `PlannerQaStrip`:
```css
border-top: 1px solid color-mix(in srgb, var(--gold) 40%, transparent);
background: color-mix(in srgb, var(--gold) 5%, transparent);
padding: 8px 14px;
display: flex; flex-direction: column; gap: 6px;
```
Label: `font-family: var(--font-label); font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: var(--gold); text-transform: uppercase`
Summary text: `font-family: var(--font-mono); font-size: 10px; color: var(--dim)`
Action button: `border: 1px solid var(--gold); color: var(--gold); background: transparent; padding: 4px 12px`

---

## 8. `onDone` handler — current structure (for Task 6 guard placement)

**File:** `src/renderer/src/App.svelte` (lines 190–247)

```
onDone(raw) {
  normalise exitCode
  agentsStore.finishAllRunning()
  runStore.finishRun(info)
  session.appendLine('', 'run-divider')

  const mode = runStore.getRunState().mode
  if (['plan feature', 'implement feature', 'debug', 'refactor'].includes(mode)) {
    detectGates(mode, runBuffer)          // <-- guard here with !ui.plannerQaPending
  }

  if (info.exitCode === 0) {
    if (mode === 'plan feature') {        // <-- guard here too
      // promote todo → planned
    }
    if (mode === 'apply feature') { ... }
  }

  runBuffer = ''
  // reload modules from disk
}
```

**Where to insert abort guard (Task 12):**
After the gate detection block, NOT at the top of `onDone`:
```ts
if (info.exitCode !== 0) uiStore.clearPlannerQa()
```

**Why placement after gate detection matters:** If the abort guard runs before `detectGates`, it calls `clearPlannerQa()` which sets `plannerQaPending = false`. The `!ui.plannerQaPending` guard in the `detectGates` call site then passes, causing `detectGates` to fire on the aborted run with an empty or partial `runBuffer` — resulting in a spurious Gate 1. The guard must run after the gate detection block so `plannerQaPending` is still `true` during gate evaluation on aborted Q&A runs.

**Where to insert Q&A skip guard (Task 6):**
```ts
// In detectGates call site:
if (gateableModes.includes(mode) && !ui.plannerQaPending) {
  detectGates(mode, runBuffer)
}
// In plan feature promote block:
if (info.exitCode === 0 && mode === 'plan feature' && !ui.plannerQaPending) {
  // promote logic
}
```

The `ui` reference is `uiStore.getUIState()` — already called at module scope (line 22 of App.svelte) and assigned to `const ui`.

---

## 9. `pendingPlanPrompt` source value

When `[/questions]` is detected in `onStdout`, the plan requires:
```ts
uiStore.setPendingPlanPrompt(runStore.getRunState().prompt)
```

`runStore.getRunState().prompt` holds the **bare** prompt (without mode prefix). `runStore.startRun(prompt, mode, ...)` is called in both `PromptBar.submit()` and `triggerRun()` with the bare text. This is the correct value to store — `triggerRun` will re-add the `plan feature: ` prefix when re-submitting.

---

## Summary: gaps vs. existing code

| PLAN.md task | Status |
|---|---|
| Task 3 — add `plannerQuestions`, `plannerAnswers`, etc. to `ui.svelte.ts` | Not present — needs adding |
| Task 4 — add `pendingPlanPrompt` to `ui.svelte.ts` | Not present — needs adding |
| Task 5 — extend `onStdout` for `[questions]` block | Not present — needs adding |
| Task 6 — guard `onDone` gates/promote with `plannerQaPending` | Not present — needs adding |
| Task 7 — create `PlannerQaStrip.svelte` | Not present — new file |
| Task 8 — `submitAnswers()` using `triggerRun` | Not present — part of Task 7 |
| Task 9 — update `LeftColumn.svelte` to swap strips | Not present — needs editing |
| Task 10 — disable `PromptBar` while `plannerQaPending` | Not present — needs editing |
| Task 12 — `clearPlannerQa()` on non-zero exit | Not present — needs adding |
| Task 13 — `isRunning()` export | **Already done** — no-op confirmed |
