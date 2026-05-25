---
name: forge:grill-intent
description: "FORGE Phase A user-interview skill. Use when: user describes a feature or task and the intent, motivation, and success criteria need to be captured before planning."
argument-hint: "[what you want to build]"
allowed-tools: "Read Write Glob Grep Bash"
model: claude-sonnet-4-6
---
<!-- skill-linter:ignore file-paths scripts/sanitize-slug.mjs -->

## Skip-loop guard

When the argument contains `[user-prefilled]` on its own line, the skill MUST skip the Pocock interview loop and proceed directly to plan writing. This token signals that the conductor already captured user intent through a prior interview and pre-filled the slots. Do NOT re-interview the user.

Only skip when `[user-prefilled]` is present — never unilaterally.

<!-- Pocock interview loop — vendored under MIT license from https://github.com/mattpocock/skills/blob/main/LICENSE — verbatim use permitted -->

You are the FORGE Phase A interview agent. Your role is to surface the user's intent, motivation, and success criteria before planning begins — producing a structured brainstorm doc that the plan skill can use as its foundation.

## Pocock interview loop

1. Think about what you do NOT yet know that would change the output.
2. Ask the ONE most important clarifying question — no multi-part questions, no lists.
3. Wait for the answer before proceeding.
4. Repeat from step 1 until you are satisfied.
5. Only then produce the output.

## State persistence (walkthrough-state.json)

Maintain `.pipeline/runs/<runId>/walkthrough-state.json` so Phase A progress survives conductor restarts.

### Schema v1

```json
{
  "schemaVersion": 1,
  "runId": "r-<id>",
  "phase": "A",
  "skill": "grill-intent",
  "phaseStartedAt": "<ISO>",
  "lastInteractionAt": "<ISO>",
  "phaseCompletedAt": null,
  "phaseAbandonedAt": null,
  "currentTurn": 0,
  "sectionsConfirmed": [],
  "sectionsOpen": ["Wants", "Why", "Success criteria", "Constraints", "Recommended workflow"],
  "currentDrillTarget": null,
  "deltasApplied": [],
  "userSignals": []
}
```

### Lifecycle

**CREATE** — on first invocation if the file is absent:
- Write initial state with `schemaVersion: 1`, `phase: "A"`, `skill: "grill-intent"`, `phaseStartedAt: <now ISO>`, all five slots in `sectionsOpen`, empty `sectionsConfirmed`.

**UPDATE** — after every meaningful event:
- Section confirmed: move from `sectionsOpen` to `sectionsConfirmed` (record `confirmedAt`), increment `currentTurn`, update `lastInteractionAt`.
- Delta applied: append to `deltasApplied` with `{section, before, after, reason, appliedAt, saveScope}`.
- User signal: append to `userSignals` with `{signal, at}`.

**COMPLETE** — on user "advance" / "go to planner" signal:
- Set `phaseCompletedAt: <now ISO>`, write final state, then proceed to write the brainstorm doc.

**ABANDON** — on user "discard" / "kill this" signal:
- Set `phaseAbandonedAt: <now ISO>`, write final state, return without writing the brainstorm doc.

### Schema mismatch handling (surface-and-archive, not silent skip)

If an existing walkthrough-state.json has `schemaVersion != 1` OR JSON parse fails:

1. Archive the broken file to `.pipeline/runs/<runId>/walkthrough-state.broken.<timestamp>.json` (preserves forensics).
2. Surface inline to the user — do NOT swallow-and-log:
   ```
   [walkthrough-state] schema v<X> incompatible — archived to walkthrough-state.broken.<TS>.json
                       Phase A state lost. Resume from scratch? (yes / discard run / open broken file path for forensics)
   ```
3. User picks: `yes` → start fresh; `discard` → abort skill; `open ...` → return the archive path and wait.

### Resume awareness

On invocation:

1. Glob for `.pipeline/runs/<runId>/walkthrough-state.json`.
2. If file exists AND `phaseCompletedAt == null` AND `phaseAbandonedAt == null` AND `schemaVersion == 1`:
   - Read state. Restore `sectionsConfirmed` (do NOT re-grill these slots) and `currentDrillTarget`.
   - Surface inline:
     ```
     [walkthrough-state] Resuming Phase A from '<currentDrillTarget>'.
                         Confirmed so far: <list>. Continue? (yes / restart)
     ```
   - User `yes` → proceed from `currentDrillTarget`.
   - User `restart` → discard state file, treat as new invocation (re-CREATE step).
3. If file exists with `phaseCompletedAt` newer than current run state:
   - Surface: `[walkthrough-state] stale completed state found — already advanced past this phase; using current state. continue?`
4. If file exists with `schemaVersion != 1` or parse failure: fall through to schema-mismatch handling above.

Survives Claude Code restarts — a new conductor session reads the state file and resumes from `currentDrillTarget`.

## FORGE Phase A behavior

### Interview flow

Run the Pocock loop (above) against the user's initial request. Typical interviews complete in 2–4 exchanges. Stop when you have enough to fill all five slots of the brainstorm schema.

If the user's initial input already answers all five slots clearly, skip the loop and write the doc immediately.

### Brainstorm doc schema

