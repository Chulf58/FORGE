---
name: forge:learn
description: "Capture a learning (gotcha, solution, or decision) into the FORGE knowledge store through the quality gate. Use when: the user wants to record a reusable lesson, pitfall, fix, or decision."
argument-hint: "[the learning — what you discovered and when it applies]"
allowed-tools: "Read Write Edit"
---

Persist a learning into the FORGE knowledge store. This is the user-facing write path — it closes the gap where only agents (plan-extractor, learnings-extractor) could write knowledge but the user could not. Every write goes through the same quality gate the agents use.

## The quality gate (required fields)

`forge_add_learning` rejects structurally incomplete payloads at the chokepoint. You MUST supply:

- **type** — `gotcha` or `solution`.
- **trigger** — the "when X, do Y" condition under which the learning applies (e.g. "When editing a hook script"). A learning with no trigger cannot be acted on later.
- **sourceEvidence** — provenance: where this was observed (e.g. `"run r-4a09697c"`, `"GENERAL.md line 47"`, a URL).

Also pass `title`, `content`, and `tags`. If the payload conflicts with an existing entry, pass `mergeEvidenceOnConflict: true` to merge the new `sourceEvidence` into the existing entry instead of creating a duplicate.

## The three kinds

- **gotcha** → `forge_add_learning({ type: 'gotcha', ... })` — appends a section to `docs/gotchas/GENERAL.md` and indexes it for retrieval. Use for a project-specific pitfall or rule.
- **solution** → `forge_add_learning({ type: 'solution', ... })` — writes a new doc under `docs/solutions/` and updates `docs/solutions/index.json`. Use for a reusable fix or pattern.
- **decision** → recorded in the chronological `docs/DECISIONS.md` (append a new `## [YYYY-MM-DD] <title>` entry with Context / Decision / Reason), then it becomes retrievable via the decisions index (`docs/decisions-index.json`, refreshed by `buildDecisionsIndex`). Use for a non-obvious architectural choice you want findable later.

## How to run

1. From `$ARGUMENTS`, determine the kind, then draw out the `trigger` and `sourceEvidence` if the user did not state them — do not invent provenance; ask or cite the run/file.
2. For `gotcha`/`solution`: call `forge_add_learning` with all required fields. If it returns a `conflict`, re-call with `mergeEvidenceOnConflict: true` (the gate still applies) so evidence is never dropped.
3. For `decision`: append the dated entry to `docs/DECISIONS.md` (never reorder or delete existing entries), then note that it is now indexed for retrieval.
4. Report what was written and where.

$ARGUMENTS
