# Research: Fix Coder Agent Prompt Gaps

## Question: What is the correct output signal — `apply feature:` or `review feature:`?

**Finding:** `.claude/agents/coder.md` line 219 currently emits:
```
`[suggest] apply feature: <feature name>`
```
The debug agent (`.claude/agents/debug.md` line 95) uses the parallel pattern:
```
`[suggest] review debug: <bug description>`
```
The debug agent's `## Output signal` section (lines 90–98) explicitly documents why: "Do NOT suggest applying directly." and explains Gate #2 gates the apply step. The coder must mirror this. The correct signal for the coder is `[suggest] review feature: <feature name>`.

**Source:** `.claude/agents/coder.md` line 219; `.claude/agents/debug.md` lines 90–98

**Recommendation:** Replace line 219 in `coder.md`:
- Old: `` `[suggest] apply feature: <feature name>` ``
- New: `` `[suggest] review feature: <feature name>` ``

Add immediately after that line a note matching the debug agent's pattern:
"Do NOT suggest applying directly — Gate #2 gates the apply step. Emitting `apply feature:` here bypasses all reviewers and the human approval gate."

---

## Question: Where exactly should the plan validity pre-step be inserted, and what should it check?

**Finding:** The `## Your role` section ends at line 16. The next section `## Why handoff.md, not source files` begins at line 18. The insertion point is between these two sections — after the blank line at line 17, before line 18.

The two checks required by the plan are implementable as simple file-existence instructions:
1. `docs/RESEARCH/` must contain at least one `.md` file — the Researcher always writes there.
2. `docs/PLAN.md` must contain a `### Feature:` heading — the Planner always writes one.

If either check fails the coder must stop, NOT write `handoff.md`, and emit `[suggest] plan feature: <name>` (not `implement feature:`).

**Source:** `.claude/agents/coder.md` lines 14–18; `docs/PLAN.md` line 3 (confirms `### Feature:` heading pattern)

**Recommendation:** Insert a new `## Before you start — plan validity check` section between lines 17 and 18 of `coder.md` with the two checks and the stop/escalate instruction as specified in the plan.

---

## Question: Where in the role description should `docs/gotchas/GENERAL.md` be added, and what does it cover?

**Finding:** The role description at `coder.md` line 16 currently reads:
> "Read the plan in `docs/PLAN.md` and research in `docs/RESEARCH/`, then write a complete implementation draft to `docs/context/handoff.md`."

`docs/gotchas/GENERAL.md` exists and covers: process boundary (no Node in renderer), Svelte 5 runes vs legacy stores, IPC invoke/send distinction, state ownership, signal protocol, file path safety, token cost constants, and Windows platform differences (spawn shell flag, path separator rules, `fsPromises.cp` version requirement). All of these are pre-coding knowledge, not post-coding checks — making them mandatory pre-read is correct.

**Source:** `.claude/agents/coder.md` line 16; `docs/gotchas/GENERAL.md` lines 1–119

**Recommendation:** Amend line 16 to include `docs/gotchas/GENERAL.md` as a third explicit pre-read. The updated sentence should read something like:
> "Read `docs/gotchas/GENERAL.md` (project-specific gotchas: process boundary, IPC pattern, Svelte 5 rune rules, signal protocol, platform differences), the plan in `docs/PLAN.md`, and the research in `docs/RESEARCH/`, then write a complete implementation draft to `docs/context/handoff.md`."

---

## Question: Which line has "IPC triple" and what does the code block below it contain?

**Finding:** `.claude/agents/coder.md` line 39 reads:
```
### IPC triple (main + preload + type)
```
Line 40 reads:
```
Every new channel needs all three:
```
The code block that follows (lines 42–53) has comment headers for three locations only:
- `// src/main/index.ts` (line 43)
- `// src/preload/index.ts (inside contextBridge.exposeInMainWorld)` (line 48)
- `// src/renderer/src/types/claude.d.ts (inside ClaudeAPI interface)` (line 51)

The fourth location — `src/renderer/src/lib/ipc.ts` — is absent from the heading, the prose on line 40, and the code block entirely.

By contrast, the pre-flight checklist at lines 150–155 already correctly names all four as "the quadruple" and explicitly lists `src/renderer/src/lib/ipc.ts` with the explanation that it is "the layer components actually call."

**Source:** `.claude/agents/coder.md` lines 39–53 (heading and code block); lines 150–155 (pre-flight checklist, correct reference)

**Recommendation:** Four targeted edits to the tech-stack section:
1. Line 39: change `### IPC triple (main + preload + type)` to `### IPC quadruple (main + preload + type + ipc.ts wrapper)`
2. Line 40: change `Every new channel needs all three:` to `Every new channel needs all four:`
3. After line 53 (closing triple-backtick of the code block), add a fourth code snippet entry for `src/renderer/src/lib/ipc.ts`:
   ```typescript
   // src/renderer/src/lib/ipc.ts (wrapper components actually call)
   export async function myMethod(arg: string) {
     return window.claude.myMethod(arg)
   }
   ```

---

## Summary of exact edit locations in `.claude/agents/coder.md`

| Gap | Line(s) | Current text | Required change |
|-----|---------|--------------|-----------------|
| 1. Output signal | 216–221 (the `## Output signal` section) | `[suggest] apply feature:` | `[suggest] review feature:` + Gate #2 warning note |
| 2. Plan validity pre-step | between lines 17 and 18 | (nothing) | Insert `## Before you start — plan validity check` section |
| 3. GENERAL.md pre-read | line 16 | lists only PLAN.md and RESEARCH/ | Add `docs/gotchas/GENERAL.md` as mandatory first pre-read |
| 4. IPC triple → quadruple | lines 39–40, code block lines 43–53 | "triple", "all three", three code comments | "quadruple", "all four", add fourth ipc.ts code comment |
