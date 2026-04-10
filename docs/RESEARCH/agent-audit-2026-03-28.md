# Agent Audit Report — 2026-03-28

Audited against: `templates/code/CLAUDE.md` (orchestrator routing spec) and `docs/ARCHITECTURE.md`.
Scope: all 22 agent `.md` files in `.claude/agents/`.

---

## Summary table

| Agent | Verdict |
|-------|---------|
| planner | MINOR ISSUES |
| researcher-triage | CLEAN |
| researcher | MINOR ISSUES |
| gotcha-checker | MINOR ISSUES |
| coder | MINOR ISSUES |
| reviewer-triage | CRITICAL |
| reviewer | MINOR ISSUES |
| reviewer-safety | CLEAN |
| reviewer-logic | MINOR ISSUES |
| reviewer-style | CLEAN |
| reviewer-performance | CLEAN |
| implementer | MINOR ISSUES |
| tester | CRITICAL |
| documenter | MINOR ISSUES |
| debug | MINOR ISSUES |
| refactor | CLEAN |
| architect | MINOR ISSUES |
| tool-call-auditor | MINOR ISSUES |
| agent-optimizer | CRITICAL |
| integrity-checker | MINOR ISSUES |
| skills-generator | CLEAN |
| nyquist-auditor | CLEAN |

---

## planner — MINOR ISSUES

### Role alignment
Matches orchestrator spec closely. Two-pass behaviour (questions → plan), wave assignment, `[module]` signal, `[todo]` emission, and `[summary]` output are all present and correct.

### Findings

**1. IPC pattern section lists only four locations; GENERAL.md lists six.**
The planner's `## IPC pattern` section says "Every new capability needs changes in exactly four places" and enumerates: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/types/claude.d.ts`, `src/renderer/src/lib/ipc.ts`. GENERAL.md lists six steps: the four above plus (5) the new handler should live in `src/main/handlers/<domain>.ts` not `index.ts`, and (6) file-writing handlers must apply path traversal guard. Plans produced from this list will miss the handler-file separation and the security guard requirement.

**2. Project structure diagram is stale.**
The `## Project structure` block says `src/main/index.ts — Electron main process, IPC handlers, Claude CLI spawn`. New IPC handlers now live in `src/main/handlers/*.ts` modules registered from `index.ts`. The diagram will cause planners to write IPC tasks targeting the wrong file, and the implementer will faithfully follow, producing structurally incorrect code.

**3. `[module]` signal missing from the `## Output signal` block.**
The agent body (Step 4) correctly describes emitting `[module] <id>` after the plan, but the `## Output signal` section at the bottom only shows `[todo]`, `[suggest]`, and `[summary]`. The output signal block is the quick reference agents use in practice. Missing `[module]` from it means the signal will be omitted on low-attention runs.

---

## researcher-triage — CLEAN

### Role alignment
Matches the orchestrator's Step 2a description exactly. Reads `docs/PLAN.md` + GENERAL.md + SKILLS.md, emits `[brief-for: N]` blocks only, stops without writing files. Mode fallback (empty/None section → stop) aligns with the orchestrator's "skip step 2 entirely" rule.

### Findings
None.

---

## researcher — MINOR ISSUES

### Role alignment
Orchestrator dispatches one researcher per question using a brief block as the prompt prefix. The researcher's own instructions say "Read `docs/PLAN.md` and find the `### Research needed` section" — this is the pre-triage, single-researcher flow and does not acknowledge the brief-block input format at all.

### Findings

**1. No instructions for brief-block input format.**
When dispatched by the orchestrator after researcher-triage, the researcher receives a prompt that begins with `[brief-for: N]` content containing the question and relevant GENERAL.md excerpts. The agent's instructions do not mention this format and tell it to read PLAN.md instead. Since the brief already supplies the question, reading PLAN.md is redundant and wastes tokens. The agent should be told: if the prompt begins with `[brief-for:`, use it as the sole question source — do not read PLAN.md.

**2. Output file naming uses `<feature-slug>.md`; CLAUDE.md requires `<feature-slug>-q<N>.md`.**
The researcher instructions say to write to `docs/RESEARCH/<feature-slug>.md`. The orchestrator invocation in CLAUDE.md says `docs/RESEARCH/<feature-slug>-q<N>.md`. When two concurrent researchers run for the same feature, both would attempt to write `<feature-slug>.md` and overwrite each other. The `q<N>` suffix in CLAUDE.md is what makes concurrent researchers safe. The researcher's own instructions do not know about this convention.

