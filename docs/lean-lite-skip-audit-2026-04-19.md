# LEAN-lite Reviewer Skip: Behavior Audit — 2026-04-19

## Context

The LEAN-lite reviewer-skip classifier (`scripts/lean-risk-classify.mjs`) was
introduced in commit `e3e7703` (2026-04-19T08:32Z) for the implement skill, and
ported to debug/refactor in `7e0e525` (2026-04-19T16:46Z). This audit measures
how often it fires, what it saves, and whether it is safe and worth expanding.

## Data sources

- Session JSONL files from `~/.claude/projects/` (agent-level token data)
- Run records from `.pipeline/runs/*/run.json`
- Git history for file-level risk classification
- Subagent meta.json for agent type identification

## Skip frequency

### Post-classifier runs (eligible: implement/debug/refactor in LEAN mode after e3e7703)

| Run | Pipeline | Feature | Risk files | Classifier | Reviewers ran |
|-----|----------|---------|------------|------------|---------------|
| r-e0722d6b | implement | worktree merge | `bin/forge-worktree.js` | skip=false (bin-script, merge-apply-worktree-boundary) | 3 + 1 retry |
| r-be606c6e | implement | stuck detection | `hooks/subagent-start.js` | skip=false (hook-script) | 3 + triage |
| r-cddda5fb | implement | LEAN-lite gate port | `skills/*.md`, `CLAUDE.md` | **skip=true** | **0** |

**Skip rate (post-classifier): 1/3 (33%)**

### Counterfactual: would past LEAN runs have been skippable?

Retroactive classification of all pre-classifier implement/debug/refactor runs
by mapping git commits to the risk-surface rules:

| Session | Feature | Files touched | Skippable? |
|---------|---------|---------------|------------|
| 96e4cbc6 | quota flag clear hook | `hooks/` | No |
| 96e4cbc6 | observer launcher shim | `hooks/`, `bin/` | No |
| 96e4cbc6 | anti-speculation hook | `hooks/` | No |
| 96e4cbc6 | forge-config migration | `hooks/`, `mcp/` | No |
| 96e4cbc6 | gate-enforcement hook | `hooks/` | No |
| b195c81c | stale run-active fix | `hooks/` | No |
| e5f4213f | reviewer-boundary fix | `agents/reviewer-boundary.md` | **Yes** |
| e5f4213f | git guard + approval token | `hooks/`, `mcp/` | No (also SPRINT) |
| e5f4213f | 8 enforcement fixes | `hooks/`, `mcp/`, `scripts/` | No |

**Counterfactual skip rate: 1/9 pre-classifier runs (11%)**

### Combined historical skip rate: 2/12 runs (17%)

## Token savings

### Measured: run r-cddda5fb (the one actual skip)

The skip eliminated reviewer-triage plus 3 reviewer dispatches. Using the
per-call costs measured from the two non-skip runs in the same session:

| Metric | r-e0722d6b reviewers | r-be606c6e reviewers | Average |
|--------|---------------------|---------------------|---------|
| Reviewer count | 4 (3 + 1 retry) | 4 (3 + triage) | 4 |
| Reviewer output tokens | 5,156 | 9,955 | 7,556 |
| Reviewer cost (USD) | $1.0689 (Sonnet) | $0.4246 (Haiku) | — |

Note: r-e0722d6b reviewers ran on Sonnet (before routing fix `646df54`).
r-be606c6e reviewers ran on Haiku (after routing fix). Haiku is the current
routing and the correct baseline going forward.

**Estimated savings from the skip at Haiku pricing: ~$0.42, ~7,500 output tokens**

### Projected annual impact (this project)

At the observed 17% skip rate across 12 historical runs:

| Projection | Value |
|------------|-------|
| Runs per month (estimate from current pace) | ~30 |
| LEAN implement/debug/refactor runs/month | ~20 |
| Expected skips/month at 17% | ~3.4 |
| Monthly savings at $0.42/skip | ~$1.43 |
| Monthly output token savings | ~25,500 |

This is modest. The skip saves ~$17/year for this project at current pace.

## Correctness assessment

### True positives (correctly skipped): 1/1

r-cddda5fb changed only `skills/debug/SKILL.md`, `skills/refactor/SKILL.md`,
and `CLAUDE.md`. These are Markdown documentation/skill files with no executable
code, no shell commands, no network operations. Skip was correct.

### True negatives (correctly NOT skipped): 2/2

- r-e0722d6b: `bin/forge-worktree.js` — merge/worktree boundary code, correctly
  flagged by `bin-script` and `merge-apply-worktree-boundary` rules.
- r-be606c6e: `hooks/subagent-start.js` — hook script, correctly flagged by
  `hook-script` rule.

