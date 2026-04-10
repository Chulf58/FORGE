# FORGE — Testing History

Test entries archived from docs/TESTING.md when the file exceeds 400 lines.

---
## Test: Mode buttons — FREE renamed to EXPLORE, DIRECT added — 2026-03-19

**Prerequisites:**
- App is running (`npm run dev` or production build).
- A FORGE project is configured in Settings.

---

### Happy path — button labels match new mode names

- [ ] Start a run with mode EXPLORE (previously FREE) → terminal shows `[mode: explore]` line and run executes in explore mode.
- [ ] Start a run with mode DIRECT → terminal shows `[mode: direct]` line and run executes in direct mode.
- [ ] Start a run with mode PLAN FEATURE → terminal shows `[mode: plan feature]`.
- [ ] Confirm EXPLORE mode runs Claude without a pipeline and does not attempt to read `docs/PLAN.md` or write to `.pipeline/`.

---

### UI button consistency

- [ ] Mode dropdown in PromptBar shows all eight modes: PLAN FEATURE, IMPLEMENT FEATURE, APPLY FEATURE, DEBUG, APPLY DEBUG, REFACTOR, APPLY REFACTOR, EXPLORE, DIRECT.
- [ ] Mode dropdown buttons are in the same order as defined in `lib/constants.ts` MODES array.
- [ ] Selecting each mode from the dropdown updates the PromptBar's displayed mode.

---

### No regression — existing modes still work

- [ ] Plan feature, implement feature, apply feature, debug, apply debug, refactor, and apply refactor modes all still run without errors.
- [ ] Gate #1 appears after plan feature → review → done.
- [ ] Gate #2 appears after implement feature → review → done.
- [ ] Pressing YES on Gate #1 or Gate #2 initiates the next pipeline step.

---

_Last updated: 2026-03-19_

---

## Test: Mode buttons — FREE renamed to EXPLORE, DIRECT added — 2026-03-19

**Prerequisites:**
- App is running (`npm run dev` or production build).
- A FORGE project is configured in Settings.

---

### Happy path — button labels match new mode names

- [ ] Start a run with mode EXPLORE (previously FREE) → terminal shows `[mode: explore]` line and run executes in explore mode.
- [ ] Start a run with mode DIRECT → terminal shows `[mode: direct]` line and run executes in direct mode.
- [ ] Start a run with mode PLAN FEATURE → terminal shows `[mode: plan feature]`.
- [ ] Confirm EXPLORE mode runs Claude without a pipeline and does not attempt to read `docs/PLAN.md` or write to `.pipeline/`.

---

### UI button consistency

- [ ] Mode dropdown in PromptBar shows all eight modes: PLAN FEATURE, IMPLEMENT FEATURE, APPLY FEATURE, DEBUG, APPLY DEBUG, REFACTOR, APPLY REFACTOR, EXPLORE, DIRECT.
- [ ] Mode dropdown buttons are in the same order as defined in `lib/constants.ts` MODES array.
- [ ] Selecting each mode from the dropdown updates the PromptBar's displayed mode.

---

### No regression — existing modes still work

- [ ] Plan feature, implement feature, apply feature, debug, apply debug, refactor, and apply refactor modes all still run without errors.
- [ ] Gate #1 appears after plan feature → review → done.
- [ ] Gate #2 appears after implement feature → review → done.
- [ ] Pressing YES on Gate #1 or Gate #2 initiates the next pipeline step.

---

_Last updated: 2026-03-19_

---

## Test: Documenter — scaffold Step 0 conditions checks in documenter.md — 2026-03-19

**What this fix does:** Adds step 0 to documenter.md. This step reads `docs/ARCHITECTURE.md` (if present), checks for two conditions: whether it mentions Typescript/architecture-level decisions (needs_architecture_update), and whether it lacks a "## Decisions" section (needs_decisions_entry). The conditional gates in Steps 2 and 3 then use these flags to skip optional ARCHITECTURE.md and DECISIONS.md edits.

---

### Static file checks — Step 0 structure

File: `C:/Users/cuj/Forge/.claude/agents/documenter.md`

- [ ] Step 0 defines `needs_architecture_update` and `needs_decisions_entry` boolean flags.
- [ ] `### 2. docs/ARCHITECTURE.md` section has skip gate: "If `needs_architecture_update` is false, skip this section entirely."
- [ ] `### 3. docs/DECISIONS.md` section has skip gate: "If `needs_decisions_entry` is false, skip this section entirely."
- [ ] `### 1. docs/CHANGELOG.md` section has lazy-read note (read first 20 lines to find insertion point).

---

_Last updated: 2026-03-19_

---

## Test: Reviewer agents write-access removed — 2026-03-19

**What this fix does:** Removes `Write` from the frontmatter `tools:` list of all five reviewer agents and deletes their `## Knowledge persistence` sections. Reviewers are now strictly read-only.

---

### Static file checks — frontmatter tool lists

