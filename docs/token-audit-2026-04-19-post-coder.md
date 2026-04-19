# Token Audit: Post-Coder Contract Impact — 2026-04-19

## Context

Prior audit (`docs/token-audit-2026-04-19.md`) identified `forge:coder` as the
#1 output-token hotspot (51,211 tokens / 6 invocations / avg 8,535 per call)
and recommended tightening the coder output contract as the first target.

Commit `b8937af` ("feat(coder): tighten output contract for low-token handoff")
was applied on 2026-04-19T08:05Z. This follow-up audit measures the impact.

## Data availability

| Session | Timestamp (UTC) | Coder calls | Relation to change |
|---------|----------------|-------------|--------------------|
| `96e4cbc6` | 2026-04-18 | 5 | PRE (baseline) |
| `b195c81c` | 2026-04-19 07:12 | 1 | PRE (baseline) |
| `e5f4213f` | 2026-04-19 09:49 | 1 | POST (1h44m after commit) |
| `3bb7cef1` | 2026-04-19 12:59 | 0 | POST (no coder invoked) |
| `d9c252ec` | 2026-04-18 19:44 | 0 | PRE (no coder invoked) |

**Critical limitation: only 1 post-change coder invocation exists.** This is
insufficient for a statistically meaningful before/after comparison. The
findings below are directional only.

## Coder: before/after comparison

### Raw data — all coder invocations

| Period | Task | Out tokens | Tools | Turns | Out/turn | Out/tool |
|--------|------|-----------|-------|-------|----------|----------|
| PRE | quota-flag-clear hook | 4,942 | 6 | 10 | 494 | 824 |
| PRE | observer-launcher shim | 6,786 | 8 | 13 | 522 | 848 |
| PRE | anti-speculation Stage 1 | 7,033 | 12 | 18 | 391 | 586 |
| PRE | stale run-active.json fix | 8,340 | 19 | 31 | 269 | 439 |
| PRE | gate-enforcement hook | 10,717 | 10 | 15 | 714 | 1,072 |
| PRE | forge-config migration | 13,393 | 11 | 17 | 788 | 1,218 |
| **POST** | **git guard + approval token** | **30,505** | **41** | **65** | **469** | **744** |

### Summary metrics

| Metric | PRE (6 calls) | POST (1 call) | Delta |
|--------|--------------|---------------|-------|
| Avg output/call | 8,535 | 30,505 | +257% |
| Avg output/turn | 492 | 469 | -5% |
| Avg output/tool-use | 776 | 744 | -4% |
| Avg tools/call | 11.0 | 41.0 | +273% |
| Avg turns/call | 17.3 | 65.0 | +276% |

### Interpretation

The total output increase (8,535 → 30,505) is **entirely explained by task
complexity** — the post-change coder performed 3.7x more tool uses and 3.8x
more turns than the pre-change average. The "git guard + approval token" feature
spanned 4 new/modified files across hooks, requiring extensive exploration.

At the per-turn and per-tool-use level, the post-change coder is marginally
more efficient (469 vs 492 tokens/turn, 744 vs 776 tokens/tool). This is
**directionally positive but not conclusive with N=1**.

### Did coder output drop?

**Cannot confirm.** Per-turn efficiency improved ~5% but the single data point
is a complexity outlier. Need 3-5 more post-change coder calls across varied
task sizes to draw conclusions.

## Updated hotspot ranking (5 sessions aggregate)

| Rank | Agent | Out total | Invocations | Avg/call | Cache read |
|------|-------|----------|-------------|----------|------------|
| 1 | forge:coder | 81,716 | 7 | 11,674 | 4,902,201 |
| 2 | forge:implementer | 42,266 | 9 | 4,696 | 8,230,386 |
| 3 | forge:reviewer-boundary | 33,791 | 13 | 2,599 | 3,886,271 |
| 4 | forge:documenter | 32,149 | 7 | 4,593 | 3,301,724 |
| 5 | forge:reviewer-safety | 32,057 | 13 | 2,466 | 4,296,595 |
| 6 | forge:researcher | 19,465 | 3 | 6,488 | 1,914,385 |
| 7 | forge:debug | 8,899 | 1 | 8,899 | 709,873 |
| 8 | forge:ideator | 6,171 | 1 | 6,171 | 1,286,532 |
| 9 | forge:planner | 4,088 | 1 | 4,088 | 150,124 |
| 10 | forge:reviewer-logic | 3,631 | 1 | 3,631 | 185,606 |
| 11 | forge:refactor | 2,549 | 1 | 2,549 | 286,421 |

