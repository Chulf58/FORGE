# Token Audit: Refresh Hotspot Ranking — 2026-04-19

## Context

Two output-contract changes were applied this session:
- `b8937af` — coder contract tightening (2026-04-19T08:05Z)
- `e999296` — documenter contract tightening (2026-04-19, this session)

This refresh expands the audit window from 5 to 7 sessions and establishes
baselines for both agents. It does NOT confirm impact — post-change sample
sizes are insufficient.

## Session inventory

| # | Session | Date | Agents | Relation to coder change | Relation to documenter change |
|---|---------|------|--------|--------------------------|-------------------------------|
| 1 | `8deea291` | 2026-04-11 | 47 | PRE | PRE |
| 2 | `d1e3f2a4` | 2026-04-17 | 12 | PRE | PRE |
| 3 | `96e4cbc6` | 2026-04-18 | 22 | PRE | PRE |
| 4 | `d9c252ec` | 2026-04-18 | 5 | PRE | PRE |
| 5 | `b195c81c` | 2026-04-19 | 8 | PRE | PRE |
| 6 | `e5f4213f` | 2026-04-19 | 15 | POST (coder) | PRE |
| 7 | `3bb7cef1` | 2026-04-19 | 0 | POST | POST |

## Coder: before/after

### PRE baseline (N=9 calls across sessions 1-5)

| Metric | Value |
|--------|-------|
| Total output | 88,335 |
| Avg/call | 9,815 |
| Median/call | 8,246 |
| Avg/turn | 526 |

### POST (N=1 call, session 6)

| Metric | Value | Delta vs PRE avg |
|--------|-------|------------------|
| Output | 30,505 | +211% total (complexity outlier) |
| Per-turn | 469 | -11% |
| Per-tool | 744 | -4% vs PRE 776 |

### Verdict

**Cannot confirm.** The single post-change call was a 3.7x complexity outlier
(41 tools, 65 turns vs PRE avg 11 tools, 17 turns). Per-turn efficiency
improved 11% — directionally positive but N=1 is not conclusive. Need 3+
additional post-change coder calls across varied task sizes.

## Documenter: baseline established

### PRE baseline (N=9 calls across sessions 1-6)

| Metric | Value |
|--------|-------|
| Total output | 41,004 |
| Avg/call | 4,556 |
| Median/call | 2,631 |
| P75/call | 4,144 |
| Max/call | 19,155 |
| Variance ratio | 19x (998 to 19,155) |

### POST (N=0)

No documenter invocations have occurred since `e999296`. The contract change
targets the pathological case (19,155 outlier) — expected to compress it from
~19k to ~4-5k. Standard calls (median 2,631) should be unaffected or slightly
smaller.

### Verdict

**No measurement possible.** Baseline is solid (N=9). First post-change
documenter call will be the initial signal.

## 7-session aggregate ranking

| Rank | Agent | Out total | Invocations | Avg/call | Notes |
|------|-------|----------|-------------|----------|-------|
| 1 | forge:coder | 118,840 | 10 | 11,884 | Contract changed; 1 post-change call |
| 2 | forge:reviewer-logic | 60,526 | 9 | 6,725 | Inflated by session 8deea291 (8 calls) |
| 3 | forge:reviewer-safety | 55,213 | 16 | 3,451 | Steady, high frequency |
| 4 | forge:researcher | 44,800 | 11 | 4,073 | Moderate, variable |
| 5 | forge:implementer | 42,266 | 9 | 4,696 | Output mostly tool calls |
| 6 | forge:documenter | 41,004 | 9 | 4,556 | Contract changed; 0 post-change calls |
| 7 | forge:reviewer-boundary | 33,791 | 13 | 2,599 | Steady |
| 8 | forge:planner | 30,224 | 8 | 3,778 | Inflated by early session |
| 9 | forge:reviewer-style | 23,156 | 7 | 3,308 | Low frequency |
| 10 | forge:debug | 8,899 | 1 | 8,899 | Single call |

### Session 8deea291 skew

Session 1 (April 11, 47 agents) is an early-development outlier with 8
reviewer-logic calls, 7 planner calls, and 7 researcher calls. It predates
the current pipeline routing and mode system. Excluding it:

| Rank | Agent | Out total | Invocations | Avg/call |
|------|-------|----------|-------------|----------|
| 1 | forge:coder | 81,716 | 7 | 11,674 |
| 2 | forge:implementer | 42,266 | 9 | 4,696 |
| 3 | forge:reviewer-boundary | 33,791 | 13 | 2,599 |
| 4 | forge:documenter | 32,149 | 7 | 4,593 |
| 5 | forge:reviewer-safety | 32,057 | 13 | 2,466 |

This "current pipeline window" (sessions 2-7) is more representative.

## Fan-out map (unchanged)

| Path | Fan-out | Key metric |
|------|---------|------------|
| coder → handoff → {reviewers, completeness, implementer} | 1→7 | Largest |
| planner → PLAN.md → {reviewers, coder, researcher-triage} | 1→5 | Second |
| reviewer-triage → excerpts → {each reviewer} | 1→3-5 | Reduces downstream input |
| implementer → source files → {documenter} | 1→1 | Low fan-out, high volume |

## Recommendation: next steps

### 1. Collect post-change data (blocking)

Both contract changes need real pipeline runs to generate measurement data.
No further contract changes should be made until:
- Coder: 3+ post-change calls (currently N=1)
- Documenter: 3+ post-change calls (currently N=0)

### 2. Next target candidates (after measurement)

Once post-change data confirms or denies impact:

| Candidate | Why | Expected savings |
|-----------|-----|-----------------|
| reviewer-safety | #3 aggregate (55k), 16 invocations, highest frequency | Per-call is moderate (3,451) — volume-driven; triage-excerpt quality is the lever |
| researcher | #4 aggregate (44k), high per-call variance | Output is exploration-dependent; hard to cap without losing utility |
| implementer | #5 aggregate (42k), output is tool calls | Better addressed via task scoping than output caps |

### 3. Structural observation

The highest-value token reduction is not further contract tightening — it is
**reducing unnecessary agent invocations**. Session 8deea291 spent 60k tokens
on reviewer-logic (8 calls) and 30k on planner (7+ calls) because early
pipeline routing lacked the mode system. The LEAN-lite skip rule (`e3e7703`)
already addresses this for clean changes. The next structural lever is
confirming that LEAN-lite actually fires on real runs and measuring reviewer
skip rates.

## Non-goals respected

- No prompt edits in this slice (documenter was a prior slice)
- No routing changes
- No hook changes
- Analysis only — fresh measurement and evidence-based ranking