- [ ] `reviewer.md` — tools list contains only `Read`, `Glob`, `Grep`. No `Write`.
- [ ] `reviewer-safety.md` — tools list contains only `Read`, `Glob`, `Grep`. No `Write`.
- [ ] `reviewer-logic.md` — tools list contains only `Read`, `Glob`, `Grep`. No `Write`.
- [ ] `reviewer-style.md` — tools list contains only `Read`, `Glob`, `Grep`. No `Write`.
- [ ] `reviewer-performance.md` — tools list contains only `Read`, `Glob`, `Grep`. No `Write`.

---

### Static file checks — Knowledge persistence removed

- [ ] `reviewer.md` — no `## Knowledge persistence` section.
- [ ] `reviewer-safety.md` — no `## Knowledge persistence` section.
- [ ] `reviewer-logic.md` — no `## Knowledge persistence` section.
- [ ] `reviewer-style.md` — no `## Knowledge persistence` section.
- [ ] `reviewer-performance.md` — no `## Knowledge persistence` section.

---

### Existing sections intact

- [ ] Each reviewer still has its `## What NOT to do` section with "Do not modify source files" instruction.
- [ ] Each reviewer still has its `## Output format` section with `APPROVED`, `REVISE`, `BLOCK` verdicts.

---

### No source file changes

- [ ] `src/main/index.ts` — not modified.
- [ ] `src/preload/index.ts` — not modified.
- [ ] `src/renderer/src/lib/ipc.ts` — not modified.
- [ ] No `.svelte` files modified.
- [ ] `docs/gotchas/GENERAL.md` — not written to by reviewers during review pass.

---

### Regression — reviewer pipeline still produces verdicts

- [ ] Trigger `implement feature:` with a valid handoff. Confirm all invoked reviewer agents produce a verdict (`APPROVED`, `REVISE`, or `BLOCK`).
- [ ] Confirm no reviewer writes to any file during the review pass.
- [ ] Gate #2 still appears after APPROVED verdicts; Gate #2 remains blocked when any reviewer returns BLOCK.

---

_Last updated: 2026-03-19_

---

## Test: debug: Documenter agent has a stale hardcoded module list — 2026-03-19

**What this fix does:** Replaces the 14-entry hardcoded module list in Section 5 of `documenter.md` with an instruction to read `.pipeline/modules.json` dynamically.

---

### Static file check — documenter.md Section 5

- [ ] Old hardcoded bullet list is gone (no `terminal`, `live-panel`, `feat-panel`, `pipeline`, `wizard`, etc.).
- [ ] Replacement instruction present: `**To identify valid module IDs and names, read \`.pipeline/modules.json\` before acting on this step.**`
- [ ] Instruction states: `Use only IDs that appear in that file — never infer or invent a module ID from context.`

---

### Static file check — modules.json

- [ ] `.pipeline/modules.json` is valid JSON.
- [ ] Contains entries with correct IDs: `pipeline-system`, `terminal-output`, `gate-system`, `task-board`, `feature-registry`, `settings`, `health-tooling`, `prompt-run-controls`, `agent-manager`, `run-monitor`, `project-management`.
- [ ] Stale IDs (`terminal`, `pipeline`, `live-panel`, `feat-panel`, etc.) are **not** present.

---

### Edge case — modules.json absent

- [ ] Temporarily rename `modules.json`. Trigger `apply feature:`. Confirm Documenter does not crash — graceful skip or warning.
- [ ] Restore file after test.

---

_Last updated: 2026-03-19_

---

## Test: debug: Tester agent does not handle TESTING.md creation edge case — 2026-03-19

**What this fix does:** Adds a guard to step 3 of `tester.md`: if `docs/TESTING.md` does not exist, create it with the header `# FORGE — Manual Test Checklist` before appending.

---

### Static file check — guard clause

File: `C:/Users/cuj/Forge/.claude/agents/tester.md`

- [ ] Step 3 in `## What to read first` contains: `If the file does not exist, create it with exactly this content before appending:`
- [ ] Indented content block immediately after reads: `# FORGE — Manual Test Checklist`
- [ ] Guard is part of step 3, not a new step — numbering remains 1, 2, 3.
- [ ] The string `If the file does not exist` appears exactly once in the file.

---

### New-project creation path

- [ ] Rename `docs/TESTING.md` to `docs/TESTING.md.bak`. Trigger `apply feature:`. Confirm Tester creates `docs/TESTING.md` with `# FORGE — Manual Test Checklist` as line 1. Restore backup after.

---

### Existing-file path — no regression

- [ ] With `docs/TESTING.md` present, trigger `apply feature:`. Confirm existing content is intact and new section is appended at the end.

---

_Last updated: 2026-03-19_

---

## Test: Switch Tester, Documenter, and Reviewer-Performance to Haiku Model — 2026-03-19

