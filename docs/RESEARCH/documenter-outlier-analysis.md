# Documenter POST Outlier Analysis — 2026-04-19

## Subject

Session `3bb7cef1`, subagent `agent-a73854b5c15b9235d` (forge:documenter), task "gitIntegration config key", run `r-f0df325a`.

**Metrics:** 22,155 output tokens, 20 turns, 10 tool uses, 1,108 out/turn (POST median: 104 out/turn).

## Root cause: compound of two factors

### Factor 1 — bash-guard blocked the prompt-prescribed append method

The documenter prompt (Step 4c, `agents/documenter.md:141-148`) instructs the agent to append to `docs/PLAN-archive.md` using `cat >> ... << 'ARCHIVE_EOF'` via Bash. However, `hooks/bash-guard.js` blocks `cat` with: `[bash-guard] Use Read tool instead of 'cat'`.

**Evidence:** Turn 14 attempted `Bash: cat >> ".../.worktrees/r-f0df325a/docs/PLAN-archive.md" << 'ARCHIVE_EOF' ...` and received `is_error: true` with the bash-guard block message (1,930 output tokens wasted on the blocked command body).

### Factor 2 — Write-entire-file fallback on a 52KB archive file

After the `cat >>` block, the agent:
1. Turn 15 — decided to use Write instead (text: "I'll use Write to append to PLAN-archive.md instead")
2. Turn 16 — Read the existing `PLAN-archive.md` (52,170 chars, 427 lines)
3. Turn 18 — **Rewrote the entire file** via Write (57,123 chars = old content + new 5KB section)

This single Write call consumed **16,462 output tokens** — 74.3% of the agent's total output.

**Why Write instead of Edit?** The Write tool overwrites the entire file. Edit could have appended by matching the last line and inserting after it, but the agent chose the simpler Write path after the Bash block. This is a reasonable fallback for Haiku — Edit requires finding a unique old_string anchor, which is harder than Write-entire-file.

### Compounding: PLAN-archive.md was already large

At the time of this run, `PLAN-archive.md` contained 427 lines / 52KB from 5 previously archived features (documenter board hygiene, stale run-active fix, LEAN-lite gate, hello world, git guard). The "Git Integration for Apply Pipeline" plan section alone was ~5KB (6 tasks + research section + approach summary).

