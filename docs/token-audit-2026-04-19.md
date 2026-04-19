# Token Hotspot & Fan-out Audit — 2026-04-19

## Scope

Bounded audit — one-shot analysis over the 3 most recent Claude Code sessions
for this project, using the transcripts already persisted by Claude Code under
`~/.claude/projects/C--Users-cuj-forge-plugin/<session>/subagents/*.jsonl`. No
new instrumentation, no telemetry platform — a single read-only script
(`scripts/audit-tokens.mjs`) that sums per-message `usage` fields from the
existing JSONL transcripts.

Goal: rank FORGE agents by output tokens and identify the top fan-out paths so
the next slice can target the highest-value output-contract fixes with
evidence, not intuition.

## Methodology

- Source: `assistant`-typed JSONL lines carry `message.usage` with
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`. Agent type is resolved from the sidecar
  `agent-<id>.meta.json` file.
- Sessions covered (most-recent-first, by newest transcript mtime):
  - `e5f4213f-…` — 4 agents (today's refactor for reviewer-boundary)
  - `b195c81c-…` — 9 agents (today's earlier plan/implement with 3×
    reviewer-boundary retries)
  - `96e4cbc6-…` — 35 agents (2026-04-18 larger plan/implement/debug block)
- Ignored: built-in Claude Code subagents (`claude-code-guide`, `Explore`,
  etc.) are reported but not treated as FORGE signal.

Raw tables are emitted by `node scripts/audit-tokens.mjs --top=3`. The numbers
below are pasted verbatim from that run.

## Ranked by output tokens (aggregate, 3 sessions)

| agentType               | out tokens | invocations | out/call avg | cache read |
|-------------------------|-----------:|------------:|-------------:|-----------:|
| forge:coder             |     51,211 |           6 |        8,535 |  2,623,979 |
| forge:reviewer-boundary |     29,166 |          12 |        2,430 |  3,352,271 |
| forge:reviewer-safety   |     28,260 |          11 |        2,568 |  3,568,406 |
| forge:implementer       |     26,875 |           7 |        3,840 |  4,267,758 |
| forge:documenter        |     26,612 |           5 |        5,322 |  1,893,082 |
| forge:researcher        |     18,595 |           2 |        9,298 |  1,857,559 |
| forge:planner           |      4,088 |           1 |        4,088 |    150,124 |
| forge:reviewer-logic    |      3,631 |           1 |        3,631 |    185,606 |
| forge:refactor          |      2,549 |           1 |        2,549 |    286,421 |

(Entries with a single invocation are included for completeness but carry low
statistical weight.)

### Single-run outliers worth flagging

- **documenter, session b195c81c**: 19,155 output tokens in one invocation —
  more than the next 3 documenter runs combined (3,313 total across those
  three). Suggests a pathological long-tail case (large CHANGELOG, full
  solution-capture block, architecture update, plus archival prose all in one
  shot). Worth surfacing in the prompt-contract review.
- **coder, session 96e4cbc6**: top three coder invocations produced 13,393 /
  10,717 / 7,033 tokens out. Five of the six coder invocations in the audit
  window came from that one session — suggests a cluster of heavy-plan features
  or a handoff template that invites over-writing.
- **reviewer-boundary, session b195c81c**: three invocations, all before
  today's reviewer-boundary prompt fix, producing 4,944 / 2,221 / 925 output
  tokens despite the third dispatch never emitting a verdict. That is a
  canonical zero-value-output fan-out — this specific pathology is now fixed
  (see `agents/reviewer-boundary.md:18` and `:138`).

## Top fan-out paths (top 5)

Fan-out = the number of downstream agents that consume a single upstream
agent's artifact within the same pipeline run. Derived from the pipeline
topology in `CLAUDE.md` + observed invocation counts.

1. **coder → `docs/context/handoff.md` → {reviewer-safety, reviewer-boundary,
   reviewer-logic, reviewer-style, reviewer-performance, completeness-checker,
   implementer}** — one coder output feeds up to 7 downstream readers. In
   session 96e4cbc6, a single coder run was followed by 5 reviewer-safety + 4
   reviewer-boundary invocations reading the same handoff. Biggest multiplier
   in the system.
2. **planner → `docs/PLAN.md` → {plan-stage reviewer-safety,
   reviewer-boundary, reviewer-logic, researcher-triage, coder}** — one
   planner output feeds ~5 downstream readers at plan stage and is re-read at
   implement stage by coder and implementer.
3. **reviewer-triage → `docs/context/triage-excerpts/<reviewer>.md` →
   {each reviewer}** — one triage run writes 3–5 per-reviewer excerpts; each
   is consumed exactly once but by a high-fan-out agent class. Net effect:
   triage reduces downstream input but adds its own output.
4. **researcher → `docs/RESEARCH/<slug>.md` → {planner, coder via handoff}** —
   two researcher runs in session 96e4cbc6 produced 12,862 and 5,733 output
   tokens; each is read by planner and persisted into the handoff chain.
5. **reviewer-* verdict → orchestrator** — low multiplier (1 consumer) but
   every reviewer pays the full prose + signal cost to deliver a
   few-bytes JSON verdict. This is an output-contract target, not a fan-out
   target.

## Recommendation: first 2–3 prompt-contract targets

Ranked by expected $-saved × ease-of-change:

1. **coder** — #1 aggregate output producer (51k out) AND #1 fan-out source
   (handoff fans out 7×). Every token saved here is amplified by the
   downstream read chain. The lever: structured handoff contract (fixed
   section order, word caps per section, no restating of `PLAN.md`, no
   self-review prose that reviewers re-chew).

2. **reviewer-safety** — highest invocation count (11). Its skip-gate at
   `agents/reviewer-safety.md:30` ("no new file-writing handler → APPROVED
   immediately") already exists, but per-call output (avg 2,568) suggests the
   non-skip path still emits substantial prose. The lever: cap
   `### Verified` list length, require file output only (no prose in text
   response — the `[reviewer-verdict]` signal is the only stdout emission).

