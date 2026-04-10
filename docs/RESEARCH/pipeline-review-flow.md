# Research: Review and Optimise Pipeline Review Flow

## Question 1: Is `claude-haiku-4-5-20251001` appropriate for reviewer-triage?

**Finding:** The plan proposes downgrading `reviewer-triage` from Sonnet to Haiku. The current model field is confirmed at line 4 of `.claude/agents/reviewer-triage.md`:

```
model: claude-sonnet-4-6
```

The triage agent's task as written in its prompt is unambiguously pattern-matching: read one document (`docs/context/handoff.md`), answer five binary trigger questions against a fixed decision table, and emit a structured markdown dispatch block. The output template is fully specified with example entries. There is no open-ended reasoning, no codebase traversal, and no synthesis across multiple sources. The agent is explicitly told "Do not perform any review yourself — you are a dispatcher, not a reviewer." and is restricted to only two tools (Read, Grep).

All five reviewer agents it dispatches (`reviewer`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`) already run on `claude-haiku-4-5-20251001`. The plan's previous rationale for keeping triage on Sonnet ("a wrong dispatch choice silently skips mandatory checks") is mitigated by the low-confidence fallback built into the existing triage prompt: "When confidence is LOW, default to invoking ALL reviewers." This means a model that misclassifies an ambiguous feature will over-dispatch (a recoverable extra cost) rather than under-dispatch (a missed check).

`claude-haiku-4-5-20251001` is the model identifier already in use across all six other reviewer agents. Its presence in those agent files is confirmed by the haiku-model-switch research (`docs/RESEARCH/haiku-model-switch.md`) and by direct inspection of `reviewer.md`, `reviewer-safety.md`, `reviewer-logic.md`, `reviewer-style.md`, and `reviewer-performance.md`.

**Source:** `.claude/agents/reviewer-triage.md` lines 1–66, `template/CLAUDE.md` lines 71–83
**Recommendation:** Switch line 4 of `.claude/agents/reviewer-triage.md` from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001`. The dispatch task is pattern-matching with a fixed output schema. Haiku is sufficient and consistent with all five sibling reviewers.

---

## Question 2: Does the plan-stage revision loop re-run all reviewers or only blocking ones?

**Finding:** `template/CLAUDE.md` lines 87–92 (the `### Plan revision loop` section) read verbatim:

> When any plan-stage reviewer issues BLOCK or REVISE:
> 1. The planner reads **all reviewer outputs** and revises `docs/PLAN.md` to address every BLOCK and REVISE item.
> 2. All plan-stage reviewers that were originally invoked re-run against the updated plan.
> 3. Repeat until every reviewer returns APPROVED.

Step 2 is unambiguous: the current rule is **all originally-invoked plan-stage reviewers re-run** after every revision cycle, regardless of which ones issued BLOCK/REVISE and which returned APPROVED. There is no targeted-re-run provision. This confirms the problem statement in the plan: a single blocking reviewer triggers a full re-run of all four conditional reviewers plus gotcha-checker.

**Source:** `template/CLAUDE.md` lines 85–92
**Recommendation:** Task 4 in the plan is correct. Replace step 2 with targeted re-run language: only the reviewer(s) that issued BLOCK or REVISE re-run; reviewers that returned APPROVED skip re-run unless the revision materially touches their domain. The 3-cycle cap and `[PLAN-BLOCK-ESCALATED]` signal on lines 92–93 are unaffected and must be preserved unchanged.

---

## Question 3: Does the coder revision loop include `reviewer-performance` in the mandatory re-run set?

**Finding:** `template/CLAUDE.md` lines 94–102 (the `### Coder revision loop` section) read verbatim:

> 3. All **mandatory reviewers** (reviewer, reviewer-safety, reviewer-logic) re-run against the updated handoff. reviewer-style does **not** re-run — its issues are static notes carried forward to the implementer.

`reviewer-performance` is absent from this list. The coder revision loop currently mandates re-run for three reviewers: `reviewer`, `reviewer-safety`, `reviewer-logic`. `reviewer-performance` is not included.

Cross-checking line 69 of `template/CLAUDE.md` confirms `reviewer-performance` IS listed as a mandatory reviewer for Gate #2 blocking purposes:

> **BLOCK** — if any mandatory reviewer (reviewer, reviewer-safety, reviewer-logic, reviewer-performance) issues BLOCK, Gate #2 YES button is disabled.

And the conflict table at lines 75–81 confirms a `reviewer-performance` BLOCK is hard-blocking (row 4: `APPROVED | APPROVED | APPROVED | BLOCK | any → Blocked — coder revision required`).

The inconsistency is exactly as described in problem 5 of the plan: `reviewer-performance` can block Gate #2, but when the coder revises and the mandatory re-run set fires, `reviewer-performance` does not re-run to confirm the fix was addressed.

There are no other mentions of `reviewer-performance` in the coder revision loop section. The only additional occurrences are:
- Line 16: plan-stage conditional invocation heuristic
- Line 29: implement-stage triage dispatch mention
- Line 69: Gate #2 BLOCK condition (mandatory list)
- Lines 75 and 231: conflict table header and reading-discipline list

None of these other occurrences are within the coder revision loop and none require updating as a consequence of task 6. Only the single line at line 99 needs changing.

**Source:** `template/CLAUDE.md` lines 94–102 (coder revision loop), line 69 (Gate #2 mandatory list), lines 75–81 (conflict table)
**Recommendation:** Task 6 requires a single-line edit at line 99 of `template/CLAUDE.md`. Change `(reviewer, reviewer-safety, reviewer-logic)` to `(reviewer, reviewer-safety, reviewer-logic, reviewer-performance)`. No other occurrences in the coder revision loop section need updating.

---

## Question 4: Does gotcha-checker.md reference a triple (3 locations) or quadruple (4 locations) for IPC?

**Finding:** `.claude/agents/gotcha-checker.md` lines 31–36 read:

```
### IPC — both sides must match
Every new capability requires changes in exactly two places:
1. `ipcMain.handle('channel-name', handler)` in `src/main/index.ts`
2. `contextBridge.exposeInMainWorld` in `src/preload/index.ts`
3. Type added to `ClaudeAPI` in `src/renderer/src/types/claude.d.ts`
```

The section heading says "exactly two places" but the numbered list contains three items. There is no mention of the fourth location: the helper function in `src/renderer/src/lib/ipc.ts` (the IPC wrapper). The Flag line below the list reads: "Any plan that adds an IPC handler without mentioning the corresponding preload and type steps." — it also omits `ipc.ts`.

This is a triple (3 locations enumerated), not a quadruple (4 locations). The heading ("exactly two places") is internally inconsistent with even the three items listed, and both the heading and the list are inconsistent with `GENERAL.md` and PLAN.md which establish the quadruple as the canonical pattern.

**Source:** `.claude/agents/gotcha-checker.md` lines 31–37
**Recommendation:** Task 1 in the plan is confirmed and correct. Change the heading from "exactly two places" to "exactly four places". Add a fourth numbered list item: `(4) Helper function added to src/renderer/src/lib/ipc.ts`. Update the Flag line to reference all four locations. The current triple causes the checker to APPROVE plans that omit the `ipc.ts` wrapper step.

---

## Bonus: Is `template/CLAUDE.md` the live orchestration file?

**Finding:** The only `CLAUDE.md` in the repository is `C:/Users/cuj/Forge/template/CLAUDE.md`. There is no `CLAUDE.md` at the repo root (`C:/Users/cuj/Forge/CLAUDE.md`) and no `CLAUDE.md` inside `.claude/` (confirmed by glob of both locations). Claude Code reads `CLAUDE.md` from the project root when it exists; absent that, it reads from `~/.claude/CLAUDE.md` (user-level). The `.claude/` directory in this project contains only `agents/` and `settings.local.json` — no `CLAUDE.md`.

The implication is that `template/CLAUDE.md` is NOT currently loaded as the active orchestration file by Claude Code. For FORGE agents to read it, they must be explicitly instructed to do so (which they are — the pipeline routing logic lives in agent prompts that reference this file by path) or CLAUDE.md must be symlinked/copied to the project root.

This is a pre-existing condition that the plan's tasks are written to accommodate: all plan tasks reference `template/CLAUDE.md` directly by path. The implementer must write to `template/CLAUDE.md` — that is the correct target for tasks 2, 4, 6, and 10.

**Source:** Glob of `C:/Users/cuj/Forge/CLAUDE.md` (no result), Glob of `C:/Users/cuj/Forge/.claude/CLAUDE.md` (no result), confirmed only match at `C:/Users/cuj/Forge/template/CLAUDE.md`
**Recommendation:** All CLAUDE.md edits must target `C:/Users/cuj/Forge/template/CLAUDE.md`. Do not create a new CLAUDE.md at the project root — that would change routing behaviour in ways outside this plan's scope.

---

## Bonus: Can reviewer-triage detect plan-stage vs implement-stage from file presence alone?

**Finding:** The current reviewer-triage prompt (`/Users/cuj/Forge/.claude/agents/reviewer-triage.md`) is entirely implement-stage oriented. Its `## Do NOT read` section explicitly prohibits reading `docs/PLAN.md`. Its decision table is keyed entirely on `docs/context/handoff.md` content. It has no concept of plan-stage mode.

The plan's task 3 proposes adding a `## Plan-stage mode` section triggered by the absence of `docs/context/handoff.md`. File-presence detection is a reliable discriminator: `handoff.md` is only written by the coder, debug, or refactor agents — none of which run during the plan pipeline. During `plan feature:`, `handoff.md` either does not exist or contains content from a prior feature. The reviewer-triage agent has Read and Grep tools; it can check file presence by attempting to read `docs/context/handoff.md` and branching on the result.

However, relying purely on file presence has one edge case: if a prior implement run left `handoff.md` on disk and then `plan feature:` is run for a new feature, the stale `handoff.md` would still be present. An explicit invocation-mode signal (e.g. a line in the orchestrator prompt saying "INVOCATION: plan-stage") would be more robust. That said, the plan's task 2 proposes the orchestrator invoke reviewer-triage with instructions to "read `docs/PLAN.md` and output a plan-stage dispatch list" — this explicit instruction in the invocation is sufficient to override file-presence ambiguity without requiring a separate argument mechanism.

**Source:** `.claude/agents/reviewer-triage.md` lines 10–66, `template/CLAUDE.md` lines 9–21
**Recommendation:** Use explicit invocation context (the orchestrator's invocation instruction says "plan-stage") as the primary discriminator, with file-presence check as a secondary confirmation. Do not rely on file presence alone. Task 3's `## Plan-stage mode` section should state: "You are in plan-stage mode when the orchestrator's invocation says 'plan stage' or when `docs/context/handoff.md` is absent. In plan-stage mode, read `docs/PLAN.md` instead of `handoff.md`."
