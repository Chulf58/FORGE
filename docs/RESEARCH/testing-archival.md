# Research: TESTING.md Archival

## Question: Does the Write tool in Claude Code auto-create parent directories on Windows when writing to a path like docs/archive/TESTING_HISTORY.md if docs/archive/ does not yet exist?

**Finding:** The `docs/archive/` directory already exists at `C:/Users/cuj/Forge/docs/archive/` — it contains `PLAN_HISTORY.md`. So the "create intermediate directory" scenario will not arise for this project on first write.

For the general case, the Write tool does call `fs.mkdir(dirPath, { recursive: true })` before every file operation, which means it is designed to auto-create intermediate directories. However, there is a known Windows-specific bug where this mkdir call throws `EEXIST` on directories that already exist (issues #31460, #31254, #31453, #31233 on the anthropics/claude-code repo, all filed and closed around March 2026). The bug affects writing to **existing** directories, not just new ones. It was introduced in v2.1.69 and reported as fixed in a subsequent release. The FORGE machine is on Windows 11, so this is a live concern if the installed Claude Code version is in the affected range.

**Summary of scenarios:**

| Scenario | Outcome |
|---|---|
| `docs/archive/` does not exist, Write to `docs/archive/TESTING_HISTORY.md` | Write tool creates the directory then writes the file (by design; `recursive: true`). |
| `docs/archive/` already exists (current state of this project) | Write should succeed. On affected Claude Code builds (v2.1.69 range), may throw `EEXIST` and fail silently or error. |
| Bash available as a fallback | `mkdir -p docs/archive` before the first Write call guarantees the directory exists and sidesteps any mkdir race. |

**Source:**
- Verified directory presence: `C:/Users/cuj/Forge/docs/archive/PLAN_HISTORY.md` exists (Glob result)
- GitHub issue: https://github.com/anthropics/claude-code/issues/31460 (EEXIST on Windows, closed as duplicate of #31254)
- GitHub issue: https://github.com/anthropics/claude-code/issues/30928 (Write/Edit fail with EEXIST on OneDrive directories, v2.1.69 regression, marked fixed)
- GitHub issue: https://github.com/anthropics/claude-code/issues/11912 (Write tool creates directories; permissions bug)

**Recommendation:** Task 5 of the plan currently reads "note in the documenter prompt that the Write tool creates intermediate directories automatically; no explicit mkdir step is needed." This is **partially safe** because `docs/archive/` already exists in this project. However, the plan note should be updated with a caveat: since this project runs on Windows 11, include a defensive Bash `mkdir -p docs/archive` call before the first Write to `docs/archive/TESTING_HISTORY.md`. This guards against both the case where the directory is absent (new project clone) and against the EEXIST regression on certain Claude Code builds. The Bash call is a no-op if the directory already exists, so there is no downside. The documenter already has Bash access (it is in its tools list), so no tools change is needed.

---

## Question: Is the `---` separator before each `## Test:` heading consistently present throughout docs/TESTING.md? The archival splitting algorithm depends on using `## Test:` as the entry boundary — verify this is reliable.

**Finding:** `docs/TESTING.md` was read in full (612 lines). There are 9 `## Test:` entries present. The separator structure is **fully consistent** across all 9 entries:

Every `## Test:` heading is preceded by a `---` separator on the line immediately above it (no blank line between the `---` and the heading). The pattern repeats without exception. Specifically:

- Line 5: `---` (end of header block, before first entry)
- Line 7: `## Test: Mode buttons — FREE renamed to EXPLORE, DIRECT added — 2026-03-19`
- Line 14: `---` (internal to first entry — sub-section separator)
- Line 266: `---` then line 268: `## Test: Fix Coder Agent Prompt Gaps — 2026-03-19`
- Line 330: `---` then line 332: `## Test: Fix Planner Agent Prompt Gaps — 2026-03-19`
- Line 379: `---` then line 381: `## Test: Optimize Tester and Documenter Agent Token Usage — 2026-03-19`
- Line 410: `---` then line 411: `## Test: Reviewer agents write-access removed — 2026-03-19`
- Line 463: `---` then line 466: `## Test: debug: Documenter agent has a stale hardcoded module list — 2026-03-19`
- Line 496: `---` then line 499: `## Test: debug: Tester agent does not handle TESTING.md creation edge case — 2026-03-19`
- Line 528: `---` then line 532: `## Test: Switch Tester, Documenter, and Reviewer-Performance to Haiku Model — 2026-03-19`

Note: The **first** entry (Mode buttons) does not have a leading `---` on the line directly above `## Test:` — the file header ends with `---` at line 5, then a blank line at line 6, then `## Test:` at line 7. All **subsequent** entries follow the pattern `---\n\n## Test:` (blank line between `---` and heading).

**Important nuance for the splitting algorithm:** The `---` separators also appear **inside** entries as sub-section dividers (e.g. line 14, after the Prerequisites block of the first entry). The algorithm in task 2 uses `## Test:` as the boundary marker, not `---`. This is correct — the entry boundary should be detected by the `## Test:` heading line, not by `---`. The `---` immediately before each `## Test:` heading belongs to the **preceding** entry's trailing separator (or the header block's closing separator for entry 1), not to the opening of the new entry.

**Source:** `C:/Users/cuj/Forge/docs/TESTING.md` — read in full, lines 1–612

**Recommendation:** The splitting algorithm in task 2 is sound: use `## Test:` as the entry boundary. The Coder should implement the split by scanning for lines that match `^## Test:` and treating each such line as the start of a new entry. The content between the end of one entry and the start of the next (which includes the trailing `---` separator) should be treated as part of the **preceding** entry, not the following one. When reconstructing the live file after archival, the header block (lines 1–5 of the current file: `# FORGE — Manual Test Checklist`, blank line, description, blank line, `---`) should be written first, followed by the 3 kept entries. Each kept entry already carries its own leading `---` from the previous entry's tail, preserving visual separation. No special handling is needed to insert separators — the raw entry content retains them.

---

## Supplementary finding: Header block structure for TESTING_HISTORY.md

The plan task 6 asks the documenter to model the new `TESTING_HISTORY.md` header on `PLAN_HISTORY.md`. The confirmed structure of `PLAN_HISTORY.md` lines 1–5 is:

```
# FORGE — Plan History

Completed feature plans archived here when PLAN.md exceeds 150 lines.

---
```

The `TESTING_HISTORY.md` header should follow the same shape:

```
# FORGE — Testing History

Test entries archived from docs/TESTING.md when the file exceeds 400 lines.

---
```

**Source:** `C:/Users/cuj/Forge/docs/archive/PLAN_HISTORY.md` lines 1–5
