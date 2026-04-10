# Research: Fix Planner Agent Prompt Gaps

## Question: Where exactly in planner.md should the `## Two-pass behavior` section be inserted, and what lines currently occupy that position?

**Finding:** `/C:/Users/cuj/Forge/.claude/agents/planner.md` line 14 is `## Your role`, which currently contains no body text — the section heading is immediately followed by a blank line and then `## Step 0 — Clarify (first invocation only)` at line 18. There is no body content between `## Your role` and `## Step 0`. The new `## Two-pass behavior` section must be inserted between lines 17 and 18 (after the blank line following `## Your role`, before `## Step 0`).

The two-pass behavior is already partially described in `## Step 0` (lines 18–44), but only in prose form embedded inside the clarify step — there is no standalone section that names "Pass 1" and "Pass 2" as distinct modes, and no explicit instruction that Pass 1 must STOP with zero plan content. The coder agent in `/C:/Users/cuj/Forge/.claude/agents/coder.md` shows the parallel "plan validity check" pattern: a named `## Before you start` section at lines 18–29 that interrupts normal flow and demands an early exit if conditions aren't met. The two-pass section should follow the same named-section-before-the-main-steps pattern.

**Source:** `/C:/Users/cuj/Forge/.claude/agents/planner.md` lines 14–18; `/C:/Users/cuj/Forge/.claude/agents/coder.md` lines 18–29

**Recommendation:** Insert `## Two-pass behavior` as a new section at line 17 (after the blank line under `## Your role`, before `## Step 0`). The section body must explicitly label Pass 1 (no `[answers]` present: emit `[questions]` block then stop — no plan content, no `[suggest]`) and Pass 2 (when `[answers]` is present anywhere in the prompt: skip Step 0 entirely, use answers to resolve design choices, proceed to reading codebase and writing the full plan).

---

## Question: Where exactly should `docs/gotchas/GENERAL.md` be added as a mandatory pre-read in planner.md, and what does GENERAL.md contain that the planner needs?

**Finding:** The `## Steps 1–3 (write the plan)` section in planner.md is at lines 45–49. Step 1 currently reads only "Read the current codebase to understand what already exists" (line 47) — no file list, no mention of GENERAL.md or docs/PLAN.md.

`/C:/Users/cuj/Forge/docs/gotchas/GENERAL.md` contains the following planner-relevant content:
- IPC is a **four-file** operation (main, preload, types, ipc.ts) — the planner's own `## IPC pattern` section at lines 86–92 only mentions two files (main and preload) and omits `src/renderer/src/lib/constants.ts` and `src/renderer/src/lib/ipc.ts`, creating a direct contradiction with GENERAL.md line 56–60.
- Svelte 5 runes only — no `writable`/`readable` from `svelte/store`.
- Node.js APIs must never appear in renderer files.
- `triggerRun()` from `src/renderer/src/lib/runner.ts` is the single entry point for runs — if the plan schedules a "trigger run" task it must reference this function.
- Signal protocol lines (e.g., `[todo]`, `[gate1]`) must not be written to the terminal.

The coder agent (`/C:/Users/cuj/Forge/.claude/agents/coder.md` line 16) lists GENERAL.md as the first mandatory read in its role description paragraph, with the exact note: "project-specific gotchas: process boundary, IPC pattern, Svelte 5 rune rules, signal protocol, platform differences — read it before writing any code".

**Source:** `/C:/Users/cuj/Forge/.claude/agents/planner.md` lines 45–49, 86–92; `/C:/Users/cuj/Forge/docs/gotchas/GENERAL.md` lines 7–9, 55–60; `/C:/Users/cuj/Forge/.claude/agents/coder.md` line 16

**Recommendation:** Expand Step 1 in `## Steps 1–3` to list explicit mandatory reads: `docs/gotchas/GENERAL.md`, `docs/PLAN.md` (to detect existing tasks before appending), and relevant source files. Add the note: "Reading GENERAL.md first prevents the plan from scheduling tasks that repeat known process-boundary, IPC, or reactivity mistakes." Also fix the `## IPC pattern` section (lines 86–92) to name all four locations to match GENERAL.md — this is a secondary inconsistency the Coder already corrected for their own IPC section.

---

## Question: Where exactly is the `## PLAN.md format` section, what does it currently say about append vs overwrite, and where should the append rule be added?

**Finding:** `## PLAN.md format` is at lines 104–117 in planner.md. It contains only a bare code block showing the `## Active Plan` / `### Feature:` / task / `### Research needed` template. There is no instruction about what to do if `docs/PLAN.md` already exists. The `## What NOT to do` section at lines 135–141 says "Do not remove existing completed items from `docs/PLAN.md`" (line 141) but says nothing about not deleting existing feature headings or not overwriting the file.