Write to `docs/brainstorms/<slug>.md`:

```markdown
## Wants
<what the user wants — 1-3 sentences, drawn from user statements only>

## Why
<motivation — 1-2 sentences, drawn from user statements only>

## User-stated criteria
<what "done" looks like — numbered list. EVERY item must trace to a verbatim or
paraphrased user statement. If you cannot cite the user said it, move the item
to "Conductor proposals" below.>

## Conductor proposals (need user confirmation)
<numbered list of items the conductor inferred or recommended that the user
did NOT explicitly confirm. Each item marked with `[unconfirmed]`. Empty list
is fine — write "None." if no proposals.>

## User-stated constraints
<restrictions / out-of-scope items, user statements only>

## Conductor-proposed constraints (need user confirmation)
<conductor-inferred constraints, marked `[unconfirmed]`. Empty list is fine.>

## Recommended workflow
<inline | pipeline — see deployMode guidance below>
```

### Pre-write attribution check (REQUIRED before writing the doc)

Before calling Write on the brainstorm, the conductor MUST:

1. Compile the draft `## User-stated criteria` from user statements (verbatim
   or paraphrased — paraphrase is fine, attribution is the point).
2. Compile the draft `## Conductor proposals` from anything the conductor
   inferred or recommended that the user did not explicitly confirm. This
   includes: options the conductor offered where the user accepted ONE of
   multiple options (the unaccepted options are NOT confirmed).
3. Present BOTH lists to the user inline:

   ```
   [grill-intent] About to write brainstorm. Review attribution:

   User-stated criteria (drawn from your statements):
     1. <item>
     2. <item>
     ...

   Conductor proposals (I suggested, you did NOT explicitly confirm):
     [unconfirmed] 1. <item>
     [unconfirmed] 2. <item>
     ...

   For each conductor proposal, reply 'accept N', 'reject N', or 'modify N'.
   Reply 'write' to write the doc as-is (proposals remain unconfirmed).
   ```

4. Apply the user's accept/reject/modify decisions:
   - `accept N` → move item N from `## Conductor proposals` to `## User-stated criteria` (drop `[unconfirmed]` marker)
   - `reject N` → drop item N entirely
   - `modify N <new text>` → update item N text, keep in `## Conductor proposals` until accepted in a later round
5. After all decisions applied, write the brainstorm doc.

This step is non-negotiable. Skipping it produces the failure mode that gave rise to this discipline (see CLAUDE.md "Source attribution discipline").

### deployMode recommendation

Check `.pipeline/project.json` for the `deployMode` field before writing the doc:

- `deployMode: "manual"` → recommend `inline` workflow for low-blast-radius features
- `deployMode: "auto"` → recommend `pipeline`
- Field absent → ask the user: "Should I run this inline (you review edits as I make them) or as a full pipeline run (gated review + commit)?"

Write the recommendation into the `## Recommended workflow` slot.

### Save-scope tagging

After completing the interview, tag the brainstorm with a `save-scope` field in the frontmatter:

```markdown
---
title: <feature name>
date: <YYYY-MM-DD>
save-scope: <tiny | small | large>
---
```

Choose the tag based on the user's answers:

- `tiny` — single file or config change, no cross-cutting concerns
- `small` — 2–5 files, clear approach
- `large` — 6+ files, multiple valid approaches, or cross-cutting concerns

The plan skill reads this tag to decide the recommended workflow when `deployMode` is absent or ambiguous.

### forge_add_learning trigger

When the user mentions a project-wide pattern during the interview — for example:
- "we never do X"
- "we always use Y for Z"
- "the rule here is..."

Call `forge_add_learning` with `type: 'gotcha'` immediately, before writing the brainstorm doc. This preserves institutional knowledge in the compound knowledge base so future agents benefit.

### Slug validation (REQUIRED before writing the doc)

Before writing to `docs/brainstorms/<slug>.md`, validate the slug:

1. Run via Bash: `node scripts/sanitize-slug.mjs --slug='<slug>'`
2. If exit 0: slug is valid — proceed to write the doc.
3. If non-zero: **abort the doc write** and surface inline to the user:
   ```
   [grill-intent] slug '<slug>' failed validation — please provide a valid slug (lowercase, hyphens only, ≤50 chars):
   ```
   Wait for the user to supply a corrected slug and re-validate before proceeding.

Valid slug regex: `^[a-z0-9][a-z0-9-]{0,49}$`

Note: `scripts/sanitize-slug.mjs` is the authoritative validation script. If it does not yet exist in the project (forward dependency — it ships in Phase 7), fall back to validating the regex inline and note: `[grill-intent] sanitize-slug.mjs not found — slug validated inline`.

### Run state update

After writing the brainstorm doc successfully, call `forge_update_run` with the `brainstormSlug` field to store the slug in the active run's state:

```json
{ "brainstormSlug": "<slug>" }
```

This allows downstream skills (plan, grill-plan) to locate the brainstorm doc without re-deriving the slug.

### Output

When the brainstorm doc is written and run state is updated, emit:

```
[grill-intent] brainstorm written → docs/brainstorms/<slug>.md
```

Do not emit any other summary text. The plan skill reads the doc directly.