---

## gotcha-checker — MINOR ISSUES

### Role alignment
Runs third in the plan feature pipeline. Checks plan against gotchas, emits structured report with APPROVED / REVISE verdict. Does not emit `[reviewer-verdict]` (correct — that is reviewers-only).

### Findings

**1. IPC uniqueness check greps `src/main/index.ts` only; handlers now live in `src/main/handlers/*.ts`.**
The `## IPC channel uniqueness check` section says: "Grep `src/main/index.ts` for `ipcMain.handle`". All new IPC handlers live in `src/main/handlers/*.ts` modules. A plan could propose a channel name that already exists in a handler file (e.g. `handlers/pipeline-data.ts`) and this check would miss the collision entirely, leading to a silent duplicate handler at runtime.

**2. Self-description says "runs third (and last)" which is false.**
The agent's intro says "You run third (and last) in the `plan feature:` pipeline, just before Gate #1." In STANDARD and FULL modes, reviewer-triage and up to four plan-stage reviewers run after it. This is a documentation error, not a functional one, but it could mislead the agent into believing it is the final quality gate and cause it to over-expand its checks into reviewer territory.

---

## coder — MINOR ISSUES

### Role alignment
Matches spec: reads GENERAL.md + PLAN.md + RESEARCH/, writes `docs/context/handoff.md` with Find/Replace pairs, does not touch source files. Pre-flight checklist, self-review, and output signal are aligned.

### Findings

**1. IPC quadruple example shows `src/main/index.ts` as the handler location.**
The `## IPC quadruple` section shows `ipcMain.handle` going into `src/main/index.ts`. Per GENERAL.md and the actual codebase, new handlers go in `src/main/handlers/<domain>.ts`, not `index.ts`. Handoffs generated from this example will target the wrong file. The implementer will faithfully follow, producing code that works but violates the project's handler-module separation.

**2. Plan validity check fails incorrectly for legitimate "no research" plans.**
The check says in non-LEAN modes: fail if `docs/RESEARCH/` is absent. In STANDARD mode the researcher is conditional — if `### Research needed` is None, the researcher is skipped and `docs/RESEARCH/` will legitimately be empty or absent. The coder would incorrectly stop and emit `[suggest] plan feature:` on a valid pipeline-produced plan that simply had no research questions. The check should be: fail only if `RESEARCH/` is absent AND `### Research needed` was non-empty.

---

## reviewer-triage — CRITICAL

### Role alignment
Dispatcher role is correct. However there is a critical bug in the implement-stage mode detection logic.

### Findings

**CRITICAL: Implement-stage secondary-signal check looks for `### Feature:` heading in handoff.md, but real handoffs start with `# Handoff:`.**
The secondary-signal rule (used when the `[plan-stage mode]` prefix is absent) says: "read its first 10 lines — if it contains a `### Feature:` heading, proceed in implement-stage mode." A legitimate implement-stage handoff starts with `# Handoff: <Feature Name>` — it never contains `### Feature:`. That heading belongs to PLAN.md only.

The consequence: when reviewer-triage is invoked for `implement feature:` but the `[plan-stage mode]` prefix is absent (which is the normal case for the implement pipeline), the secondary signal check will find `# Handoff:` in the first line, not `### Feature:`, and fall through to the stale-handoff-or-blank branch — proceeding in **plan-stage mode** against handoff.md content. It will read `docs/PLAN.md` instead of `docs/context/handoff.md`, dispatch plan-stage reviewers, and the implement pipeline will run the wrong review set. The fix is to change the heading check from `### Feature:` to `# Handoff:`.

**2. Plan-stage keyword mapping misses `handlers/` as an IPC trigger word.**
The keyword list for `reviewer` at plan stage includes: `IPC, channel, ipcMain, ipcRenderer, preload, contextBridge, boundary, layer, claude.d.ts, ipc.ts, window.claude`. Plans that reference `src/main/handlers/` as the IPC target file will not match any of these keywords unless they also explicitly use IPC terminology. A task like "Add handler in `src/main/handlers/settings.ts`" would slip through without triggering the reviewer boundary check.

---

## reviewer — MINOR ISSUES

### Role alignment
Boundary and IPC completeness check. Writes to `docs/context/reviewer-output/reviewer.md`, emits `[reviewer-verdict]` as sole stdout. Correct.

### Findings

