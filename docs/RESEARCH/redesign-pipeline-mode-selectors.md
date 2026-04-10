# Research: Redesign pipeline mode selectors

## Question: How do the current FREE mode CLI flags work in src/main/index.ts, specifically what allowedTools array is passed and how --dangerously-skip-permissions is set, so DIRECT mode can replicate pipeline-mode CLI flags?

**Finding:** The logic is in the `run-claude` IPC handler at `/src/main/index.ts` lines 267-270:

```ts
const isFree = mode === 'free'
const permissionFlags = isFree
  ? ['--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch,Task']
  : ['--dangerously-skip-permissions']
```

FREE mode passes `--allowedTools` with a comma-separated list of six read-only tools: `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`. All other modes (all pipeline modes) get `--dangerously-skip-permissions` — no additional flags. There is no `allowedTools` restriction for pipeline modes.

The `permissionFlags` array is spread directly into the `args` array at line 275 alongside `--output-format stream-json --verbose` and optional `--resume`/`--continue` flags.

**Source:** `/src/main/index.ts` lines 265-277

**Recommendation:** For DIRECT mode the coder only needs to change the `isFree` guard from `mode === 'free'` to `mode === 'explore'`. DIRECT falls through to the existing `--dangerously-skip-permissions` branch automatically — no new code path is needed. The plan's task 5 is correct as written.

---

## Question: How does run.svelte.ts set its default mode — does the file exist, and where is the default mode actually set?

**Finding:** The file `/src/renderer/src/stores/run.svelte.ts` exists and sets `mode: 'free'` as a hard-coded string literal at line 24 inside the `$state<RunState>` initialiser. This is a separate default from `editor.svelte.ts`.

`editor.svelte.ts` (line 25) sets `mode: MODES[0]` — it derives its default from the first element of the `MODES` tuple in `constants.ts`. After the rename of `'free'` to `'explore'` and reordering in constants, `editor.svelte.ts` will automatically reflect the new default with no change needed — but only if `MODES[0]` is `'explore'` after the constants update.

`run.svelte.ts` does NOT use `MODES[0]`. It has a raw `'free'` string literal. This is an additional rename site that the plan's task 3 correctly targets, but the plan says "update the default `mode` value from `'free'` to `'explore'`" — that is accurate and sufficient.

**Source:**
- `/src/renderer/src/stores/run.svelte.ts` line 24
- `/src/renderer/src/stores/editor.svelte.ts` lines 3-4, 25

**Recommendation:** The coder must update both files. `run.svelte.ts` line 24: change `mode: 'free'` to `mode: 'explore'`. `editor.svelte.ts` requires no change once constants are updated, because it uses `MODES[0]` — confirm this in task 4.

---

## Question: Does board.json already have a TODO with id 'a3b4c5d6' for the Haiku classifier, or does one need to be added?

**Finding:** The TODO entry already exists in `/.pipeline/board.json` at line 4. The full id is `a3b4c5d6-e7f8-4a9b-0c1d-2e3f4a5b6c7d`. The text reads: "Review and revise DIRECT mode intent routing — after DIRECT mode ships, test it against the behavioral eval set in `docs/RESEARCH/direct-mode-evals.md`; if misfires are frequent, consider promoting the guard to a dedicated pre-flight Haiku classifier". The entry has `"done": false`.

The plan's design decisions section (line 104) correctly states this entry already exists and no new TODO is needed.

**Source:** `/.pipeline/board.json` lines 3-8

**Recommendation:** No action needed. The coder should not add a new TODO entry for the Haiku classifier.

---

## Question: Does docs/RESEARCH/direct-mode-evals.md exist, and what are its eval categories?

**Finding:** The file exists at `/docs/RESEARCH/direct-mode-evals.md`. It contains five eval categories:

1. **Should PROCEED in DIRECT mode** — 10 cases (invoking agents, doc edits, analysis, read/explore, agent prompt review, git read, discussion, read+summarise, targeted agent edit, explanation)
2. **Should REDIRECT to `plan feature:`** — 5 cases (dark mode toggle, agent manager UI, pipeline visualiser, new DIRECT mode, session history persistence)
3. **Should REDIRECT to `debug:`** — 4 cases (blank LIVE tab, gate bar colour, Q&A strip broken, planner crash on import)
4. **Should REDIRECT to `refactor:`** — 3 cases (PromptBar component, agents store cleanup, App.svelte split)
5. **Edge cases — ambiguous intent** — 5 cases with acceptable-outcome ranges (planner smarter, planner reads modules.json, architect not reading modules.json, FORGE error handling, review and improve coder agent)

The file also includes a "How to run a review" procedure and a note that if the redirect rate on "Should PROCEED" cases exceeds ~10% or misfires on pipeline cases are non-zero, a pre-flight Haiku classifier should be considered.

**Source:** `/docs/RESEARCH/direct-mode-evals.md`

**Recommendation:** No changes needed to this file. The tester's task 14 in the plan correctly references the exact counts: 10 PROCEED, 5 plan feature redirect, 4 debug redirect, 3 refactor redirect, 5 edge cases.

---

## Additional finding: All 'free' literal rename sites in the renderer

The plan's research section asks for a complete grep of `'free'` across the codebase. All sites found:

| File | Line | Content |
|---|---|---|
| `/src/main/index.ts` | 267 | `const isFree = mode === 'free'` |
| `/src/renderer/src/lib/constants.ts` | 55 | `'free'` in `MODES` tuple |
| `/src/renderer/src/lib/runner.ts` | 10 | `mode: ModeId = 'free'` (default parameter) |
| `/src/renderer/src/lib/runner.ts` | 15 | `mode === 'free' ? prompt : ...` |
| `/src/renderer/src/lib/runner.ts` | 20 | `if (mode === 'free')` |
| `/src/renderer/src/stores/run.svelte.ts` | 24 | `mode: 'free'` (state initialiser) |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 20 | `{ id: 'free', label: 'FREE' }` |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 28 | `if (mode === 'free') return ''` |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 126 | `editor.mode === 'free'` (placeholder logic) |
| `/src/renderer/src/components/panels/FeatPanel.svelte` | 115 | `setMode('free')` (architect quick-launch button) |

The `FeatPanel.svelte` site at line 115 is not covered by the plan's task list. It is a call to `setMode('free')` on an architect quick-launch button. After the rename this should become `setMode('explore')`. The coder must handle this as an additional rename site.

`editor.svelte.ts` uses `MODES[0]` and contains no `'free'` literal — it will update automatically once constants change.

**Source:** grep across `/src/` for `'free'`

**Recommendation:** Add `FeatPanel.svelte` line 115 to the coder's task list as an additional rename site. Change `setMode('free')` to `setMode('explore')` there.

---

## Additional finding: template/CLAUDE.md — scope of update

**Finding:** The import handler in `/src/main/index.ts` at lines 765-770 always overwrites the project `CLAUDE.md` with `template/CLAUDE.md` during an import. The scaffold handler at lines 826-828 does the same during new project creation. Existing live projects (already imported/scaffolded before this change) will NOT automatically receive the updated `template/CLAUDE.md` — they keep whatever was written at import time.

**Source:** `/src/main/index.ts` lines 765-770, 826-828

**Recommendation:** The plan's design decisions correctly note that existing projects will not be updated unless the user re-imports. No code change is needed here. The tester should note this caveat in `docs/TESTING.md`.
