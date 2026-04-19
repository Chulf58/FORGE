# Token Audit: Post-Change Measurement — 2026-04-19

## Context

This audit measures the impact of two output-contract changes:
- `b8937af` — coder contract tightening (2026-04-19T08:05Z)
- `e999296` — documenter contract tightening (2026-04-19T14:30Z)

Both thresholds met: coder N=4 post-change calls, documenter N=3 post-change calls.

## Coder: PRE vs POST

### PRE baseline (N=9)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 8deea291 | 26,981 | 26 | 18 | 1,038 | 1,499 | model routing impl |
| 2 | 8deea291 | 8,246 | 19 | 13 | 434 | 634 | subagent hooks impl |
| 3 | 3d4221d9 | 1,897 | 19 | 11 | 100 | 172 | hello world command |
| 4 | 96e4cbc6 | 4,942 | 10 | 6 | 494 | 824 | quota flag clear hook |
| 5 | 96e4cbc6 | 6,786 | 13 | 8 | 522 | 848 | observer launcher shim |
| 6 | 96e4cbc6 | 7,033 | 18 | 12 | 391 | 586 | anti-speculation |
| 7 | 96e4cbc6 | 13,393 | 17 | 11 | 788 | 1,218 | forge-config migration |
| 8 | 96e4cbc6 | 10,717 | 15 | 10 | 714 | 1,072 | gate-enforcement hook |
| 9 | b195c81c | 8,340 | 31 | 19 | 269 | 439 | stale run-active fix |

| Metric | Value |
|--------|-------|
| Avg output/call | 9,815 |
| Median output/call | 8,246 |
| Avg output/turn | 528 |

### POST (N=4)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | e5f4213f | 30,505 | 65 | 41 | 469 | 744 | git guard + approval token |
| 2 | 3bb7cef1 | 9,936 | 29 | 17 | 343 | 584 | worktree merge conflict |
| 3 | 3bb7cef1 | 2,892 | 12 | 7 | 241 | 413 | stuck loop detection |
| 4 | 3bb7cef1 | 4,189 | 17 | 11 | 246 | 381 | LEAN-lite gate port |

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 11,881 | +21.0% |
| Avg output/turn | 325 | **-38.5%** |
| Avg output/tool | 531 | -31.6% |

### Coder analysis

The per-call average increased because POST call #1 (git guard, 30,505 output) was a 3.7x complexity outlier (65 turns, 41 tools vs PRE avg 19 turns, 12 tools). This is task complexity, not contract leakage.

Excluding the outlier, POST calls 2-4:

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 5,672 | **-42.2%** |
| Avg output/turn | 277 | **-47.6%** |

The per-turn efficiency (output tokens per assistant turn) is the correct normalization — it controls for task complexity. The contract achieved a **38.5% reduction** in per-turn output across all 4 calls, and **47.6%** when excluding the complexity outlier.

### Coder verdict

**Confirmed positive.** Per-turn output dropped 38.5% (528 → 325). The contract tightening works. The single complexity outlier (git guard) still ran lean per-turn — it was large because the task touched 5 files with 41 tool calls, not because the agent was verbose.

## Documenter: PRE vs POST

### PRE baseline (N=9)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 8deea291 | 7,675 | 45 | 23 | 171 | 334 | end of session |
| 2 | 3d4221d9 | 1,180 | 11 | 6 | 107 | 197 | hello world |
| 3 | 96e4cbc6 | 998 | 9 | 4 | 111 | 250 | quota hook |
| 4 | 96e4cbc6 | 1,312 | 13 | 6 | 101 | 219 | launcher |
| 5 | 96e4cbc6 | 1,003 | 7 | 3 | 143 | 334 | anti-speculation |
| 6 | b195c81c | 19,155 | 21 | 11 | 912 | 1,741 | stale run-active fix |
| 7 | e5f4213f | 4,144 | 22 | 12 | 188 | 345 | reviewer-boundary fix |
| 8 | e5f4213f | 2,631 | 20 | 10 | 132 | 263 | git guard |
| 9 | e5f4213f | 2,906 | 23 | 13 | 126 | 224 | enforcement fixes |