**1. Plan-stage mode detection uses a fragile heuristic instead of the `[plan-stage mode]` prefix.**
The `## Plan-stage invocation` section says: "If the orchestrator's message asks you to review a plan (mentions `docs/PLAN.md`, `plan feature`, or 'review the plan'), you are in plan-stage mode." The authoritative signal is the `[plan-stage mode]` prefix that CLAUDE.md defines. If the orchestrator's invocation message does not contain those exact strings (e.g. it just says "Review the excerpt below"), reviewer would not detect plan-stage mode. Reviewer-triage uses `[plan-stage mode]` as its primary signal — reviewer should match.

**2. Source files checklist greps `src/main/index.ts` only for `ipcMain.handle`.**
Same as gotcha-checker: existing handlers live in `src/main/handlers/*.ts`. Grepping only `index.ts` will miss duplicate channel names defined in handler files, producing false-clean reviews for IPC completeness.

---

## reviewer-safety — CLEAN

### Role alignment
Correct domain scope (shell injection, secrets, XSS, Electron security, file system safety, IPC input validation, process lifecycle). Output protocol matches other reviewers. Cross-reviewer boundary note present and correct.

### Findings
None.

---

## reviewer-logic — MINOR ISSUES

### Role alignment
Logic and edge-case review. Reads source files listed in handoff. Writes to `docs/context/reviewer-output/reviewer-logic.md`. Has special `## Architect health review` section for post-architect runs. Correct.

### Findings

**1. Architect health review mode detection is fragile against stale handoff.md.**
The `## Architect health review` section detects architect mode by checking "whether `docs/context/handoff.md` is absent or does not contain a `# Handoff:` heading." If a stale handoff.md from a previous feature run exists, reviewer-logic will enter normal handoff-review mode during an architect run, reviewing the stale handoff instead of performing dead-code verification. The architect pipeline does not clean up handoff.md before running, so this collision is realistic.

**2. `## Module parent detection` check references the deleted `FeatPanel.svelte`.**
The conditional guard says "only apply this check if the handoff explicitly modifies `FeatPanel.svelte`". Per git status, `FeatPanel.svelte` was deleted. This guard will never fire. The check is dead prompt weight.

---

## reviewer-style — CLEAN

### Role alignment
Style-only domain. Output protocol identical to other reviewers. Correct.

### Findings
None.

---

## reviewer-performance — CLEAN

### Role alignment
Dual-mode (plan-stage / implement-stage). Output protocol identical. Correct.

### Findings
None.

---

## implementer — MINOR ISSUES

### Role alignment
Apply pipeline agent. Reads handoff.md, applies changes to source files, runs wave protocol, emits `[wave-complete]` / `[blocked]`, ends with `[tester-gate]`. Matches spec.

### Findings

**1. Application order still lists `src/main/index.ts` as the IPC handler location.**
Step 2 in the application order says "Main process (`src/main/index.ts`) — add IPC handlers". New handlers go in `src/main/handlers/<domain>.ts`. An implementer following this order for a new IPC handler will put code in the wrong file.

**2. `[tester-gate]` description is ambiguous about who owns tester invocation.**
The agent says "FORGE UI intercepts `[tester-gate]` and pauses to ask the user whether to run the tester before the documenter." GENERAL.md says `TESTER MODE: OFF/ASK/ON` in the system prompt controls tester invocation and is the orchestrator's (CLAUDE.md's) responsibility, not the UI's. The implementer's description implies the UI makes the decision; GENERAL.md says the orchestrator makes it based on TESTER MODE. This is a description-level mismatch — the implementer correctly emits `[tester-gate]` unconditionally, which is right — but the comment gives the wrong mental model.

---

## tester — CRITICAL

### Role alignment
Second in apply pipeline. Writes to `docs/TESTING.md`. But its output signal is incorrect.

### Findings

**CRITICAL: Tester emits `[run-documenter]` which will double-invoke the documenter.**
The tester's `## Output signal` says: "End your response with a single standalone line: `[run-documenter]`" and explains "FORGE UI catches `[run-documenter]` and automatically fires the documenter agent."

Per CLAUDE.md the apply pipeline is `implementer → tester → documenter` — the orchestrator invokes documenter sequentially after tester completes as a normal pipeline step. The `[run-documenter]` signal exists for the case where the tester is **skipped** (TESTER MODE: OFF or ASK) and the signal auto-chains documenter in place of the tester's normal completion. If a live tester run emits `[run-documenter]`, App.svelte's `onDone` handler will queue a documenter run, and then the orchestrator will also invoke documenter as the next sequential step. The result is documenter running twice: double CHANGELOG entry, second attempt to archive the same PLAN.md section, and a features.json entry written twice.

