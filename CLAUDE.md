# FORGE Worker — Runtime Instructions

These rules apply when `.pipeline/worker-task.json` exists — i.e., this is a worker session executing a pipeline task.

## Attention-first principle

Human attention is the scarcest resource in this system. Every gate, pause, or escalation consumes a unit of that resource. Judgment lives inline — in this file, in agents, in skills — where it is read and monitored every session, not in a separate document that agents skip. Every stop must change an outcome: if pausing does not alter a decision or prevent a mistake, it is ceremony and must be removed.

This principle governs design choices across FORGE: gates are added only where they block structurally incomplete inputs, not where they surface style preferences; inline rules are preferred over external decision logs; no preamble or acknowledgement text is emitted unless it carries information that changes the reader's next action.

See `docs/DECISIONS.md` for the dated rationale behind this redesign.

## Change philosophy

Choose the smallest safe implementation that solves the stated problem. No speculative abstractions. No unrelated cleanup. Prefer existing patterns in the codebase over new structure. Keep the patch easy to justify against unnecessary complexity, hidden side effects, and scope creep.

Before editing any file, read it first. Before modifying a function, grep for all callers. Research before you edit.

## Anti-speculation rule

Before claiming anything about this codebase's state, history, what exists, or what happened — cite a file:line from a Read/Grep done THIS turn, or say "I don't know, checking" and call the tool. No "appears to", "likely", "probably", "I assume", "seems to have been". If you lack tool-call evidence this turn, you don't know — verify or disclaim.

## Acknowledgement discipline — no bare "noted"

Do not write "noted", "got it", "OK I'll do that", "remembered", "saved", or any similar acknowledgement that implies action has been taken — UNLESS the action has actually been taken THIS turn (cited via a tool call or file edit).

Verbal acknowledgement without action is misleading: it leaves the user with the impression that the request was handled when nothing was persisted. If the user asks you to remember a preference, persist it via the appropriate mechanism:

- Project-wide preference → file a TODO via `forge_add_todo` or edit the relevant skill/agent file
- Behavioral rule for future sessions → save to auto-memory or edit CLAUDE.md
- Inline run-only context → state explicitly: "I'll keep this in mind for this run, but it's not persisted — file as TODO?"

If you cannot act on the request right now, say so explicitly with the reason and offer a concrete persistence path.

Why: hit during pilot run r-a45d9be6 (2026-05-22) — conductor said "noted" about a Phase D parallelism preference but made no actual change; user caught the empty acknowledgement the next turn.

## Source attribution discipline — no synthesis-without-attribution

When writing a brainstorm doc, plan, or any artifact that captures user intent, NEVER fold a conductor recommendation into the artifact as if the user stated it. Two distinct categories must remain distinct in every artifact that flows downstream to other agents:

- **User-stated** — the user said it, paraphrased or verbatim. The user can be quoted.
- **Conductor proposal** — the conductor inferred or recommended it; the user did NOT explicitly confirm it.

Concretely:

1. Brainstorm docs MUST use the two-section schema: `## User-stated criteria` and `## Conductor proposals (need user confirmation)`. Same for `## Constraints` if applicable. The grill-intent skill enforces this format.
2. Before writing the brainstorm doc to disk, grill-intent must present every conductor proposal to the user and require an explicit accept/reject signal. Proposals the user does NOT confirm go into `## Conductor proposals` with a `[unconfirmed]` marker; the planner sees them but treats them as open questions, not requirements.
3. When the conductor includes its own recommendation in a reply to the user (e.g., "I'd recommend (b)..."), and the user's next message answers something OTHER than that recommendation, the conductor MUST NOT treat the recommendation as silently accepted. If the user replied to one of multiple options offered, only that one is accepted.

Why: hit during pilot run r-a45d9be6 (2026-05-22) — conductor offered options (a) and (b) for the loop-guard kill path; user accepted (a) ("explicit ack with one keyword"); conductor baked (b) ("kill path with `loop-guard exhausted` failure reason") into the brainstorm anyway as Success criterion #8. The user caught it in Phase C grill-plan walkthrough when asked to refine something they had never said. Result: hours of design conversation grew brainstorm content the user never agreed to.

How to apply: every line of `## Success criteria` and `## Constraints` in a brainstorm must trace to either a verbatim user statement OR a conductor proposal flagged as such. If you can't cite the user statement, the line belongs in `## Conductor proposals`, not in user-stated criteria.

## Intent-capture skill invocation discipline

When invoking a skill whose purpose is to capture USER intent — `forge:grill-intent`, `forge:grill-plan`, `forge:debug` Step 0, or any future Phase A / interview-style skill — the conductor MUST pass only the user's verbatim words as the skill argument. Do NOT paraphrase. Do NOT inject content from TODOs, prior conversations, conductor inference, or repackaging. The user's exact phrasing (however minimal) is the input.

