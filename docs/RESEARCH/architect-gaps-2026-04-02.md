# Architect Gaps Report — One Chat Phase 1 — 2026-04-02

This report covers functional gaps found in the Phase 1a + 1b implementation of One Chat intent
detection. Files audited: `src/main/handlers/intent.ts`, `src/renderer/src/stores/editor.svelte.ts`,
`src/renderer/src/components/prompt/PromptBar.svelte`,
`src/renderer/src/components/prompt/IntentConfirmRow.svelte`,
`src/main/handlers/runner.ts`, `src/renderer/src/lib/ipc.ts`.

---

## Gap 1 — TRIVIAL mode bypass fires BEFORE intent chips are consumed (ordering conflict)

**Severity: HIGH**

**File:** `src/renderer/src/components/prompt/PromptBar.svelte` lines 120–135

**What happens:**

The submit() function processes steps in this order:

1. Phase 1: no result yet → classify → show chips → `return`
2. Phase 2: result set, not confirmed → mark confirmed → **fall through**
3. TRIVIAL guard: if `proj.pipelineMode === 'trivial'` and mode is a pipeline type → print message and `return`
4. Build `pipelineModeOverride` from `intentResult`
5. Call `ipc.run()`

The TRIVIAL guard at step 3 fires **after** the user has already pressed Enter twice and
`intentConfirmed` has been set to `true`. This means:

- The run starts (step 3 `return` stops it) but `intentConfirmed` is left as `true` in the store.
- `intentResult` is also left populated (it is only cleared after `ipc.run()` on line 197).
- The third Enter now re-enters Phase 2, sees `intentResult !== null && !intentConfirmed` is
  `false`, falls through to the TRIVIAL guard again, prints the message again, and returns again —
  an infinite no-op loop until the user manually clears the chips.

**Root cause:** `clearIntentResult()` is only called on the success path (line 197, after `ipc.run()`).
If the TRIVIAL guard fires and returns early, neither `intentResult` nor `intentConfirmed` is
cleared.

**Fix needed:** Call `editorStore.clearIntentResult()` before returning in the TRIVIAL guard block,
or restructure so the TRIVIAL guard fires before the intent classification step (Phase 1).

---

## Gap 2 — IntentConfirmRow mode chip uses uppercase options, classifier returns lowercase

**Severity: MEDIUM**

**File:** `src/renderer/src/components/prompt/IntentConfirmRow.svelte` lines 21–22

```svelte
const MODE_OPTIONS = ['LEAN', 'STANDARD', 'FULL', 'SPRINT'];
```

The `mode` option values are uppercase strings (`'LEAN'`, `'STANDARD'`, etc.).

The classifier in `intent.ts` validates against `VALID_MODES` which contains lowercase values
(`'lean'`, `'standard'`, `'full'`, `'sprint'`, `'trivial'`), and returns lowercase in `IntentResult`.

**The `<select>` bind:** The `value` prop on the mode `<select>` is `intentResult.mode` (lowercase,
e.g. `'lean'`). The `<option value={m}>` elements carry uppercase (`'LEAN'`). In HTML, `<select>`
value matching is case-sensitive — the browser will not match `'lean'` against `<option value="LEAN">`,
so the selected option will always be blank/unselected on first render.

When the user changes the dropdown, `onmodechange` fires with the uppercase option value (e.g.
`'LEAN'`), which PromptBar stores in `overrideMode`. That uppercase string is then passed as
`pipelineModeOverride` to `ipc.run()`. In `runner.ts`, the validation does
`.toLowerCase()` before the set check, so `'LEAN'` → `'lean'` passes validation and works
correctly end-to-end — but the initial dropdown display is broken (no option visually selected).

**Fix needed:** Either lowercase the `MODE_OPTIONS` array to match the classifier output, or
uppercase `intentResult.mode` in the `value` prop. Lowercase is preferred for consistency with
the rest of the pipeline.

---

## Gap 3 — 'trivial' mode is missing from MODE_OPTIONS in IntentConfirmRow

**Severity: MEDIUM**

**File:** `src/renderer/src/components/prompt/IntentConfirmRow.svelte` line 22

```svelte
const MODE_OPTIONS = ['LEAN', 'STANDARD', 'FULL', 'SPRINT'];
```

`'trivial'` (or `'TRIVIAL'`) is absent from the dropdown options. The classifier can return
`mode: 'trivial'` for a single-file trivial fix. When this happens:

- `intentResult.mode` is `'trivial'`
- The mode `<select>` has no matching `<option>` — blank/unselected display
- If the user does not change the dropdown and presses Enter to confirm, `overrideMode` is `''`
  (initialized as empty string), so the override falls back to `intentResult.mode` via
  `(overrideMode || editor.intentResult.mode)` → `'trivial'`
- `pipelineModeOverride = 'trivial'` is passed to runner.ts
- In runner.ts, `'trivial'` passes `VALID_OVERRIDE_MODES.has('trivial')` → `validatedOverride = 'trivial'`
- The system prompt gets `PIPELINE MODE: TRIVIAL`

So the **end-to-end pipeline bypass happens via the system prompt injection** — the Claude
orchestrator sees `PIPELINE MODE: TRIVIAL` and is expected to bypass the pipeline. However, the
PromptBar TRIVIAL guard (Gap 1) would also fire, printing the "skip plan and implement" message
and returning early **before** `ipc.run()` is ever called.

Net result: when the classifier returns `trivial`, the user sees the intent chips with a blank
mode selector and then, on second Enter, sees the TRIVIAL bypass message instead of a run starting.
This is the intended TRIVIAL behaviour — but the blank dropdown is confusing UX.

**Fix needed:** Add `'trivial'` (or `'TRIVIAL'`) to `MODE_OPTIONS` so the detected mode is
visibly shown to the user before they confirm.

