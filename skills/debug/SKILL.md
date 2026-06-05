---
name: forge:debug
description: "Run the FORGE debug pipeline INLINE (conductor-driven; no autonomous worker). Use when: user reports a bug, something is broken, or tests are failing."
argument-hint: "[bug description]"
allowed-tools: "Read Write Edit Glob Grep Bash Agent"
model: claude-sonnet-4-6
---

Debugging runs **INLINE in the conductor session.** The autonomous `spawnWorker` path is RETIRED (the LLM-prose worker is broken — user 2026-06-05: "debug doesnt work and should not be used. fix it inline"). Do NOT spawn an autonomous worker (`forge_create_run` with `spawnWorker: true`, or `forge_advance_stage`). Inline debug creates **no FORGE run record and no gate2 state at all** — the approval before commit is conversational (STEP 6), not a gate state-machine.

This skill ENACTS the **Root-cause debugging SOP** — the canonical method lives in `CLAUDE.md` (§ "Root-cause debugging SOP"), which is loaded every session. This file is the *operational wrapper*; it references that SOP rather than restating it, so the two cannot drift.

## STEP 0 — Bug intent (one question, with skip)

Before diagnosing, ask the user ONE question to capture their expected behavior — their framing, not yours. Not a multi-turn interview.

**Intent-capture discipline (CLAUDE.md "Intent-capture skill invocation discipline"):** Step 0 is an intent-capture surface. Do NOT pre-fill the user's expected behavior from TODO content or your own inference — ask, then quote them verbatim. The `skip` keyword is the user's escape, not yours.

Ask verbatim:

> Before I start diagnosing — how was this supposed to work? Type `skip` if you've already described the expected behavior, or describe it in one or two sentences.

Branches:
- **`skip`** — proceed to Step 1 with `$ARGUMENTS` as the bug framing.
- **Describes expected behavior** — capture it VERBATIM and carry it as the diagnosis target (the "expected" the trace is measured against). Quote it back when you present the root cause.
- **Ambiguous** — ONE follow-up clarifying question (max 2 turns total in Step 0).

Do NOT skip Step 0 because you think you already know the bug — the user's wording often reveals something you missed.

## STEP 1 — Trace to the floor (NO fix yet)

Apply the SOP. Start from **evidence, not the symptom**: identify the exact actor + tool-call + arguments that produced the behavior — read the transcript / log / dispatch code FIRST. Then descend one governing mechanism at a time, **citing file:line at each layer**, until a floor: a layer you cannot go below (an OS/SDK boundary or a single controlling line). Write the chain out: `symptom → … → ⌊cited floor⌋`. Front-load the mechanism/dispatch/API reads — 2-3 files up front beats N "go deeper" round-trips.

**GATE (most-broken rule):** do NOT propose a fix until the chain bottoms out at a cited floor. If you're reaching for a fix and can't cite the controlling line, you stopped early — keep reading.

Agents: the conductor traces inline (`Read`/`Grep`/`Glob`); for broad multi-file tracing dispatch **`Explore`** (read-only).

## STEP 2 — Verification fan-out (when the root cause is non-trivial or contested)

Spawn parallel subagents to **triangulate and REFUTE — not to generate more options**:
- **`Explore`** — independent codebase tracer: confirm or refute the floor, citing file:line.
- **`forge:researcher`** — API/online + codebase research: verify the facts the fix relies on, citing official docs + local type defs.
- **`general-purpose`** — skeptic: adversarially attack BOTH the diagnosis and every candidate fix; find where they break.

Synthesize only after all three report; a refutation REVISES the diagnosis (don't defend the first answer). Skip the fan-out only for a trivial, self-evident floor.

> These subagents are a SANCTIONED, defined pipeline step. The standing "no ad-hoc Agent" conductor rule does NOT apply inside this skill's verification phase — invoking them here is expected.

## STEP 3 — Rank fixes; present ONE root fix

Rank candidate fixes by **where they intervene**: floor = root fix (the recommendation); mid-chain = workaround; symptom = heal/patch. Present the single root fix (with any optional defense-in-depth clearly subordinate) — **never a co-equal menu**. Healing a symptom is not a root-cause fix. Get the user's `go` before editing.

## STEP 4 — Implement test-first, inline

Per the SOP's test layers (for intermittent / LLM-nondeterministic bugs, **deterministically force** the failing condition — don't wait for it to recur):
- **`forge:coder-scout`** — map the fix's file scope (scout-before-coder is a hard precondition).
- **`forge:test-author`** — write the FAILING tests FIRST (RED bar — confirm the test command exits non-zero before any fix exists). Layer 1: logic unit. Layer 2 (the proof): a real-dispatch smoke test that REPRODUCES the bug pre-fix — verify the artifact/seam, never a proxy (call-count, file-existence, duration); see `docs/gotchas/GENERAL.md` "Unit/mock tests pass on broken dispatch."
- **`forge:coder`** — implement until GREEN. Layer 3: assert the legitimate path still works (don't "fix" by blocking everything).

Edits land in the run's worktree if one exists, else main per the inline model; confine writes to the intended root.

## STEP 5 — Review

Run via Bash: `node scripts/reviewer-dispatch.mjs --handoff=<handoff> --stage=implement --run-id=<label>` (deterministic; force-includes `reviewer-tests` on any test-touching diff). `<label>` is only an output-namespacing id (e.g. the bug TODO id) — **no formal run record is created inline.** Dispatch EXACTLY the returned reviewers (`forge:reviewer-boundary` / `forge:reviewer-logic` / `forge:reviewer-safety` / `forge:reviewer-performance` / `forge:reviewer-tests`) — use `forge_get_model_recommendation` per reviewer. Handle BLOCK / REVISE inline (≤2 revision passes, then surface to the user).

## STEP 6 — Approve + commit (conversational — NOT a gate state-machine)

There is no worker to pause, so there is **no gate2 plumbing**: do NOT write `gate-pending.json`, do NOT call `forge_update_run` with a `gateState`, do NOT route through `/forge:approve`. The approval is the **mandatory conversational pause** this codebase always requires before a commit:

1. Present the fix + the reviewer verdicts to the user.
2. **Wait for explicit approval** ("approve" / "go") — never commit without it (CLAUDE.md: never edit/commit without approval).
3. On approval, the **conductor commits** (stage files individually, never `git add -A`) — and merges the worktree branch if one was used. The conductor handles commits; never spawn a worker to do it.
4. **Layer 4 — re-run / re-soak the exact scenario that surfaced the bug** (the end-to-end proof).
5. Mark the bug TODO done.

## Bug description
$ARGUMENTS