### Change from prior audit

| Agent | Prior out | Current out | Prior rank | Current rank | Change |
|-------|----------|-------------|------------|--------------|--------|
| forge:coder | 51,211 | 81,716 | #1 | #1 | +30,505 (1 new call) |
| forge:implementer | 26,875 | 42,266 | #4 | #2 | +15,391 (2 new calls) |
| forge:reviewer-boundary | 29,166 | 33,791 | #2 | #3 | +4,625 (1 new call) |
| forge:documenter | 26,612 | 32,149 | #5 | #4 | +5,537 (2 new calls) |
| forge:reviewer-safety | 28,260 | 32,057 | #3 | #5 | +3,797 (2 new calls) |

Coder is still #1. Implementer jumped from #4 to #2.

## Updated fan-out ranking

| Path | Fan-out | Key metric |
|------|---------|------------|
| coder → handoff → {reviewers, completeness, implementer} | 1→7 | Still largest |
| planner → PLAN.md → {reviewers, coder, researcher-triage} | 1→5 | Still second |
| reviewer-triage → excerpts → {each reviewer} | 1→3-5 | Reduces downstream input |
| implementer → source files → {documenter} | 1→1 | Low fan-out, high volume |
| documenter → CHANGELOG + ARCHITECTURE → {future sessions} | 1→N | Cross-session, unbounded |

## Documenter variance analysis

The documenter shows the widest per-call variance of any agent:

| Session | Out tokens | Description |
|---------|-----------|-------------|
| b195c81c | 19,155 | Full CHANGELOG + architecture + solutions |
| e5f4213f (a) | 4,144 | Standard documenter |
| e5f4213f (b) | 2,906 | Standard documenter |
| e5f4213f (c) | 2,631 | Standard documenter |
| 96e4cbc6 (a) | 1,312 | Lightweight documenter |
| 96e4cbc6 (b) | 1,003 | Lightweight documenter |
| 96e4cbc6 (c) | 998 | Lightweight documenter |

Range: 998 to 19,155 (19x). The outlier (19,155) is a single-call pathological
case that exceeds the next 6 calls combined. This suggests the documenter
contract has no effective ceiling — when a session has large accumulated changes,
the output grows without bound.

## Recommendation: next output-contract target

### Primary: documenter

**Why now, not coder:** The coder contract was already tightened and its impact
cannot be confirmed yet (N=1). Waiting for more coder data is the right call.
Meanwhile, documenter is the clearest unbounded-output agent with actionable
evidence:

- **19x variance** (998 to 19,155) — no other agent shows this range
- **#4 aggregate** (32,149 total) but **#2 by worst-case** (19,155 single call)
- The pathological case is well-understood: large CHANGELOG, solution-capture,
  architecture update, and archival prose all in one shot
- The fix is structural: cap CHANGELOG entries (3 bullets, 120 chars each),
  eliminate solution-capture prose, require file-only output for architecture

**Expected impact:** Capping the long-tail would bring the worst-case from
~19k to ~4-5k (matching the standard calls), saving ~14k tokens on pathological
runs. Average-case savings are smaller (~1-2k) since most calls are already
under 4k.

### Secondary: implementer (defer)

Implementer is #2 aggregate (42,266) with 9 invocations. Per-call average
(4,696) is moderate, and the output is mostly tool calls (Write/Edit operations
on source files). Less opportunity for contract tightening since output content
is inherently determined by the code being written. Better addressed through
task-scoping (smaller handoff slices) than output caps.

### Coder: collect more data first

Do not make further coder contract changes until 3-5 more post-change
invocations provide a real baseline. The per-turn efficiency improvement (5%)
is encouraging but not conclusive. If it holds across varied task sizes, the
coder contract change saved ~23 tokens/turn — meaningful at scale but not
transformative.

## Non-goals respected

- No prompt edits in this slice
- No routing changes
- No hook changes
- No handoff redesign
- No board.json changes
- Analysis only — fresh measurement and evidence-based ranking

## Next recommended slice

Tighten the **documenter output contract** (`agents/documenter.md`):
- Cap CHANGELOG entries: max 3 bullets, max 120 chars each
- Eliminate inline solution-capture prose — write to file only
- Cap architecture-update section: max 10 lines of changes
- Re-run this audit after 3-5 documenter calls to measure impact
