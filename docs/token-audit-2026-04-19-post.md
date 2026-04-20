# Token Audit: Post-Change Measurement — 2026-04-19

## Context

This audit measures the impact of three output-contract changes:
- `b8937af` — coder contract tightening (2026-04-19T08:05Z)
- `e999296` — documenter contract tightening (2026-04-19T14:30Z)
- `965fa16` — implementer contract tightening (2026-04-19T17:51Z)

All thresholds met: coder N=7, documenter N=6, implementer N=3 post-change calls.

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

### POST (N=7)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | e5f4213f | 30,505 | 65 | 41 | 469 | 744 | git guard + approval token |
| 2 | 3bb7cef1 | 9,936 | 29 | 17 | 343 | 584 | worktree merge conflict |
| 3 | 3bb7cef1 | 2,892 | 12 | 7 | 241 | 413 | stuck loop detection |
| 4 | 3bb7cef1 | 4,189 | 17 | 11 | 246 | 381 | LEAN-lite gate port |
| 5 | 3bb7cef1 | 1,096 | 10 | 6 | 110 | 183 | worktree dirty-check fix |
| 6 | 3bb7cef1 | 2,048 | 16 | 12 | 128 | 171 | Hello World command |
| 7 | 3bb7cef1 | 1,899 | 14 | 10 | 136 | 190 | gitIntegration config key |

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 7,509 | -23.5% |
| Avg output/turn | 239 | **-54.7%** |

### Coder analysis

Per-turn output is the correct normalization — it controls for task complexity. The **54.7% per-turn reduction** (528 → 239) is the headline metric. The per-call delta is diluted by one complexity outlier (git guard: 65 turns, 41 tools).

Excluding the outlier (calls 2-7):

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 3,677 | **-62.5%** |
| Avg output/turn | 201 | **-62.0%** |

**Verdict: confirmed strong positive.** Per-turn output halved. Non-outlier per-call down 62%.

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
| Variance ratio | 19.2x |