**What this feature does:** Changes the `model:` frontmatter field in three agent files from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001`. No prompt content, tool lists, source files, IPC channels, or stores are affected. This is a one-line change per file.

---

### Static file checks — model field values

- [ ] Open `C:/Users/cuj/Forge/.claude/agents/tester.md`. Line 4 reads exactly: `model: claude-haiku-4-5-20251001`.
- [ ] Open `C:/Users/cuj/Forge/.claude/agents/documenter.md`. Line 4 reads exactly: `model: claude-haiku-4-5-20251001`.
- [ ] Open `C:/Users/cuj/Forge/.claude/agents/reviewer-performance.md`. Line 4 reads exactly: `model: claude-haiku-4-5-20251001`.
- [ ] Confirm the string `claude-sonnet-4-6` does **not** appear in any of the three files above.

---

### Static file checks — unchanged content

- [ ] `tester.md` tools list still reads: `Read`, `Write`, `Glob`, `Grep` — no tools added or removed.
- [ ] `documenter.md` tools list still reads: `Read`, `Write`, `Glob`, `Grep` — no tools added or removed.
- [ ] `reviewer-performance.md` tools list still reads: `Read`, `Glob`, `Grep` — no tools added or removed, `Write` is still absent.
- [ ] `tester.md` description line is unchanged: `Writes a manual test checklist to docs/TESTING.md after implementation. Second agent in the apply pipeline.`
- [ ] `documenter.md` description line is unchanged: `Updates CHANGELOG.md, ARCHITECTURE.md, and DECISIONS.md after a feature is implemented and tested. Also maintains .pipeline/board.json and .pipeline/features.json. Last agent in the apply pipeline.`
- [ ] `reviewer-performance.md` description line is unchanged: `Performance check on the plan or implementation handoff. Flags patterns that would cause sluggish UI, blocking I/O, memory leaks, or unscalable data loads. Runs conditionally in plan feature and implement feature pipelines.`

---

### Unchanged agents — Sonnet agents not touched

- [ ] `C:/Users/cuj/Forge/.claude/agents/implementer.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/coder.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/planner.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/researcher.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/reviewer-triage.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/debug.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/refactor.md` — line 4 still reads `model: claude-sonnet-4-6`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/architect.md` — line 4 still reads `model: claude-sonnet-4-6`.

---

### Unchanged agents — already-Haiku agents not double-changed

- [ ] `C:/Users/cuj/Forge/.claude/agents/reviewer.md` — line 4 reads `model: claude-haiku-4-5-20251001` (was already Haiku; confirm still correct).
- [ ] `C:/Users/cuj/Forge/.claude/agents/reviewer-logic.md` — line 4 reads `model: claude-haiku-4-5-20251001`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/reviewer-safety.md` — line 4 reads `model: claude-haiku-4-5-20251001`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/reviewer-style.md` — line 4 reads `model: claude-haiku-4-5-20251001`.
- [ ] `C:/Users/cuj/Forge/.claude/agents/gotcha-checker.md` — line 4 reads `model: claude-haiku-4-5-20251001`.

---

### No source file changes

- [ ] `src/main/index.ts` — not modified (run `git diff src/main/index.ts` and confirm no output).
- [ ] `src/preload/index.ts` — not modified.
- [ ] `src/renderer/src/lib/ipc.ts` — not modified.
- [ ] No `.svelte` files modified.
- [ ] No `.ts` store or component files modified.

---

### Regression — apply pipeline still runs end-to-end

- [ ] Trigger a full `implement feature:` → reviewer pass → `apply feature:` pipeline run. Confirm the Tester agent runs and appends a checklist section to `docs/TESTING.md`.
- [ ] Confirm the Documenter agent runs and appends a CHANGELOG entry to `docs/CHANGELOG.md`.
- [ ] Confirm the reviewer-performance agent runs (when triggered by the reviewer-triage dispatch) and produces a verdict line containing `APPROVED`, `REVISE`, or `BLOCK` — not a parse error or empty output.
- [ ] Confirm Gate #2 still appears after the reviewer pass completes with all APPROVED verdicts.
- [ ] Confirm Gate #2 is blocked (YES button disabled) if reviewer-performance returns `BLOCK`.

---

### Quality signal monitoring (first run after this change)

- [ ] Tester output: inspect the checklist section added to `docs/TESTING.md`. Confirm checklist items are concrete actions with expected results, not vague or missing. Flag if more than 2 items lack a specific expected result.
- [ ] Documenter output: inspect `docs/CHANGELOG.md` — confirm the new entry is correctly formatted (version header, date, feature description). Inspect `.pipeline/features.json` — confirm the JSON structure is valid and the new feature entry is present. Inspect `.pipeline/board.json` — confirm the `todos[]` array was not accidentally modified.
- [ ] Reviewer-performance output: inspect the performance review section in the handoff notes. Flag if a `BLOCK` verdict is issued on a benign pattern (false positive), or if an obvious blocking pattern (`readFileSync` in IPC handler) receives `APPROVED` (false negative). Flag if the verdict block is malformed and cannot be parsed by the downstream pipeline.

---

_Last updated: 2026-03-19_

---

## Test: TESTING.md Archival — 2026-03-19

**What this feature does:** Adds `## Step 7 — TESTING.md archival` to `.claude/agents/documenter.md`. After every apply run, if `docs/TESTING.md` exceeds 400 non-empty lines (measured via Grep count), the Documenter splits the file at `## Test:` boundaries, moves all but the last 3 entries to `docs/archive/TESTING_HISTORY.md` (prepend into that file after its header `---`), and rewrites `docs/TESTING.md` with the canonical 5-line header plus the 3 most recent entries. The `## Output signal` section is also updated to four variants that cover the archival-ran and no-archival cases for both `feature` and `debug`/`refactor` modes.

