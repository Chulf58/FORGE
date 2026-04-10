# Research: Enforce Glob/Grep over Bash in Agent Prompts

## Question: Which agents in `.claude/agents/` have Bash in their tools list?

**Finding:** Exactly two agents list `- Bash` in their frontmatter tools block:
- `/Users/cuj/Forge/.claude/agents/implementer.md` — line 11
- `/Users/cuj/Forge/.claude/agents/debug.md` — line 10

All other 14 agents (`researcher`, `tester`, `reviewer`, `reviewer-performance`, `reviewer-triage`, `reviewer-logic`, `reviewer-safety`, `reviewer-style`, `documenter`, `refactor`, `architect`, `gotcha-checker`, `coder`, `planner`) do **not** list Bash. This was confirmed by grepping the entire `.claude/agents/` directory for `- Bash`.

**Source:** Grep result across `C:/Users/cuj/Forge/.claude/agents/*.md`
**Recommendation:** The rule only needs to be added inline to `implementer.md` and `debug.md`. The GENERAL.md addition serves as a global backstop for any future agents that may acquire Bash access.

---

## Question: Exact insertion point in `docs/gotchas/GENERAL.md`

**Finding:** `GENERAL.md` currently has 119 lines. The final section is `## Platform differences (Windows)` beginning at line 113. There is no existing tool-preference section anywhere in the file. A new `## Tool preference — Glob and Grep over Bash` section should be appended after line 119 (end of file), keeping consistent with the file's pattern of double-newline-separated `---`-delimited sections.

**Source:** `C:/Users/cuj/Forge/docs/gotchas/GENERAL.md` lines 113–119
**Recommendation:** Append the new section at the end of the file, following the existing `---` separator convention.

---

## Question: Exact insertion point in `.claude/agents/implementer.md`

**Finding:** `implementer.md` is 80 lines. The `## Editing rules` section starts at line 55 and ends at line 64 (the blank line before `## After applying` at line 66). There is no existing `## Tool preference` section. The plan specifies inserting `## Tool preference` immediately **after** `## Editing rules` — meaning between line 64 and line 65 (the blank line before `## After applying`).

Specifically:
- Line 55: `## Editing rules`
- Line 64: (last bullet in editing rules: `- **2-space indent, single quotes, semicolons, trailing commas**`)
- Line 65: (blank line)
- Line 66: `## After applying`

Insert the new section between lines 64 and 66.

**Source:** `C:/Users/cuj/Forge/.claude/agents/implementer.md` lines 55–66
**Recommendation:** Insert the new `## Tool preference` section (with a blank line before and after) between `## Editing rules` and `## After applying`.

---

## Question: Exact insertion point in `.claude/agents/debug.md`

**Finding:** `debug.md` is 99 lines. The `## Debugging approach` section starts at line 51 and ends at line 56 (the last numbered step: `5. **Check for regressions** — does the fix affect other flows?`). The next section `## Handoff format for debug` begins at line 58. There is no existing `## Tool preference` section. The plan specifies inserting `## Tool preference` immediately **after** `## Debugging approach`.

Specifically:
- Line 51: `## Debugging approach`
- Line 56: (last step: `5. **Check for regressions**...`)
- Line 57: (blank line)
- Line 58: `## Handoff format for debug`

Insert the new section between lines 56 and 58.

**Source:** `C:/Users/cuj/Forge/.claude/agents/debug.md` lines 51–58
**Recommendation:** Insert the new `## Tool preference` section (with a blank line before and after) between `## Debugging approach` and `## Handoff format for debug`.

---

## Question: Is the rule text identical across all three files?

**Finding:** The plan specifies the same verbatim text for all three insertion points:

> "Always use the Glob tool instead of bash find/ls, and the Grep tool instead of bash grep/rg. Bash should only be used for operations that have no dedicated tool equivalent (e.g. git commands, wc, process operations). Never use bash find, bash ls, or bash grep/rg."

The only difference is the section heading:
- `GENERAL.md`: `## Tool preference — Glob and Grep over Bash`
- `implementer.md`: `## Tool preference`
- `debug.md`: `## Tool preference`

**Source:** `docs/PLAN.md` tasks 1–3 under "Feature: Enforce Glob/Grep over Bash in Agent Prompts"
**Recommendation:** Use the longer heading in GENERAL.md (it is a catch-all reference file) and the shorter `## Tool preference` heading in the agent files (consistent with their terse section naming style, e.g. `## Editing rules`, `## Debugging approach`).

---

## Question: Are there any existing Bash-over-Glob/Grep patterns in the agent files to reference as anti-examples?

**Finding:** Neither `implementer.md` nor `debug.md` currently contain any instruction about which search tool to prefer. There are no existing `bash find`, `bash ls`, or `bash grep` examples in either file that need to be replaced — the rule is additive only.

**Source:** `C:/Users/cuj/Forge/.claude/agents/implementer.md` (full file), `C:/Users/cuj/Forge/.claude/agents/debug.md` (full file)
**Recommendation:** No existing text needs to be removed or replaced. Pure insertions only.
