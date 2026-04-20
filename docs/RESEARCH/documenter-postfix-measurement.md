# Documenter Post-Fix Measurement — 2026-04-20

## Question

Did commit `5f59ca5` (replace shell archive append with Edit pattern) eliminate the documenter outlier behavior?

## Fix under test

Commit `5f59ca5` (2026-04-19T20:28:49Z) changed `agents/documenter.md` Step 4c from `cat >> PLAN-archive.md << 'ARCHIVE_EOF'` to an Edit-based append pattern (match last 3 lines, extend with new content). Step 6c (board todo archival) received the same Edit-based instruction.

The fix explicitly bans both `Bash cat >>` (blocked by bash-guard) and `Write` (rewrites entire file — token-expensive on large archives).

**Source:** `agents/documenter.md:140-153` (confirmed this turn).

## Data classification

All 9 POST-contract documenter runs in session `3bb7cef1` were reclassified relative to the fix commit:

### Pre-fix (contract applied, before archive-append fix) — N=6

| # | Output | Turns | Tools | Out/Turn | Archive path | Task |
|---|--------|-------|-------|----------|-------------|------|
| 1 | 1,665 | 16 | 10 | 104 | MISS | worktree merge fix |
| 2 | 1,070 | 9 | 4 | 119 | MISS | stuck loop detection |
| 3 | 1,489 | 20 | 10 | 74 | MISS | LEAN-lite gate port |
| 4 | 1,649 | 20 | 10 | 82 | MISS | worktree dirty-check fix |
| 5 | 2,566 | 20 | 10 | 128 | **HIT** | Hello World command |
| 6 | **22,155** | 20 | 10 | **1,108** | **HIT** | gitIntegration config key **(OUTLIER)** |

### Post-fix (after archive-append fix) — N=3

| # | Output | Turns | Tools | Out/Turn | Archive path | Task |
|---|--------|-------|-------|----------|-------------|------|
| 7 | 3,406 | 20 | 10 | 170 | MISS | templates→scaffolds rename |
| 8 | 1,974 | 21 | 11 | 94 | MISS | model routing fix |
| 9 | 1,886 | 20 | 10 | 94 | MISS | SessionEnd/FileChanged hooks |

### Post-fix summary

| Metric | Value |
|--------|-------|
| Avg output/call | 2,422 |
| Avg output/turn | 119 |
| Max output/call | 3,406 |
| Min output/call | 1,886 |
| Variance ratio | 1.8x |

## Critical finding: archive-append path untested post-fix

**None of the 3 post-fix runs exercised the archive-append code path (Step 4c).** The path only fires when the documenter finds a `### Feature:` heading in PLAN.md to archive. Across all 18 documenter runs in the audit window:

| Metric | Value |
|--------|-------|
| Archive-append hits | 4 |
| Archive-append misses | 14 |
| Hit rate | 22% |
| Post-fix hits | **0 of 3** |

P(0 hits in 3 runs at 22% rate) = 0.78³ ≈ 0.47 — statistically unsurprising.

## Pre-fix archive-path comparison

The two pre-fix archive hits tell the story of why the outlier happened:

| Run | Archive size at time | Tool sequence | Output |
|-----|---------------------|---------------|--------|
| Hello World (#5) | ~948 chars | Bash `cat >>` → blocked → Read → **Edit** (948→1,795 chars) | 2,566 |
| gitIntegration (#6) | ~52,170 chars | Bash `cat >>` → blocked → Read entire 52KB → **Write** entire 57KB | **22,155** |

Both hit the same bash-guard block on `cat >>`. The Hello World agent chose Edit (cheap append on a tiny file). The gitIntegration agent chose Write (full-file rewrite on a 52KB archive — 16,462 output tokens for the Write call alone = 74.3% of total output).

**The outlier is a function of two variables:** (1) the agent choosing Write over Edit after the bash-guard block, AND (2) the archive being large. The fix addresses variable (1) by explicitly prescribing Edit and banning Write.

## Current archive state

PLAN-archive.md is now **479 lines / 57,845 bytes** — larger than the 52KB archive that caused the original outlier. If a future documenter run hits the archive path and falls back to Write, the outlier would be **worse** than the observed 22,155 tokens.

## Verdict

| Dimension | Assessment |
|-----------|-----------|
| Fix structurally sound? | **Yes.** The prompt now prescribes Edit-based append (match last 3 lines), explicitly bans both `Bash cat >>` and `Write`. |
| Fix empirically validated? | **No.** Zero post-fix runs have exercised the archive-append path. |
| Outlier pattern eliminated? | **Unknown — insufficient evidence.** The 3 post-fix runs are healthy but only tested CHANGELOG-update paths, not the archive-append path. |
| Normal behavior healthy? | **Yes.** Post-fix non-archive runs average 2,422 out/call, 119 out/turn — consistent with pre-fix non-archive runs (avg 1,468, 95/turn). |
| Variance collapsed? | **Partial.** Post-fix variance is 1.8x (healthy) but only across non-archive runs. The pre-fix non-archive variance was similarly low (2.4x for runs #1-4). The variance was driven by archive-path runs, which haven't been tested. |

**Root-cause verdict: structurally fixed, not yet proven under load.**

## What would constitute proof?

A single documenter run that:
1. Has a `### Feature:` section in PLAN.md to archive (triggers Step 4c)
2. Runs against the current 479-line / 56KB PLAN-archive.md
3. Completes with output < 5,000 tokens and out/turn < 250

This would confirm the Edit-based append works on a large archive without the Write fallback.

## Recommendation

| Action | Priority |
|--------|----------|
| No further prompt changes | The fix is structurally correct. Changing more would be premature without test data. |
| Monitor next archive-triggering run | When it happens naturally (22% rate), verify it uses Edit not Write and check output. |
| Consider PLAN-archive.md trimming | At 479 lines (threshold: 500), the archive is close to triggering Step 8b auto-trim. One more archived feature pushes it over. This is working as designed. |
| No additional test runs needed | The archive path will be exercised organically. Forcing a test run for this alone is not cost-justified. |

**Bottom line:** Documenter is operating within acceptable bounds for all observed post-fix runs. The archive-append fix is correct in design but awaits its first real-world test on a large archive. No further prompt work until that test occurs.

## Audit trail

This analysis used:
- `scripts/audit-extract.mjs` — existing extraction script (no modifications)
- `agents/documenter.md:140-153` — confirmed fix is in place
- 9 documenter JSONL transcripts from session `3bb7cef1` — classified and examined for archive-path interaction
- `docs/PLAN-archive.md` — 479 lines / 57,845 bytes (current size)
- `docs/RESEARCH/documenter-outlier-analysis.md` — original root-cause analysis
- `docs/token-audit-2026-04-19-post.md` — existing audit data

No prompts, hooks, routing, MCP, or board files were modified.