---

## Gap 4 — explore and direct pipeline types have no mode, but mode chip is always shown

**Severity: MEDIUM**

**File:** `src/renderer/src/components/prompt/IntentConfirmRow.svelte`

The classifier's `VALID_PIPELINES` set includes `'explore'` and `'direct'`. Both pipelines
run without a pipeline mode — `MODES` in `constants.ts` lists them as standalone entries with no
entry in `PIPELINES` or `PIPELINE_MODE_AGENTS`. There is no gate, no reviewers, and `PIPELINE MODE`
is irrelevant to them.

When the classifier returns `{ pipeline: 'explore', mode: 'lean' }` (which it can, because mode
validation is independent of pipeline), the IntentConfirmRow renders both a pipeline chip
(`explore`) and a mode chip (`lean`). The mode chip is misleading — it will be passed as
`pipelineModeOverride` into the runner, injected as `PIPELINE MODE: lean` into the system prompt,
but since explore runs as a single-agent chat-mode passthrough with no pipeline, the injected
mode line is ignored by the agent.

More importantly: if the classifier returns `{ pipeline: 'explore', mode: 'lean' }` and the
user's `editor.mode` is set to `plan feature`, the detected pipeline is ignored — `ipc.run()` is
called with `editor.mode` (the left-side mode selector), not with the detected pipeline. The intent
classification result's `pipeline` field changes only the display and the `pipelineModeOverride`;
it does not switch `editor.mode`.

**Root cause:** Phase 1 was designed to influence mode/intensity, not to change the pipeline type.
The classifier returning a different pipeline type than the user's mode selector is a classification
mismatch that the UI does not resolve — the detected pipeline chip is decorative in the current
implementation.

**Fix needed (two options):**
- Option A: Constrain the classifier prompt to only return pipeline types, not suggest switching
  pipelines — i.e. the classifier should only classify mode/intensity within the user's chosen
  pipeline type. This is the minimal Phase 1 design.
- Option B: When detected pipeline differs from `editor.mode`, offer to switch `editor.mode` as
  part of the confirmation flow.

The gap report for `explore`/`direct` no-mode case: show the mode chip only when the pipeline is
a `PIPELINES` key (i.e. has a gate). For explore/direct, hide the mode selector.

---

## Gap 5 — intentConfirmed is not reset when the user edits the prompt after chips appear

**Severity: LOW**

**File:** `src/renderer/src/components/prompt/PromptBar.svelte`

There is no `$effect` or `oninput` handler that calls `clearIntentResult()` when the user edits
the prompt text after classification chips have appeared but before pressing Enter to confirm.

If a user types a prompt, sees the chips, edits the prompt (e.g. adds more detail), then presses
Enter — `editor.intentResult` still holds the classification for the **original** prompt. The
run proceeds with stale intent chips and potentially the wrong `pipelineModeOverride`.

The textarea `oninput` handler only calls `editorStore.setPrompt()` — it does not clear the
intent result.

**Fix needed:** Clear `intentResult` (and `intentConfirmed`) on any prompt edit while chips are
visible. A `$effect` on `editor.prompt` that calls `clearIntentResult()` when
`editor.intentResult !== null` would suffice.

---

## Gap 6 — No keyboard shortcut to dismiss chips (Escape)

**Severity: LOW**

**File:** `src/renderer/src/components/prompt/PromptBar.svelte`

The `onKeydown` handler handles Enter, ArrowUp, ArrowDown. There is no Escape handler to dismiss
the intent chips (equivalent to clicking the "override" button). A user who wants to skip the
intent confirmation and submit immediately has to click "override" with the mouse — there is no
keyboard path to dismiss and revert to the immediate-submit behaviour.

**Fix needed:** Add `key === 'Escape'` handling in `onKeydown` that calls
`editorStore.clearIntentResult()` + resets `overridePipeline`/`overrideMode` when chips are
visible.

---

## Gap 7 — classifyIntent is not wired for 'apply feature', 'apply debug', 'apply refactor' modes

**Severity: LOW**

**File:** `src/renderer/src/components/prompt/PromptBar.svelte` lines 89–93

The `classifiableModes` list in submit() includes `'apply feature'`, `'apply debug'`,
`'apply refactor'`. These are apply-phase pipelines that run the implementer + documenter —
they have no mode-based reviewer branching (all pipeline modes return the same agent set:
`['implementer', 'documenter']`). Classification for these modes produces a `pipelineModeOverride`
that has zero effect on the agent list.

This means for every apply-phase run, a Haiku API call is made (with 5s timeout) before the run
starts — adding latency with no observable benefit.

**Fix needed:** Remove the three apply modes from `classifiableModes`. Classification is only
meaningful for pipelines where mode changes the active agent set.

---

## Summary table

| Gap | File | Severity | Type |
|-----|------|----------|------|
| 1 — TRIVIAL guard fires after confirmed, chips stuck | PromptBar.svelte | HIGH | Functional bug |
| 2 — Mode chip options are uppercase, classifier is lowercase | IntentConfirmRow.svelte | MEDIUM | Display bug |
| 3 — 'trivial' absent from MODE_OPTIONS | IntentConfirmRow.svelte | MEDIUM | Display bug |
| 4 — explore/direct have no mode, mode chip misleads + pipeline chip is decorative | IntentConfirmRow.svelte + classifier | MEDIUM | Design gap |
| 5 — Prompt edits after chips appear don't invalidate stale classification | PromptBar.svelte | LOW | UX bug |
| 6 — No Escape key to dismiss chips | PromptBar.svelte | LOW | UX gap |
| 7 — Apply-phase modes trigger unnecessary Haiku classification call | PromptBar.svelte | LOW | Performance waste |