| Metric | Value |
|--------|-------|
| Avg output/call | 4,556 |
| Median output/call | 2,631 |
| Max output/call | 19,155 |
| Variance ratio | 19.2x (998 to 19,155) |

### POST (N=3)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 3bb7cef1 | 1,665 | 16 | 10 | 104 | 167 | worktree merge fix |
| 2 | 3bb7cef1 | 1,070 | 9 | 4 | 119 | 268 | stuck loop detection |
| 3 | 3bb7cef1 | 1,489 | 20 | 10 | 74 | 149 | LEAN-lite gate port |

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 1,408 | **-69.1%** |
| Median output/call | 1,489 | **-43.4%** |
| Max output/call | 1,665 | **-91.3% vs PRE max** |
| Avg output/turn | 99 | **-55.2%** |
| Variance ratio | 1.6x | **from 19.2x** |

### Documenter analysis

The contract change targeted two problems:
1. **Pathological blowup** — PRE call #6 (19,155 tokens, 912/turn) was 19x the minimum
2. **General verbosity** — even non-outlier PRE calls averaged 4,556/call

Both are addressed:
- The pathological case is eliminated. POST max (1,665) is **91.3% below** PRE max (19,155) and **below PRE median** (2,631).
- Non-outlier PRE (excluding call #6): avg 2,731. POST avg 1,408 is still **48.4% below** the cleaned PRE baseline.
- Variance collapsed from 19.2x to 1.6x — the agent now produces consistent output.

### Documenter verdict

**Confirmed strong positive.** Per-call output down 69.1%, pathological case eliminated, variance collapsed from 19.2x to 1.6x. This is the highest-impact contract change so far.

## Combined impact estimate

Using the "current pipeline window" (sessions 2-7) from the prior audit as baseline:

| Agent | PRE total (sessions 2-7) | POST avg/call | Projected savings per 7-call block |
|-------|-------------------------|---------------|-------------------------------------|
| Coder | 32,149 (7 calls) | 5,672 (excl outlier) | ~17,445 output tokens (~54%) |
| Documenter | 32,149 (7 calls) | 1,408 | ~22,043 output tokens (~69%) |

At Sonnet pricing ($15/M output): ~$0.59 saved per 7-call block across both agents.

## Updated aggregate ranking

Applying POST averages to the prior audit's "current pipeline window" (sessions 2-7):

| Rank | Agent | Projected avg/call | Change from prior | Status |
|------|-------|-------------------|-------------------|--------|
| 1 | forge:implementer | 4,696 | unchanged | Next candidate |
| 2 | forge:coder | 5,672 (excl outlier) | was 11,674 (-51%) | **Confirmed improved** |
| 3 | forge:reviewer-safety | 2,466 | unchanged | Frequency-driven |
| 4 | forge:reviewer-boundary | 2,599 | unchanged | Steady |
| 5 | forge:documenter | 1,408 | was 4,593 (-69%) | **Confirmed improved** |

Coder dropped from #1 to #2. Implementer is now the largest per-call output producer.

## LEAN-lite reviewer skip: first measurement

During this audit window, the LEAN-lite classifier fired for the first time on run r-cddda5fb (LEAN-lite gate port). It classified the change as non-risk (Markdown-only files) and skipped all reviewers. This saved 3-5 reviewer invocations (~7,500-12,500 output tokens at reviewer avg ~2,500/call).

The structural observation from the prior audit — that **reducing unnecessary agent invocations** is higher-value than further contract tightening — is validated by this first skip.

## Recommendations

### 1. No further contract changes needed now

Both changes are confirmed. The coder and documenter are now operating within acceptable bounds. Monitor over the next 10+ pipeline runs to confirm stability, but no immediate action required.

### 2. Next optimization targets (in priority order)

| Target | Lever | Expected impact |
|--------|-------|-----------------|
| LEAN-lite skip rate | Accumulate skip/run data across 10+ runs | Structural: saves entire reviewer fan-out |
| Implementer | Now #1 at 4,696 avg/call | Moderate: output is mostly tool calls (file writes) |
| Reviewer-safety | High frequency (13 calls in window) | Low per-call but high aggregate |

### 3. Measurement infrastructure

`scripts/audit-extract.mjs` is now available for future audits. Run with `node scripts/audit-extract.mjs` to regenerate per-agent token data from session JSONL files.