For comparison: the Hello World documenter (POST call #5, 2,566 tokens) hit the same `cat >>` block but fell back to Edit — appending ~847 chars to an existing ~948 char archive. The file was small enough that Edit worked naturally.

### Secondary factor: maxTurns exhaustion

The documenter has `maxTurns: 10` (tool calls). The outlier run spent all 10 on Steps 0–4:

| # | Tool | Step | Purpose |
|---|------|------|---------|
| 1 | Read | 0 | handoff.md |
| 2 | Read | 1 | CHANGELOG.md |
| 3 | Edit | 1 | Prepend CHANGELOG entry |
| 4 | Grep | 4a | Locate feature heading in PLAN.md |
| 5 | Read | 4b | Read feature section from PLAN.md |
| 6 | Read | 4b | Re-read (slightly different offset) |
| 7 | Bash | 4c | `cat >>` attempt — **BLOCKED** |
| 8 | Read | 4c | Read PLAN-archive.md (52KB) for Write fallback |
| 9 | Write | 4c | **Rewrite entire PLAN-archive.md (57KB) — THE OUTLIER** |
| 10 | Edit | 4d | Remove section from PLAN.md |

Steps 5–8c (board maintenance, module wiring, todo closure, solution capture, CHANGELOG archival, PLAN-archive trimming) were **never reached**. Notably, Step 8b would have trimmed PLAN-archive.md if it had run (480 lines, threshold 500 — close but under).

## Token breakdown

| Category | Tokens | % of total |
|----------|--------|-----------|
| Turn 18: Write entire PLAN-archive.md | 16,462 | 74.3% |
| Turn 20: Edit PLAN.md (remove 6.5KB section) | 1,939 | 8.8% |
| Turn 14: Blocked Bash cat (wasted) | 1,930 | 8.7% |
| Remaining 17 turns combined | 1,824 | 8.2% |
| **Total** | **22,155** | **100%** |

## Classification

| Dimension | Assessment |
|-----------|-----------|
| Prompt-contract failure? | **Partial.** The contract does not ban Write-entire-file; the prescribed method (`cat >>`) is blocked by bash-guard. The agent followed the spirit of the contract but was forced into a pathological fallback. |
| Loop/retry behavior? | **No.** No loops detected. Each tool call was distinct and purposeful. |
| Oversized input/context artifact? | **Yes — primary cause.** PLAN-archive.md at 52KB forces any full-file rewrite to cost ~16K output tokens. |
| Pathological tool/read pattern? | **Partial.** The double-read of PLAN.md (turns 5+6) wasted one tool slot. The blocked Bash wasted one slot + 1,930 output tokens. Together these cost 2 of 10 tool slots. |
| Orchestration-level issue? | **No.** Model routing, gate handling, and run management were correct. |

## Causal chain (ordered)

1. `agents/documenter.md` Step 4c prescribes `cat >>` for PLAN-archive append
2. `hooks/bash-guard.js` blocks `cat` → agent wastes 1 tool slot + 1,930 tokens
3. Agent falls back to Read-then-Write-entire-file for the append
4. `docs/PLAN-archive.md` is 52KB → Write outputs 16,462 tokens (57KB rewrite)
5. 3 tool slots consumed by the failed path (blocked Bash, Read archive, Write archive)
6. Agent exhausts maxTurns: 10 on Steps 0–4, never reaches Steps 5–8c

## Recommendations (smallest fix first)

### Fix 1 — Change Step 4c from `cat >>` to Edit (prompt change, zero code)

Replace the `cat >> ... << 'ARCHIVE_EOF'` instruction with an Edit-based append:

> Read the last line of `docs/PLAN-archive.md`. Use Edit with `old_string` = that last line and `new_string` = that last line + newline + the archived section. This appends without rewriting the file.

**Impact:** Eliminates the bash-guard block (saves 1 tool slot + ~2K tokens), eliminates the full-file Write (saves ~16K tokens on current archive size). The agent would use 2 tool calls for Step 4c (Read last line + Edit) instead of the current 3 (blocked Bash + Read entire file + Write entire file).

**Risk:** Edit requires a unique `old_string`. The last line of the archive is typically `---` which may not be unique. Mitigation: use the last 2-3 lines as context.

### Fix 2 — PLAN-archive.md trimming enforcement (structural)

The current Step 8b trims PLAN-archive.md at 500 lines, but this outlier run never reached Step 8b (maxTurns exhaustion). Two sub-options:

- **2a:** Lower the threshold from 500 to 300 lines — would have triggered earlier.
- **2b:** Move trimming to a pre-step (before Step 4) so it runs before the append. Downside: adds complexity to an already-long prompt.

### Fix 3 — Increase maxTurns from 10 to 12 (config change)

Would give the agent headroom to survive the 3-slot penalty from the bash-guard block and still reach later steps. Downside: doesn't fix the root cause (the 52KB Write) and allows more token spend per run.

### Recommended order

**Fix 1 alone** would have prevented this outlier. It eliminates both the wasted Bash attempt and the 16K Write. Fixes 2 and 3 are defense-in-depth but not required if Fix 1 lands.

## Verification

This analysis is based solely on:
- `agent-a73854b5c15b9235d.jsonl` (31 JSONL lines, 175,761 bytes) — the outlier run's full transcript
- `agent-a41bd45c860943389.jsonl` — the Hello World documenter run (comparison)
- `agents/documenter.md` — the current prompt (read this turn, 364 lines)
- `docs/token-audit-2026-04-19-post.md` — the audit report

No prompts, hooks, routing, MCP, or board files were modified.
