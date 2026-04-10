# Research: Optimize Tester and Documenter Agent Token Usage

The plan's "Research needed" section states "None" — causes are visible directly in the files.
This research document fulfils the pipeline contract by recording exact line numbers, structural
observations, and per-task implementation guidance the Coder needs.

---

## Question: What are the exact insertion/replacement targets in tester.md for each of the five tester tasks?

**Finding:**

`/Users/cuj/Forge/.claude/agents/tester.md` is 86 lines. Full structure:

| Lines | Section |
|-------|---------|
| 1–10 | Frontmatter (YAML) |
| 11 | blank |
| 12 | Identity line |
| 13 | blank |
| 14–16 | `## Your role` |
| 17 | blank |
| 18–23 | `## What to read first` (3-item numbered list) |
| 24 | blank |
| 25–30 | `## Test checklist principles` |
| 31 | blank |
| 32–54 | `## Checklist format` (fenced markdown block) |
| 55 | blank |
| 56–80 | `## FORGE-specific test patterns` (5 sub-sections) |
| 81 | blank |
| 82–86 | `## Output signal` |

**Task 1 — Rewrite `## What to read first`**
Target: lines 18–23. Replace the entire 3-item numbered list. The new content is a conditional
read strategy with an explicit doc-only guard. The section heading at line 18 stays; lines 19–23
(the three `1.`/`2.`/`3.` items) are replaced.

**Task 2 — Add `## Feature-type classification` section**
Insert location: after line 23 (the current end of `## What to read first`), before line 24
(blank line before `## Test checklist principles`). A new blank line + `## Feature-type
classification` heading + guard text is inserted between lines 23 and 25.

**Task 3 — Rewrite checklist format**
Target: lines 32–54 (the `## Checklist format` section including its fenced markdown block).
The five sub-section headings (`### Happy path`, `### Edge cases`, `### IPC / data persistence`,
`### Error handling`, `### Regression check`) and their content lines are removed. Replace with
a single flat list under `## Test: <Feature Name> — <date>`, capped at 15 items, with the
write-only-tests-that-can-fail instruction.

**Task 4 — Convert FORGE-specific patterns from templates to conditionals**
Target: lines 56–80. The five sub-sections (`### Terminal output`, `### Right panel tabs`,
`### Gate interaction`, `### IPC`, `### Settings persistence`) and their bullet lists are
replaced by a single reference table with "When to include" column guidance. The section
heading `## FORGE-specific test patterns` at line 56 is retained; lines 57–80 are replaced.

**Task 5 — Add `## What NOT to test` section**
Insert location: after line 80 (end of `## FORGE-specific test patterns`), before line 81
(blank line before `## Output signal`). A new `## What NOT to test` section listing six
excluded check types and the "These belong in CI" statement is inserted between lines 80 and 82.

**Source:** `/Users/cuj/Forge/.claude/agents/tester.md` (read in full, all 86 lines)

**Recommendation:** Coder should work top-to-bottom through tester.md in a single Write pass
after constructing the full replacement. The file is short (86 lines) — a complete rewrite
is safer than multiple Edit calls that could misalign line numbers after earlier insertions.

---

## Question: What are the exact insertion/replacement targets in documenter.md for each of the five documenter tasks?

**Finding:**

`/Users/cuj/Forge/.claude/agents/documenter.md` is 176 lines. Full structure:

| Lines | Section |
|-------|---------|
| 1–10 | Frontmatter (YAML) |
| 11 | blank |
| 12 | Identity line |
| 13 | blank |
| 14–16 | `## Your role` |
| 17 | blank |
| 18–33 | `## Step 0 — Extract context` (three lettered sub-steps a/b/c) |
| 34 | blank |
| 35–102 | `## Files to update` (four sub-sections: CHANGELOG, ARCHITECTURE, DECISIONS, PLAN) |
|   37–45 | `### 1. docs/CHANGELOG.md` |
|   47–63 | `### 2. docs/ARCHITECTURE.md` |
|   65–76 | `### 3. docs/DECISIONS.md` |
|   78–82 | `### 4. PLAN.md — archive completed feature` |
|   84–101| `### 5. Module registry` (core modules list) |
| 103–126 | `## Step 5 — Remove from planned board (feature mode only)` |
| 127 | blank |
| 128–157 | `## Step 6 — Log to features.json (all modes)` |
| 158 | blank |
| 159–168 | `## What NOT to do` |
| 169 | blank |
| 170–176 | `## Output signal` |

**Task 6 — Rewrite `## Step 0 — Extract context` to defer all file reads**
Target: lines 18–33. The current Step 0 already reads only handoff.md — it does NOT batch-read
ARCHITECTURE, CHANGELOG, or DECISIONS. The problem the plan describes (batch upfront reads) is
not in Step 0 itself — it is implicit in the `## Files to update` section which instructs the
agent to update each doc without any skip guard. The change for Task 6 is to expand Step 0 (d)
with two new decision flags: `needs_architecture_update` and `needs_decisions_entry`, derived
from the handoff content before any other file is opened. The insert point is after line 33
(end of current Step 0 sub-step c), adding a new sub-step (d) with the two flag definitions.

**Task 7 — Add ARCHITECTURE.md skip rule**
Target: lines 47–63 (`### 2. docs/ARCHITECTURE.md`). Add a guard block at the top of this
section (after the `### 2.` heading line, currently line 47) before the first bullet. The
guard reads: "If `needs_architecture_update` is false, skip this section entirely." When true,
instruct use of Grep to locate relevant sub-section headers before reading. The existing bullet
list (lines 49–54) is retained below the guard.