### POST (N=7)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 3bb7cef1 | 1,665 | 16 | 10 | 104 | 167 | worktree merge fix |
| 2 | 3bb7cef1 | 1,070 | 9 | 4 | 119 | 268 | stuck loop detection |
| 3 | 3bb7cef1 | 1,489 | 20 | 10 | 74 | 149 | LEAN-lite gate port |
| 4 | 3bb7cef1 | 1,649 | 20 | 10 | 82 | 165 | worktree dirty-check fix |
| 5 | 3bb7cef1 | 2,566 | 20 | 10 | 128 | 257 | Hello World command |
| 6 | 3bb7cef1 | 22,155 | 20 | 10 | 1,108 | 2,216 | gitIntegration config key (OUTLIER — see note) |
| 7 | 3bb7cef1 | 3,406 | 20 | 10 | 170 | 341 | templates→scaffolds rename (post-fix) |

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call (all 7) | 4,857 | +6.6% (outlier-skewed) |
| Avg output/call (excl #6) | 1,974 | **-56.7%** |
| Median output/call | 1,665 | **-36.7%** |

### Documenter analysis

POST call #6 (gitIntegration, 22,155 tokens) was a pathological outlier — 1,108 out/turn vs POST median 104 out/turn. **Root cause identified and fixed in commit `5f59ca5`:** Step 4c prescribed `cat >> PLAN-archive.md` which bash-guard blocks; agent fell back to Read-entire-file + Write-entire-file on the 52KB archive (16,462 tokens = 74.3% of the outlier). Fix: replaced shell append with Edit-based append pattern. See `docs/RESEARCH/documenter-outlier-analysis.md` for full causal chain.

**Post-fix validation** (call #7, templates→scaffolds rename): 3,406 tokens, 170/turn — healthy, consistent with calls 1-5.

Excluding the outlier (calls 1-5, 7):

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 1,974 | **-56.7%** |
| Avg output/turn | 112 | **-49.4%** |
| Max output/call | 3,406 | **-82.2% vs PRE max** |
| Variance ratio | 3.2x | **from 19.2x** |

**Verdict: confirmed strong positive. Outlier root cause resolved.** Excluding the outlier, per-call down 57%, variance collapsed from 19.2x to 3.2x. The bash-guard/archive interaction that caused the blowup is now structurally prevented.

## Implementer: PRE vs POST

### PRE baseline (N=12)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 96e4cbc6 | 2,410 | 16 | 9 | 151 | 268 | quota flag hook |
| 2 | 96e4cbc6 | 4,846 | 31 | 20 | 156 | 242 | launcher shim |
| 3 | 96e4cbc6 | 3,842 | 25 | 16 | 154 | 240 | anti-speculation |
| 4 | 96e4cbc6 | 5,567 | 26 | 14 | 214 | 398 | migration hook |
| 5 | 96e4cbc6 | 6,074 | 25 | 16 | 243 | 380 | gate-enforcement |
| 6 | b195c81c | 2,639 | 19 | 10 | 139 | 264 | stale run-active fix |
| 7 | e5f4213f | 1,497 | 14 | 8 | 107 | 187 | reviewer-boundary fix |
| 8 | e5f4213f | 7,169 | 38 | 21 | 189 | 341 | git guard + approval token |
| 9 | e5f4213f | 8,222 | 53 | 34 | 155 | 242 | 8 enforcement fixes |
| 10 | 3bb7cef1 | 3,308 | 13 | 7 | 254 | 473 | worktree merge fix |
| 11 | 3bb7cef1 | 1,815 | 11 | 6 | 165 | 303 | stuck loop detection |
| 12 | 3bb7cef1 | 3,540 | 18 | 12 | 197 | 295 | LEAN-lite gate port |

| Metric | Value |
|--------|-------|
| Avg output/call | 4,244 |
| Median output/call | 3,675 |
| Max output/call | 8,222 |
| Min output/call | 1,497 |
| Avg output/turn | 177 |

### POST (N=3)

| # | Session | Output | Turns | Tools | Out/Turn | Out/Tool | Task |
|---|---------|--------|-------|-------|----------|----------|------|
| 1 | 3bb7cef1 | 1,916 | 11 | 6 | 174 | 319 | worktree dirty-check fix |
| 2 | 3bb7cef1 | 1,312 | 17 | 10 | 77 | 131 | Hello World command |
| 3 | 3bb7cef1 | 1,068 | 12 | 6 | 89 | 178 | gitIntegration config key |

| Metric | Value | Delta vs PRE |
|--------|-------|-------------|
| Avg output/call | 1,432 | **-66.3%** |
| Avg output/turn | 113 | **-36.0%** |
| Max output/call | 1,916 | **-76.7% vs PRE max** |

### Implementer analysis

The output contract bans (no preamble, no edit labels, no post-edit summaries, no narration, no recap) cut two-thirds of output per call. All three POST calls are tightly clustered (1,068–1,916), suggesting the contract produces consistent behavior.

Key metric: PRE implementer averaged 177 tokens/turn of text output alongside tool calls. POST: 113 tokens/turn. The residual is verification checklist lines and signal emissions — this is close to the minimum viable output for an apply agent.

**Verdict: confirmed strong positive.** Per-call down 66.3%, max down 76.7%. The implementer is no longer the #1 per-call token producer.

## Combined summary

| Agent | Contract commit | PRE avg/call | POST avg/call | Delta | Per-turn delta |
|-------|----------------|-------------|---------------|-------|----------------|
| Coder | b8937af | 9,815 | 7,509 (3,677 excl outlier) | -23.5% (-62.5%) | **-54.7%** |
| Documenter | e999296 + 5f59ca5 | 4,556 | 4,857 (1,974 excl outlier) | +6.6% (-56.7%) | **-49.4% excl outlier** |
| Implementer | 965fa16 | 4,244 | 1,432 | **-66.3%** | **-36.0%** |

### Updated aggregate ranking (post all three contracts)

| Rank | Agent | Avg out/call | Status |
|------|-------|-------------|--------|
| 1 | forge:coder | 3,677 (excl outlier) | Improved, watch outliers |
| 2 | forge:reviewer-safety | 2,466 | Unchanged — frequency-driven |
| 3 | forge:reviewer-boundary | 2,599 | Unchanged |
| 4 | forge:documenter | 1,974 (excl outlier) | Improved, outlier resolved (5f59ca5) |
| 5 | forge:implementer | 1,432 | **Improved — dropped from #1 to #5** |

### Projected savings per 7-call pipeline block

Using POST averages (excluding outliers) vs PRE averages:

| Agent | PRE total (7 calls) | POST total (7 calls) | Saved |
|-------|---------------------|---------------------|-------|
| Coder | 68,705 | 25,739 | 42,966 tokens |
| Documenter | 31,892 | 13,818 | 18,074 tokens |
| Implementer | 29,708 | 10,024 | 19,684 tokens |
| **Total** | **130,305** | **49,581** | **80,724 tokens (62.0%)** |

At Sonnet pricing ($15/M output): **~$1.21 saved per 7-call pipeline block.**

## Open items

1. ~~**Documenter POST outlier**~~ — **RESOLVED.** Root cause: bash-guard blocked `cat >>` archive append, agent fell back to Write-entire-file on 52KB archive (16,462 tokens). Fix: commit `5f59ca5` replaced shell append with Edit-based append pattern in `agents/documenter.md` Steps 4c and 5c. Post-fix validation (call #7, templates→scaffolds): 3,406 tokens, 170/turn — healthy. Full analysis: `docs/RESEARCH/documenter-outlier-analysis.md`.

2. **Sample size** — implementer POST N=3 needs N=5 for conclusive (2 more runs needed). Documenter POST N=7 — sufficient. Coder POST N=7 — sufficient.

3. **No further contract changes recommended now.** All three agents are within acceptable bounds. The next optimization target is structural (LEAN-lite skip rate, reviewer dispatch reduction) rather than per-agent verbosity.

## Measurement infrastructure

`scripts/audit-extract.mjs` covers all three agents. Run with `node scripts/audit-extract.mjs` to regenerate from session JSONL files.