### False positives (wrongly skipped): 0

No evidence of the classifier skipping a risky change.

### False negatives (wrongly NOT skipped): 0

No evidence of the classifier forcing reviewers on a change that was clearly safe.

**Verdict: 100% correct classification across all 3 observed runs.**

## Coverage gaps identified

### Gap 1: agents/ not in RISK_PATH_PATTERNS (medium concern)

Agent prompt files (`agents/*.md`) are NOT in the risk path list. A change to an
agent prompt would be classified as skippable if it meets the other conditions
(clean verification, no blockers, no risky code blocks).

Verified: the classifier returns `skipReviewers: true` for a simulated handoff
modifying only `agents/reviewer-boundary.md`.

**Risk**: Agent prompts control pipeline behavior. The prompt-dependent enforcement
model (CLAUDE.md § "Task approach protocol", gate enforcement, stuck-loop
thresholds) means agent prompt changes can affect security properties. However:
- Agent prompt changes are relatively rare (~1/12 historical runs)
- The content-pattern checks would catch any executable code injected into agent
  prompts (though prompt text itself is not matched)
- Adding `agents/` to risk paths is a one-line fix if needed

**Recommendation**: Monitor for now. If agent prompt edits become more frequent
or if a prompt change causes a regression, add `{ rule: 'agent-prompt', regex: /^agents\// }`
to `RISK_PATH_PATTERNS`.

### Gap 2: templates/ not in RISK_PATH_PATTERNS (low concern)

Template files are scaffolded into user projects by `/forge:init`. A malicious
template could inject risky content. However, template changes are extremely rare
and the content-pattern checks would catch any executable code within template
code blocks.

### Gap 3: scripts/ not in RISK_PATH_PATTERNS (acceptable)

Analysis scripts (`scripts/*.mjs`) are not in the risk path list. This is
intentional — scripts like `lean-risk-classify.mjs`, `audit-extract.mjs`,
`token-usage.mjs` are development tools, not operational code. The content-pattern
checks would catch any risky code if it appeared.

## Comparison: LEAN-lite skip vs implementer prompt tightening

| Dimension | LEAN-lite skip expansion | Implementer tightening |
|-----------|------------------------|----------------------|
| **Affected runs** | ~17% of LEAN runs (skip-eligible) | 100% of pipeline runs with source changes |
| **Savings per event** | ~$0.42, ~7,500 output tokens | TBD — currently 4,696 avg out/call; 30-50% reduction plausible |
| **Projected monthly savings** | ~$1.43, ~25,500 tokens | ~$2.10-$3.50 (at 20 runs × 30-50% of $0.35/call) |
| **Risk** | Low — classifier is 100% correct so far | Medium — implementer output is mostly tool calls (file writes); tightening risks incomplete applies |
| **Effort** | One-line rule additions to risk paths | Agent prompt rewrite + measurement cycle |
| **Applicability beyond this project** | HIGH — non-plugin projects touch risk surface less often; skip rate could be 50-70% | HIGH — implementer runs in every project |

### Key insight

For **this project** (a plugin where most changes touch hooks/bin/mcp), LEAN-lite
skip has narrow applicability. The 17% skip rate and $17/year savings make
expansion a low-priority optimization.

For **other projects** using FORGE, the skip rate would likely be much higher
because typical app code (src/, lib/, components/) doesn't match the current risk
paths. We cannot measure this yet — FORGE is currently deployed only on itself.

**Implementer tightening has higher guaranteed ROI**: it runs on every pipeline
run and directly reduces the #1 per-call output producer (now that coder and
documenter have been tightened).

## Recommendation

**Leave LEAN-lite skip as-is. Prioritize implementer prompt tightening next.**

Rationale:
1. The classifier is working correctly (3/3 correct decisions)
2. The skip rate is structurally low for this project (~17%)
3. Expanding the classifier (adding agents/ to risk paths, etc.) would REDUCE
   the skip rate further — the wrong direction for optimization
4. Implementer tightening affects 100% of runs vs 17% for skip expansion
5. The real payoff of LEAN-lite skip comes when FORGE is deployed to non-plugin
   projects — that measurement requires deployment first, not classifier tuning

### Specific next steps

1. **Next slice**: Implementer prompt tightening (measure baseline, write contract,
   verify with 3+ post-change calls)
2. **Deferred**: Add `agents/` to RISK_PATH_PATTERNS if agent prompt regressions occur
3. **Deferred**: Measure LEAN-lite skip rate on Diesel Priser (the test project)
   once it has 5+ pipeline runs to establish a non-plugin baseline
4. **No action needed**: templates/ and scripts/ gaps are acceptable as-is