**Prerequisites:**
- `C:/Users/cuj/Forge/.claude/agents/documenter.md` is the modified file — no source files changed.
- `docs/archive/` directory exists (confirmed: `PLAN_HISTORY.md` is present there).
- `docs/TESTING.md` currently has 612 lines — archival threshold (400 non-empty lines) is already exceeded, so the next apply run will trigger archival.

---

### Static file checks — Step 7 structure

File: `C:/Users/cuj/Forge/.claude/agents/documenter.md`

- [ ] Open the file. Confirm `## Step 7 — TESTING.md archival` section exists between the end of the Step 6 body and `## What NOT to do`.
- [ ] Step 7 sub-step (a) reads: "Use Grep with `output_mode: "count"` on `docs/TESTING.md`, pattern `.*`, to count matching (non-empty) lines. If the result is 400 or fewer, skip this step entirely."
- [ ] Step 7 sub-step (b) reads: use Glob with pattern `docs/archive/` to confirm the directory exists — if absent, emit the warning line and skip.
- [ ] The warning line text is exactly: `[archival] WARNING: docs/archive/ not found — TESTING.md archival skipped. Create docs/archive/ manually to enable archival.`
- [ ] Step 7 sub-step (d) defines the header block as everything before the first `^## Test:` line, and each entry as starting at `^## Test:` and ending before the next `^## Test:`.
- [ ] Step 7 sub-step (e) specifies keep set = last 3 entries, archive set = all earlier entries, and includes the guard: if N ≤ 3, skip steps (f) and (g) entirely.
- [ ] Step 7 sub-step (f) specifies the `TESTING_HISTORY.md` initial header template (5 lines: heading, blank, description sentence, blank, `---`).
- [ ] Step 7 sub-step (g) specifies that `docs/TESTING.md` is rewritten as: header block verbatim, one blank line, then keep set entries in original order.

---

### Static file checks — Output signal section

File: `C:/Users/cuj/Forge/.claude/agents/documenter.md`

- [ ] `## Output signal` section contains **four** variants (not two).
- [ ] Variant 1: `apply feature:` with no archival → `Feature <name> documented. Changelog, Architecture, Plan, and board updated.`
- [ ] Variant 2: `apply feature:` when archival ran → ends with `TESTING.md trimmed to 3 entries; <N_archived> entries moved to TESTING_HISTORY.md.`
- [ ] Variant 3: `apply debug:` or `apply refactor:` with no archival → `<name> documented. Changelog, Architecture updated. Logged to features.json (no planned item removed — debug/refactor mode).`
- [ ] Variant 4: `apply debug:` or `apply refactor:` when archival ran → ends with `TESTING.md trimmed to 3 entries; <N_archived> entries moved to TESTING_HISTORY.md.`
- [ ] The old two-variant output signal (feature / debug+refactor with no archival variants only) is **not** present — the section has been fully replaced.

---

### Static file checks — What NOT to do and preceding content

- [ ] `## What NOT to do` section is unchanged (same 7 bullet points as before this change).
- [ ] The last line of the Step 6 body (`Do NOT emit this for \`debug\` or \`refactor\` modes — \`""\` is correct and expected there.`) is still present immediately before `## Step 7`.
- [ ] No content from lines 1–166 (everything before Step 7) was altered — confirm by checking that `## Step 0`, `## Files to update`, `## Step 5`, and `## Step 6` headings are all still present and intact.

---

### Happy path — archival triggers on next apply run

**Note:** `docs/TESTING.md` currently has 612 lines, which already exceeds the 400-line threshold. The very next `apply feature:` run will trigger archival. Run a minimal apply (e.g. ship any small feature through the pipeline) and observe the following:

- [ ] After the apply run completes, the Documenter's terminal output contains the archival variant of the output signal — e.g. `Feature <name> documented. ... TESTING.md trimmed to 3 entries; <N> entries moved to TESTING_HISTORY.md.`
- [ ] Open `docs/TESTING.md`. Confirm it contains exactly: the 5-line header block (`# FORGE — Manual Test Checklist`, blank line, description paragraph, blank line, `---`), one blank line, then exactly 3 `## Test:` entry sections (the 3 most recent, including the new one just appended by the Tester).
- [ ] The 3 retained entries are the most recent 3 — confirmed by checking their dates/names against what was in `TESTING.md` before the run.
- [ ] Open `docs/archive/TESTING_HISTORY.md`. Confirm the file exists and contains the archival header (`# FORGE — Testing History`, blank line, description sentence, blank line, `---`) followed by the archived entries (all entries that were removed from `TESTING.md`), most-recently-archived first (prepend order).
- [ ] The archived entries in `TESTING_HISTORY.md` are verbatim copies — formatting, `---` separators, and `_Last updated:` lines are preserved exactly.
- [ ] `docs/TESTING.md` total line count is now well below 400 lines.

---

### Edge cases