The tester should end with `[suggest] apply complete` or no signal at all — not `[run-documenter]`. (Note: tester is currently always skipped per `feedback_skip_tester.md`, so this bug is dormant. It will activate the moment TESTER MODE is set to ON.)

---

## documenter — MINOR ISSUES

### Role alignment
Last in apply pipeline. Updates CHANGELOG.md, ARCHITECTURE.md, DECISIONS.md, archives PLAN.md section, manages board.json and features.json. Archival steps 7 and 8 present. Correct.

### Findings

**1. ARCHITECTURE.md update section references section names that don't match the actual file.**
Step 2 says to use Grep to locate sections named "Folder structure", "IPC channel inventory", "Data flow", "Store descriptions". The actual `docs/ARCHITECTURE.md` uses: "Process boundaries", "Module map", "IPC handler modules", "Store architecture". The Grep will find no matches, and the documenter will either skip the update silently or append duplicate sections with the old names.

**2. Feature registry Step 5 references `docs/MODULES.md` as an alternative target.**
"add a capability entry to that module's record in the features store or a dedicated `docs/MODULES.md` if it exists." There is no `docs/MODULES.md`. Module capabilities live in `.pipeline/modules.json`. The `docs/MODULES.md` reference is a dead path that will cause the documenter to attempt reading a non-existent file before falling back to modules.json — wasting a tool call.

---

## debug — MINOR ISSUES

### Role alignment
Traces root cause, writes handoff.md with fix plan, emits `[suggest]` and `[summary]`. Matches spec.

### Findings

**1. Output signal comment describes a fixed four-reviewer set that contradicts pipeline mode.**
The agent says: "Your handoff goes to the reviewer trio (boundary, safety, logic, style) before Gate #2." In LEAN mode only `reviewer` runs; in STANDARD mode reviewer-triage dispatches conditionally; in FULL mode all five run. Describing a fixed "trio" (the list actually names four reviewers) is misleading and could cause the debug agent to structure its handoff expecting all four domains to be reviewed when only one reviewer runs in LEAN mode.

---

## refactor — CLEAN

### Role alignment
Matches spec. Analyses hot files, writes refactor plan to handoff.md, emits `[suggest]` and `[summary]`. Output signal correctly says "do NOT suggest applying directly."

### Findings
None.

---

## architect — MINOR ISSUES

### Role alignment
FULL / HEALTH / GAPS / CROSS-MODULE / REFACTOR modes all present. Writes ARCHITECTURE.md, modules.json, GENERAL.md. Dead code verification protocol present. Matches spec.

### Findings

**1. HEALTH mode aspect list omits `integrity` and `nyquist`.**
The HEALTH mode section lists aspects as: `complexity`, `duplication`, `coupling`, `coverage`, `documentation`, `performance`, `security`. GENERAL.md's signal table adds `integrity` (integrity-checker) and `nyquist` (nyquist-auditor). The architect's HEALTH mode signals should be consistent with the full vocabulary. Non-listed aspects still render in the HEALTH tab but may not style correctly.

**2. `[todo]` format includes a PRIORITY prefix not present in the standard signal.**
The architect emits `[todo] HIGH: title — detail` but CLAUDE.md defines `[todo] <task text>` with no priority prefix. App.svelte classifies any line starting with `[todo]` and uses the full remaining text as the task title. So board entries would read "HIGH: Split App.svelte..." as the literal title. Functional but inconsistent with how other agents emit `[todo]` signals, and creates non-uniform task titles on the board.

---

## tool-call-auditor — MINOR ISSUES

### Role alignment
Reads session audit log, detects anti-patterns + recurrence, appends to `docs/audit-log.jsonl`, emits `[auditor-clean]` or `[auditor-recurring] <count>`. Matches CLAUDE.md's apply pipeline tail.

### Findings

**1. The `[auditor-recurring]` → agent-optimizer → `[gate2]` → implementer flow is broken (see agent-optimizer below).**
This agent correctly emits `[auditor-recurring] <count>` which the orchestrator uses to invoke agent-optimizer. However agent-optimizer's output signal `[gate2]` is not a real FORGE signal, so the Gate #2 and implementer steps that follow will never execute. The tool-call-auditor is not at fault for this break, but the overall flow it initiates is non-functional.

---

## agent-optimizer — CRITICAL

### Role alignment
Reads recurring audit findings, maps to agent files, writes proposed prompt additions to `docs/context/handoff.md`. Triggered by `[auditor-recurring]`.

