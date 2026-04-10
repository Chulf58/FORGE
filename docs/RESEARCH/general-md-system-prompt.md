# Research: GENERAL.md injected via --append-system-prompt

## Question: Do any agent .md files read SKILLS.md directly via a tool call?

**Finding:** Two patterns exist.

**Pattern A — boilerplate paragraph** (remove these): `coder.md`, `debug.md`, `implementer.md`, `planner.md`, `refactor.md`, `researcher.md`, `tester.md` each have a standard "read SKILLS.md after GENERAL.md" paragraph.

**Pattern B — load-bearing functional read** (do NOT remove): `gotcha-checker.md` § Stack-aware SKILLS.md check reads SKILLS.md as part of its plan-validation workflow. `skills-generator.md` line 16 merge-read is functionally necessary.

**Agents with GENERAL.md instruction but no SKILLS.md instruction** (no change needed for task 3): `architect.md`, `documenter.md`, `reviewer.md`, `reviewer-logic.md`, `reviewer-performance.md`, `reviewer-safety.md`, `reviewer-style.md`, `reviewer-triage.md`.

**Recommendation:** Strip the boilerplate paragraph from the 8 Pattern A agents. Do NOT touch `gotcha-checker.md` § Stack-aware SKILLS.md check.

---

## Question: Does --append-system-prompt propagate to Task-spawned subagents?

**Finding: No — this is the blocking architectural constraint.**

`runner.ts` spawns a single top-level `claude` process with `--agents <json>` and `--append-system-prompt <content>`. The top-level process is the **orchestrator** and is the only process that receives `--append-system-prompt`.

Pipeline agents (planner, coder, reviewer-*, etc.) are dispatched by the orchestrator via the `Task` tool. Each subagent receives its system prompt from the `--agents` JSON `prompt` field — NOT from `--append-system-prompt`. The CLI flag does not propagate into Task-spawned subagents.

**Consequence:** The plan's stated rationale "the Planner is invoked by FORGE itself so it also receives --append-system-prompt" is incorrect. Tasks 1 and 6 (extend `buildSystemPromptAppend`) are valid for the orchestrator only. Tasks 2, 3, 4 (strip Read GENERAL.md from agent prompts) would leave all pipeline agents with no mechanism to receive GENERAL.md content — a regression.

**Source:** `src/main/handlers/runner.ts` lines 117–131; `src/main/shared.ts` lines 434–438.

**Recommendation — three options:**

1. **Orchestrator-only scope** (safest, immediate win): Implement task 1 only — prepend GENERAL.md to `--append-system-prompt` so the orchestrator has project context. Drop tasks 2/3/4. The orchestrator (which interprets pipeline routing from CLAUDE.md) is the entity that benefits most from GENERAL.md context, and this is a real token win for it.

2. **Inject into buildAgentsJson** (full win, higher effort): Prepend GENERAL.md content into each agent's `prompt` field in `buildAgentsJson`. The 1500-char truncation in `buildAgentsJson` would need to be raised or a filtered per-agent GENERAL.md slice produced. This would allow removing per-agent Read instructions.

3. **Abandon the strip** (no code change): Leave per-agent reads as-is. The in-conversation read is working correctly. Revisit when option 2 is feasible.

**Recommended path: Option 1 now (orchestrator benefit), plan Option 2 as a separate feature.**