3. **documenter** — outlier single-run (19,155). The lever: re-examine
   Step 8c (knowledge compounding) and the archival bash blocks — they are
   the largest prose-generating sections. Also: CHANGELOG entries currently
   accept free-form bullet prose; schema constraint (e.g. "≤ 3 bullets, ≤ 120
   chars each") would compress without losing signal.

A fourth candidate worth flagging but not in the first slice: **planner**.
Its per-call output is modest (4,088) and its single invocation here limits
statistical weight, but its fan-out is second-largest in the topology and its
output shape drives every downstream agent. Best addressed in slice 2 along
with the canonical-artifact redesign below.

## Verbosity-classes evaluation

The brief asked whether a dedicated "verbosity classes" system is still needed
after the likely Phase 1 and 2 changes, or whether schema constraints would
carry most of the weight.

Based on the data:

- Average per-call output for all reviewer-* agents is between 2.4k and
  2.6k tokens — already compressed by design (they write to a file and emit a
  signal line).
- The big producers (coder, researcher, documenter) emit
  semantically-required content, not filler — the lever on those is **output
  schema**, not a separate verbosity dial.
- A verbosity-class abstraction would add a layer of indirection without
  closing the actual gap: the current cost isn't "agents choosing to be
  verbose," it's "output contracts that allow unbounded prose in certain
  sections" (free-form self-review in coder, free-form bullets in documenter,
  free-form `### Verified` lists in reviewers).

**Recommendation: do not add a verbosity-class system.** Schema constraints +
file-only output discipline + skip-gate expansion will capture the gain with
less machinery. Revisit only if a measurable residual remains after the first
two slices.

## First canonical artifact target

Per the brief, pick one and only one artifact to redesign first. Evidence
supports **`docs/PLAN.md` (planner output)** as the right first target:

- Earliest pivot point in the chain — shape changes here cascade into every
  downstream consumer (researcher-triage, coder, handoff, reviewers).
- Smallest current size (single invocation, 4,088 tokens) — cheap to
  redesign and re-run.
- Planner output drives coder's handoff template and reviewer-triage
  categorisation; a structured planner artifact (explicit task list,
  per-task files-to-touch, explicit module assignment) lets coder drop the
  restate-PLAN preamble entirely, which is the single biggest coder output
  saving identified above.
- Handoff redesign is the natural *second* target once PLAN.md's structure
  is fixed, because handoff inherits much of its shape from PLAN.md.

Do **not** attempt both in one slice.

## Caching note (parallel track, not part of this slice)

- Cache-read totals observed: 13,446,739 tokens in session 96e4cbc6 alone —
  caching is working and is already the dominant cost-reducer.
- `cache_creation_input_tokens` is large for every reviewer invocation
  (avg 70–150k), which indicates per-invocation re-caching. For cache to hit
  across reviewer dispatches, the stable portion of the prompt
  (agent-system-prompt + GENERAL.md + architectural context) must sit at the
  front, and task-specific content (handoff excerpt) must sit at the end.
- Not implementing here — a separate track should audit whether the
  prompt-assembly order in `reviewer-triage.md` and per-agent prompts actually
  preserves the cache-prefix invariant.

## Non-goals respected (self-check)

- No agent prompt rewrites in this slice.
- No routing changes in this slice.
- No pricing/power work.
- No verbosity-class system added.
- No generalized telemetry platform — one script, one-shot read.
- No broad handoff redesign — one artifact target identified only.
- No caching implementation — noted as parallel track only.

## Next recommended slice

Tighten the **coder output contract** first (single highest-leverage target,
confirmed by the data). Scope: restructure `agents/coder.md` output sections
with explicit caps and no-prose rules for self-review; downstream reviewers
inherit the smaller input automatically. Keep it to one agent prompt and one
mode (LEAN). Re-run this audit after to measure the delta.