The `## Planning rules` section at lines 94–101 contains seven bullet rules. None of them address the append/overwrite distinction.

Current `docs/PLAN.md` (the live file) demonstrates the pattern: it contains two `### Feature:` headings ("Fix Coder Agent Prompt Gaps" at line 3 and "Fix Planner Agent Prompt Gaps" at line 32) under a single `## Active Plan` heading, confirming the intended behavior is accumulation, not replacement.

**Source:** `/C:/Users/cuj/Forge/.claude/agents/planner.md` lines 94–101, 104–117, 135–141; `/C:/Users/cuj/Forge/docs/PLAN.md` lines 1–3, 32

**Recommendation:** Add the append rule in two places: (1) as a bullet in `## Planning rules` after the existing "Flag unknowns" bullet (after line 100), worded as: "**Append only** — if `docs/PLAN.md` already exists, append the new `### Feature:` section under the existing `## Active Plan` heading; never delete, overwrite, or modify existing task lines or feature headings." (2) As a note inside the `## PLAN.md format` section (after the code block, before the next section), worded as: "If the file already exists, append the new feature section — do not overwrite the whole file."

---

## Question: Where exactly should the `## Step 3b — Emit [todo] signals` section be inserted, and what is the correct relationship between `[todo]` lines and the `[suggest]` line in the output signal?

**Finding:** The planner's `## Output signal` section is at lines 143–147. It currently shows:
```
[suggest] implement feature: <feature name>
[summary] <one-sentence summary of what will be built, ≤ 120 characters>
```
There is no `[todo]` line shown or described. The `[module]` signal is documented in `## Step 4 — Assign module` (lines 119–133) and its line 133 states the `[module]` line must appear "after all plan content and after `[suggest]`".

`/C:/Users/cuj/Forge/docs/gotchas/GENERAL.md` line 91 lists `[todo]` as one of the current FORGE signals: "`[todo]`, `[gate1]`, `[gate2]`, `[module]`, `[health]`, `[summary]`, `[CONTEXT-CHECKPOINT]`, `[questions]` / `[/questions]`, `[answer-*]`". No existing agent prompt currently documents when or how `[todo]` lines should be emitted by the planner.

The plan specifies the section should go immediately after plan-writing steps and before `## Step 4 — Assign module`. `## Step 4` begins at line 119. The `## PLAN.md format` section ends at line 117, followed by a blank line. The insertion point is line 118 (between the PLAN.md format section and Step 4).

**Source:** `/C:/Users/cuj/Forge/.claude/agents/planner.md` lines 117–133, 143–147; `/C:/Users/cuj/Forge/docs/gotchas/GENERAL.md` line 91

**Recommendation:** Insert a new `## Step 3b — Emit [todo] signals` section at line 118 (between `## PLAN.md format` and `## Step 4 — Assign module`). It must instruct: after writing the plan to `docs/PLAN.md`, emit one `[todo] <task text>` line per numbered task, matching the task description text. Also update `## Output signal` to show that `[todo]` lines precede the `[suggest]` line:
```
[todo] <task 1 text>
[todo] <task 2 text>
...
[suggest] implement feature: <feature name>
[summary] <one-sentence summary>
```

---

## Question: Is the Electron version reference in planner.md's `## Tech stack` section accurate?

**Finding:** `package.json` line 33: `"electron": "^39.2.6"`. Planner.md line 54: `"Desktop: Electron 39 via electron-vite"`. The version reference is accurate.

**Source:** `/C:/Users/cuj/Forge/package.json` line 33; `/C:/Users/cuj/Forge/.claude/agents/planner.md` line 54

**Recommendation:** No change needed. Verification complete.

---

## Summary of exact insertion/modification points in planner.md

| Change | Action | Current line(s) |
|--------|--------|-----------------|
| 1. Two-pass behavior | Insert new `## Two-pass behavior` section | After line 17 (before `## Step 0` at line 18) |
| 2. GENERAL.md pre-read | Expand Step 1 inside `## Steps 1–3` | Line 47 (`"Read the current codebase..."`) |
| 3. Append rule | Add bullet to `## Planning rules` + note in `## PLAN.md format` | After line 100 (rules) and after line 116 (format code block) |
| 4. [todo] signals | Insert new `## Step 3b` section + update `## Output signal` | After line 117 (before Step 4); lines 143–147 (output signal) |
| 5. Electron version | Verification only — no change | Line 54 |