### Findings

**CRITICAL: `[gate2]` output signal does not exist in FORGE's signal protocol — Gate #2 will never appear.**
The agent ends with:
```
[gate2] Agent Optimizer has proposed prompt updates for <N> agent file(s). Review docs/context/handoff.md and approve to apply.
```
This signal does not appear in GENERAL.md's signal table, CLAUDE.md's signal list, or App.svelte's classifier. It will fall through to the terminal as plain text. Gate #2 is triggered in FORGE by the orchestrator detecting the review pipeline completion (via `gateDetector.detectGates()`) or by the `BLOCK` literal in the run buffer — not by any named signal. The intended Gate #2 display will never occur, meaning the implementer that should apply the proposed agent changes will never be invoked.

The entire optimizer → Gate #2 → implementer chain is silently broken end to end.

**2. No `[summary]` signal emitted.**
CLAUDE.md requires `[summary] <one sentence>` before Gate #2 is shown. Even if the `[gate2]` signal issue were fixed, no `[summary]` is emitted, so Gate #1/2 bars would show no description.

---

## integrity-checker — MINOR ISSUES

### Role alignment
Nine checks, emits `[health]` signals with `integrity` aspect. On-demand via direct mode. Correct format. Correct scope.

### Findings

**1. Count inconsistency: description says seven, intro says six, implementation has nine.**
The YAML `description` field says "seven pipeline integrity checks". The body intro says "Run all six checks below." The agent actually implements nine numbered checks (1–9 are fully specified). The `## Output order` section says "1 through 9". None of these three references agree, which creates confusion about expected behaviour but does not affect execution since all nine checks are fully implemented.

---

## skills-generator — CLEAN

### Role alignment
Generates `docs/gotchas/SKILLS.md` in stack-name-only or codebase-analysis mode. Merge behaviour correct. Warns about `filterSkillsByStacks()` structure requirement. Correct output signal.

### Findings
None.

---

## nyquist-auditor — CLEAN

### Role alignment
Reads PLAN.md, writes `.test.md` stubs to `docs/tests/<slug>/`, emits `[health]` signals with `nyquist` aspect. On-demand via direct mode. No conflicts with other agents.

### Findings
None.

---

## Cross-cutting findings

### CC-1 — IPC handler location is stale across five agents

**Affected:** planner, gotcha-checker, coder, reviewer, implementer

Every agent that describes IPC handler creation still references `src/main/index.ts` as the target file. The actual project routes new handlers through `src/main/handlers/<domain>.ts` modules. This affects: task generation (planner writes wrong file target), plan validation (gotcha-checker misses duplicate channel names in handler files), handoff generation (coder produces handoffs targeting wrong file), IPC review (reviewer greps wrong file for collision detection), and code application (implementer applies changes to wrong file).

Fix: update all five agents to reference `src/main/handlers/<domain>.ts` as the IPC handler location and update all Grep-based uniqueness/completeness checks to search `src/main/` recursively.

### CC-2 — Agent-optimizer Gate #2 flow is broken end to end

**Affected:** agent-optimizer, tool-call-auditor

The `[gate2]` signal emitted by agent-optimizer is not in FORGE's signal protocol and will not trigger Gate #2. The apply step that is supposed to use implementer to apply proposed agent prompt changes will never execute. This means recurring tool-call anti-patterns detected by the auditor will be reported but never fixed automatically.

Fix: either (a) add `[gate2]` as a real signal to App.svelte and GENERAL.md's signal table, or (b) redesign the optimizer to emit a `[reviewer-verdict]` JSON with `BLOCK` verdict so the existing `gateDetector` picks it up — though this is a poor semantic fit. Option (a) is simpler.

### CC-3 — reviewer-triage implement-stage detection is broken

**Affected:** reviewer-triage (CRITICAL), reviewer-logic (minor)

Reviewer-triage's secondary-signal check for implement-stage mode looks for `### Feature:` in handoff.md, but handoffs always start with `# Handoff:`. When the `[plan-stage mode]` prefix is absent (the normal implement pipeline invocation), reviewer-triage will incorrectly enter plan-stage mode and read PLAN.md instead of handoff.md, dispatching the wrong set of reviewers for every implement/debug/refactor run.

Fix: change the heading check in reviewer-triage from `### Feature:` to `# Handoff:`.

---

*Report generated 2026-03-28. 22 agents audited. 3 CRITICAL findings, 14 MINOR ISSUES, 5 CLEAN.*