This is distinct from pre-filling worker task briefs, agent prompts, TODO bodies, or learning content — those are conductor-authored by design. The discipline applies ONLY to surfaces designed to capture what the user actually wants.

If the user's verbatim input is minimal (e.g., "pick option 2"), pass that minimal input. The skill's Pocock loop will fill the gap by asking questions. Resist the urge to "help" by pre-stuffing the slots — that produces the failure mode documented in `docs/solutions/forge-debug-pipeline-lacks-the-lightweight-bug-intent-capture-that-plan-pipeline-has-via-phase-a.md` and the analogous gap in grill-intent filed under the skill-feedback lane.

**Allowed exception — `[user-prefilled]` token:** the conductor may pass `[user-prefilled]` on its own line in the skill argument ONLY when the user explicitly typed or pasted `[user-prefilled]` in their actual message to the conductor. The conductor MUST NOT add this token unilaterally — that would re-create the failure mode.

Intent-capture surfaces in scope (current):

- `skills/grill-intent/SKILL.md` (Phase A interview)
- `skills/grill-plan/SKILL.md` (Phase C walkthrough)
- `skills/debug/SKILL.md` Step 0 (bug intent)

When you add a new intent-capture skill, add it to this list AND wire its skip-loop guard to honor the `[user-prefilled]` token convention.

Why: 2026-05-25 conductor session — same conductor that added Step 0 to /forge:debug to prevent unilateral framing skipped grill-intent's Pocock loop within the next hour by passing a brainstorm-pre-filled argument from TODO 65c1ad5f. Two discipline gates (skip-loop guard + pre-write attribution check) both failed because prose discipline gets ignored under "this is obvious, let me skip ahead" pressure. This rule is the upstream gate before the skill ever runs.

## One-question-at-a-time discipline

When the conductor needs the user to make a decision or answer an open question, ask ONE question at a time and WAIT for the answer before asking the next. Never batch multiple questions, decisions, or a numbered `Q1/Q2/Q3…` list into a single message — even when the questions feel related or answering them all at once seems more efficient. The user wants full focus on each decision in turn.

This extends the grill skills' existing rule (`skills/grill-intent/SKILL.md`: "Ask the ONE most important clarifying question — no multi-part questions, no lists"; `skills/grill-plan/SKILL.md`: "Ask ONE question") to ALL conductor↔user Q&A — pre-grill design conversation, scope confirmation, and any inline decision-gathering outside a skill. Surfacing several considerations for context is fine; ending a message with several distinct asks the user must answer is not.

If you have N open questions, present only the single most important/blocking one (with options + a recommendation), let the user answer, then move to the next. Track the rest yourself; do not dump them.

Why: 2026-05-31 — during the orchestrator-finish design the conductor ended a message with four batched decision questions (Q1–Q4). User: "it isnt nice doing all at once and I want your full focus on 1 at the time… update that in the SOP, not just your memory." The grill skills already enforced one-at-a-time; the conductor's general chat Q&A did not — this rule closes that gap.

## TDD discipline

When the work itself is TDD-enforcement infrastructure (hooks that gate edits, agents that audit testing, runners that score regressions, reviewers that scan for test weakening), you MUST build it test-first:

- Write failing tests first (red bar — confirm the test command exits non-zero before the implementation exists)
- Implement until tests pass (green bar — confirm same test command exits 0)
- Run the full regression suite — confirm no regression

Anti-pattern to avoid (research §3.2 — Red+Green collapse): writing tests + implementation in the same turn, then running the suite once and claiming success. Tests must be created and observed-failing BEFORE the implementation exists.

For non-enforcement work, pragmatic TDD vs. direct fix is a judgment call — see the planner's guidance in `docs/PLAN.md` for the run.

Source: `docs/RESEARCH/tdd-agentic-llm-setups.md` — research catalogues 11 failure modes; §3.2 documents Red+Green collapse as the second-most-common; §4.1 names hook-enforced TDD as the strongest single intervention.

## Tool efficiency

Use dedicated tools over Bash: `Read` not `cat`, `Glob` not `find`, `Grep` not `grep`, `Edit` not `sed`. Prefer `forge_*` MCP tools for pipeline state; fall back to direct file reads if MCP unavailable. `hooks/bash-guard.js` enforces this as a backstop.

**No subagents for file reads.** Use `Read`, `Grep`, or `Glob` directly. Subagents are for open-ended research or protecting context from large outputs.

---

## Checkpoint resume

When you receive a user message starting with `[resume-from-checkpoint]`, a subagent hit its context limit mid-task and was paused. The `[resume-from-checkpoint]` message names the agent type and tells you the `docs/context/checkpoint.md` file holds the partial state.

**What to do:** Re-dispatch the named agent via `Agent(subagent_type=<X>)` with a prompt that begins with the literal `[resume-from-checkpoint]` prefix and instructs it to read `docs/context/checkpoint.md` to continue. Do NOT do the agent's work yourself — re-dispatch it.

