# User-first planning flow — design doc (draft)

**Status:** DRAFT, in active design conversation 2026-05-22.

This doc captures the design of a new planning flow that brings the user closer to the plan before reviewers run. It is itself being designed using the flow it describes — this conversation between cuj (user) and the conductor is pilot run #1.

## The problem we are fixing

Today's flow puts adversarial review (reviewers + plan-skeptic) between the planner and the user. The user only sees the plan via REVISE findings at gate1. Consequences witnessed in production:

- Plans drift from user intent — reviewers can't catch this because they don't know the intent
- Plans over-engineer — plan-skeptic catches some, but the user catches faster
- Plans surprise the user at implement-time (which means revise + rework cost)
- Phase decomposition happens INSIDE implement-stage, not at plan-time when the user could weigh in

The fix: put the user FIRST in the review chain. Reviewers become a second pass on a user-approved plan, not the first signal.

## The vision — "plan so good everything after is easy"

A plan that fully specifies intent, constraints, anti-goals, acceptance criteria, and per-task verify oracles makes everything downstream mechanical:

- The coder doesn't decide anything — the plan already decided
- No debug needed — the spec captured edge cases at plan time
- No mid-implementation changes — there's nothing left to change
- Reviewers find drift fast — the spec is the comparison point

Today's plans are under-specified at the user-intent level. Reviewers catch structural problems but not intent gaps. User-first planning closes the intent gap so the downstream becomes mechanical because everything has been decided.

This is the WHY. The 6-phase flow exists to make the plan complete enough that execution doesn't need to ask any more questions.

**Implementation:** FORGE vendors Matt Pocock's `grill-me` interview loop into TWO specialized skill files (per turn 22 Gap #2 disposition): `skills/grill-intent/SKILL.md` (Phase A — intent slots) and `skills/grill-plan/SKILL.md` (Phase C — PLAN.md tasks). Both vendor Pocock's 5-line loop with attribution + license citation, then EXTEND with mode-specific FORGE behavior. Phase A invokes `Skill(grill-intent)`; Phase C invokes `Skill(grill-plan)`. Source: `mattpocock/skills/skills/productivity/grill-me/SKILL.md` — fetched 2026-05-22 turn 13. **Reason for skill (not agent):** FORGE agent dispatch uses batch [questions]/[answers] protocol (cited `agents/brainstormer.md:105`), incompatible with Pocock's one-at-a-time pattern. **Reason for two specialized skills (not one bimodal skill):** different cross-reference targets (knowledge_base vs brainstorm), different output semantics (new file vs inline edits), different save-scope mappings. Specialized prose more LLM-reliable than IF/ELSE bimodal prose. Pocock's 5 lines duplicated across two files (with attribution in each) — duplication cost is cheap.

## Principles

1. **User is the first reviewer.** They own intent. Nothing else can substitute.
2. **Grill-me-for-design is not skipped lightly.** A misaligned foundation compounds — if implementation builds on a wrong premise, the whole house leans. The cost of grilling is small; the cost of building on wrong is large. Default is RUN. Skip is an exception with justification.
3. **Walkthrough is review, not redesign.** If big pivots emerge, kick back to Phase A (re-invoke `Skill(grill-intent)`) — don't reshape on the fly.
4. **Conductor neutral first.** State plan content factually, ask user's view BEFORE stating opinion. The walkthrough is the user's stage, not the conductor's.
5. **Reviewers narrow.** Each reviewer specializes in what users genuinely cannot catch as well.
6. **Walkthrough deltas are auditable.** Land them inline in PLAN.md under a `## Walkthrough deltas` section, not in chat-only memory.

## Method disciplines (how this doc stays coherent as it evolves)

These 7 disciplines emerged from the gap-finding patterns in this pilot conversation. They are NOT principles about the planning method itself — they are disciplines for maintaining ANY design doc that evolves through user-first walkthrough. They should also become discipline rules for `## Phase C: plan walkthrough` (every plan walkthrough sweeps the plan against these).

Each discipline has the form: **Rule** / *Why it exists* / *How to apply* / *Example from this pilot*.

### 1. Rename sweep

**Rule:** When something is renamed, grep ALL references. For each, decide: stay (legitimate reference to historical state) or change (forward-looking reference). Never assume.

**Why:** Rename decisions cascade in non-obvious ways. The brainstormer→grill-me-for-design rename was logged in this doc but the artifact path `docs/brainstorms/<slug>.md` and the doc title `# <Feature> — brainstorm` were never explicitly considered. Untracked second-order references rot silently.

**How to apply:** After approving any rename, run a grep for the old name within minutes (not days). For each hit, classify: historical cite (keep), forward-looking (change), implicit decision (resolve).

**Example:** Turn 8 (rename approved) → turn 9 (read-through) revealed 35 "brainstorm" references unresolved. The rename was incomplete the moment it was logged.

### 2. Structural symmetry

**Rule:** Every parallel concept in a doc has the same doc shape. Phases get section + discipline + transcript + checklist; modes get definition + when-applies + example; reviewers get scope + model + dispatch trigger.

**Why:** Readers infer parallelism from layout. When one phase has a transcript and another doesn't, readers conclude (often wrongly) that the second is simpler or less important.

**How to apply:** After adding any parallel item, ask "what shape do siblings have?" and bring the new item up to that shape OR explicitly note why it differs.

**Example:** Phase A.5 was added in turn 8 but only described in the canonical-flow diagram. Phases A, B, C, D, E, F all have dedicated `## Phase X` sections. A.5 was structurally asymmetric until A is applied below.

### 3. Cross-section propagation

**Rule:** When something new lands, sweep N other sections that should mention it. New phases → inline-only list, multi-session scenarios, risks table, implementation list. New principles → trigger conditions, reviewer logic, gate criteria.

**Why:** A new concept that lives in only one section is invisible from the others. Readers entering the doc at a non-introduction section will miss it.

**How to apply:** Maintain a mental list of "propagation targets" for each section type. When editing, check the targets for relevance.

**Example:** Phase A.5 added in turn 8 was missing from "Inline-only enforcement" (line 387-391), "Multi-session orchestration" scenario (line 399-407), and "Risks" table (line 364-371). Three propagation gaps in one change.

### 4. Stale-section sweep

**Rule:** When a new principle or constraint lands, re-read earlier sections written BEFORE the principle. They may contradict or omit it.

**Why:** Earlier sections were written without the principle in mind. They aren't wrong by themselves but are stale relative to the current state of the doc.

**How to apply:** After landing a new principle, list sections written before it; spot-check each for staleness; update.

**Example:** "Trigger semantics" (line 339-347) was written before the Risk principle landed in turn 5. It still says "trivial features could skip" without referencing the deploy-mechanism rule that now governs that decision.

### 5. Single source of truth

**Rule:** For any rename, decision, or constraint, ONE canonical location states it in full. Other locations reference back with `(see X)`.

**Why:** Duplicated statements drift independently. Six months later, one location says "rename to grill-me-for-design" and another says "rename to grill" — and nobody knows which is current.

**How to apply:** When you find yourself writing the same thing in two places, stop. Make one location canonical (typically the section where the topic primarily belongs) and replace the other with a reference.

**Example:** The brainstormer rename plan appears at lines 213-219 (Implementation strategy) AND line 353 (Reviewer set changes item 1). The two versions differ slightly. One must be canonical.

### 6. Open-question disposition

**Rule:** Every open question reaches one of three states within a defined window: **answered** (with the answer landed in the doc), **deferred** (with reason + revisit trigger), or **killed** (no longer relevant). Never just accumulates.

**Why:** Open questions left in place silently shape the design — they become assumptions ("we'll figure it out later") that downstream sections build on. Then the question is forgotten and the assumption hardens.

**How to apply:** At the end of every walkthrough turn, scan open questions; mark each that should change state; document the change.

**Example:** Q1-Q7 in the Open Questions section have accumulated across 8 turns without disposition. Q4 was partly closed in turn 6 but its sub-question (workflow values) is still open. The list is at risk of becoming a parking lot.

### 7. Second-order decisions

**Rule:** When you make a decision, immediately list the second-order decisions it implies. Resolve each, or explicitly defer with reason.

**Why:** Decisions look small at the moment of making them. The implications surface later and surprise you. Capturing implications at decision-time prevents that.

**How to apply:** After deciding X, ask "what does X make true downstream?" — list 2-5 implications. Decide each immediately or list as deferred.

**Example:** "Rename brainstormer.md" (turn 8) implied: agent-roles.json update (captured), skill prose updates (captured), but NOT: directory path `docs/brainstorms/` (forgotten), doc title `# brainstorm` (forgotten), planner reads (forgotten — `agents/planner.md` reads `docs/brainstorms/<slug>.md`). Three second-order decisions surfaced two turns later in turn 9.

### Applying the disciplines

These disciplines are not a checklist for every edit — they're a sweep performed at specific points:

- **After every walkthrough turn**: rename sweep (#1) + open-question disposition (#6)
- **After every new section landing**: structural symmetry (#2) + cross-section propagation (#3)
- **After every new principle landing**: stale-section sweep (#4)
- **At every save**: single source of truth (#5) check on the diff
- **At every decision**: second-order decisions (#7) listed before moving on

The disciplines also become inputs to `## Phase C: plan walkthrough` — the conductor's coherence-check pass against the plan, distinct from the task-by-task review.

## Canonical flow (6 phases)

```
Phase A: intent dialogue (renamed and merged from brainstormer + Phase A.5)
   - Agent reads input + project context, scores 5 slots internally
   - Agent presents initial understanding inline (always — no silent path)
   - Agent walks decision tree, ONE question at a time, with recommended answer per question
   - User reacts: confirm / correct / override / volunteer / drill / advance
   - Codebase-answerable questions: agent looks up instead of asking
   - Iterates until user signals "advance" / "go to planner" — done or not done, no nudge
   ↓ writes docs/brainstorms/<slug>.md (5-slot contract: Wants / Constraints / Don't-wants / Acceptance / Priority + Recommended workflow)
Phase B: planner
   ↓ writes docs/PLAN.md
Phase C: plan walkthrough (conductor + user, inline)
   ↓ may add `## Walkthrough deltas` section to PLAN.md
Phase D: reviewers (technical-skeptic, reviewer-boundary, reviewer-safety [gated])
   ↓ writes verdicts to .pipeline/context/reviewer-output/
Phase E: REVISE walkthrough (if any reviewer REVISEs, conductor + user walk through findings)
   ↓ may add `## Resolution (gate1 REVISE)` section to PLAN.md
Phase F: gate1 approval (user types "approve")
```

**Why one merged phase, not two** — earlier drafts of this doc split intent discovery into Phase A (grill, single-round 0-5 questions) and Phase A.5 (brainstorm walkthrough, iterative). The pilot conversation that produced this doc revealed the boundary was artificial — design dialogue oscillates between agent-asking and user-contributing throughout, not in two sequential phases. Pocock's `grill-me` skill validates this: interview relentlessly, one question at a time, until shared understanding. No phase boundary.

**The "0 questions" problem the merge solves:** if grill emits 0 questions because all slots are filled from input, the user gets no chance to drive — the brainstorm doc is written without their input. The merged design forces the agent to ALWAYS present its understanding and invite user contribution, even when no questions are open. The user always has the floor.

## Phase A: intent dialogue (renamed and merged from brainstormer + Phase A.5)

**Job:** drive the user and conductor to shared understanding of intent, walking the decision tree one branch at a time, until the brainstorm doc is complete enough that the planner doesn't have to guess.

**Trigger:** the agent ALWAYS runs. There is no skip path, no thin-mode shortcut, no silent doc-write. Even when input is fully specified, the agent presents its understanding and waits for user confirmation — the user always has the floor.

### Output schema — `docs/brainstorms/<slug>.md`

Five-slot contract structure (anchored in research-backed RE elicitation slots — see `docs/RESEARCH/grill-me-for-design-discipline.md` lines 215-225 for source):

```markdown
# <Feature> — brainstorm

## Wants (positive intent)
- <what must be true after this ships>
- <what observable behavior or outcome the user gets>

## Constraints (what is fixed, must not change)
- <existing API contracts, performance budgets, UI patterns to preserve>
- <upstream / downstream systems that must continue working>

## Don't-wants / Anti-goals (explicit exclusions)
- <what would a bad version of this look like>
- <what is explicitly out of scope for this slice>

## Acceptance shape
<how the user will know this is done — observable state, not test names>

## Priority / trade-off (only if option-space exists)
<if forced to choose: speed vs completeness, simplicity vs flexibility, etc.>

## Recommended workflow
inline | pipeline
<one-sentence justification, derived from the deploy-mechanism rule in the Risk principle section below>

## Open questions resolved (only if grill asked any)
<Q1: ... → A: ...>
```

The brainstorm doc is the **contract**. Any plan deviation from it should surface in walkthrough as a deliberate decision, not silent drift.

### How Phase A works — invoke `skills/grill-intent/SKILL.md` via Skill tool

Phase A invokes the FORGE-owned skill `skills/grill-intent/SKILL.md`, which contains Pocock's interview loop (vendored with attribution) plus FORGE-specific behavior for intent grilling. Invocation is via the Skill tool: `Skill(grill-intent)`. The skill runs IN the conductor session — the dialogue happens directly with the user, supporting Pocock's one-at-a-time conversational pattern naturally.

**Step 0 — Pre-grill knowledge load (conductor, before agent dispatch).** Conductor calls `forge_get_constraints` + `forge_get_patterns` to gather project-wide knowledge from prior grills. See `## Knowledge loop integration` for full rationale.

**Step 1 — Invoke the skill with FORGE-prefixed context.** Conductor invokes `Skill(grill-intent)` with a leading context message:

```
Pre-loaded project knowledge (inherit unless user overrides):
  - <constraint A> (project-wide, learned r-abc 2026-04)
  - <constraint B> (project-wide, learned r-def 2026-03)

Feature request: <user's input verbatim>
Brainstorm doc target: docs/brainstorms/<slug>.md
```

The skill's PROSE already contains:
- Pocock's 5-line interview loop (vendored)
- The 5-slot output schema
- Save-scope tagging discipline
- Output-write instruction
- Knowledge-load context integration rules

So the conductor's input only needs to pass the feature request + pre-loaded knowledge + target path.

**Step 2 — Skill drives the interview in-session.** Vendored Pocock prose runs: "Interview me relentlessly... walk down each branch of the design tree... for each question, provide your recommended answer... ask the questions one at a time... if a question can be answered by exploring the codebase, explore the codebase instead." User reacts turn by turn.

For each recommended answer about a Constraints / Don't-wants / Priority slot, the skill prose instructs the LLM to include a save-scope tag: `[save-scope: project-wide | feature-only]`. The LLM does this throughout the interview — no instruction-fade risk because it's skill-prose-level (part of the same prose the LLM is following for the interview loop).

**Step 3 — Stop condition.** Continues until user signals advance. No nudge, no cap. Either done or not done.

**Step 4 — Skill writes the brainstorm doc.** Per the skill prose, when the user signals advance, the LLM writes `docs/brainstorms/<slug>.md` using the 5-slot schema. Project-wide save-scope tags drive immediate `forge_add_learning` calls during the doc-write.

**Step 5 — Advance to Phase B.** Conductor (which IS the session running the skill) continues to Phase B, reports the brainstorm doc location.

### Why skill (not agent) — architectural rationale

- **Conversational shape**: Pocock's "ask the questions one at a time" requires turn-by-turn dialogue with the user. Skills run in-session — the conductor's LLM is the one running grill-me, talking with the user directly.
- **Batch protocol mismatch**: FORGE agent dispatch uses batched `[questions]` / `[answers]` (cited `agents/brainstormer.md:105` this turn). Pocock's one-at-a-time pattern doesn't fit batch protocol.
- **FORGE precedent**: 29 skill files already exist in `skills/` (verified turn 19 Glob). Skill is an established FORGE pattern; not a new concept.
- **Vendoring rationale** (vs invoking Pocock's skill from his repo): FORGE additions need to be in the SAME prose the LLM follows, not as wrapper context that might fade. 5 lines of vendored prose with FORGE additions = reliable integration.

### When questions get answered by codebase or knowledge_base lookup

The agent's system prompt extends Pocock's "explore the codebase instead" rule to ALSO mean the knowledge_base (`forge_get_constraints`, `forge_get_patterns`). Pre-loaded knowledge from Step 0 reduces lookup surface further — many "would have asked" questions are pre-answered by inheritance.

### run.json schema for skill activity (Gap #7, resolved turn 22)

The existing `forge_update_run` Zod schema (verified earlier this session via tool-load) accepts:

```
phases: items with {
  index: integer (0-based),
  label: string,
  status: enum (pending|running|completed|skipped|blocked),
  reviewerVerdict: optional (approved|revise|blocked),
  committedAt: optional (ISO timestamp)
}
```

**Schema accommodates plan-stage phases without modification:**

| Phase | Tracked via | Notes |
|---|---|---|
| A (intent dialogue, skill) | `phases[]` entry, index 0 | populated by orchestrator before/after Skill invocation |
| B (planner, agent) | `phases[]` entry, index 1 + `agents[]` entry | double-tracked (intentional — different angles) |
| C (plan walkthrough, skill) | `phases[]` entry, index 2 | same shape as A |
| D (reviewers, agents) | `phases[]` entry, index 3 + `agents[]` entries (multiple) | reviewerVerdict field populated |
| E (REVISE walkthrough, conductor inline) | `phases[]` entry, index 4 | optional — only if any reviewer REVISEs |
| F (gate1 approval) | `phases[]` entry, index 5 + `gateState` | gate-approval tracking unchanged |

**No schema changes needed.** Plan-stage Phase B (planner) gets double-tracked (in phases[] AND in agents[]) — intentional, different lenses.

**Verification at implementation time:**
- `forge_dashboard_state` returns plan-stage phase entries correctly (not implement-stage-specific)
- Observer renders Phase A/C cards distinguishable from B/D (one's a skill, one's an agent — UX clarity)
- No forensic-tool double-counts Phase B's work via both arrays

### Hook attribution for skills (Gap #6, resolved turn 22)

Verified this turn via Glob of `hooks/`: only `subagent-start.js` + `subagent-stop.js` exist for agent lifecycle. No `skill-start.js` or equivalent — Claude Code's hook model doesn't include skill-lifecycle events.

**Implication:** Skill invocations don't auto-populate `run.json` agent trail. Observer would lose visibility of grill activity.

**Resolution: manual attribution via existing `phases[]` field.** The orchestrator (`skills/plan/SKILL.md`) calls `forge_update_run` before and after each skill invocation with phase entries:

```
Step A.0 — forge_update_run({ runId, phases: [
  { index: 0, label: "Phase A — intent dialogue (grill-me)", status: "running" }
]})

Step A.1 — Invoke Skill(grill-intent) with FORGE-prefixed context

Step A.2 — On skill return (user signaled advance):
  forge_update_run({ runId, phases: [
    { index: 0, label: "Phase A — intent dialogue (grill-me)", status: "completed" }
  ]})
```

Same shape for Phase C (Skill invocation #2 with `index: 2`).

**Why this works:**
- `phases[]` field already exists in run.json schema (used today by implement-stage's Phase Execution Loop)
- Observer's existing phase-display logic extends naturally
- No new hook code, no new schema
- Forensic trail: phase boundaries with timestamps in run.json

**Trade-offs:**
- Manual attribution means orchestrator MUST remember the update calls. Discipline-enforced, not hook-enforced.
- Per-question grill detail isn't captured (only phase boundaries). If turn-by-turn audit needed later, separate feature.
- `agent-loop-guard.js` doesn't fire for skill invocations — Phase A's grill can be re-invoked from Phase C with the same skill name. This is INTENDED (same skill, different artifact target). But if a grill loops on itself, no safety net.

**Verification at implementation time:** confirm observer/dashboard rendering of plan-stage phases matches expectations (today's phase display was built for implement-stage labels).

### Orchestration mechanics — skill-in-skill invocation (verified turn 22)

WebSearch this turn confirmed Claude Code natively supports nested skill invocation. Two patterns:

1. **Natural-language coordination** — orchestrator SKILL.md says "once X is done, invoke Skill(Y) to do Z." Claude reads the instruction, invokes Y mid-workflow, applies it, returns to orchestrator's flow.
2. **Subagent isolation** — SKILL.md frontmatter `agent:` field spawns a subagent with the skill's context, for stronger isolation.

`skills/plan/SKILL.md` will use pattern 1 — it orchestrates as a state machine, instructing the conductor LLM to invoke `Skill(grill-intent)` at Phase A start and `Skill(grill-plan)` at Phase C start. Claude coordinates between skills; the skills don't call each other directly.

**Cited sources (turn 22 WebSearch):**
- code.claude.com/docs/en/skills — Claude Code skills documentation
- mindstudio.ai/blog/how-to-build-skill-systems-claude-code
- mindstudio.ai/blog/claude-code-skill-collaboration-pattern
- resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf

**Remaining verification at implementation time:** confirm that orchestrator-skill prose stays salient after inner-skill returns (so Phase A → B → C → D progression resumes correctly). Test before committing to architecture.

### Phase A does NOT auto-load prior brainstorms

Today's `agents/brainstormer.md:117` (cited turn 21) says "Search for prior brainstorms... if a previous brainstorm for the same or very similar feature exists, read it and build on it rather than starting from scratch." This behavior is **deprecated** under the new design. The knowledge_base is the SINGLE automatic compound-knowledge source.

Reasoning: two parallel learning loops (knowledge_base + brainstorm-doc Glob) would drift over time — same constraint could land in 5 brainstorm docs AND in the knowledge_base. Single source of truth is `forge_get_constraints` / `forge_get_patterns`. Past brainstorm docs stay as AUDIT artifacts but are not auto-loaded.

**User-on-demand brainstorm reuse still works.** If the user says "this is similar to feature Y," the conductor can Glob `docs/brainstorms/` and offer to load Y's brainstorm as additional context. This is explicit, user-initiated — not implicit skill behavior.

### Question format rules

Each question:
- One sentence, under 15 words
- Options inline in brackets: `[option1 / option2 / option3 / open]`
- 1-3 word options, max 5 options per question
- Always include `open` as an option (no forced choices)

**Format anti-patterns to reject (all from research §5, lines 147-178):**

1. **Compound questions** — "Tell me what you need AND why AND what success looks like" — one topic per question
2. **Hypothetical questions** — "What would you do if...?" — ask about existing context, not imagined futures
3. **Yes/no questions** — "Do you want this to be fast?" — always include `open` or rephrase as open-ended
4. **Leading questions** — "Did you choose X because it was easy?" — neutral wording only
5. **Generic phrasing** — questions that could apply to any project provide no contextual signal
6. **Solution-requesting** — "Should this use REST or GraphQL?" — pushes implementation decisions before design intent
7. **Mixing requirement categories** — performance + functional behavior in same question
8. **Jargon mismatched to user vocabulary** — speak in the user's domain language
9. **Over-specification** — "Should the button be red or blue?" — visual/implementation details belong in the plan, not discovery
10. **Asking about what's already in project context** — wastes question budget
11. **Asking what you could look up** (Pocock) — if the answer is in the codebase, explore the codebase instead. Wasting a question on a derivable fact is a sin.
12. **Asking without recommending** (Pocock) — every question must include the agent's best guess. "What do you want?" is lazy; "I think you want X — confirm?" forces the agent to commit and lowers user cognitive load.
13. **Front-loading all questions** (Pocock) — ONE question at a time. Front-loading creates a forms-style cognitive burden and prevents dependency-aware ordering.

### Example dialogue (a few turns of a wrapped grill-me session)

The interview prose comes from Pocock's skill. The conductor's first message and final doc-write are FORGE-specific.

```
[conductor — Step 1 wrapper message to grill-me]
Pre-loaded project knowledge (inherit unless I override):
  - API contracts must hold (project-wide, learned r-abc 2026-04)
  - No new MCP tools without explicit user approval (project-wide, learned r-def 2026-04)

When we reach shared understanding, write to docs/brainstorms/auto-fire-compound-refresh.md
using the 5-slot schema. Tag constraints/anti-goals/priorities with [save-scope: project-wide | feature-only].

Feature request: I want auto-fire compound-refresh after apply.

[grill-me — Pocock's prose drives from here]
I'll interview you to reach shared understanding. Let me start with the core intent.

What must not change about the existing apply pipeline?
[my-rec: must not block apply-stage completion / must not double-fire on retries / nothing fixed / open]
[save-scope: project-wide — these feel like permanent constraints]

[user]
my-rec — both.

[grill-me]
Constraints captured. Both tagged project-wide.

What's explicitly out of scope for this slice?
[my-rec: no new MCP tool / no UI changes / no observer rework / none / open]
[save-scope: per-bullet — first one is project-wide (covered by pre-loaded knowledge), others feature-only]

[user]
my-rec for "no UI changes" and "no observer rework." Also: don't auto-fire if apply had reviewer BLOCKs.

[grill-me]
Don't-wants:
  - no UI changes (feature-only)
  - no observer rework (feature-only)
  - no auto-fire if apply had reviewer BLOCKs (feature-only — situational)

(The "no new MCP tool" constraint was already inherited from pre-loaded knowledge.)

How will you know this is done?
[my-rec: compound-refresh card appears in observer within 30s of successful apply / open]

[user]
my-rec. Also: I can cancel a running compound-refresh from the observer.

[grill-me]
Acceptance:
  - compound-refresh card appears within 30s
  - user can cancel a running compound-refresh

I have no further open branches. Summary:
  Wants: 1 / Constraints: 2 (both inherited / confirmed) / Don't-wants: 3 / Acceptance: 2 / Workflow: pipeline

Advance to planner, or drill deeper?

[user]
Advance.

[conductor — Step 4 writes brainstorm doc + Step 5 advances]
Writing docs/brainstorms/auto-fire-compound-refresh.md... done.
Project-wide save-scope tags triggered forge_add_learning for the new constraints.
Advancing to Phase B (planner).
```

**What this example demonstrates:**
- Pocock's prose drives the interview body (recommend per question, one at a time, walk decision tree)
- FORGE wrapping handles knowledge inheritance (pre-load) and save-scope routing (knowledge_base writes)
- Stop is user-driven, no nudge
- Conductor closes by writing the brainstorm doc — Pocock's skill does NOT write files

### LLM-specific prompt-engineering rules (research §6, lines 183-198)

These are constraints on how the agent's system prompt is written, not on its question output:

- **Positive framing, not negation.** "Should surface tacit constraints" beats "don't fail to ask about constraints."
- **Capitalize role labels** in any transcript-shaped context: `USER:`, `GRILL-AGENT:`. Reduces role-attribution errors measurably (research §6).
- **One-shot examples required** for hard self-enforcement criteria: include a good-question / bad-question pair for each of solution-requesting, jargon, technical-framing, multi-category mixing.
- **Step-by-step reasoning** for the coverage-matrix scoring step — numbered list, not prose.

### Implementation strategy — vendor Pocock's prose, extend with FORGE behavior

The work is **vendor + extend + replace**. Four concrete steps:

1. **Verify Pocock's repo license** at `mattpocock/skills` (typically MIT for public GitHub skill repos; check the LICENSE file before vendoring).

2. **Create TWO specialized skill files:**

   - `skills/grill-intent/SKILL.md` for Phase A (intent slots)
   - `skills/grill-plan/SKILL.md` for Phase C (PLAN.md tasks)

   Both contain:
   - Frontmatter (name, description — minimal per skill convention)
   - Attribution block crediting Matt Pocock + source URL + license
   - Vendored Pocock interview loop (5 lines, duplicated across both files with attribution)
   - Mode-specific FORGE behavior (different per skill — see sketches below)
   - Approximately 50-60 lines per file

3. **Delete `agents/brainstormer.md`** and its `agent-roles.json` entry. NOTE: skill files don't need agent-roles.json entries; write-target enforcement for skills happens via the conductor's `ctx-pre-tool.js` hook applied to the calling session, not via agent-roles. Verify this distinction during implementation.

4. **Rewrite `skills/plan/SKILL.md` Phase A + Phase C sections** to:
   - Phase A Step 0: call `forge_get_constraints` + `forge_get_patterns` (knowledge load)
   - Phase A Step 1: invoke `Skill(grill-intent)` with FORGE-prefixed context (pre-loaded knowledge + feature request + brainstorm-doc target path)
   - Phase A Step 2-4: skill drives the interview, writes brainstorm doc when user signals advance
   - Phase B: planner agent (unchanged)
   - Phase C Step 0: read brainstorm doc + PLAN.md
   - Phase C Step 1: invoke `Skill(grill-plan)` with FORGE-prefixed context (brainstorm contents + plan contents + cross-reference instruction)
   - Phase C Step 2-4: skill drives plan walkthrough, inline edits to PLAN.md, returns when user signals advance
   - Phase D-F: reviewers + REVISE walkthrough + gate1 (unchanged from existing design)

**What we DELETE/REPLACE (per discipline #1 — rename/delete sweep):**

| Artifact | Action | Reason |
|---|---|---|
| `agents/brainstormer.md` | DELETE | Replaced by TWO skill files: `skills/grill-intent/SKILL.md` (Phase A) + `skills/grill-plan/SKILL.md` (Phase C). Note: `agents/brainstormer.md:117` "search prior brainstorms" behavior is NOT re-implemented in either skill — deprecated per turn 21 consolidation (knowledge_base is the single automatic learning loop). |
| `agent-roles.json` `brainstormer` entry | DELETE | No agent named brainstormer anymore |
| `[pipeline-mode: thin/full]` signal | DELETE | New agent has no thin/full distinction — always Pocock-style |
| `[slug: ...]` injection from skill prose | KEEP | Agent uses slug for brainstorm-doc path |
| `docs/brainstorms/` directory | KEEP | Planner reads from here (cited `agents/planner.md:71, 79` from earlier this session); doc stays |
| Doc title `# <Feature> — brainstorm` | KEEP | Artifact noun — unaffected by which actor writes it |

**What we ADD:**

| Artifact | Action |
|---|---|
| `skills/grill-intent/SKILL.md` | NEW — vendored Pocock + FORGE Phase A extensions (intent slots) |
| `skills/grill-plan/SKILL.md` | NEW — vendored Pocock + FORGE Phase C extensions (PLAN.md grilling) |
| New `agents/plan-extractor.md` | ADD for post-gate1 knowledge sweep (per Knowledge loop integration §3) — this stays an agent because it runs autonomously after gate1, not interactively |

**What we keep unchanged:**

- 5-slot brainstorm doc schema — load-bearing for planner
- `agents/planner.md` reads brainstorm doc per `agents/planner.md:71` (verified earlier this session) — path stays
- `agents/plan-skeptic.md` reads brainstorm doc as intent proxy per `agents/plan-skeptic.md:36`
- Knowledge loop integration (Phase A pre-step + tag-as-you-go + post-gate1 extractor sweep)

### Downstream consumers to update — surfaced by turn 20 grep

Beyond the headline `agents/brainstormer.md` deletion, these files reference brainstormer and need updating. Citations from turn 20 grep across the FORGE repo:

| File | What references brainstormer | Update |
|---|---|---|
| `skills/plan/SKILL.md` (multiple lines including 26, 28, 30, 35-37, 40, 42, 46) | Phase 1b invocation, slug derivation, error handling | Rewrite Phase A to invoke `Skill(grill-intent)`; add Phase C invocation `Skill(grill-plan)` |
| `agents/planner.md:56, 71, 75` | References "brainstormer asked questions before you run" | Update to reference grill-intent skill (or describe brainstorm doc as input without naming actor — cleaner) |
| `skills/chat/SKILL.md:100` | Pipeline diagram: `brainstormer (conditional) -> planner -> ...` | Update to `grill-intent -> planner -> grill-plan -> reviewers -> ...` |
| `scaffolds/code/CLAUDE.md:43, 62, 131` | Scaffolded project CLAUDE.md describes brainstormer to project's LLM | Rewrite for grill-intent + grill-plan skills (mention both, or describe the brainstorm doc as the contract artifact without naming the producing skill) |
| `forge-config.default.json:161-163` | `"brainstormer": { "requiredCapabilities": ["reasoning"] }` capability mapping | DELETE entry (skills don't have capability mappings — they run in caller's context) |
| `.pipeline/agent-roles.json:10` | `"brainstormer": { "allowedPaths": ["docs/brainstorms/**"] }` | DELETE entry (already documented above) |

**Historical references that stay (per discipline #1 — historical cite vs forward-looking):**

- `CHANGELOG.md` — past record of brainstormer behavior
- `.pipeline/conductor-scratchpad-brainstormer-thin-mode.md` — historical design scratchpad
- `.pipeline/conductor-scratchpad-plan-skeptic.md` — historical reference
- `.pipeline/conductor-scratchpad-roadmap.md` — historical roadmap

**Total downstream-consumer churn:** 6 files need forward-looking edits + 4 historical files that stay. All identified via turn 20 grep; if any future grep finds additional references, add to this table per discipline #1.

### Sketches of the two skill files (Gap #2, resolved turn 22)

#### `skills/grill-intent/SKILL.md` — Phase A

```yaml
---
name: grill-intent
description: "Pocock-style relentless interview to extract design intent. Use at Phase A of /forge:plan when starting a new feature. Produces docs/brainstorms/<slug>.md."
---

<!-- Attribution: vendored from Matt Pocock's grill-me skill
     Source: https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
     License: <verify at vendor time>
     Fetched: 2026-05-22 (turn 13 of pilot conversation) -->

## Core interview loop (Pocock — verbatim)

Interview me relentlessly about every aspect of this plan until we reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## FORGE Phase A behavior

- Read project context: `.pipeline/project.json`, `docs/gotchas/GENERAL.md`, `docs/ARCHITECTURE.md` if present
- Pre-loaded knowledge from invoker context (constraints + patterns from past grills) — present to user as part of initial understanding; user can override
- Decision tree to walk: 5 intent slots — Wants / Constraints / Don't-wants / Anti-goals / Acceptance / Priority
- For each recommended answer about Constraints / Don't-wants / Priority: include `[save-scope: project-wide | feature-only]` tag
- Stop on user signal: "advance" / "go to planner" / "approve"
- On stop: write `docs/brainstorms/<slug>.md` with the 5-slot schema (slug from invoker context)
- Project-wide save-scope items trigger immediate `forge_add_learning` calls
```

#### `skills/grill-plan/SKILL.md` — Phase C

```yaml
---
name: grill-plan
description: "Pocock-style relentless interview to review PLAN.md against brainstorm intent. Use at Phase C of /forge:plan after planner writes PLAN.md. Inline-edits PLAN.md."
---

<!-- Attribution: vendored from Matt Pocock's grill-me skill (same source as grill-intent)
     Source: https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
     License: <verify at vendor time>
     Fetched: 2026-05-22 (turn 13 of pilot conversation) -->

## Core interview loop (Pocock — verbatim)

Interview me relentlessly about every aspect of this plan until we reach a shared understanding.
Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## FORGE Phase C behavior

- Read `docs/brainstorms/<slug>.md` (intent context) and `docs/PLAN.md` (artifact to grill)
- Pre-loaded knowledge from invoker context: AC patterns + test-shape patterns from past plans
- Decision tree to walk: plan tasks (per-task: ACs, Verify lines, dependencies, files touched)
- Cross-reference discipline (load-bearing): flag any Wants / Acceptance / Don't-wants from brainstorm doc that are NOT addressed in PLAN.md tasks. This is the most valuable Phase C catch.
- For each recommended answer about AC shape / Verify-line shape / task decomposition: include `[save-scope: project-wide | feature-only]` tag
- Stop on user signal: "advance" / "approve"
- On stop: PLAN.md already has inline edits from the walkthrough; append/extend `## Walkthrough deltas` section listing what changed and why
- Project-wide save-scope items trigger immediate `forge_add_learning` calls (knowledge_base captures design-pattern-level learnings from this phase)
```

Both files vendor Pocock's 5-line loop. Both extend with mode-specific FORGE behavior. Each ~50-60 lines total.

### Migration impact

Today's brainstormer behavior:
- Thin-mode binary skip-or-ask (`agents/brainstormer.md:50-69`)
- 5-question cap (`agents/brainstormer.md:89`)
- Scope tiers map to question count

Under Option I (skill flavor, two-skill split per turn 22), all of this goes away. `agents/brainstormer.md` is deleted, replaced by `skills/grill-intent/SKILL.md` + `skills/grill-plan/SKILL.md` which use Pocock-style unbounded questioning in the conductor session. The user's previous concern about thin-mode runs is moot — there is no thin-mode, only the Pocock loop that naturally terminates at 0 questions if all slots are filled from input.

The OUTPUT (the brainstorm doc) stays compatible with the planner — same 5-slot schema. Downstream consumers (planner, plan-skeptic) need no changes.

### Risks specific to vendoring

| Risk | Mitigation |
|---|---|
| License doesn't permit redistribution | Verify Pocock's LICENSE file at vendor time; if restrictive (rare for public skill repos), fall back to "inspired by" prose authored from scratch |
| Pocock improves the skill upstream | Manual decision to pull updates; no automatic propagation. Acceptable cost given 5-line prose. |
| Our FORGE additions degrade Pocock's behavior | Code-review the agent file before each release; test on real grill sessions to verify both Pocock loop and FORGE additions work together |
| New FORGE features require modifying interview prose | Modify the agent file directly — we own it. No upstream-dependency to coordinate with. |
| Future maintenance gap | Agent file is 50-80 lines and stable; no significant maintenance load |

## Phase B: planner

**No change to the planner agent itself.** It reads:
1. `docs/brainstorms/<slug>.md` (the contract)
2. `docs/gotchas/GENERAL.md` (project conventions)
3. Codebase as needed

It writes `docs/PLAN.md`. Tighter brainstorm input → tighter plan → less walkthrough churn.

## Phase C: plan walkthrough — invoke `grill-plan` skill with PLAN.md as target

Phase C invokes `skills/grill-plan/SKILL.md` — a specialized skill that vendors the same Pocock interview loop as `grill-intent` (Phase A) but with mode-specific FORGE behavior for plan grilling.

`skills/plan/SKILL.md` Phase C section invokes:

```
Skill(grill-plan)
```

with a leading context message that includes:
- Brainstorm context: contents of `docs/brainstorms/<slug>.md` (intent anchor)
- Plan content: contents of `docs/PLAN.md` (artifact to grill)
- Cross-reference instruction: "flag any Wants/Acceptance from brainstorm not addressed in plan tasks"
- Knowledge load: `forge_get_patterns` for AC/test-shape patterns inherited from prior plans

The skill prose (Pocock loop + FORGE extensions) handles the interview discipline; the context message switches the target from intent to plan.

### Discipline (the rules)

1. **High-level summary first.** Conductor opens with a one-screen summary of PLAN.md — feature, task count, phase count, highest-risk area, any `## Research needed` items. NOT a recitation; an orientation. End with: "Where would you like to start?"

2. **One question at a time, with recommended answer.** Once drilled into a task, the conductor walks AC by AC, Verify line by Verify line, with the agent's recommended answer in each question. Example:
   ```
   Task 3.1, AC-3 says "agent retrieves correct learning given query context."
   [my-rec: this AC is too vague — propose tightening to "agent returns learnings matching tag X for queries containing tag X" / leave as-is / open]
   ```
   User reacts: confirm / correct / override / drill deeper. Conductor edits PLAN.md and moves to the next branch.

3. **Cross-reference plan against brainstorm.** Phase C's highest-value catch: things in the brainstorm that the plan didn't address. Discipline:
   - Conductor reads `docs/brainstorms/<slug>.md` BEFORE starting Phase C
   - During walkthrough, flag any Wants / Acceptance / Don't-wants from brainstorm not visible in plan tasks
   - Example: "Brainstorm Wants includes 'learning loop after apply.' I don't see this addressed in PLAN.md tasks. Should we add a task, or did you decide to defer it?"
   - This is the single most valuable Phase C activity — reviewers cannot do this (they have no intent anchor).

4. **Codebase AND knowledge_base before user.** If a question is answerable by reading the codebase (e.g. "does this AC match the existing Verify-line shape gate?") OR by querying the knowledge_base (`forge_get_constraints`, `forge_get_patterns`), the conductor does that instead of asking. Same Pocock rule as Phase A. Knowledge_base lookup also pre-loads at Phase C start — see `## Knowledge loop integration` for full discipline.

5. **Walkthrough is review, not redesign.** If user wants a fundamentally different APPROACH (not a fix to a task), conductor flags: "This sounds like a re-design — should we kick back to Phase A intent dialogue with the new input?" Don't quietly rewrite the plan in walkthrough. Re-grill against new intent if needed.

6. **Deltas land inline.** Any change agreed → conductor edits PLAN.md, appends to `## Walkthrough deltas` section listing what changed and why. User reviews the edited PLAN.md before advance.

7. **Stop condition: user signals advance.** Same as Phase A. No nudge, no soft cap. "Advance" / "go to reviewers" / "approve gate1" are the exit triggers. Either done or not done.

8. **Always-present-understanding.** Even if conductor's review surfaces no concerns (rare), conductor presents the full task summary + cross-reference findings and asks: "Anything to add or drill, or advance to reviewers?" User always has the floor.

### Example dialogue (3 turns of a longer session)

```
[conductor]
PLAN.md ready. High-level summary:
  Feature: User-first planning flow
  Active tasks: 12 across 3 phases (A→F)
  Highest-risk area: brainstormer refactor + skill prose rewrite
  Brainstorm cross-check: 1 item flagged — your Wants includes "Phase C should be Pocock-style"
    but I see PLAN.md Phase C tasks describe section-summary discipline instead. Worth drilling.

Where would you like to start?

[user]
Start with the Phase C tasks — that flagged thing.

[conductor]
Task 6.3: "Update Phase C walkthrough discipline to Pocock-style."
[my-rec: this matches brainstorm Wants — keep task / brainstorm was wrong, drop / drill into AC / open]

[user]
my-rec — keep task. But the AC needs to be sharper. Show me.

[conductor]
Task 6.3 currently has AC-1: "Phase C uses Pocock-style grilling."
[my-rec: tighten to "Phase C dialogue is one-question-at-a-time with recommended answers,
and conductor cross-references PLAN.md against docs/brainstorms/<slug>.md to flag intent
items not addressed in plan tasks." / keep generic / open]

[user]
my-rec.

[conductor]
Updated. Added to ## Walkthrough deltas: "Tightened Task 6.3 AC-1 per Phase C grill, turn 14."

Next: Task 6.4 covers the cross-reference discipline. Drill or advance to next phase block?

[user]
Drill.
...
```

### Walkthrough complete checklist

Before gate1, conductor confirms:
- [ ] Brainstorm doc was read at start of Phase C
- [ ] Every Wants / Acceptance item from brainstorm was cross-referenced against PLAN.md (and either confirmed-present or explicitly deferred with reason)
- [ ] Every active task has been reviewed at section-summary level OR drilled-into per user request
- [ ] User confirmed each drilled-into task and AC
- [ ] All walkthrough deltas landed in PLAN.md under `## Walkthrough deltas`
- [ ] Any "this is a redesign" moments were kicked back to Phase A, not silently absorbed
- [ ] User explicitly signaled "advance" (no inferred advancement)

## Phase D: reviewers — narrowed and gated

The current 3-reviewer set (reviewer-safety, reviewer-boundary, plan-skeptic) becomes:

### technical-skeptic (renamed from plan-skeptic) — concrete sketch (Gap #8, refined turn 22 → option b)

**Narrowed scope with backstop** — drops some concerns, keeps over-engineering as CONCERN-only:

- ❌ Drop entirely (user owns in Phase A/C): intent drift, Verify-line goal-completeness
- ⚠️ Backstop only (CONCERN severity, NOT REVISE): over-engineering — user catches in Phase A/C; skeptic provides advisory backstop
- ✅ Keep at full REVISE severity: test shape (oracles checking observable outcomes vs implementation details), under-engineering, hidden shared state across waves, failure-path coverage, opacity/debuggability, trust-boundary crossings

Cited from this turn's read of `agents/plan-skeptic.md:56-66` — current scope has 9 concern shapes; refined scope keeps 7 (1 at CONCERN-only).

**Why over-engineering is CONCERN-only:**
- User catches faster in Phase A/C walkthrough (per turn 14 reasoning)
- But technical-skeptic provides backstop for cases where user missed it
- CONCERN severity = advisory, doesn't trigger REVISE loop, doesn't block gate1
- User decides in Phase E whether to address the concern or accept-with-known-risk
- Preserves coverage for less-senior users / domains the user knows less well

**File**: `agents/technical-skeptic.md` (renamed from plan-skeptic.md)
**Model**: claude-opus-4-7 (unchanged — cross-model adversarial review is irreplaceable)
**Output path**: `.pipeline/context/reviewer-output/technical-skeptic.md` (filename matches new agent name)

**Discipline preserved from plan-skeptic.md:**
- Cross-model header tag `[planner: <family>, skeptic: <family>]` (line 23-28)
- Reads brainstorm doc but as GROUNDING context, not sole intent proxy (user owns intent)
- Finding format unchanged (`[FINDING:<id>]` + AC-N + Cited verbatim + Severity)
- Citation discipline unchanged (verbatim ≥10 words from PLAN.md, line 70)
- Verdict logic unchanged (APPROVED / APPROVED-WITH-CONCERNS / REVISE / BLOCK)

**Don't-push-back-on list EXPANDED** (was 4 items at `agents/plan-skeptic.md:72-76`, now 6):
- Performance, Style, Gotcha-checker scope (unchanged)
- NEW: Intent drift — user owns in Phase A
- NEW: Verify-line goal-completeness — user owns in Phase C cross-reference (NOTE: test-shape SEMANTICS — "does the oracle catch the failure mode?" — IS still in scope; only goal-completeness moves to user)
- **Over-engineering is NOT in don't-push-back** — it's CONCERN-only backstop. Skeptic CAN flag it, but severity capped at CONCERN, never REVISE. User catches first in Phase C; backstop catches what user missed.

**Frontmatter changes:**

```yaml
---
name: technical-skeptic
description: "Senior-engineer technical critic. Pushes back on plan TECHNICAL concerns user cannot catch — test shape, hidden state, failure paths, opacity, trust boundaries. Renamed from plan-skeptic; intent/over-engineering checks moved to user (Phase A/C grills)."
model: claude-opus-4-7
tools: [Read, Glob, Grep, Write]
maxTurns: 10
effort: medium
memory: project
skills: [forge:gotchas]
---
```

**Implementation steps:**
1. Rename `agents/plan-skeptic.md` → `agents/technical-skeptic.md`
2. Update `description:` frontmatter per above
3. Edit `## The critique` section: narrow concern list from 9 to 6 items
4. Edit `## Don't push back on` section: add 3 new exclusions (intent, over-eng, Verify-goal)
5. Edit `## Read this — once, in order` section: clarify brainstorm is grounding context not sole intent
6. Update `agent-roles.json` entry: `technical-skeptic` (allowedPaths same as plan-skeptic)
7. Update `forge-config.default.json` capability mapping (rename entry, capabilities unchanged)
8. Update `scripts/reviewer-dispatch.mjs` to dispatch `technical-skeptic` instead of `plan-skeptic` at plan-stage
9. Update `skills/plan/SKILL.md` Phase D dispatch list — `technical-skeptic` replaces `plan-skeptic`
10. Cross-reference scripts that emit verdict-file paths (verify nothing hardcoded to `plan-skeptic.md` filename)

### reviewer-boundary — extended

Keep existing job (task sequencing, wave collisions, architecture violations). Add:
- ✅ Turn on `docs/solutions/` knowledge enforcement at plan-stage (currently skipped per agents/reviewer-boundary.md:31). Patterns matter at plan-time more than implement-time.
- ✅ Extract wave-collision detection into `scripts/wave-collision-check.mjs` — deterministic graph check, not LLM reasoning.

### reviewer-safety — surface-gated

Only dispatch when PLAN.md mentions sensitive surface keywords: `auth`, `password`, `token`, `secret`, `credentials`, `fs.*write`, `exec`, `spawn`, `network`, `external API`, or touches files under `bin/`, `hooks/`, `mcp/`. Otherwise skip — most plans don't introduce security risks and the haiku APPROVED is token waste.

### Dispatch order (parallel)

All applicable reviewers dispatch in parallel after walkthrough closes. No change to dispatch mechanism — just narrower scope per reviewer.

## Phase E: REVISE walkthrough — concrete discipline (Gap #10, resolved turn 22)

If any reviewer emits REVISE or BLOCK in Phase D, Phase E walks the user through each finding using the same Pocock-recommend-and-react pattern as Phase A/C, anchored to reviewer verdict files.

**Today's REVISE-loop (cited from this turn's read of `skills/plan/SKILL.md:120-148`):**
- M counter, max 2 cycles
- Conductor re-invokes planner with `[revision-mode: M]` + `[failed-criteria: AC-N]` (line 137)
- Loop is autonomous — no user in loop until M=2 or all APPROVED
- M=2 → gate1 opens with `revisingUnresolved: true` marker (line 139)

**Phase E reuses this machinery but wraps each finding with user dialogue.**

### Per-finding walkthrough (one at a time)

For each finding in each reviewer's verdict file, conductor presents:

```
Reviewer: <name> (e.g. technical-skeptic)
Finding: <one-line summary from FINDING block>
Cited: <verbatim cited phrase from verdict>
Concern: <reviewer's concern text>
Counter-proposal: <reviewer's proposed fix>

[my-rec: accept fix / modify / dismiss / discuss]
```

User reacts:
- **accept** → conductor inline-edits PLAN.md per counter-proposal; adds entry to `## Resolution (gate1 REVISE)` section with finding ID + action
- **modify** → user describes change; conductor applies; adds to Resolution
- **dismiss** → conductor adds entry to Resolution: "accepted with known risk: <reviewer> raised <concern>; decided to proceed because <user reasoning>"
- **discuss** → free-form dialogue until resolved; resolves to one of the above

### After all findings disposed

| Condition | Action |
|---|---|
| Mechanical edits only AND M < 2 | Re-dispatch reviewers per existing line 137-138 loop. New verdicts → Phase E again. |
| Structural change needed AND user agrees | Re-invoke planner with `[revision-mode: M]` + `[failed-criteria]` per line 137. New plan → Phase C walkthrough → Phase D → Phase E. |
| All findings dismissed OR inline-fixed AND user signals advance | Skip re-dispatch; proceed to gate1 finalization. |
| M = 2 cap reached | Gate1 opens with `revisingUnresolved: true` marker; conductor surfaces "after 2 cycles, reviewers still have unresolved concerns — approve or discard?" — user decides. |

**Close condition:** every finding has a disposition (accept/modify/dismiss) entered in PLAN.md's Resolution section AND user types "advance" / "approve."

### Phase E lives in `skills/plan/SKILL.md` orchestrator prose, NOT a separate skill file

Dialogue is bounded ("for each finding, recommend, await reaction") — doesn't need its own skill prose. Conductor inline is sufficient.

### Resolution section format (extends memory `feedback_inline_edit_block_resolution`)

```markdown
## Resolution (gate1 REVISE, cycle M=1)

### Finding F-001 (technical-skeptic, REVISE)
Cited: "Task 3 verify line: <verbatim>"
Concern: Test checks function-return rather than observable outcome
Counter-proposal: rewrite Verify to assert end-to-end observable state
Disposition: ACCEPT — Task 3 Verify line updated to assert observable state via integration test
Edited PLAN.md lines: 47-52
```

Each finding gets ID, citation, concern, counter-proposal, disposition, and edit reference.

### Verification needed at implementation time

- `scripts/plan-revise-loop.mjs` helper (cited `skills/plan/SKILL.md:142`) must be updated for user-in-the-loop variant OR replaced
- M-counter persistence across Phase E sessions (via walkthrough-state.json per Q7 disposition — `schemaVersion: 1`)
- Per-finding state persistence (which findings reviewed, which pending) — extension of walkthrough-state.json

### Trade-offs vs today's autonomous loop

| Aspect | Today (autonomous) | Phase E (user-in-loop) |
|---|---|---|
| Speed | Faster | Slower — per-finding dialogue |
| Drift risk | Higher — silent inline-edits | Lower — user reviews every change |
| Re-dispatch cost | Always re-invoke planner | Selective — sometimes inline-edit only |
| Discovery of new issues | Limited to reviewer findings | User can flag additional concerns mid-walkthrough |
| M=2 cap | Same machinery | Same machinery |

## Phase F: gate1 approval

User types literal "approve" (per memory feedback_approve_only_keyword — unchanged). Conductor calls `forge_set_gate({status: "approved"})` and `forge_advance_stage({targetStage: "implement"})`.

## Trigger semantics — when does this whole flow run?

**Default:** every `/forge:plan` invocation goes through Phases A → B → C → D → E → F (6 phases — Phase A.5 was merged into Phase A in turn 13).

**The inline-vs-pipeline decision lives in the brainstorm doc** — not in the trigger logic. Phase A's `Recommended workflow` field captures the recommendation (`inline | pipeline | research | explore | not-a-task`) based on the deploy-mechanism rule from the Risk principle section.

If `Recommended workflow: inline`:
- After Phase A closes (user confirms the brainstorm via "advance"), the user can either proceed inline (conductor edits directly) OR override and stay in pipeline. Phase B onwards becomes optional.
- This is the "Power Automate flow edit" case — human-mediated deploy, low blast radius.

If `Recommended workflow: pipeline`:
- Full A → B → C → D → E → F flow runs. Planner dispatches, reviewers run, gate1 + gate2 apply.
- This is the default for forge-plugin source changes, anything with state/logic, anything without human deploy gate.

If `Recommended workflow: research | explore`:
- Phase B is replaced by `/forge:research` or `/forge:explore` dispatch instead of planner dispatch. Phases C-F skipped.

If `Recommended workflow: not-a-task`:
- Pipeline aborts cleanly after Phase A. Brainstorm doc is preserved as a discussion artifact. No planner runs.

**No-skip-default principle:** Phase A intent dialogue ALWAYS runs even when `Recommended workflow: inline`. The user must confirm the brainstorm before any work proceeds, inline or pipeline. Cost of intent dialogue is minutes; cost of building on wrong is hours.

**TODO-driven runs (board.json item)** — TODO text is partial intent capture, not full. Phase A intent dialogue still runs; question count adapts to how much the TODO already specifies.

## Implementation checklist

To ship this design. Single source of truth (discipline #5) — each item links to its canonical detail section.

1. **Brainstormer DELETE + grill-me-for-design SKILL VENDOR** — see `## Phase A` → `### Implementation strategy — vendor Pocock's prose, extend with FORGE behavior` for the full 4-step procedure. Delete `agents/brainstormer.md` and `agent-roles.json` entry. Create `skills/grill-me-for-design/SKILL.md` (~50-80 lines: vendored Pocock 5-line loop + FORGE-specific scaffolding for knowledge load, 5-slot schema, save-scope discipline, doc-write). Rewrite `skills/plan/SKILL.md` Phase A to invoke `Skill(grill-me-for-design)`.
2. **Plan-skeptic narrowing + optional rename** — see `## Phase D: reviewers — narrowed and gated` → `### technical-skeptic (renamed from plan-skeptic)`. Scope drops handled there.
3. **reviewer-safety surface gating** — edit `scripts/reviewer-dispatch.mjs` (referenced at the /forge:plan SKILL.md step described in this session) to gate dispatch on keyword scan of PLAN.md. Detail in `## Phase D` → `### reviewer-safety — surface-gated`.
4. **Wave-collision deterministic check** — extract `scripts/wave-collision-check.mjs` (new file). Wire into reviewer-boundary or run as a separate gate step. Detail in `## Phase D` → `### reviewer-boundary — extended`.
5. **Plan-stage knowledge enforcement** — edit `agents/reviewer-boundary.md` line 31 to remove "Skip knowledge enforcement — implement-stage only" restriction. Detail in `## Phase D` → `### reviewer-boundary — extended`.
6. **Skill prose update** — rewrite `skills/plan/SKILL.md` to add Phase A (intent dialogue — Pocock-style one-at-a-time interrogation), Phase C (plan walkthrough), Phase E (REVISE walkthrough), and the trigger-semantics changes (workflow recommendation routing). Cite the canonical phase sections in this doc.
7. **Project mode field** — add `deployMode: "manual" | "auto"` field to `.pipeline/project.json` schema. Detail in `## Project type` → `### Risk principle`.
8. **Walkthrough state file** — implement `.pipeline/runs/<runId>/walkthrough-state.json` schema + read/write. Survives conductor restarts. Detail in `## Multi-session orchestration`.
9. **Documentation sweep** — update `docs/gotchas/GENERAL.md` mechanically-enforced sections if any new rules need codification (e.g. "rename-sweep discipline" if we want it project-wide).
10. **Knowledge loop wiring** — see `## Knowledge loop integration` section for the full implementation checklist (knowledge-load wiring in skill prose, save-scope tag in grill agent, plan-extractor agent file, compound-refresh integration). Single source of truth lives there per discipline #5.

## Risks and how we mitigate

Applies to BOTH Phase A (intent dialogue) and Phase C (plan walkthrough) unless noted.

| Risk | Mitigation |
|---|---|
| Phase A or C becomes rubber-stamp | Always-present-understanding rule (Phase A); per-section explicit confirmation (Phase C); conductor-neutral-first (both) |
| Phase A or C becomes unbounded loop | NO nudge, NO soft cap. Either done or not done. If dialogue revisits same point 3+ times, agent surfaces "what's the underlying question we're not resolving?" — observation, not advancement. |
| Phase A scope creep — turning intent dialogue into planning | If user starts proposing tasks/files/implementation, agent surfaces "this sounds like planning — should we advance to Phase B?" |
| User wants fundamental redesign mid-Phase-C | Conductor kicks back to Phase A (intent dialogue) with the new input |
| Conductor over-influences | "Recommend, then wait" discipline. Agent's recommended answer is a STARTING POINT, not a verdict. |
| Tokens balloon on long Phase A sessions | Phase A's recommendation-pattern lowers per-question load; codebase-lookup rule removes derivable questions; agent should compress repeat content. Net tokens may rise vs today but plan quality reduction in downstream debug/rework offsets it. |
| Migration breaks active runs | Ship rename + skill update in one atomic commit; verify reviewer-dispatch.mjs path lookups |
| User abandons mid-dialogue | walkthrough-state.json persists across conductor restarts; observer surfaces "<N> open branches, <M> resolved" so resume is visible |

## Inline-only enforcement

**Hard rule:** Phase A (intent dialogue), Phase C (plan walkthrough), and Phase E (REVISE walkthrough) ALL run in the conductor session (in-chat). They never run in workers. Reasoning:

- Workers cannot relay interactive turns back to the user (cited from this session's /forge:plan SKILL.md Step 1b: "Brainstormer MUST run in the conductor session — full-mode Q&A needs interactive turns with the user, which workers cannot relay back")
- The new phases are explicitly conversational — running them in a worker would defeat their purpose
- Today's brainstormer already obeys this rule for full-mode Q&A — we're extending it to all user-facing phases

**What CAN run in workers (unchanged):**
- Planner (writes PLAN.md autonomously)
- Reviewers (write verdicts autonomously after walkthrough closes)
- Coder, debug, refactor (implement-stage workers)
- Researcher, documenter

**What CANNOT run in workers (new constraint):**
- Intent dialogue (Phase A) — Pocock-style one-at-a-time interrogation
- Plan walkthrough (Phase C)
- REVISE walkthrough (Phase E)
- Gate1 approval dialogue (Phase F)

## Multi-session orchestration

The conductor session is single-threaded for user interaction, but workers run in parallel via worktrees (per FORGE's existing multi-session architecture — verified at memory project_worktree_conductor_vision.md 2026-04-18 noting most infra is built).

**Implication:** workers can run many runs in parallel; user-interactive phases serialize through the conductor.

Concrete scenario:
- Runs `r-1`, `r-2`, `r-3`, `r-4` all in flight in their own worktrees
- `r-1` is in Phase B (planner worker running) — no conductor attention needed
- `r-2` is in Phase C (plan walkthrough) — needs conductor + user attention NOW
- `r-3` is in Phase D (reviewer workers running) — no conductor attention needed
- `r-4` is in Phase A (intent dialogue) — also needs conductor + user attention; queued behind r-2
- The TUI/observer surfaces `r-2` and `r-4` as attention cards (distinguished by phase label: "plan walkthrough" vs "intent dialogue")
- User and conductor walk through `r-2`'s PLAN.md
- Meanwhile `r-1`'s planner finishes and writes PLAN.md → new attention card appears for `r-1`
- User chooses next: keep walking `r-2`, save state on `r-2` and switch to `r-1` or `r-4`

**Walkthrough state persistence (required for multi-run safety):**

Without persistence, switching between runs loses walkthrough progress (which sections have been confirmed, which user-deltas have been applied, what's outstanding).

Proposal: **per-run walkthrough state file** at `.pipeline/runs/<runId>/walkthrough-state.json`. Concrete schema and operationalization per Gap #5 (resolved turn 22). The `phase` field distinguishes A (intent dialogue) from C (plan walkthrough) from E (REVISE walkthrough) — all three use the same state-file shape:

```json
{
  "runId": "r-2",
  "phase": "C",
  "sectionsConfirmed": ["feature-heading", "phase-1-overview"],
  "sectionsOpen": ["phase-2-tasks", "phase-3-deltas", "acceptance"],
  "deltasApplied": [
    {"section": "phase-1-task-2", "before": "...", "after": "...", "reason": "user feedback"}
  ],
  "lastInteractionAt": "2026-05-22T08:42:11Z",
  "currentDrillTarget": "phase-2-task-3"
}
```

The conductor reads this on resume; the TUI surfaces "Walkthrough 3/8 sections done" as a progress indicator. Survives conductor session restarts.

**Conductor swap is safe** — if Claude Code restarts mid-walkthrough, the new conductor session reads walkthrough-state.json and the user picks up where they left off.

**Phase F (gate1 approval) still requires the "approve" keyword** (per memory feedback_approve_only_keyword) — not auto-derivable from walkthrough completion.

### Operationalization (Gap #5, resolved turn 22)

**Extended schema v1** (additions beyond initial sketch):
- `schemaVersion: 1` (per Q7 disposition — fail-closed on mismatch)
- `skill: "grill-intent" | "grill-plan" | null` — which skill is running
- `phaseStartedAt` / `phaseCompletedAt` / `phaseAbandonedAt` — lifecycle timestamps
- `currentTurn: <integer>` — heartbeat counter
- `userSignals[]` — history of "advance" / "drill X" / etc., useful for forensics
- `deltasApplied[]` entries get `saveScope: "project-wide" | "feature-only" | null`

**Who writes:** the skill (grill-intent or grill-plan) writes the file directly. Skills run in the conductor session, so the LLM following the skill prose handles state-file writes via Write tool. No external conductor logic needed.

**Skill prose addition (in both grill-intent and grill-plan):**

```
## State persistence

Maintain `.pipeline/runs/<runId>/walkthrough-state.json` per the schema in the design doc.

- On first invocation (file absent): create initial state with schemaVersion=1, phase=<this phase>,
  skill=<this skill>, phaseStartedAt=now, empty sectionsConfirmed, all slots in sectionsOpen.
- After every section confirmation: update sectionsConfirmed + sectionsOpen, increment currentTurn,
  update lastInteractionAt.
- After every delta application: append to deltasApplied with saveScope tag.
- On user advance signal: set phaseCompletedAt to now, write final state, return.
- On user discard signal: set phaseAbandonedAt to now, write final state, return.

If the file exists with schemaVersion != 1: refuse to read; surface "walkthrough state is from
incompatible schema — restart Phase <X> from beginning" to user (per Q7 disposition).
```

**Resume protocol (on Claude Code restart or new conductor session):**

1. Conductor Globs `.pipeline/runs/*/walkthrough-state.json`
2. Filters to active states: `phaseCompletedAt == null AND phaseAbandonedAt == null`
3. Schema-version check: if `schemaVersion != 1`, surface incompatible message + offer to archive
4. For each valid active state, surface attention card: "Active walkthrough on r-X (Phase Y, started T) — resume?"
5. On user "resume": conductor re-invokes the relevant skill with `[resume-walkthrough]` prefix in the prompt; skill reads walkthrough-state.json and continues from `currentDrillTarget`

**Skill prose addition for resume:**

```
## Resume awareness

If the invocation prompt contains [resume-walkthrough]:
- Read .pipeline/runs/<runId>/walkthrough-state.json
- Restore: sectionsConfirmed (don't re-grill these), currentDrillTarget (continue here)
- Present user with: "Resuming from <currentDrillTarget>. Confirmed so far: <list>. Continue?"
- User confirms → proceed with the section walk where it left off
- User says "restart" → discard state, treat as new invocation
```

**Observer integration:** observer Globs walkthrough-state.json files; renders "Phase A: <currentDrillTarget> (N/M sections done)" cards. Updates as the file updates. Extends existing observer phase-card display per Gap #6's resolution.

**Verification at implementation time:**
- File-write atomicity on Windows (use temp-write + rename pattern to avoid partial writes)
- Concurrent reads (observer side) don't conflict with skill writes
- Resume context passes correctly to re-invoked skill

## Project type — revised after Dataverse-project review (2026-05-22)

Initial draft of this section proposed three modes — `code` / `guided` / `docs` — and put Power Automate in `guided` mode. **That was wrong.** Reviewing the actual Dataverse project (`C:\Users\cuj\Dataverse`) corrects the framing:

The Dataverse project is **code-mode in FORGE terms**:
- Claude / Coder agent directly edits `flows/<slug>/flow.json` with Edit/Write (cited `flows/README.md:9-12`)
- `scripts/pack-flow.ps1` is the deterministic build step (cited `flows/README.md:40-45`)
- Tests would run via PowerShell against the JSON's validity
- Pipeline is plan → implement → review → apply, unchanged
- Project CLAUDE.md confirms: "pipeline rules, gate system, and other scaffold conventions live in the FORGE plugin itself" (`C:\Users\cuj\Dataverse\CLAUDE.md:3`)

What's actually different about it isn't the mode — it's:
1. The **artifact format** (JSON-WDL, not JS) → handled by per-project `docs/gotchas/GENERAL.md` + `docs/solutions/`
2. The **build/test command** (PowerShell packager, not `npm`) → handled by `.pipeline/project.json` `testCommand:` (already configurable per skills/apply/SKILL.md)
3. The **deploy step is manual** (user uploads zip to Power Automate portal) → handled by NOT auto-deploying; apply stops at the packaged artifact

**Conclusion:** the FORGE pipeline doesn't need new modes for projects like Dataverse. Project-specific commands and gotchas already cover the gap.

### When IS a new mode warranted? "Guided" — narrowed definition

"Guided" mode applies when **there is no editable file Claude can write** — the user must be the implementer because the work happens in a UI, an external system, or physically:

- Configuring SharePoint/Power Platform permissions in the admin UI
- Salesforce admin steps performed via Setup screens
- Manually running a sequence in a vendor system with no API
- Hardware / physical actions

Most "configuration" work has an underlying file Claude can edit (terraform, JSON, YAML, .env) — so guided mode is genuinely rare. When it does apply, the conductor coaches step-by-step and the user reports back. Out of scope for the initial user-first-planning shipment — flag as a follow-up if/when concrete examples accumulate.

### Updated mode taxonomy

Just two relevant modes for the user-first-planning rollout:

1. **`code`** (default) — covers JS/TS/Python/Go AND Power Automate / declarative artifacts / YAML configs / terraform. Anything with an editable file Claude can write. Per-project commands in `.pipeline/project.json` handle artifact-specific build/test.
2. **`docs`** — documentation-only changes. Skip implement-stage entirely, route through documenter.

Project-type detection becomes a thin check, not a mode switch. The grill agent doesn't need a first-question for it in most cases.

### Risk principle: deploy mechanism > change size

The inline-vs-pipeline decision should weigh **deploy mechanism**, not just change size. When deploy is human-mediated, the human deploy step IS a review gate, and the FORGE pipeline's review becomes duplicative.

Concrete examples (cuj 2026-05-22 morning):

- **Dataverse / Power Automate flows** — editing `flow.json` doesn't execute; `pack-flow.ps1` is deterministic; user manually uploads zip via make.powerautomate.com; PA portal UI shows the flow before any trigger fires. **Manual import = review gate.** Inline is appropriate even for non-trivial changes. Cited `C:\Users\cuj\Dataverse\flows\README.md:5-6, 40-45`.
- **forge-plugin source code** — changes affect future workers in any session; bugs propagate to plugin users; no manual deploy step (`/plugin` cache refresh is the only barrier). **Pipeline review valuable** for non-trivial changes.
- **Documentation** — no deploy at all; direct is fine.

Principle: **inline appropriateness = (low complexity OR human-mediated deploy) AND no irreversible side effects.**

Edge cases to remember when applying this principle to Power-Automate-like artifacts:
- Scheduled triggers + expensive actions (rate-limit / cost blast radius)
- Side effects on shared resources (mass emails, writes to shared SharePoint lists)
- Connection-bound credentials (rare in flow.json itself; bound at import)

These are exceptions, not the rule. Most PA flow edits are genuinely low-risk inline.

**For the grill agent:** when recommending inline-vs-pipeline (per the inline-vs-pipeline mechanism below), the heuristic should be:

```
if humanMediatedDeploy(project) and no irreversible side effects:
    recommend inline (regardless of change size)
else if smallScope(change) and no logic/state/external-effects:
    recommend inline
else:
    recommend pipeline
```

`humanMediatedDeploy(project)` is a per-project flag — added to `.pipeline/project.json` as e.g. `deployMode: "manual"`. Set in scaffold for Dataverse-style projects.

## Knowledge loop integration — compound learning from grill answers

The grill phases (A and C) produce high-density design knowledge that should feed the existing knowledge_base (`docs/solutions/`, `forge_add_learning` MCP tool). Without this integration, every grill starts from scratch — the user retypes the same constraints feature after feature, and the system never compounds.

Three integration points wire grill answers into the learning loop. Each captures different content.

### Integration 1 — Knowledge LOAD before grill starts (compound retrieval)

This is the most important integration — it closes the compound loop.

Before Phase A or Phase C starts, the conductor calls knowledge-retrieval MCP tools to pre-load existing project knowledge:
- `forge_get_constraints` — project-wide constraints learned from prior grills
- `forge_get_patterns` — design patterns learned from prior plans

Pre-loaded knowledge becomes part of the agent's initial understanding presentation:

```
Initial understanding:
  Wants: <derived from input>
  Constraints: pre-loaded from knowledge_base —
    - API contracts must hold (project-wide, learned r-abc123 2026-04)
    - No jQuery (project-wide, learned r-def456 2026-03)
    Inheriting these unless you override.
  ...
```

User can confirm, override, or supersede. **The system REMEMBERS — user doesn't re-state.**

This is the compound part. Token cost per grill drops over project lifetime; quality compounds.

### Integration 2 — Tag-as-you-go during grill (explicit save-scope)

Each grill question's recommended answer carries a `save-scope` tag — `project-wide` or `feature-only`. User picks scope along with content.

Example:
```
Q: What must not change about the existing system?
[my-rec: API contracts must hold | save-scope: project-wide
 / no implementation changes | save-scope: feature-only
 / open]
```

User picks first → conductor calls `forge_add_learning` immediately with outcome `design_decided`. Constraint enters knowledge_base mid-dialogue.

**Knowledge categories produced by each Phase A slot:**

| Slot | Save-scope likelihood | Why |
|---|---|---|
| Wants | Low | Usually feature-specific |
| Constraints | **HIGH** | "API contracts must hold" applies forever |
| Don't-wants | **HIGH** | "No jQuery" applies forever |
| Acceptance shape | Medium | "We test by behavior" generalizes |
| Priority | **HIGH** | "Simplicity > flexibility" applies forever |

**Knowledge categories produced by Phase C grill (Gap #3 concrete mapping, resolved turn 22):**

| Phase C content category | Save-scope likelihood | Example |
|---|---|---|
| AC observable-state preferences | HIGH (project-wide) | "ACs cite observable state, not implementation. Example: 'feature works when user can complete task X' not 'function Y returns Z'." |
| Verify-line oracle shape | HIGH (project-wide) | "Verify lines prefer behavior-checking. 'WHEN trigger fires AND state Y THEN observable Z'." |
| Test-shape / TDD red-bar discipline | HIGH (project-wide) | "When slice has test files, dispatch test-author wave first per TDD discipline. Always confirm red bar before green bar." |
| Task decomposition rules | HIGH (project-wide) | "Phase-split when slice crosses 5+ files OR 8+ tasks." |
| Reviewer pattern feedback | MEDIUM (could generalize) | "Reviewer-boundary flagged wave collision in Tasks 5-6 → resolved by splitting wave." |
| Specific task content | LOW (feature-only) | "Task 3.2 added bullet 4 for empty input case." |
| Per-feature trade-off | LOW (feature-only) | "For this feature, accept slower implementation in exchange for stronger acceptance test." |
| Per-feature risk acceptance | LOW (feature-only) | "Dismissed reviewer test-shape concern because the pattern is being phased out." |
| Pure inline wording fixes | NO TAG | Wording fixes don't enter knowledge_base — too granular. |

**Save-scope decision rule for `skills/grill-plan/SKILL.md`:**
- `project-wide` → call `forge_add_learning(outcome="design_decided")` immediately with the pattern
- `feature-only` → keep in `## Walkthrough deltas` section of PLAN.md; don't enter knowledge_base
- `no tag` → just inline-edit PLAN.md, no Resolution / deltas log entry needed

The recommended-answer pattern (Pocock) does double-duty: lowers user cognitive load AND forces the agent to commit to a save-scope classification. User confirms both content and scope in one reaction.

### Integration 3 — Post-gate1 extractor sweep (catches what slipped tagging)

New stage-aware extractor agent runs after Phase C completes and gate1 is approved (before Phase F closes). Reads `docs/brainstorms/<slug>.md` + `docs/PLAN.md` and proposes patterns the user didn't tag during grill. Conductor surfaces:

```
I noticed these recurring patterns that look project-wide:
  - <pattern A> (from brainstorm Constraints, line 12)
  - <pattern B> (from plan AC shape on Tasks 3, 5, 7)
Save as project-wide knowledge?
```

User confirms each one, or skips. Catches patterns that slipped through tag-as-you-go.

This is parallel to today's apply-stage learnings-extractor (cited from this turn's read of `agents/learnings-extractor.md:3` — extractor runs at apply Step 3.4a, reads handoff + verdicts, calls `forge_add_learning` exactly once). Two extractors total:

| Extractor | Stage | Reads | Outcomes |
|---|---|---|---|
| **Plan-stage extractor (NEW)** | After gate1 approval | brainstorm doc + PLAN.md | `design_decided` |
| **Apply-stage extractor (existing per `agents/learnings-extractor.md`)** | Apply Step 3.4a | handoff + reviewer verdicts | `approved` / `blocked` / `debug_resolved` |

Both feed the same knowledge_base via `forge_add_learning`. Different content sources, same target.

**Implementation choice:** either extend `agents/learnings-extractor.md` with stage-aware behavior OR create new `agents/plan-extractor.md`. Decision (turn 22): **create new file** — different inputs, different outcome vocabulary, different proposal flow (post-gate1 conversational confirmation vs autonomous-write at apply).

### Concrete sketch of `agents/plan-extractor.md` (Gap #4, resolved turn 22)

Structure parallels `agents/learnings-extractor.md` (cited turn 18 + earlier turn read: `agents/learnings-extractor.md:3, 5-8, 24, 54-62`):

```yaml
---
name: plan-extractor
description: "Post-Phase-C knowledge extractor. Reads brainstorm + PLAN.md, proposes up to 5 candidate patterns for forge_add_learning. Conductor surfaces proposals to user for confirmation."
model: claude-haiku-4-5-20251001
tools:
  - Read
  - Glob
  - Write
maxTurns: 8
---

## Your role
Extract candidate knowledge entries from a completed brainstorm + plan and write proposals
for conductor review. You do NOT call forge_add_learning — the conductor does that after
user confirmation.

## When you run
After gate1 approval, before the run advances to implement-stage. Phase E (REVISE) complete,
plan in APPROVED state.

## Steps (numbered)
1. **Read inputs**: docs/brainstorms/<slug>.md, docs/PLAN.md, docs/gotchas/GENERAL.md
2. **De-duplicate**: call forge_get_constraints + forge_get_patterns; skip semantic matches
3. **Identify candidates**: scan brainstorm Constraints/Don't-wants/Priority slots, [save-scope: project-wide] tagged items, AC/Verify-line shape patterns in PLAN.md. Cap at 5. Prefer high-confidence (explicit tag) over inferred.
4. **Write proposals**: `.pipeline/runs/<runId>/plan-extractor-proposals.json` with each candidate's text, tags, source, confidence, rationale.
5. **Log + return**: `[plan-extractor] N candidates proposed (filename)`

## Permissions
- **Always**: read brainstorm/PLAN.md/GENERAL.md; call forge_get_constraints + forge_get_patterns; write proposals file
- **Ask First**: automated — no user present; if brainstorm or PLAN.md unreadable, log non-blocking error and stop
- **Never**: call forge_add_learning yourself; modify brainstorm or PLAN.md; propose >5 candidates; duplicate existing knowledge_base entries; run Bash
```

**Conductor's post-extractor dialogue** (`skills/plan/SKILL.md` Phase F or new sub-phase between D-close and F):

1. Dispatch `Agent(subagent_type='plan-extractor')` — autonomous extraction
2. Read `.pipeline/runs/<runId>/plan-extractor-proposals.json`
3. For each proposal, surface to user in chat with Pocock-style recommend-and-react:
   ```
   Candidate pattern: "<text>"
   Source: <source>; confidence: <high|medium|low>
   [my-rec: save to knowledge_base / skip / open]
   ```
4. For each "save": call `forge_add_learning` with `outcome: design_decided`
5. Log summary; advance to gate1 finalization

**Trade-offs:**
- Pro: clean separation of autonomous extraction (agent) from user dialogue (conductor inline)
- Pro: reuses forge_add_learning pattern from apply-stage extractor
- Pro: user confirms every knowledge_base entry — no silent writes
- Con: one more agent dispatch per gate1 (~5 turns of haiku)
- Con: post-approval dialogue extends Phase F before implement-stage (~1-3 min per ≤5 candidates)

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Knowledge_base pollution from feature-specific noise | Default `save-scope: feature-only`; `project-wide` is explicit user choice; compound-refresh agent (existing per `agents/compound-refresh.md` referenced earlier session) deduplicates |
| Stale knowledge no longer applies | Each entry carries `learnedAt` timestamp; conductor surfaces inheritance with date so user can mark superseded |
| User changes mind mid-grill, contradicts past learning | Conductor marks old learning `supersededBy: <new-runId>`; writes new learning with reference back |
| Knowledge load adds latency to grill start | `forge_get_constraints` + `forge_get_patterns` cap at ~200ms combined; negligible vs grill turn cost |
| Plan-stage extractor proposes too many patterns at once | Cap at top-5 candidates per run; user confirms one at a time |
| Knowledge schema collides with existing `forge_add_learning` (`conflict: true` per `agents/learnings-extractor.md:24, 65`) | Plan-stage extractor honors same conflict-detect-and-skip rule as apply-stage extractor |

### Compound effect over project lifetime

- **First grill** — teaches the system 3-5 project-wide things; tokens high
- **Tenth grill** — pre-loads ~20 inherited constraints/patterns; asks only about feature-specifics; tokens drop
- **Fiftieth grill** — system handles most constraint inheritance silently; user grilled only on genuinely-new design decisions

This applies the "plan so good everything is easy" vision (see Vision section) to the dialogue itself. **The grill gets shorter AND sharper as the project ages.**

### Discipline added to Phase A and Phase C

Both phases get the same two new sub-steps:

1. **Pre-step (before Initial understanding):** call `forge_get_constraints` + `forge_get_patterns`; include results in the initial understanding presentation tagged with `learnedAt` and run-origin
2. **Per-question format extension:** add `save-scope: project-wide | feature-only` tag to every recommended answer for slot types listed in the categories tables above

### Consolidation: knowledge_base is the ONLY automatic learning loop (turn 21)

Today's FORGE has two parallel learning mechanisms (verified turn 21 grep):

| Mechanism | Citation | Granularity |
|---|---|---|
| Knowledge base | `forge_add_learning`, `forge_get_constraints`, `forge_get_patterns` MCP tools + `docs/solutions/**` | Atomic facts, tag-queryable |
| Brainstorm-to-brainstorm Glob | `agents/brainstormer.md:117` — auto-search prior brainstorms by feature-name similarity | Document-level |

These overlap. A project-wide constraint can appear in 5 brainstorm docs AND as a knowledge_base entry — two sources of truth, no clean reconciliation rule.

**Consolidation decision:**

- **Knowledge_base is the single automatic learning loop.** All compound retrieval at grill start happens via `forge_get_constraints` + `forge_get_patterns`.
- **Brainstorm-to-brainstorm Glob (`agents/brainstormer.md:117`) is deprecated.** Neither `skills/grill-intent/SKILL.md` nor `skills/grill-plan/SKILL.md` automatically searches prior brainstorms.
- **Brainstorm docs become pure AUDIT artifacts.** Per-feature record of intent decisions. Not auto-loaded.
- **plan-extractor (post-gate1) is the BRIDGE.** Brainstorm-doc content → knowledge_base entries via the post-gate1 sweep. One-directional, explicit.
- **User-on-demand Glob still works.** If user says "this is like feature Y," conductor can Glob brainstorms/ and load Y as additional context. Explicit, not implicit.

**What this fixes:** single source of truth for project-wide patterns; no drift between two parallel learning systems; no grill-time pollution from potentially-irrelevant past brainstorms.

### Implementation checklist items (additive)

- Wire `forge_get_constraints` + `forge_get_patterns` calls into `skills/plan/SKILL.md` Phase A start and Phase C start
- Embed the save-scope tagging discipline in BOTH `skills/grill-intent/SKILL.md` and `skills/grill-plan/SKILL.md` skill prose (first-class FORGE behavior — part of the same prose the LLM follows for the interview loop). Each skill's save-scope mapping is mode-specific (intent slots vs AC/test-shape/decomposition).
- Create new `agents/plan-extractor.md` (or extend `agents/learnings-extractor.md`) for post-gate1 sweep
- Update `skills/plan/SKILL.md` Phase F to invoke plan-extractor before gate1 approval finalizes
- Do NOT re-implement `agents/brainstormer.md:117` "search prior brainstorms" behavior in the new skill — deprecated per consolidation decision above
- `agents/compound-refresh.md` keeps current cleanup role — handles deduplication across both extractors

## In-flight run migration (B10, resolved turn 22)

The risk: runs started under the OLD brainstormer-as-agent flow may break when we delete the agent file and update planner schema expectations.

### Risk by run state

| State at deploy | Risk | Mitigation |
|---|---|---|
| Pre-Phase 1 | Worker tries to dispatch missing brainstormer agent | Drain before deploy |
| Mid-Phase 1b (brainstormer running) | Resume fails | Drain or discard |
| Phase 1b complete, risk-classification step | Continues normally (brainstorm doc exists) | None needed |
| Phase 2+ (planner read brainstorm) | Schema mismatch risk if planner updated | Schema-compat shim (mandatory) |
| At gate1 | Brainstorm doc exists; gate1 logic unchanged | None needed |
| Implement-stage / apply-stage | Brainstormer is dead history | None needed |

### Schema mismatch — old vs new brainstorm doc

Old brainstormer schemas (cited from `agents/brainstormer.md:127-148` earlier session reads):
- **Old thin schema** (4 sections): Intent / Requirements / Constraints / Open questions
- **Old full schema** (6 sections): What / Why / Requirements / Approach / Affected areas / Open questions

New schema (5 sections): Wants / Constraints / Don't-wants / Acceptance / Priority

`agents/planner.md:71, 79` reads brainstorm as primary input. Schema-compatibility shim is MANDATORY before deletion.

### Six-step migration plan

1. **Pre-deploy: drain.** User verifies no Phase 1b runs are mid-execution. Either complete them or `/forge:discard`. Single-user FORGE means this is practical.

2. **Schema-compat shim (LANDS FIRST, even before deletion).** Update `agents/planner.md` Step 1 and `agents/plan-skeptic.md` brainstorm-read section to handle BOTH old and new schemas:
   - If file contains `## Wants` → new schema
   - If file contains `## Intent` → old thin schema
   - If file contains `## What` → old full schema
   - Map old terminology to new (Intent / What → Wants; Approach → Acceptance shape; Affected areas → Constraints)
   - Shim is permanent (defensive parsing) — supports both forward and backward compat

3. **Atomic deploy.** All changes in one commit:
   - Delete `agents/brainstormer.md` + agent-roles.json + forge-config.default.json entries
   - Create `skills/grill-intent/SKILL.md` + `skills/grill-plan/SKILL.md`
   - Create `agents/plan-extractor.md`
   - Rename `agents/plan-skeptic.md` → `agents/technical-skeptic.md` with narrowed prose
   - Update `skills/plan/SKILL.md` (Phases A, C, D, E + dispatch list)
   - Update `skills/chat/SKILL.md:100` pipeline diagram
   - Update `scaffolds/code/CLAUDE.md` references

4. **Cache refresh sequence** (per memory `reference_plugin_cache_refresh`):
   - Version bump in `.claude-plugin/plugin.json`
   - Commit + push (needs `commit`/`push` keywords)
   - `/plugin` update
   - `/reload-plugins`
   - Claude Code restart

5. **Verification — pilot run.** Run a fresh `/forge:plan` with a small test feature end-to-end:
   - Phase A: grill-intent invokes; dialogue works
   - Brainstorm doc written with new 5-slot schema
   - Phase B: planner reads new schema
   - Phase C: grill-plan invokes; cross-references work
   - Phase D: reviewers dispatch with technical-skeptic
   - Phase E: REVISE walkthrough surfaces findings
   - Phase F: gate1 approves → implement-stage works

6. **Rollback path** (per memory `project_orchestrator_default_on` pattern):
   - `git revert <commit>` on main
   - Version bump
   - Commit + push
   - `/plugin` + `/reload-plugins`
   - Claude Code restart

### Why the shim is symmetric

- Forward: new planner reads old docs (via shim)
- Backward (rollback): reverted planner reads new docs (needs same shim)

**Keep the shim permanently.** One-line defensive parsing; cheap; supports both migration directions and any future user-on-demand brainstorm reuse.

### Historical artifacts that stay

- `run.json` `agents[]` entries with `agentType: "brainstormer"` for historical runs → harmless history
- `agent-roles.json` entries in archived runs → terminal; no re-dispatch concern
- `CHANGELOG.md` + `.pipeline/conductor-scratchpad-brainstormer-*.md` → historical records

### Critical step ordering

**The shim MUST land before deletion.** Otherwise: deploy → old runs at Phase 2+ break because planner can't read old brainstorm docs. With shim landed first, planner is forward-compatible; deletion just removes the now-unused agent file.

## Open questions — disposition (applying discipline #6)

Each question reaches: ANSWERED (resolution landed in doc) / DEFERRED (with reason + revisit trigger) / KILLED (no longer relevant).

### Q1. Where does implementation-architect fit? — **ANSWERED 2026-05-22**

**Resolution:** Implementation-architect STAYS at implement-stage Step 2b as a safety net. Phase C plan-walkthrough discipline (cross-reference brainstorm + Pocock-style one-at-a-time interrogation) covers most slice-narrowing scenarios the user CAN catch. Implementation-architect catches what the user MISSED — complementary, not redundant.

**Reason:** Removing it risks losing a cheap safety net. Adding it as a Phase C tool requires significant new wiring. Status quo is the lowest-risk choice and lets us see whether Phase C grill is sufficient before changing implement-stage shape.

**Implications:** No change to `agents/implementation-architect.md` or implement-stage skill prose. Phase C must NOT duplicate implementation-architect's work (slice-narrowing is implement-stage's job; Phase C is intent-coverage-against-plan).

**Revisit trigger:** If Phase C consistently surfaces slice-too-big concerns that implementation-architect ALSO surfaces, the duplication is wasteful → consider moving slice-decision to Phase C.

### Q2. Should walkthrough deltas trigger planner re-invocation? — **ANSWERED 2026-05-22**

**Resolution:** No automatic planner re-invocation from walkthrough deltas. Inline conductor edits to PLAN.md are sufficient for refinement. If the conversation surfaces a fundamentally different approach → kick back to Phase A (intent dialogue), NOT back to Phase B (planner).

**Reason:** Pocock-style Phase C is dialogue-driven, not batched — each delta is small and lands inline as it's discussed. Re-invoking the planner mid-conversation would lose the dialogue context. The "different approach" case is intent-level, not plan-level, so Phase A is the right kickback target.

**Implications:** PLAN.md grows through inline edits + `## Walkthrough deltas` log. Planner runs exactly ONCE per run. If user wants a fundamental redesign, the run is implicitly restarted via Phase A → Phase B.

### Q3. Should technical-skeptic findings reach user directly? — **ANSWERED 2026-05-22**

**Resolution:** Conductor mediates. No direct skeptic→user channel. The skeptic writes verdict + findings to `.pipeline/context/reviewer-output/`; the conductor reads, summarizes, and walks the user through each finding during Phase E (REVISE walkthrough).

**Reason:** The conductor already has full intent context from Phase A (now with Pocock dialogue) and full plan context from Phase C. Skeptic findings are conversational-translatable. Adding a direct skeptic→user channel = one more agent voice in chat = higher friction without proportional fidelity gain.

**Implications:** Phase E protocol stays as drafted (conductor walks user through findings, decides together which to address). `agents/technical-skeptic.md` writes only to the verdict file, not to chat.

**Revisit trigger:** If Phase E findings are so technically dense that conductor mediation routinely loses fidelity (evidenced by user "wait, I don't understand" friction), consider direct channel.

### Q4. Grill abort behavior + workflow values — **CLOSED in turn 11**

(See walkthrough deltas turn 11 entry. Recommended workflow values: `inline | pipeline | research | explore | not-a-task`. Grill always writes a doc — "abort" is not a behavior.)

### Q5. Project-type auto-detection aggressiveness — **ANSWERED 2026-05-22**

**Resolution:** Option (c) with (a) fallback. `.pipeline/project.json` `mode:` field is authoritative when present. When absent, conductor auto-detects from project files (presence of `package.json` → code mode; predominantly `.md` files only → docs mode) and includes the detection in Phase A's initial understanding presentation for user confirmation/override.

**Reason:** Mode taxonomy was simplified to just `code | docs` after the Dataverse correction (most "non-code" projects are still code with declarative artifacts). Auto-detection is reliable for the common cases. Explicit `mode:` lets edge cases override.

**Implications:** Scaffold (`/forge:init`) should write `mode:` to `.pipeline/project.json` when known. Phase A pre-step in `skills/plan/SKILL.md` reads `mode:` first, falls back to file-presence heuristic.

### Q6. `/forge:guide` skill scope — **DEFERRED**

**Reason for deferral:** Genuinely guided mode (user is implementer because no editable file) is rare — most "configuration" work has an underlying file Claude can edit. Without concrete use cases, scope is speculative.

**Revisit trigger:** When 2+ concrete guided-mode use cases accumulate (e.g. Salesforce admin steps, SharePoint permissions, hardware/physical actions, Power Platform UI configuration). Until then, out of scope for user-first planning rollout.

**Workaround until then:** For projects with manual steps, FORGE handles up to the editable-artifact boundary; user does manual steps post-apply. No FORGE coaching loop.

### Q7. walkthrough-state.json schema versioning — **ANSWERED 2026-05-22**

**Resolution:** Fail-closed. Add `schemaVersion: 1` field to walkthrough-state.json. Conductor refuses to read non-matching versions and forces a fresh walkthrough (user starts Phase A or Phase C from scratch). No migration.

**Reason:** In-flight runs are short-lived (hours to days, not weeks). The cost of forcing a restart on schema change is small relative to the cost of writing migration code for every schema bump. Migration is over-engineering for this lifecycle shape.

**Implications:** Initial schema is `schemaVersion: 1`. Any field addition that breaks reads bumps to `2`. Conductor's read-side checks version first, surfaces "session was for an older schema — please restart Phase A/C" if mismatched.

### Disposition summary

| Question | Status | Decided |
|---|---|---|
| Q1. implementation-architect placement | ANSWERED | Stays at implement-stage |
| Q2. walkthrough deltas → planner re-invoke | ANSWERED | No, inline only; redesign → Phase A |
| Q3. skeptic direct→user channel | ANSWERED | No, conductor mediates |
| Q4. grill abort + workflow values | CLOSED (turn 11) | 5 workflow values; no abort |
| Q5. project-type detection | ANSWERED | mode: authoritative + auto-detect fallback |
| Q6. /forge:guide scope | DEFERRED | Revisit at 2+ concrete cases |
| Q7. walkthrough-state schema versioning | ANSWERED | Fail-closed with schemaVersion field |

**All questions disposed.** No accumulators left.

## Pilot — this conversation

This document is being designed using the flow it describes. Snapshot of pilot state as of turn 13:

- **Phase A (intent dialogue)** — happened across turns 3-13. The grill + walkthrough split that earlier drafts proposed was rediscovered AS A MERGE during the pilot itself (turns 11-13). cuj's "either done or not done" framing + Pocock's grill-me skill validated single-phase, one-at-a-time, recommendation-driven dialogue. This is what the conversation actually IS.
- **Phase B (planner)** — this document IS the planner output. The conductor played the planner role.
- **Phase C (plan walkthrough)** — happening NOW. Most of turns 9-13 have been Phase C against this doc. The walkthrough deltas log proves it.
- **Phase D (reviewers)** — not yet run. Will run when this doc is ready to land as an implementable plan.
- **Phase E (REVISE walkthrough)** — pending Phase D.
- **Phase F (gate1 approval)** — pending the above. User signal will be "approve" or "this is ready to ship as a plan."

**Pilot validates the method.** The 7 disciplines emerged from gaps surfaced during this pilot. The merge of A + A.5 emerged from cuj's pushback. Pocock's grill-me skill validated the merge externally. **The user-first method, applied to itself, produces better designs than upfront perfection — and surfaces patterns no upfront design would have predicted.**

**Open: when this design ships**, the pilot conversation itself should be referenced as the canonical example of the method in action. Possibly extract a "First pilot — design of user-first planning" appendix or external doc.

## Walkthrough deltas

**2026-05-22 — pilot walkthrough turn 1**: cuj pushed back on "grill-me-for-design shouldn't be skipped lightly" → revised Phase A's trigger logic from "skip-conditions may apply" to "always runs, only question count varies."

**2026-05-22 — pilot walkthrough turn 2**: cuj asked for the design to be captured in writing for collaborative editing → this doc was created (`docs/design/user-first-planning.md`).

**2026-05-22 — pilot walkthrough turn 3**: cuj raised three new design inputs (inline-only enforcement, multi-session interaction, instructional projects like Power Automate) → added three new doc sections: Inline-only enforcement, Multi-session orchestration, Project type. Open questions Q5-Q7 added.

**2026-05-22 — pilot walkthrough turn 4**: cuj pointed at the Dataverse project showing Power Automate flows were created inline → corrected the three-mode taxonomy proposal. Mode-wise it IS code; "guided" mode is genuinely rare. Power-Automate-like work is `code` mode with a deterministic packager + manual deploy step.

**2026-05-22 — pilot walkthrough turn 5**: cuj's principle "making changes to import-ready Power Automate flows is without risk" → added the Risk principle section (deploy mechanism > change size); added per-project `deployMode: "manual"` field proposal; refined the inline-vs-pipeline heuristic.

**2026-05-22 — pilot walkthrough turn 6**: research run `r-d9cf5f2e` landed → Phase A fully expanded with 5-phase grill protocol, output schema, funnel sequencing, format anti-patterns, LLM-specific rules, mapping to existing `agents/brainstormer.md` infrastructure. Closes Q4 partially (grill always writes a doc; zero-question case is valid; "abort" is not a behavior — the agent's stop condition is coverage-matrix-driven).

**2026-05-22 — pilot walkthrough turn 7**: cuj called out the likely overlap with existing brainstormer → full read of `agents/brainstormer.md` lines 80-184 + prior research doc `docs/RESEARCH/thin-brainstormer-always-runs-design.md` confirmed ~70% of the new design is already implemented. Rewrote the "Mapping to existing infrastructure" section with line-cited inventory; reframed implementation strategy from "rename + rewrite" to "targeted refactor of existing brainstormer.md."

**2026-05-22 — pilot walkthrough turn 8**: cuj approved rename to `grill-me-for-design` AND pushed back on the 5-question cap with a meta-argument: "if all of this had been 5 questions, we would have ended with the wrong solution." Counted: 11+ design-shaping exchanges across 14 turns in this pilot conversation. Confirmed: 5-question grill alone is insufficient for complex design tasks. Added Phase A.5 (brainstorm walkthrough) as iterative artifact-anchored dialogue mirroring plan walkthrough (Phase C) discipline. Phase A.5 is the safety net for everything single-round grill can't extract. Total canonical flow grew from 6 phases to 7. Rename churn list captured under implementation strategy. Closes implicit Q: "is grill enough?" — answer: no, but grill + brainstorm walkthrough is.

**2026-05-22 — pilot walkthrough turn 9 (read-through)**: cuj asked for full top-to-bottom read. Conductor surfaced 10 coherence issues organized by severity. Two structural issues identified: (1) Phase A.5 had no dedicated section despite being a canonical-flow phase; (2) Phase A.5 missing from inline-only enforcement, multi-session scenario, and risks table.

**2026-05-22 — pilot walkthrough turn 10 (meta + rename audit)**: cuj asked whether the doc accounts for the rename + raised the meta-observation that every gap points to a missing discipline in the method. Grep confirmed 35 brainstorm references; agent rename was tracked but artifact-path rename (docs/brainstorms/) was NOT explicitly addressed — a missed second-order decision. The 7 missing disciplines were identified by pattern-analysis of accumulated gaps: rename sweep, structural symmetry, cross-section propagation, stale-section sweep, single source of truth, open-question disposition, second-order decisions.

**2026-05-22 — pilot walkthrough turn 11 (B then A)**: cuj chose to land disciplines first (Section B), then apply structural fixes (Section A). Result:
- **B landed**: new "Method disciplines" section added after Principles (~140 lines). 7 disciplines documented with rule / why / how to apply / example-from-this-pilot format.
- **A landed (5 propagations)**:
  - Phase A.5 dedicated section created with full symmetry to Phase C (job, discipline, transcript, stop condition, complete checklist, safety-net rationale)
  - Phase A.5 added to inline-only enforcement list
  - Phase A.5 added to multi-session orchestration scenario (now 4 runs not 3, includes Phase A.5 attention card)
  - Walkthrough-state.json schema clarified to cover A.5, C, E phases
  - Risks table extended with 3 new A.5-specific risks (A.5↔A loops, A.5 scope creep, abandonment recovery)
  - Trigger semantics rewritten to use Recommended workflow field (closes part of Q4) — replaced stale "trivial features could skip" with workflow-recommendation routing
  - "Reviewer set changes — concrete edits required" renamed to "Implementation checklist" and references-not-duplicates (per discipline #5 single source of truth)
  - Stale Pilot section updated to reflect actual state (turns 4-9 have been Phase C against this doc)
- **Open questions Q4 sub-question** (workflow values) closed in turn 11 via the Trigger semantics rewrite. Recommended workflow values: `inline | pipeline | research | explore | not-a-task`.

**2026-05-22 — pilot walkthrough turn 12 (thin-mode migration impact)**: cuj asked "how will this affect the brainstormer we have now as the thin mode that runs every run also." Fresh read of `agents/brainstormer.md:50-150` confirmed today's thin-mode is binary (skip Steps 2+3, write 4-section schema). Identified TWO migration impacts: (1) inside agent — today's thin-mode triggers become inputs to coverage scoring; net behavior is mostly preserved EXCEPT Don't-wants slot is rarely captured in TODOs and will commonly trigger 1 question where 0 was emitted today; (2) outside agent — Phase A.5 walkthrough adds a step that didn't exist for thin-mode runs. Resolution at turn 12: walkthrough SCALES to question count (light / medium / full). Note: turn 13 superseded this by merging A.5 into A entirely, removing the scaling concept.

**2026-05-22 — pilot walkthrough turn 13 (merge to one phase, Pocock-inspired)**: cuj re-pushed on the 5-question cap and flagged that 0-question case "essentially skips the step" — user can't drive. cuj also requested checking Matt Pocock's `grill-me` skill for inspiration. WebSearch + WebFetch confirmed Pocock's skill is 5 lines, 53k stars on GitHub, runs 16-50 questions per session, with these principles: (1) interview relentlessly until shared understanding; (2) walk decision-tree one branch at a time; (3) provide recommended answer per question; (4) one question at a time; (5) if codebase can answer, look up instead. cuj rejected the "soft turn-cap nudge" — "either it is done or it is not done." cuj also surfaced the vision: "plan so good everything after is easy." Result: MERGED Phase A grill + Phase A.5 walkthrough into one Phase A "intent dialogue." Dropped 5-question cap, dropped funnel single-round structure, dropped walkthrough scaling. Added Pocock-style protocol: one question at a time, agent recommends answer, codebase-first rule, stop only on user "advance" signal, always-present-understanding rule closes the 0-question gap. Vision section added at top of doc. Total canonical flow back to 6 phases (from 7). Phase A.5 dedicated section deleted; references swept across Inline-only enforcement, Multi-session orchestration, walkthrough-state schema, Trigger semantics, Risks table, Implementation checklist, Pilot section. Three new anti-patterns added (Pocock-inspired: asking-what-you-could-look-up, asking-without-recommending, front-loading-all-questions). Closes Q2 partially (planner re-invocation now framed as part of intent dialogue when scope changes mid-conversation, not a separate decision).

**2026-05-22 — pilot walkthrough turn 14 (Phase C becomes Pocock-style too)**: cuj sketched the full flow ("I want X" → grilled → plan written → walk over plan with grill-style questioning → reviewers → implement) and confirmed Option C (Pocock verbatim in BOTH Phase A and Phase C). Result: Phase C section rewritten. Old discipline (section-summary by default, drill-down on request) replaced with Pocock-style grill discipline matching Phase A. Eight discipline rules now: (1) high-level summary first as orientation, (2) one question at a time with recommended answer, (3) **cross-reference plan against brainstorm — flag any Wants/Acceptance not addressed in plan tasks** (the load-bearing rule per cuj's "learning loop isn't addressed" example), (4) codebase before user, (5) walkthrough is review not redesign, (6) deltas land inline, (7) stop only on user advance signal, (8) always-present-understanding. New Phase C example dialogue added showing one-at-a-time grill with brainstorm cross-reference catch. Walkthrough complete checklist updated to require brainstorm-doc read at start + per-Wants/Acceptance cross-reference confirmation. Implementation strategy unchanged — still a refactor, just now Phase C's discipline mirrors Phase A's instead of being its own shape. Cited from this turn: `agents/planner.md:71, 79` (planner primary input = brainstorm doc) confirms why brainstorm doc earns its existence as the handoff between Phase A and Phase B.

**2026-05-22 — pilot walkthrough turn 15 (knowledge loop integration)**: cuj asked "how do we use forge_knowledge loop here? User answers a lot about design — how do we feed that into learning loop?" Fresh read of `agents/learnings-extractor.md:3, 15, 22, 24, 54-65` (this turn) confirmed today's loop is apply-stage only — extractor reads handoff + reviewer verdicts at Step 3.4a, writes one learning per run with outcome `approved`/`blocked`/`debug_resolved`. Does NOT capture brainstorm intent or PLAN.md design decisions. Result: added new `## Knowledge loop integration` section (single source of truth per discipline #5) covering three integration points: (1) Knowledge LOAD before grill — `forge_get_constraints` + `forge_get_patterns` pre-load past project knowledge into agent's initial understanding (closes compound loop — system remembers, user doesn't restate); (2) Tag-as-you-go during grill — `save-scope: project-wide | feature-only` tag in each recommended answer, user picks scope along with content, project-wide writes immediately via `forge_add_learning`; (3) Post-gate1 extractor sweep — new `agents/plan-extractor.md` reads brainstorm + PLAN.md, proposes patterns the user didn't tag, conductor surfaces for user confirmation. Two extractors total (plan-stage NEW + apply-stage existing per `agents/learnings-extractor.md`), same target knowledge_base. Phase A protocol Step 1 updated with Pre-step (knowledge load). Phase C discipline rule 4 updated to include knowledge_base lookup alongside codebase. Implementation checklist gets new item 10 pointing to the integration section. Compound effect documented — token cost drops over project lifetime as knowledge accumulates; quality compounds.

**2026-05-22 — pilot walkthrough turn 16 (open question disposition)**: cuj asked to resolve all open questions. Applied discipline #6 — each Q reaches answered / deferred / killed, never accumulator. Results: Q1 ANSWERED (implementation-architect stays at implement-stage as safety net; Phase C grill catches what user notices, IA catches what user missed — complementary). Q2 ANSWERED (no auto planner re-invocation from walkthrough deltas; inline edits only; fundamental redesign → kick to Phase A). Q3 ANSWERED (conductor mediates skeptic findings; no direct skeptic→user channel; revisit if findings prove too technically dense). Q4 already closed in turn 11. Q5 ANSWERED (project.json `mode:` authoritative; auto-detect fallback from file presence). Q6 DEFERRED with revisit trigger (2+ concrete guided-mode cases). Q7 ANSWERED (fail-closed with `schemaVersion: 1`; no migration). Disposition summary table added. **All questions disposed — no accumulators left.**

**2026-05-22 — pilot walkthrough turn 17 (Option IV proposed — use Pocock's skill directly)**: cuj noticed the doc said "Pocock-inspired" everywhere but the actual protocol was my expanded adaptation. Asked "why not just use Pocock's skill?" I proposed Option IV: install `mattpocock/skills` plugin, invoke `Skill(grill-me)` from `skills/plan/SKILL.md` with wrapper instructions for FORGE additions. Landed initially.

**2026-05-22 — pilot walkthrough turn 18 (Option IV REVERTED to Option I — vendor Pocock's prose)**: cuj raised concern about whether the learning loop integration survives Option IV — knowledge load, 5-slot output schema, and save-scope tagging would live in the WRAPPER MESSAGE not in Pocock's skill system prompt. Across a 16-50 question grilling session, wrapper instructions might fade while system-prompt instructions stay salient. I had no tool-call evidence either way (UNVERIFIED in practice). Cuj asked for a clear side-by-side of Option I vs Option IV, then chose **Option I — vendor + extend**. Initial framing: vendor as an AGENT file at `agents/grill-me-for-design.md`. Implementation strategy + sketch landed accordingly.

**2026-05-22 — pilot walkthrough turn 19 (Option I CORRECTED — vendor as SKILL not agent)**: cuj asked "are we sure the grill-me should be an agent — what are pros/cons of making it an agent and not a skill?" Fresh reads this turn confirmed the architectural mismatch: `agents/brainstormer.md:105` uses batched `[questions]/[answers]` protocol ("After emitting [questions]...[/questions], stop immediately... The user will answer and you will be re-invoked"). Pocock's pattern is "Ask the questions one at a time" — fundamentally different protocol. Making grill-me an AGENT would force it into batch protocol, defeating Pocock's design. Skills run in-session — dialogue happens directly with the user in the conductor's chat — making one-at-a-time the native pattern. Glob this turn confirmed FORGE already has 29 skill files in `skills/`, so skill is an established pattern. Result: corrected Option I from agent flavor to skill flavor. Vendoring still happens (FORGE owns the prose, reliability gained), but the file lives at `skills/grill-me-for-design/SKILL.md` invoked via `Skill(grill-me-for-design)`. Phase A and Phase C both invoke the same skill. `agent-roles.json` no longer needs an entry (skills use different enforcement model). Sketch updated to skill frontmatter (simpler — no model/tools fields, since skills run in calling session's context). Plan-extractor stays an AGENT because it runs autonomously after gate1, not interactively. **Closes the deepest open question definitively: agent or skill? Answer: SKILL. Reason: conversational one-at-a-time pattern requires in-session execution.**

**2026-05-22 — pilot walkthrough turn 20 (downstream consumer sweep)**: cuj asked "what happens to brainstorm now? the brainstormer agent dies, what takes its place?" Repo-wide grep this turn surfaced 12 files referencing `brainstormer` — 6 forward-looking files that need updating, 4 historical files that stay, plus the agent file itself + agent-roles.json entry (already in deletion sweep). Added new "Downstream consumers to update" subsection to Phase A implementation strategy listing all 6: `skills/plan/SKILL.md` (multiple lines), `agents/planner.md:56, 71, 75`, `skills/chat/SKILL.md:100` (pipeline diagram), `scaffolds/code/CLAUDE.md:43, 62, 131` (scaffold prose), `forge-config.default.json:161-163` (capability mapping — DELETE), `.pipeline/agent-roles.json:10` (DELETE). Historical references in CHANGELOG.md + conductor-scratchpad files stay per discipline #1 ("historical cite — keep"). Applied discipline #7 — listed all second-order edits implied by "delete brainstormer." Caught a gap in my prior implementation checklist that didn't enumerate these consumers explicitly. **Closes the question: does anything else need to change?** Answer: yes, 6 forward-looking files. They are now enumerated in the design doc.

**2026-05-22 — pilot walkthrough turn 21 (consolidate to one learning loop)**: cuj asked "this 'future brainstorms — read prior brainstorm and build on it' part — should this not also be part of the forge_knowledge learning loop? Else we have two different kinds of learning loops co-existing." Verified this turn via grep: only `agents/brainstormer.md:117` does past-brainstorm auto-Glob; planner (`agents/planner.md:79`) and plan-skeptic (`agents/plan-skeptic.md:36`) Glob the CURRENT run's brainstorm only. So the duplicate learning loop lives in one place. Consolidation decision: **knowledge_base is the SINGLE automatic learning loop.** Deprecated `agents/brainstormer.md:117` behavior — new `skills/grill-me-for-design/SKILL.md` does NOT auto-search prior brainstorms. Brainstorm docs stay as pure AUDIT artifacts. plan-extractor (already in our design) is the BRIDGE — reads brainstorm + PLAN.md post-gate1 and proposes knowledge_base entries. User-on-demand Glob still works (explicit "this is like feature Y" request), just not implicit. Added: (1) new "Phase A does NOT auto-load prior brainstorms" subsection in Phase A; (2) new "Consolidation: knowledge_base is the ONLY automatic learning loop" subsection in Knowledge loop integration with rationale + decision points; (3) explicit deletion note on `agents/brainstormer.md:117` behavior in the delete-replace table; (4) new implementation checklist item "Do NOT re-implement search-prior-brainstorms behavior." **Closes the question: are there two learning loops?** Answer: yes today (knowledge_base + brainstorm-Glob). After this change: ONE automatic loop (knowledge_base), with user-on-demand brainstorm reuse as a separate explicit-request mechanism.

**2026-05-22 — pilot walkthrough turn 22 (gap sweep — 22 sub-decisions)**: cuj asked for skeptic critical pass. I surfaced ~27 items (10 gaps, 5 smoother flows, 12 blast-radius). Resolved one-by-one:
- **Gap #1** (orchestration mechanics) — VERIFIED via turn-22 WebSearch that Claude Code supports nested skill invocation (natural-language coordination, Claude as coordinator). Citations: code.claude.com/docs/en/skills + Pocock's pattern doc.
- **Gap #6** (hook attribution for skills) — RESOLVED via manual phase-update calls to `forge_update_run` from orchestrator using existing `phases[]` field. No new hook infrastructure.
- **Gap #7** (run.json schema for skill activity) — RESOLVED: existing schema accommodates plan-stage phases without modification. Phase B double-tracked (phases[] + agents[]) intentionally.
- **Gap #4** (plan-extractor concrete sketch) — RESOLVED: `agents/plan-extractor.md` parallels `agents/learnings-extractor.md`. Reads brainstorm + PLAN.md, proposes ≤5 candidates, conductor confirms with user per-candidate, conductor calls forge_add_learning.
- **Gap #8** (technical-skeptic narrowing) — RESOLVED: 6 keep + 1 at CONCERN-only after option (b) selected for over-engineering. Originally dropped 3 entirely; refined to drop 2 + downgrade 1 to advisory backstop.
- **Gap #10** (Phase E discipline) — RESOLVED: per-finding user-in-the-loop dialogue using Pocock-recommend-and-react. Reuses existing M-counter REVISE-loop machinery from skills/plan/SKILL.md:134-139. Phase E lives in skills/plan/SKILL.md orchestrator prose, not a separate skill.
- **Gap #2** (Phase A vs Phase C: one bimodal skill or two specialized) — RESOLVED to two specialized skills: `skills/grill-intent/SKILL.md` + `skills/grill-plan/SKILL.md`. Same Pocock loop (vendored in each), mode-specific FORGE scaffolding.
- **Gap #3** (save-scope tagging in Phase C undefined) — RESOLVED: concrete 9-category mapping (5 project-wide / 3 feature-only / 1 no-tag). AC observable-state, Verify-line oracle shape, test-shape, decomposition rules → project-wide; specific task content, per-feature trade-offs → feature-only.
- **Gap #5** (walkthrough-state.json operationalization) — RESOLVED: extended schema v1 with schemaVersion + lifecycle timestamps + userSignals[]. Skill writes the file via Write tool as part of FORGE behavior. Resume protocol defined (Glob discovery → schema check → re-invoke skill with [resume-walkthrough] prefix).
- **B10** (in-flight migration) — RESOLVED: 6-step plan. Critical step is schema-compat shim in planner + technical-skeptic (handle both old and new brainstorm doc schemas). Drain Phase 1b runs before deploy; rollback path via git revert + cache refresh.
- **B11** (technical-skeptic full churn) — RESOLVED: 11-file change list (10 forward-looking + 1 agent-roles.json gap-fix). Historical references in 6 files stay per discipline #1.
- **Over-engineering coverage option (b)** — selected after cuj asked "what does that mean?" Over-engineering moves back into scope at CONCERN-only severity (not REVISE). User catches first in Phase A/C; technical-skeptic provides advisory backstop. Preserves coverage for less-senior users without bloating REVISE loops.

Net: ~12 gaps resolved with concrete dispositions landed in design doc. Remaining items (S1-S5 smoother flows, B4/B6/B7/B9 nice-to-haves) are non-blocking. Doc is now genuinely implementation-ready.

**2026-05-22 — pilot walkthrough turn 23 (remaining-items sweep)**: cuj asked to sweep remaining S1-S5 + B4/B6/B7/B9 items. Verifications this turn:
- **B9** (CLAUDE.md root): grep — NO brainstormer references. NO CHANGE NEEDED.
- **B12** (mcp/forge-worker.mjs): grep — NO brainstormer references. NO CHANGE NEEDED.
- **B4** (apply-stage extractor): already decided. Two extractors (plan-extractor + apply-stage learnings-extractor) with different scopes. NO CHANGE.
- **B6** (scaffolded CLAUDE.md): already in B11 churn list at scaffolds/code/CLAUDE.md:43, 62, 131. RESOLVED.
- **B7** (forge_get_model_recommendation): skills inherit caller's model; DELETE the call from Phase A skill prose. Implicit in skill prose rewrite.
- **S1** (incremental brainstorm write), **S2** (Phase B background UX), **S4** (brainstorm TOC), **S5** (user-on-demand brainstorm Glob) — all trivial skill-prose additions; land at implementation time.
- **S3** (Phase E findings → knowledge_base): small extension to plan-extractor — add Phase E reviewer findings + Resolution sections as inputs.

**All 27 items from the turn-22 critical pass are now dispositioned.** Two confirmed empty (B9, B12); 5 skill-prose additions (S1, S2, S4, S5 + B7 delete); 1 small extractor extension (S3); 1 already-resolved (B6). Doc is implementation-ready with no remaining blockers.