- [ ] **N ≤ 3 entries total:** Manually reduce `docs/TESTING.md` to 3 `## Test:` entries (keep only 3 sections) and pad it to exceed 400 non-empty lines with filler content. Trigger `apply feature:`. Confirm `docs/TESTING.md` is **not** modified (guard prevents archival when N ≤ 3). Confirm `TESTING_HISTORY.md` is also **not** modified. Restore original content after.
- [ ] **Under threshold:** Manually reduce `docs/TESTING.md` to under 400 non-empty lines (e.g. by trimming it to 2 entries). Trigger `apply feature:`. Confirm Documenter does **not** read or modify `docs/TESTING.md` during the archival step — the Tester's normal append still runs, but the archival sub-step is skipped. Restore after.
- [ ] **`docs/archive/` absent:** Rename `docs/archive/` to `docs/archive_bak/`. Trigger `apply feature:`. Confirm the Documenter emits the warning line `[archival] WARNING: docs/archive/ not found — TESTING.md archival skipped. Create docs/archive/ manually to enable archival.` Confirm `docs/TESTING.md` is **not** modified (only the Tester's normal append happened). Restore directory name after.
- [ ] **`TESTING_HISTORY.md` does not exist (first-ever archival):** If `docs/archive/TESTING_HISTORY.md` has never been created, delete it and trigger archival (ensure threshold is exceeded). Confirm the Documenter creates `TESTING_HISTORY.md` with the canonical 5-line header before prepending archived entries. Confirm the resulting file starts with `# FORGE — Testing History`.

---

### IPC / data persistence

- [ ] `docs/TESTING.md` rewrite is lossless: the total number of `## Test:` entries across `docs/TESTING.md` and `docs/archive/TESTING_HISTORY.md` after archival equals the number of entries in `docs/TESTING.md` before archival (count `## Test:` occurrences with Grep to verify no entries were silently dropped).
- [ ] Restart app after archival. Confirm the app opens normally — archival modifies only agent prompt and doc files, no runtime state is affected.

---

### Error handling

- [ ] If the Documenter encounters an unreadable `docs/TESTING.md` during step (c) (e.g. permissions issue), the apply run should not crash the entire pipeline — other steps (CHANGELOG, features.json, board.json) should still complete. Simulate by making `TESTING.md` read-only (Windows: right-click → Properties → Read-only), trigger apply, then restore permissions.

---

### Regression checks

- [ ] **Normal apply run (threshold not exceeded):** After archival has trimmed the file to ~3 entries, subsequent apply runs where the Tester appends one new entry should not trigger archival again until the file grows back past 400 non-empty lines. Confirm the no-archival output signal variant is used on these runs.
- [ ] **TESTING.md header block preserved:** After archival, the first 5 lines of `docs/TESTING.md` are exactly: `# FORGE — Manual Test Checklist`, blank, description paragraph, blank, `---`. The description paragraph reads: `This file is maintained by the Tester agent and appended after every \`apply\` pipeline run. Each section corresponds to one shipped feature. Check items off as you verify them before shipping.`
- [ ] **PLAN_HISTORY.md unaffected:** Open `docs/archive/PLAN_HISTORY.md` after an archival run. Confirm its content is unchanged — the archival step only writes `TESTING_HISTORY.md`, not `PLAN_HISTORY.md`.
- [ ] **board.json unaffected:** Open `.pipeline/board.json` after an archival run. Confirm `todos[]` and `planned[]` are unchanged by the archival step.

---

_Last updated: 2026-03-19_

---

## Test: Review and Optimise Pipeline Review Flow — 2026-03-19

**What this feature does:** Ten targeted edits across six agent `.md` files and `template/CLAUDE.md`. No source files, IPC channels, stores, or components were changed. The changes are: (1) gotcha-checker IPC count corrected to four places with ipc.ts added as the fourth bullet; (2) reviewer-triage fully rewritten — model changed to Haiku, plan-stage mode added with two-signal detection and a plan-stage decision table; (3) template/CLAUDE.md three hunks — plan-stage review step restructured, plan revision loop targeted re-run, reviewer-performance added to coder re-run list; (4) reviewer-logic module parent detection scoped with a guard; (5) reviewer-safety IPC input validation section gets a cross-boundary blockquote; (6) reviewer IPC completeness section gets a cross-boundary blockquote and fourth ipc.ts bullet.

**Prerequisites:**
- No app build required — all changes are to `.md` files only.
- A FORGE project with valid `docs/PLAN.md` and `docs/context/handoff.md` is useful for live pipeline tests.

---

### Happy path — static file checks

#### gotcha-checker.md

File: `C:/Users/cuj/Forge/.claude/agents/gotcha-checker.md`

- [ ] Open the file. The `### IPC — both sides must match` section heading reads "exactly **four** places" — not "two" or "three".
- [ ] The numbered list under that heading has exactly **4 items**: `ipcMain.handle` in `src/main/index.ts`, `contextBridge.exposeInMainWorld` in `src/preload/index.ts`, type in `src/renderer/src/types/claude.d.ts`, helper function in `src/renderer/src/lib/ipc.ts`.
- [ ] The **Flag** line after the list reads: "Any plan that adds an IPC handler without mentioning all four corresponding steps (main handler, preload bridge, ClaudeAPI type, and ipc.ts wrapper)."
- [ ] The string "two places" does **not** appear anywhere in the file.

#### reviewer-triage.md

File: `C:/Users/cuj/Forge/.claude/agents/reviewer-triage.md`

- [ ] Line 4 reads exactly: `model: claude-haiku-4-5-20251001` — confirm Sonnet is gone.
- [ ] `## Model rationale` section exists and mentions "Haiku is sufficient — triage is a pattern-matching dispatch task".
- [ ] `## Plan-stage mode` section exists and defines the **primary signal** as the literal prefix `[plan-stage mode]`.
- [ ] Primary signal rule states it is "decisive" and the primary signal "always wins" in conflict cases.
- [ ] Secondary signal rule states: if primary signal is absent and `docs/context/handoff.md` is absent or unreadable, proceed in plan-stage mode and emit a warning.
- [ ] Conflict rule states the warning line text: "Warning: [plan-stage mode] prefix present but handoff.md also exists — proceeding in plan-stage mode per primary signal".
- [ ] `## Plan-stage decision table` section exists with four rows: reviewer (mandatory), reviewer-safety (mandatory), reviewer-logic (conditional), reviewer-performance (conditional).
- [ ] `## Plan-stage output format` section exists with the heading `## Plan-Stage Reviewer Dispatch: <Feature Name>`.
- [ ] `## Do NOT read (mode-dependent)` section has **two** bullets (one for implement-stage, one for plan-stage) — not the old single instruction.
- [ ] `## Implement-stage decision table` section exists and is unchanged from before (five rows, same trigger questions).
- [ ] `## Implement-stage output format` section exists with the heading `## Reviewer Dispatch: <Feature Name>`.

#### template/CLAUDE.md — plan feature: review stage (Task 2)

File: `C:/Users/cuj/Forge/template/CLAUDE.md`

- [ ] In the `### plan feature:` pipeline section, step 3 heading reads "**Review stage** — invoke in order:".
- [ ] Step 3a reads: "**gotcha-checker** — always invoke first".
- [ ] Step 3b reads: "**reviewer-triage** — always invoke with the literal prompt prefix `[plan-stage mode]`".
- [ ] The example invocation text is present: `"invoke reviewer-triage with: '[plan-stage mode] Read docs/PLAN.md and output an explicit plan-stage dispatch list'"`.
- [ ] The sentence "The orchestrator must use this exact prefix — reviewer-triage uses it as the primary signal to switch into plan-stage mode." is present.
- [ ] The sentence "The orchestrator must follow the dispatch list returned by reviewer-triage exactly for all conditional plan-stage reviewers. Do not make your own reviewer invocation decisions." is present.
- [ ] The old heuristic reviewer invocation list (reviewer-safety if file I/O, reviewer-logic if async operations, etc.) is **not** present in step 3.

#### template/CLAUDE.md — plan revision loop (Task 4)

- [ ] In the `### Plan revision loop` section, step 2 reads: "Only the reviewer(s) that issued BLOCK or REVISE re-run against the updated plan."
- [ ] Step 2 includes the escape clause: "Reviewers that previously returned APPROVED do not re-run unless the revision materially changes their domain".
- [ ] The old step 2 text "All plan-stage reviewers that were originally invoked re-run against the updated plan." is **not** present.

#### template/CLAUDE.md — coder revision loop (Task 6)

- [ ] In the `### Coder revision loop` section, step 3 reads: "All **mandatory reviewers** (reviewer, reviewer-safety, reviewer-logic, **reviewer-performance**) re-run against the updated handoff."
- [ ] `reviewer-performance` appears in the mandatory re-run parenthetical alongside reviewer, reviewer-safety, and reviewer-logic.
- [ ] The old step 3 text listing only three mandatory reviewers (reviewer, reviewer-safety, reviewer-logic) is **not** present.

#### reviewer-logic.md — module parent detection guard (Task 7)

File: `C:/Users/cuj/Forge/.claude/agents/reviewer-logic.md`

- [ ] Look for text starting with "The question 'Is the proposed code a new capability...'" or similar. This paragraph should now be inside a blockquote (indented with `> ` at start of each line or wrapped in a code fence).
- [ ] Confirm the blockquote contains a guard: "Check the Handoff: Is a `modules.json` update section present? If not, scope Module Parent to the existing architecture only."
- [ ] The blockquote is a cross-boundary reference and spans multiple lines.

#### reviewer-safety.md — input validation blockquote (Task 8)

File: `C:/Users/cuj/Forge/.claude/agents/reviewer-safety.md`

- [ ] Look for a section containing "IPC input validation". This section should now contain a blockquote.
- [ ] The blockquote includes the text: "Each handler must validate the input shape using a guard — e.g., `if (typeof data.id !== 'number')` before processing. A missing guard DOES cause a BLOCK if the input could be malformed."
- [ ] The blockquote is properly formatted (indented or fenced).

#### reviewer.md — IPC completeness blockquote and fourth bullet (Task 9)

File: `C:/Users/cuj/Forge/.claude/agents/reviewer.md`

- [ ] Look for a section about "IPC completeness". This section should now contain a blockquote.
- [ ] The blockquote mentions the **four places** that must match.
- [ ] The tools list or an accompanying instruction list includes `src/renderer/src/lib/ipc.ts` as a required side-effect of adding a new IPC channel.
- [ ] The blockquote text is properly formatted.

---

### IPC / data persistence

- [ ] No source files were modified by this feature. Confirm by running `git diff src/` — output should be empty.
- [ ] No `.svelte` files were modified. Confirm by running `git diff -- '*.svelte'` — output should be empty.
- [ ] No `.ts` or `.svelte.ts` store/component files were modified.

---

### Error handling

- [ ] `reviewer-triage` receives a malformed or empty `docs/PLAN.md` in plan-stage mode (e.g. a file with only whitespace). Confirm the agent emits a LOW confidence dispatch that invokes ALL reviewers rather than silently skipping them.
- [ ] `reviewer-triage` is invoked in implement-stage mode but `docs/context/handoff.md` is a zero-byte file. Confirm the agent emits a LOW confidence result and invokes ALL reviewers.

---

### Regression checks

- [ ] **gotcha-checker still fires on IPC-less plans:** Run `plan feature:` for a feature with no IPC (e.g. a purely visual change). Confirm gotcha-checker produces a verdict and does not spuriously flag the IPC section (the IPC section simply does not trigger because the plan has no IPC tasks).
- [ ] **Full plan feature: pipeline end-to-end:** Run `plan feature: <any name>` through to Gate #1. Confirm: gotcha-checker runs first, reviewer-triage is invoked with `[plan-stage mode]` prefix, the triage dispatch list is followed exactly, Gate #1 appears after all reviewers complete.
- [ ] **Full implement feature: pipeline end-to-end:** Run `implement feature:` through to Gate #2. Confirm: reviewer-triage is invoked in implement-stage mode (no prefix), dispatch list is followed, Gate #2 appears.
- [ ] **Coder revision loop includes reviewer-performance:** Trigger a Gate #2 block where reviewer-logic issues BLOCK. After the coder revises `handoff.md`, confirm reviewer-performance re-runs in addition to reviewer, reviewer-safety, and reviewer-logic.
- [ ] **reviewer-safety does not BLOCK for missing ipc.ts wrapper:** Run `implement feature:` for a handoff that mentions a new IPC channel but omits the ipc.ts wrapper. Confirm reviewer-safety produces APPROVED or REVISE (not BLOCK) for that omission — the BLOCK should come from reviewer, not reviewer-safety.
- [ ] **reviewer does not BLOCK for missing input validation:** Run `implement feature:` for a handoff that adds a new IPC handler but omits type-guard validation inside the handler body. Confirm reviewer does not BLOCK for this — that is reviewer-safety's domain.

---

_Last updated: 2026-03-19_

---

## Test: Fix Scaffold Agent Set on Project Creation and Import — 2026-03-20

**What this feature does:** Three targeted fixes to `src/main/index.ts` and `electron-builder.yml`:
1. `'GENERAL.md'` removed from `SCAFFOLD_AGENT_NAMES` — that file lives in `docs/gotchas/`, not `.claude/agents/`, so its presence in the set caused the `delete-agent` guard to protect a phantom file and would have caused silent copy failures.
2. The `scaffold-project` IPC handler now copies agents via an explicit `for...of SCAFFOLD_AGENT_NAMES` loop with per-file `existsSync` guards and bidirectional traversal guards, replacing the previous `copyDirRecursive` call that copied everything in `.claude/agents/` unfiltered.
3. `.claude/**` and `template/**` added to `asarUnpack` in `electron-builder.yml` so that `existsSync` and `copyFileSync` work on those paths in packaged production builds (asar-packed files are not accessible to Node's `fs` module for copy operations).

**Prerequisites:**
- App is running (`npm run dev`) for dev-build tests.
- A production build (`npm run build`) is available or can be produced for the asarUnpack tests.
- FORGE's `.claude/agents/` directory is populated with the 16 standard agent `.md` files.

---

### Happy path — SCAFFOLD_AGENT_NAMES static check

File: `C:/Users/cuj/Forge/src/main/index.ts`

- [ ] Open the file. Locate the `SCAFFOLD_AGENT_NAMES` constant (lines ~43–48). Confirm it contains exactly **16 entries** and `'GENERAL.md'` is **not** among them.
- [ ] Confirm the 16 entries are: `planner.md`, `researcher.md`, `gotcha-checker.md`, `coder.md`, `reviewer.md`, `reviewer-safety.md`, `reviewer-logic.md`, `reviewer-style.md`, `reviewer-performance.md`, `reviewer-triage.md`, `implementer.md`, `tester.md`, `documenter.md`, `debug.md`, `refactor.md`, `architect.md`.

---

### Happy path — scaffold-project handler

- [ ] Create a new project via the Wizard. Confirm the handler copies exactly the 16 scaffold agents into the project's `.claude/agents/` directory — no more, no less.
- [ ] Confirm the newly-created project's `.claude/agents/` directory contains only `.md` files, no other filetypes.
- [ ] Confirm the handler returns `{ ok: true }` on success.
- [ ] Create a project, close FORGE, reopen FORGE, and select the project. Confirm all 16 scaffold agents are still present in `.claude/agents/` — nothing was modified on restart.
- [ ] Confirm the `scaffold-project` handler returns `{ ok: true }` on success and `{ error: string }` on failure (the return shape is unchanged — existing callers that check `res?.error` continue to work).

---

### Error handling

- [ ] Set the target folder to a path that cannot be created due to permissions (e.g. `C:/Windows/test-forge-project`). Trigger the Wizard. Confirm FORGE shows an error message in the UI rather than crashing — the handler's `catch (e)` block returns `{ error: e.message }` and the Wizard surfaces it.

---

### asarUnpack — production build (packaged app)

**Note:** This test requires a production build. Run `npm run build` first. The installer or unpacked app must be used — not `npm run dev`.

- [ ] After building, locate the packaged app's resources directory. Confirm `.claude/` exists as a real directory on disk alongside `app.asar` — it was not packed into the asar.
- [ ] Confirm `template/` exists as a real directory on disk alongside `app.asar`.
- [ ] Confirm `.claude/agents/` inside the unpacked directory contains the 16 scaffold agent `.md` files.
- [ ] Confirm `template/CLAUDE.md` and `template/docs/` exist inside the unpacked `template/` directory.
- [ ] Install and launch the packaged app. Create a new project via the Wizard. Confirm all 16 scaffold agents are copied to the new project's `.claude/agents/` — no silent failures due to asar path issues.
- [ ] In the packaged app, import an existing project. Confirm scaffold agents are copied correctly — `existsSync` on the agents source path succeeds because `.claude/` is unpacked.

---

### Regression checks

- [ ] **analyze-import classification:** Import a project whose `.claude/agents/` contains both scaffold agents (e.g. `planner.md`) and a custom agent (e.g. `my-custom.md`). Confirm `planner.md` is classified as a scaffold agent and `my-custom.md` as a custom agent — the `analyze-import` handler uses the same `SCAFFOLD_AGENT_NAMES` set and its classification is correct after removing `GENERAL.md`.
- [ ] **delete-agent guard still protects scaffold agents:** In the Agent Manager, attempt to delete `planner.md` from an active project. Confirm the UI shows an error and the file is not deleted — the `delete-agent` handler still returns `{ error: 'cannot-delete-scaffold' }` for all 16 names in the set.
- [ ] **Full plan → Gate #1 → implement → Gate #2 → apply pipeline on a newly-scaffolded project:** Create a fresh project via the Wizard, configure it in Settings, run a `plan feature:` prompt through to Gate #1. Confirm agents run correctly — all 16 scaffold agents were copied properly and are accessible.
- [ ] **copyDirRecursive still works for template docs:** In the newly-scaffolded project, confirm `docs/gotchas/GENERAL.md` was created from `template/docs/gotchas/GENERAL.md` — the `copyDirRecursive` call for docs is still present and functional.

---

_Last updated: 2026-03-20_

---

## Test: Context Window Monitor Hooks — 2026-03-20

**What this feature does:** Creates two Claude Code hook scripts (`ctx-session-start.js` and `ctx-post-tool.js`) that monitor context window usage during Claude Code sessions and emit warnings when thresholds are crossed. Adds a FORGE settings toggle to enable/disable warnings, registers hooks in both FORGE's dev environment and newly scaffolded/imported projects, and updates documentation to clarify the hook architecture.

**Prerequisites:**
- App is running (`npm run dev` or production build).
- FORGE project is configured in Settings.
- Claude Code CLI is installed and accessible.

---

- [ ] Open Settings → navigate to the MODEL field → confirm CONTEXT WINDOW WARNINGS toggle appears immediately below MODEL.
- [ ] Toggle is labeled "Enabled" when checked, "Disabled" when unchecked; default is checked (enabled).
- [ ] Hover over toggle → field-hint text reads: "Show advisory messages when Claude's context window is running low".
- [ ] Enable the toggle, save Settings → toggle state persists after app restart.
- [ ] Disable the toggle, save Settings → disabling suppresses hook warnings in subsequent Claude Code runs.
- [ ] Create a new project via Wizard → hook scripts are copied to `.claude/hooks/` → `ctx-session-start.js` and `ctx-post-tool.js` are present and readable.
- [ ] Import an existing project → hook scripts are copied to the project's `.claude/hooks/` → no errors during import; merge operation on `.claude/settings.json` preserves existing content.
- [ ] Open FORGE's `.claude/settings.local.json` → `hooks` key is present alongside `permissions` key → hooks object contains SessionStart and PostToolUse hook definitions.
- [ ] Open `template/.claude/settings.json` → hooks key present with SessionStart and PostToolUse definitions → matches `.claude/settings.local.json` structure.
- [ ] Open `src/renderer/src/lib/constants.ts` → `DEFAULT_SETTINGS` includes `contextWarningsEnabled: true`.
- [ ] Open `src/renderer/src/types/claude.d.ts` → `Settings` interface includes `contextWarningsEnabled?: boolean`.
- [ ] Run a Claude Code session with context window above 65% remaining → no warning appears → hooks execute silently.
- [ ] Run a Claude Code session where context drops between 25–35% → advisory message appears with "running low" text and approximate percentage.
- [ ] Run a Claude Code session where context drops below 25% → critical advisory appears with "critically low" text and immediate action instruction.
- [ ] Disable context warnings in Settings, restart app, run Claude Code session at critical threshold → no warning appears.

---

_Last updated: 2026-03-20_

---