**What NOT to do:** Do not treat this as a conversational message and narrate intent. Do not do the work yourself. The worker must be the dispatcher, not the implementer.

Example: if you receive:
```
[resume-from-checkpoint]
The previous debug agent hit its context limit mid-task. Read `docs/context/checkpoint.md` to see what was completed and what remains. Continue from where the prior pass stopped — do not repeat completed work.
```
Dispatch `Agent(subagent_type='forge:debug', prompt='[resume-from-checkpoint]\n...')` immediately.

**Cap:** the orchestrator allows at most 2 resume passes per agent per run. If the run reaches the cap, it is marked failed with `failureReason: "context-exhausted"` and requires manual intervention.

---

## Plugin development

> These rules apply when working on the FORGE plugin source code itself — editing agents, hooks, skills, or MCP server code in this repo.

### Stack

- **Runtime:** Node.js (hooks are `.js` scripts executed by Claude Code)
- **Content:** Markdown (agents, commands, skills)
- **Config:** JSON (plugin manifest, pipeline state, board)
- **Distribution:** Claude Code plugin system (marketplace or local path)

### Key source locations

| Area | Path |
|------|------|
| Plugin manifest | `.claude-plugin/plugin.json` |
| Pipeline agents | `agents/*.md` |
| Slash commands | `commands/forge/*.md` |
| Hook declarations | `hooks/hooks.json` |
| Hook scripts | `hooks/*.js` |
| Status line script | `bin/forge-status.js` |
| Worktree manager | `bin/forge-worktree.js` |
| Project scaffolds | `scaffolds/` |
| Pipeline state (per-project) | `.pipeline/` |
| Pipeline docs (per-project) | `docs/` |
| Gotchas for this plugin project | `docs/gotchas/GENERAL.md` |

### How the plugin works

When installed, Claude Code loads:
1. **Agents** from `agents/` — available as subagents in any session
2. **Commands** from `commands/forge/` — available as `/forge:plan`, `/forge:init`, etc.
3. **Hooks** from `hooks/hooks.json` — fire on SessionStart, PreToolUse, PostToolUse
4. **MCP servers** from `.mcp.json` — spawned automatically

The plugin does NOT modify project files on install. Projects get their pipeline state (`docs/`, `.pipeline/`) via `/forge:init`.

### Working on this plugin

Edit files directly — no build step, no compilation. Agent changes take effect on next invocation (no restart needed). Hook and command changes require restarting the Claude Code session.

### Knowledge write-back — required fields

Any conductor-side call to `forge_add_learning` MUST include `trigger` (the "when X, do Y" condition) and `sourceEvidence` (provenance string, e.g. `"run r-XXXX"` or `"GENERAL.md line 47"`). Passing these values only inside the `content`/`body` prose is NOT sufficient — they must be top-level fields.

### Stack rules and gotchas

@docs/gotchas/GENERAL.md

### Coder dispatch discipline

Always run `forge:coder-scout` before `forge:coder`, whether via `/forge:implement` or via an inline Agent-tool dispatch. The scout's output (`.pipeline/context/scout.json` for skill runs, or an explicit `[scout-output:` block in the inline-dispatch prompt) is a precondition — coder MUST NOT be dispatched without it.

Rationale (run `r-4a09697c`, 2026-05-27): rediscovery-truncation pattern — retirement coders burned 38 tool_uses on consumer-set grep before any edits, then hit context limits with no code written. Scout-first prevents this by pre-mapping file scope so the coder starts editing immediately.

### Reviewer dispatch discipline

When selecting reviewers for an inline (conductor-driven) implement/debug/refactor review, do NOT hand-pick the set from intuition — run `node scripts/reviewer-dispatch.mjs --diff=<path> --coder-status=<path>` (or `--handoff=<path>`) and dispatch exactly the `reviewers` it returns. The deterministic dispatcher force-includes `reviewer-tests` on any test-touching diff (`addReviewerTestsIfNeeded`, `scripts/reviewer-dispatch.mjs:111`) and evaluates it BEFORE the `skipReviewers` short-circuit (`:178`), so a clean diff that only edits test files still gets it. The skill path already routes through this dispatcher; the inline path must too.

If you genuinely cannot run the dispatcher, the floor is: ALWAYS include `reviewer-tests` whenever the change touches a test file (`*.test.*` / `*-test.*` / `/tests/` / `/spec/`) or adds a suppression keyword (`skip` / `mock` / `eslint-disable` / `@ts-ignore` / `noqa`).

Rationale (2026-05-29): during an inline batch the conductor hand-picked reviewers per task and nearly shipped without `reviewer-tests` on two tasks whose coders had edited their own test files — caught manually, not structurally. Hand-picking the reviewer set is the inline-path analogue of skipping the scout; route through the deterministic dispatcher instead.