**Task 8 — Add DECISIONS.md skip rule**
Target: lines 65–76 (`### 3. docs/DECISIONS.md`). Add a guard block at the top of this section
(after the `### 3.` heading line, currently line 65) before the fenced template block. The
guard reads: "If `needs_decisions_entry` is false, skip this section entirely." The existing
fenced template and "Only add this if..." note at lines 67–76 are retained below the guard.

**Task 9 — Make CHANGELOG.md read lazy**
Target: lines 37–45 (`### 1. docs/CHANGELOG.md`). The section currently gives write instructions
but no explicit read instruction. Add a note at the top of the section (after line 37, the
`### 1.` heading) instructing the agent to read `docs/CHANGELOG.md` immediately before writing
this section, read only the first 20 lines to locate the insertion point, and not read it
upfront. This is an insert, not a replacement — the fenced template block at lines 39–44 is
unchanged.

**Task 10 — Preserve board.json and features.json steps, add preservation comment**
Target: lines 103–157 (Steps 5 and 6). No logic changes. Add a one-line comment at the top of
Step 5 (after the `## Step 5` heading at line 103) and at the top of Step 6 (after the
`## Step 6` heading at line 128) noting: "This step's file reads are already scoped — do not
batch with doc reads above." The existing step logic (lines 105–126 and 129–157) is unchanged.

**Source:** `/Users/cuj/Forge/.claude/agents/documenter.md` (read in full, all 176 lines)

**Recommendation:** Documenter.md is 176 lines with no change to Steps 5/6 logic. A complete
rewrite is still the safest approach given five distinct insertion points spread across the file
— constructing the full replacement avoids cumulative line-number drift from sequential Edit
calls.

---

## Question: Does the current `## Output signal` in tester.md need updating?

**Finding:** tester.md line 85 currently reads:
```
`[suggest] apply feature: <feature name>` (Documenter should run after you)
```
The plan's five tester tasks do not mention changing the output signal. This signal is
technically incorrect — the correct next step after Tester is Documenter (not a gate), so
`apply feature:` is used to continue the apply pipeline. The plan explicitly scopes changes
to token reduction only and does not list an output-signal fix for tester.md. Leave line 85
unchanged.

**Source:** `/Users/cuj/Forge/.claude/agents/tester.md` line 85

**Recommendation:** Do not touch the output signal line during this feature. A separate coder/
tester signal audit is tracked elsewhere.

---

## Question: Does documenter.md currently perform any upfront batch reads of ARCHITECTURE.md, CHANGELOG.md, or DECISIONS.md?

**Finding:** The current documenter.md does NOT contain explicit "read these files first"
instructions in Step 0. The upfront read cost arises implicitly: the agent reads `## Files to
update` and interprets each `### N. docs/X.md` section as an unconditional update task,
opening each file before deciding whether anything needs to change. The fix (Tasks 6–9) adds
skip guards that let the agent abort a section before opening the file, eliminating the read
cost for unchanged docs. No explicit batch-read instruction needs to be deleted — the guards
are pure additions.

**Source:** `/Users/cuj/Forge/.claude/agents/documenter.md` lines 35–76

**Recommendation:** Coder should frame Tasks 6–9 as guard additions, not deletions. The
existing section prose is preserved; skip gates are prepended to the relevant sections.

---

## Question: Are there any naming collisions or structural conflicts between the new tester.md sections and existing content?

**Finding:** No conflicts. The three new/modified sections in tester.md are:
- `## Feature-type classification` — new heading, does not exist anywhere in the current file
- `## What NOT to test` — new heading, does not exist anywhere in the current file
- The flat checklist replaces the fenced markdown template block — the outer heading
  `## Checklist format` is also being replaced (the heading itself changes to match the new
  format), so there is no heading duplication

The `## Test checklist principles` section (lines 25–30) is not touched by any of the five
tasks and must be preserved exactly.

**Source:** `/Users/cuj/Forge/.claude/agents/tester.md` lines 25–30 and full file scan

**Recommendation:** Coder must preserve lines 14–30 (Your role + Test checklist principles)
verbatim when rewriting.

---

## Summary — Exact change map

### tester.md (`/Users/cuj/Forge/.claude/agents/tester.md`)

| Task | Action | Lines affected |
|------|--------|---------------|
| 1 | Replace `## What to read first` body | 19–23 replaced |
| 2 | Insert `## Feature-type classification` section | after line 23 |
| 3 | Replace `## Checklist format` heading + fenced block | 32–54 replaced |
| 4 | Replace `## FORGE-specific test patterns` body | 57–80 replaced |
| 5 | Insert `## What NOT to test` section | after line 80 (new line 4 task) |

Lines 1–17 (frontmatter, identity, Your role) and lines 25–30 (checklist principles) are
unchanged. Line 85 (output signal) is unchanged.

### documenter.md (`/Users/cuj/Forge/.claude/agents/documenter.md`)

| Task | Action | Lines affected |
|------|--------|---------------|
| 6 | Add sub-step (d) with two decision flags to Step 0 | insert after line 33 |
| 7 | Prepend skip guard to `### 2. docs/ARCHITECTURE.md` | insert after line 47 |
| 8 | Prepend skip guard to `### 3. docs/DECISIONS.md` | insert after line 65 |
| 9 | Prepend lazy-read note to `### 1. docs/CHANGELOG.md` | insert after line 37 |
| 10 | Add preservation comments to Step 5 and Step 6 headings | insert after lines 103 and 128 |

All existing section prose, the fenced templates, the board.json/features.json logic
(lines 103–157), and the `## What NOT to do` section (lines 159–168) are unchanged.
