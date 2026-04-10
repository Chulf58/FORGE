### [x] Feature: Documenter board hygiene

- [x] 1. Extend documenter Step 5b — broaden todo-closure matching to also close todos that share significant word overlap with the feature name (not just substring), using Stage 1 (substring) + Stage 2 (word overlap) only — do NOT apply Stage 3 (most-recent fallback) to todos since the most-recent todo may be unrelated to the current feature; if neither stage matches, log "no todo matched for feature X — skipping"; add explicit fallback log lines for each stage used (`.claude/agents/documenter.md`)
- [x] 2. Add documenter Step 5c — after Step 5b, purge stale completed entries: read `todos[]` and remove any entry where `done: true` AND `doneAt` is older than 7 days (604800000 ms) from the current epoch; log plain text "Board: purged N stale completed todos" with count (no bracket-prefix — this is not a renderer signal); write back with same 2-space indent rules; if no stale entries exist log "Board: no stale completed todos to purge" (`.claude/agents/documenter.md`)
- [x] 3. Add end-of-session documenter protocol to CLAUDE.md — in the FORGE-on-FORGE constraint section, add a paragraph specifying that after any direct-edit session touching more than one FORGE source file, the documenter agent must be run as the final step; include the exact invocation format and note that it should reference a handoff summary written to `docs/context/handoff.md` before running (`CLAUDE.md`)
- [x] 4. One-time board cleanup — manually purge all current `done: true` entries from `todos[]` in `.pipeline/board.json` that are already marked done, leaving only `done: false` entries and any done entries added within the last 7 days; this is a direct edit, not an agent task (`.pipeline/board.json`)

### Research needed
- None — scope is fully understood from the files read.

### [x] Feature: Cleanup Agent

- [x] 1. Create `.claude/agents/cleanup.md` — new Haiku agent with focused prompt covering: extract feature name from `docs/context/handoff.md` line 1 (strip `# Handoff: ` prefix, derive slug), delete `docs/RESEARCH/<slug>.md` if it exists, archive `docs/PLAN-archive.md` to `docs/archive/PLAN_HISTORY.md` when it exceeds 500 lines (keep last 10 feature blocks), trim `.pipeline/features.json` to 50 most recent entries, delete all files in `docs/context/reviewer-output/` via Bash, no output signal — exits silently (`.claude/agents/cleanup.md`) (wave: 1)
- [x] 2. Remove cleanup steps from documenter — remove Step 4e (RESEARCH file delete), Step 9 (PLAN-archive archival), Step 10 (reviewer-output cleanup), and the `slice(0, 50)` trim from Step 6(d); update description in frontmatter to remove "cleanup" from role description; update the output signal note to drop archival counts for PLAN-archive (`.claude/agents/documenter.md`) (wave: 1)
- [x] 3. Register cleanup agent in `.pipeline/agent-roles.json` — add entry `"cleanup": { "allowedPaths": ["docs/RESEARCH/**", "docs/PLAN-archive.md", "docs/archive/**", ".pipeline/features.json", "docs/context/reviewer-output/**", "docs/context/handoff.md"] }`; also narrow documenter's `allowedPaths` by removing `"docs/PLAN-archive.md"` and `"docs/archive/**"` since those responsibilities move to cleanup (`.pipeline/agent-roles.json`) (wave: 1)
- [x] 4. Add cleanup to FORGE's own `CLAUDE.md` — append `cleanup` after `documenter` in the `apply feature:`, `apply debug:`, and `apply refactor:` pipeline sequence descriptions; add cleanup to the pipeline mode table entries for those three pipelines (`CLAUDE.md`) (wave: 2)
- [x] 5. Add cleanup to `templates/code/CLAUDE.md` — same as task 4: append `cleanup` after `documenter` in `apply feature:`, `apply debug:`, and `apply refactor:` pipeline sequence descriptions (`templates/code/CLAUDE.md`) (wave: 2)
- [x] 6. Add cleanup to `src/renderer/src/lib/constants.ts` — add `cleanup` entry to `AGENT_META` (label: `'Cleanup'`, model: `'haiku'`, color: `'var(--dim)'`); add `'cleanup'` to the `agents` arrays for `'apply feature'`, `'apply debug'`, and `'apply refactor'` in `PIPELINES`; add `'cleanup'` to the `lean`/`standard`/`full` arrays in `PIPELINE_MODE_AGENTS` for those same three pipelines (`src/renderer/src/lib/constants.ts`) (wave: 2)
- [x] 7. Update `docs/gotchas/GENERAL.md` — update the pipeline modes table to add `cleanup` to the agent list for `apply feature`, `apply debug`, and `apply refactor` rows (`docs/gotchas/GENERAL.md`)

### [x] Todo: planner-checkpoint-resume
Add checkpoint/resume to the planner agent.
Done: 2026-03-30

### [x] Todo: debug-refactor-revision-loop
Extend the coder's revision loop to debug and refactor pipelines.
Done: 2026-03-30

### [x] Todo: diff-review-ui-gate2
Polish the diff review UI at Gate #2 — it is already ~90% built.
Done: 2026-03-29

### [x] Todo: per-run-cost-telemetry
Persist per-run cost breakdown to verdicts.jsonl and surface in USAGE tab.
Done: 2026-03-30

### [x] Todo: completeness-checker-agent
explore: how should a completeness-checker agent fit into the implement feature pipeline — read templates/code/CLAUDE.md to understand the coder→reviewer-triage sequence, how reviewer-triage excerpts work, and where completeness-checker should slot in. Output: exact placement, what signals it should emit, and whether it needs a new [reviewer-verdict] variant or a different signal type.
Done: 2026-03-30

### [x] Todo: verification-aware-planning
explore: read .claude/agents/planner.md, gotcha-checker.md, and implementer.md to understand the current task format in PLAN.md and how the implementer does wave self-checks. Answer: (1) what does a task entry look like today, (2) would adding a Verify: line per task break any existing parsing, (3) how does the implementer currently decide what to verify after each wave — is it freeform or structured?
Done: 2026-03-30

### [x] Todo: model-version-in-verdicts
Add model_version field to reviewer-verdict JSON.
Done: 2026-03-30

### [x] Todo: circuit-breaker-repeated-failures
explore: read templates/code/CLAUDE.md and find the implement feature revision loop section. Understand exactly how BLOCK verdicts are detected and how the coder is re-invoked. Answer: (1) how does the orchestrator currently track revision cycle count, (2) is BLOCK reason text available in the orchestrator context between cycles, (3) where exactly would a 'same BLOCK reason detected' check slot in — before re-invoking coder or after?
Done: 2026-03-30

### [x] Todo: per-agent-latency-budgets
explore: read src/renderer/src/stores/run.svelte.ts and src/renderer/src/components/prompt/RunTimer.svelte to understand what elapsed time tracking already exists. Also check src/main/handlers/runner.ts for whether there is any kill/timeout mechanism for the spawned subprocess. Answer: (1) does RunTimer already track per-agent elapsed time or just total run time? (2) can we kill a specific sub-agent without killing the whole Claude subprocess? (3) is a UI-only warning (no kill) achievable with zero changes to runner.ts?
Done: 2026-03-30

### [x] Todo: prompt-injection-researcher-output
Sanitise researcher output before writing to docs/RESEARCH/ to prevent prompt injection via web content.
Done: 2026-03-30

### [x] Todo: regression-risk-agent
explore: read .pipeline/modules.json and templates/code/CLAUDE.md to understand what the module map currently contains and how reviewer-triage slots after the coder today. Answer: (1) what fields does modules.json expose (file path, coupling info, etc.), (2) how would a regression-risk agent emit its findings — [health] signal, [suggest] chip, or injected into reviewer-triage's brief, (3) does it need to run before or in parallel with reviewer-triage?
Done: 2026-03-30

### [x] Todo: spec-agent
explore: read templates/code/CLAUDE.md (planner section) and src/renderer/src/components/prompt/QaStrip.svelte to understand (1) how the Q&A strip currently handles ambiguity before planning, (2) where a spec agent would slot — before the Q&A step, after it, or as an alternative, (3) whether spec agent output needs its own Gate or folds into the existing Gate #1 plan review.
Done: 2026-03-30

### [x] Todo: observer-agent
explore: read docs/audit-log.jsonl (first 20 lines) and .claude/agents/agent-optimizer.md to understand (1) what the tool-call-auditor currently captures, (2) what reasoning-level patterns it cannot see (they are in output text, not tool calls), (3) where a structured session ledger would live — appended to audit-log.jsonl, a separate docs/observer-log.jsonl, or written per-session.
Done: 2026-03-30

### [x] Todo: handoff-summarizer
explore: read .claude/agents/reviewer-triage.md to understand its current output format (dispatch list + excerpts). Answer: (1) does reviewer-triage already produce a handoff summary or only excerpts per reviewer, (2) would adding a 15-line summary be a natural extension to reviewer-triage's existing output, or does it need a separate pre-triage pass, (3) how would the summary reach agents outside the reviewer wave (e.g. Gate #2 display)?
Done: 2026-03-30

### [x] Todo: tdd-agent
explore: read .claude/agents/implementer.md and .claude/agents/planner.md to understand (1) how the implementer currently does wave self-checks, (2) whether test stubs would live in handoff.md (written by the coder post-TDD-agent) or in a separate docs/TEST-CRITERIA.md, (3) how this overlaps with verification-aware-planning (Verify: lines per task) — are they the same feature or complementary?
Done: 2026-03-30

### [x] Todo: domain-context-agent
explore: read templates/code/CLAUDE.md (agent slot system section) and .pipeline/project.json schema in src/renderer/src/types/claude.d.ts to understand (1) what BEFORE_PLAN and AFTER_RESEARCH hook points currently exist in the slot system, (2) whether a domain context agent can use an existing slot or needs a new hook point, (3) how it differs from a custom reviewer in a project slot today.
Done: 2026-03-30

### [x] Todo: reviewer-style-to-haiku
Change reviewer-style's model from Sonnet to Haiku.
Done: 2026-03-27

### [x] Todo: delivery-agent-focused-dispatch
Introduce triage agents for researcher parallel waves and implementer waves — extending the triage agent pattern already proven by reviewer-triage.
Done: 2026-03-28

### [x] Todo: researcher-parallel-wave-execution
Apply wave execution to the researcher agent. When the plan's '### Research needed' section contains multiple independent questions, spawn parallel researcher instances — one per question — each writing its own findings to docs/RESEARCH/<question-slug>.md. Same principle as implementer waves: tasks that don't depend on each other's output have no reason to run sequentially.
Done: 2026-03-28

### [x] Todo: reviewer-boundary-false-positive-handoff-misread
The boundary reviewer (reviewer.md) intermittently issues BLOCK verdicts by checking current source file state rather than reviewing the handoff as a plan for future changes. Concrete example: on the 'wizard-project-context-injection' feature, it flagged 5 blockers because projectName/projectDescription 'weren't in the code yet' — which is correct and expected since the handoff describes what the implementer will add.
Done: 2026-03-28

### [x] Todo: missing-project-folder-handling
UX/RESILIENCE: FORGE currently has no handling for the case where a project folder is moved or deleted while the project is still saved in FORGE's project list or set as the active project. This will silently break — pipelines will fail, file reads will throw, and the user gets no clear explanation.
Done: 2026-03-30

### [x] Todo: wizard-project-context-lost-not-injected
The project creation wizard collects the user's project description and purpose (e.g. 'fan webpage for battle tanks') but this context is never saved to project.json or injected into CLAUDE.md. As a result, agents have zero knowledge of what the project is actually for — the planner invents generic content instead of using what the user said.
Done: 2026-03-28

### [x] Todo: direct-mode-routing-centralise-in-forge
DIRECT mode routing rules (what to redirect to a pipeline vs. what to handle directly) are currently embedded in each active project's CLAUDE.md. This means: (1) every project carries a duplicate copy of the same logic; (2) fixing a routing bug requires updating every existing project's CLAUDE.md manually; (3) the rules are owned by the project, not by FORGE — which is wrong since DIRECT is a FORGE feature.
Done: 2026-03-28

### [x] Todo: terminal-run-timer
Show a live timer in the terminal area while Claude is working so the user can see how long a run has been active. When a run starts, display a small elapsed timer (e.g. '0:42') that updates every second. Show it in the run status area or near the STOP button. Hide it when the run finishes. This helps users gauge when to worry about a stuck run vs. normal thinking time. Consider: (1) where to display — inside the terminal header bar, or near the STOP button in ControlsRow; (2) format — MM:SS is readable and compact; (3) should it also appear in the LIVE tab summary row alongside the agent count?
Done: 2026-03-28

### [x] Todo: why-button-rename
Rename the 'WHY' titlebar button to something more self-explanatory. 'WHY' is cryptic to a first-time user who has no context. Candidates: 'DESIGN RATIONALE', 'HOW IT WORKS', 'ABOUT PIPELINE', 'RATIONALE'. Should be short enough to fit in the titlebar but immediately communicate what it opens.
Done: 2026-03-27

### [x] Todo: qa-all-pipelines-chat-modes-q1a2-p3c4
[CLOSED: covered by post-qa-pipeline-audit (#1)]
Done: 2026-03-29

### [x] Todo: explore-weakness-token-cost
Token cost is FORGEs biggest competitive liability. A full plan→implement→apply cycle burns 300-600K tokens. Explore: (1) instrument real runs and measure per-agent token cost to find the biggest spenders; (2) could agent prompts be shortened without losing quality? (3) could the coder skip re-reading files already in planner context? (4) how often does the plan revision loop actually fire — are multiple cycles common? (5) would caching SKILLS.md help since it is re-read on every run? (6) compare FORGE token cost on the same feature against aider or plain Claude CLI. Goal: find the 20% of changes that reduce 80% of token waste.
Done: 2026-03-25

### [x] Todo: explore-weakness-pipeline-rigidity
[CLOSED: covered by One Chat Phase 1 (one-chat-vision-ux-redesign)]
Done: 2026-03-29

### [x] Todo: explore-weakness-no-test-execution
[CLOSED: covered by test-execution-loop (#26)]
Done: 2026-03-29

### [x] Todo: incremental-mode-single-change
[CLOSED: covered by One Chat Phase 2 (dynamic-pipeline-construction-retire-modes)]
Done: 2026-03-29

### [x] Todo: terminal-copy-per-answer-a1b2-c3d4-e5f6
Copy button granularity — the terminal output copy button currently copies the entire terminal buffer. It should instead be per-answer (per agent response block), so the user can copy just the output from a specific agent run without surrounding context. Investigate: (1) how agent output blocks are currently delimited in the run buffer; (2) whether lineClassifier or the existing run-divider type can be used to identify block boundaries; (3) add a small copy icon that appears on hover at the top-right of each answer block. Store no state — just read the DOM text of that block on click.
Done: 2026-03-24
### [x] Feature: Capability-scoped skills — granular injection (Phases 2 + 3)

**Context:** Research confirmed FORGE's architecture is sound. The improvement is breaking `### Electron / Svelte` monolith into per-capability files (e.g. `electron-ipc`, `svelte5-reactivity`) so agents receive only the capabilities relevant to their current task. Phase 1 (rule density + positioning audit) was done as a direct edit session.

### Research needed
- None (research complete — `docs/RESEARCH/rule-injection-best-practices.md`)

---

### Phase 2 — Capability-scoped skill files

**Goal:** Replace per-stack subsections in SKILLS.md with per-capability files. Each file covers one topic, has a `(generated: YYYY-MM-DD)` stamp, and has separate sections per agent role.

- [x] 2.1 Define capability ID convention — lowercase kebab, no spaces (e.g. `electron-ipc`, `svelte5-reactivity`, `svelte5-components`, `electron-security`, `typescript-strict`, `git`, `api-rest`). Document in `docs/ARCHITECTURE.md`.

- [x] 2.2 Add `capabilities` array to `project.json` schema (`src/renderer/src/types/claude.d.ts` — `ProjectJson` interface). Keep `techStacks`/`techStackLabels` as display labels; `capabilities` is the machine-readable injection list.

- [x] 2.3 Update `filterSkillsByStacks()` in `src/main/shared.ts`:
  - New function `filterSkillsByCapabilities(skillsDir, capabilities, agentRole)` that reads `docs/gotchas/skills/<id>.md` files and returns the merged content for the given agent role.
  - Keep `filterSkillsByStacks()` as a shim pointing to the new function for backwards compatibility during migration.
  - Skill file structure: `## <AgentName>` sections with content for that role (no `### <Stack>` subsection needed — the file itself is the capability).

- [x] 2.4 Update `skills-generator.md` agent to generate per-capability files instead of per-stack subsections in a monolith:
  - Output path: `docs/gotchas/skills/<capability-id>.md`
  - File structure: one `## <AgentName>` section per pipeline role, 5–8 rules per section, `(generated: YYYY-MM-DD)` in the file's `# ` heading.
  - Merge behavior: if the file already exists, update only the agent sections that are stale (>90 days) or missing.

- [x] 2.5 Update wizard (Step 2 — Stack picker) to set `capabilities` from stack selection:
  - When user picks `Electron + Svelte 5`, set `capabilities: ["electron-ipc", "electron-security", "svelte5-reactivity", "svelte5-components", "typescript-strict"]`.
  - Build a `STACK_TO_CAPABILITIES` map in `constants.ts` covering all existing templates.
  - Update import flow (`ImportModal.svelte`) to derive capabilities from detected stack.

- [x] 2.6 Update integrity-checker Check 10 to read per-capability files (check `docs/gotchas/skills/*.md` for stale `(generated:)` headings) instead of SKILLS.md subsections.

- [x] 2.7 Migrate existing `templates/code/docs/gotchas/SKILLS.md` to per-capability files:
  - Extract each `### Electron / Svelte` subsection per agent into its corresponding capability file.
  - Create: `electron-ipc.md`, `electron-security.md`, `svelte5-reactivity.md`, `svelte5-components.md`, `typescript-strict.md`.
  - Leave SKILLS.md in place as a fallback until Phase 3 injection is live.

---

### Phase 3 — Selective injection at pipeline time

**Goal:** At pipeline time, inspect which files the task touches and inject only the capabilities relevant to those file types.

- [x] 3.1 Build `resolveCapabilitiesForTask(handoffOrPlan, capabilities)` in `shared.ts`:
  - Parse file paths mentioned in the handoff/plan.
  - Apply a `FILE_TO_CAPABILITIES` map (e.g. `src/main/handlers/` → `["electron-ipc", "electron-security"]`, `*.svelte` → `["svelte5-reactivity", "svelte5-components"]`).
  - Return the intersection of project-declared capabilities and task-relevant capabilities.
  - Always include `typescript-strict` and `git` if declared — they apply everywhere.

- [x] 3.2 Thread the resolved capability list into the Claude CLI invocation in `src/main/shared.ts`:
  - When building the skills context injected into the agent, call `filterSkillsByCapabilities(skillsDir, resolvedCapabilities, agentRole)` instead of the current per-stack filter.
  - The result is appended to the agent's system prompt as before.

- [x] 3.3 Update `templates/code/CLAUDE.md` docs structure table to document the new `docs/gotchas/skills/` directory.

- [x] 3.4 Smoke test: run a plan feature + implement feature cycle on a task that touches only `.svelte` files and confirm the main handler IPC rules are not injected. Run one that touches `src/main/handlers/` and confirm they are.

---

### Research needed
- None

### [x] Feature: One Chat Phase 1a — Intent Detection IPC + State

- [x] 1. Add `classify-intent` IPC handler with Haiku classifier system prompt (`src/main/handlers/intent.ts`)
  Verify: file exists, exports a `register()` function; (a) validates `projectFolder` with `existsSync` + `statSync().isDirectory()` — returns `{ ok: false, error: 'invalid-project-folder' }` if check fails; (b) wraps the `spawnClaudeJson()` call in `Promise.race([spawnClaudeJson(...), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))])` — timeout rejection returns the lean fallback; (c) wraps JSON.parse in an explicit `try/catch` — parse failure or any missing field among `pipeline`, `mode`, `reason` returns the lean fallback; (d) validates `pipeline` against the allowed `PipelineId` set and `mode` against `['trivial','sprint','lean','standard','full']` — invalid value returns the lean fallback; (e) on success returns `{ ok: true, pipeline: string, mode: string, reason: string }`; (f) lean fallback is `{ ok: true, pipeline: 'plan feature', mode: 'lean', reason: 'classification unavailable' }`; the inline system prompt instructs Haiku to output only `{ "pipeline": "<value>", "mode": "<value>", "reason": "<one sentence>" }` with no surrounding text, lists all valid pipeline values from `PipelineId`, and lists valid modes with a 3–4 line heuristic.

- [x] 2. Register `intent.ts` handler in main process (`src/main/index.ts`) (wave: 1)
  Verify: `import * as intentHandlers from './handlers/intent'` is present and `intentHandlers.register(...)` is called in the handler registration block alongside the other handler modules.

- [x] 3. Add `IntentResult` discriminated union type to shared types and `classifyIntent` signature to `ClaudeAPI` (`src/renderer/src/types/claude.d.ts`) (wave: 1)
  Verify: `IntentResult` is declared as the discriminated union `{ ok: true; pipeline: string; mode: string; reason: string } | { ok: false; error: string }` and exported; `ClaudeAPI` includes `classifyIntent(args: { prompt: string; projectFolder: string }): Promise<IntentResult>`.

- [x] 4. Expose `classifyIntent` on the contextBridge (`src/preload/index.ts`) (wave: 2)
  Verify: `window.claude.classifyIntent({ prompt, projectFolder })` is callable from the renderer; the method invokes `ipcRenderer.invoke('classify-intent', ...)`.

- [x] 5. Add `classifyIntent` typed helper in renderer IPC wrappers (`src/renderer/src/lib/ipc.ts`) (wave: 2)
  Verify: `export async function classifyIntent(...)` calls `window.claude.classifyIntent(...)` and returns `Promise<IntentResult>`.

- [x] 6. Add intent classification state to editor store (`src/renderer/src/stores/editor.svelte.ts`) (wave: 2)
  Verify: `EditorState` gains `intentResult: IntentResult | null` and `intentPending: boolean` (both initialised to `null` / `false`); exported action functions `setIntentResult(r: IntentResult | null)`, `clearIntentResult()`, and `setIntentPending(v: boolean)` follow the existing store action pattern using `$state` runes — no `writable()` or `derived()` from `svelte/store`; code comment on `setIntentPending` documents that callers must check `intentPending` is `false` before invoking `classifyIntent()` — if already `true`, skip the call entirely to prevent double-classification races.

### [x] Feature: One Chat Phase 1b — Intent Confirmation UI

- [x] 1. Add `intentConfirmed` flag and `setIntentConfirmed` / `clearIntentResult` update to `editor.svelte.ts` — extend the existing `EditorState` to include `intentConfirmed: boolean` so PromptBar can distinguish "classification shown, awaiting second Enter" from "no classification"; `clearIntentResult()` must reset BOTH `state.intentResult = null` AND `state.intentConfirmed = false`; `setIntentConfirmed(v: boolean)` must be explicitly exported from the store (`src/renderer/src/stores/editor.svelte.ts`)
  Verify: `EditorState` has `intentConfirmed: boolean`, `setIntentConfirmed(v: boolean)` is exported, and `clearIntentResult()` resets both `intentResult` to `null` and `intentConfirmed` to `false`.

- [x] 2. Add `IntentConfirmRow` component — new Svelte component rendered below the textarea when `intentResult` is set; shows pipeline type chip + mode chip + reason text; pipeline and mode chips are `<select>` dropdowns populated from `PIPELINES` keys and `['LEAN','STANDARD','FULL','SPRINT']`; emits `onpipelinechange` and `onmodechange` props; renders dim italic "classification unavailable — <error>" when `ok: false`; shows a "classifying…" placeholder and keeps textarea `disabled` (add `|| editor.intentPending` to the disabled binding) while `editor.intentPending` is true (`src/renderer/src/components/prompt/IntentConfirmRow.svelte`)
  Verify: Component renders pipeline/mode chips when `intentResult.ok === true`, renders fallback text when `ok === false`, shows "classifying…" and disables textarea while `intentPending` is true, and dropdowns allow selecting alternate pipeline/mode values.

- [x] 3. Update `PromptBar.svelte` — wire `classifyIntent` call in `submit()`: (a) call `clearIntentResult()` first to discard any stale prior result, then set `intentPending = true` synchronously BEFORE awaiting `classifyIntent()`, and add `&& !editor.intentPending` to the onKeydown Enter guard to block double-classification; (b) after `classifyIntent()` resolves — in BOTH success and error paths — call `setIntentPending(false)`; store result via `setIntentResult`, set `intentConfirmed = false`, and return without starting the run; (c) if `intentResult` is set and `intentConfirmed` is false, mark `setIntentConfirmed(true)` and proceed to run; (d) mount `<IntentConfirmRow>` below the textarea when `editor.intentResult` is non-null; (e) hide `<ModeRow>` and `<PipelineSettingsRow>` while intent chips are visible, show an "override" `<button>` that calls `clearIntentResult()` to dismiss chips and restore them (`src/renderer/src/components/prompt/PromptBar.svelte`)
  Verify: First Enter triggers classification and shows chips without starting run; `intentPending` is set to true before the IPC call and false in both success and error paths; second Enter starts run; "override" link dismisses chips and restores ModeRow/PipelineSettingsRow; submitting while `intentPending` is true is blocked (no double-classification race); any stale intentResult from a prior prompt is cleared before the new classification begins.

- [x] 4. Extend `ipc.run()` with an optional `pipelineModeOverride` param — (a) add `pipelineModeOverride?: string` as a seventh parameter to the `run()` helper in `ipc.ts`; (b) expose it in the `contextBridge` `run` wrapper in `src/preload/index.ts`; (c) add `pipelineModeOverride?: string` to the `ClaudeAPI.run` signature in `src/renderer/src/types/claude.d.ts`; (d) in `src/main/handlers/runner.ts`, accept the param and — before passing to `buildSystemPromptAppend()` — validate it against `new Set(['trivial', 'sprint', 'lean', 'standard', 'full'])` (case-insensitive); if invalid log a warning and fall back to the `project.json` value; if valid use it in place of the `pipelineMode` read from `project.json` for this invocation only; never write the override back to disk (`src/renderer/src/lib/ipc.ts`, `src/preload/index.ts`, `src/renderer/src/types/claude.d.ts`, `src/main/handlers/runner.ts`)
  Verify: Calling `ipc.run(..., 'STANDARD')` with a project configured as LEAN results in `PIPELINE MODE: STANDARD` injected into the agent system prompt for that run; an invalid override value (e.g. `'malicious\ninjected'`) logs a warning and falls back to the project.json value; after the run, `project.json` still contains `"pipelineMode": "LEAN"`.

- [x] 5. Thread overridden pipeline and mode values through `submit()` — when `intentResult.ok === true` and `intentConfirmed`, pass the (possibly overridden) mode chip value as `pipelineModeOverride` to `ipc.run()` directly (there is no `triggerRun()` wrapper — `submit()` calls `ipc.run()` directly); do not mutate `editor.mode` or `proj.pipelineMode` (`src/renderer/src/components/prompt/PromptBar.svelte`)
  Verify: Overriding mode chip to STANDARD before confirming causes the run to launch with `PIPELINE MODE: STANDARD` injected; after run completes `proj.pipelineMode` retains its original value; `editor.mode` is unchanged.

- [x] 6. Append dim italic terminal line before run header — in `submit()`, immediately before `sessionStore.appendLine('▶ ...', 'run-header')`, append a `'system'` line: `→ detected: <pipeline> · <MODE> — <reason>` when `intentResult.ok === true`; skip the line when `ok: false` or when intent confirmation was bypassed (`src/renderer/src/components/prompt/PromptBar.svelte`)
  Verify: Terminal shows the dim italic detection line directly above the `▶` run-header line on every confirmed intent run; no line appears on a bypassed run.

- [x] 7. Clear `intentResult` on new conversation — in `newConversation()` inside `PromptBar.svelte`, call `clearIntentResult()` so chips do not persist across conversation resets (`src/renderer/src/components/prompt/PromptBar.svelte`)
  Verify: Clicking NEW CONVERSATION when intent chips are visible removes the chips and restores ModeRow/PipelineSettingsRow.

Shipped: 2026-04-02

### [x] Feature: Intent Classification Log Persistence

- [x] 1. Add `IntentLogEntry` type and extend `ClaudeAPI` with `logIntentOverride` signature (`src/renderer/src/types/claude.d.ts`)
  Verify: `IntentLogEntry` interface exported with fields `timestamp`, `prompt` (truncated 200 chars), `detectedPipeline`, `detectedMode`, `detectedReason`, `finalPipeline`, `finalMode`, `overridden` (boolean), `latencyMs`, `status` (`'ok' | 'error'`), `errorMessage?`; `ClaudeAPI` has `logIntentOverride(args: { projectFolder: string; entry: IntentLogEntry }): Promise<{ ok: true } | { error: string }>`.

- [x] 2. Add `log-intent-override` IPC handler in `src/main/handlers/intent.ts` — appends entry to `.pipeline/intent-log.jsonl`, caps file at 1000 entries (discard oldest), applies `resolve()` + `startsWith()` path traversal guard (wave: 1)
  Verify: Handler reads existing JSONL lines, keeps the last 999 before appending the new entry, writes atomically; rejects paths outside `projectFolder`; logs errors with `{ status: 'error' }` entries correctly.

- [x] 3. Add `logIntentOverride` wrapper to `contextBridge.exposeInMainWorld` in `src/preload/index.ts` (wave: 1)
  Verify: `window.claude.logIntentOverride` calls `ipcRenderer.invoke('log-intent-override', args)` and is present in the exposed object.

- [x] 4. Add `logIntentOverride` typed helper in `src/renderer/src/lib/ipc.ts` (wave: 2)
  Verify: `export async function logIntentOverride(projectFolder: string, entry: IntentLogEntry): Promise<...>` exists and delegates to `c().logIntentOverride(...)`.

- [x] 5. Call `logIntentOverride` in `PromptBar.svelte` on confirmed submit — record detected vs final pipeline/mode, prompt truncated to 200 chars, latency from classification start, `overridden` flag, and `status: 'ok'`; also call with `status: 'error'` in the catch block of the classification call (wave: 2)
  Verify: After a confirmed intent submit, `.pipeline/intent-log.jsonl` in the active project gains one entry with all required fields; an IPC classification failure also produces an error entry; `overridden` is `true` when the user changed pipeline or mode chips before submitting.

### Research needed
- Confirm that `spawnClaudeJson` timing is available at the call site in PromptBar — if `classifyIntent` start time is not stored on `editor` state, the implementer must record it locally before the IPC call.
- Verify that `pipelineDir(projectFolder)` resolves to `.pipeline/` correctly and that `intent-log.jsonl` can sit beside `terminal-history.json` without conflict.

### Approach summary
**Key decisions:**
- New dedicated `log-intent-override` IPC channel (not piggybacking on an existing channel) — follows the four-file rule cleanly and keeps intent logging concerns isolated from audit-log or verdicts.
- JSONL format with 1000-entry cap matches the existing `append-audit-log` / `append-verdict` pattern; discard-oldest write keeps the file bounded without external cleanup.

**Trade-offs accepted:**
- Log lives in `.pipeline/` and may be committed by users — acceptable because it contains only pipeline/mode labels and truncated prompts (no secrets, no full prompt content).

**Uncertainties:**
- Latency measurement: classification start time must be captured before the `classifyIntent` IPC call; current editor store does not persist this timestamp so the implementer must add a local variable in PromptBar or a `classificationStartedAt` field on editor state.

### [x] Feature: One Chat Non-Pipeline Request Handling

- [x] 1. Extend `IntentResult` type and `IntentLogEntry` to include `chat` pipeline (`src/renderer/src/types/claude.d.ts`)
  Verify: `IntentResult` ok-branch `pipeline` field accepts `'chat'` as a valid value; `IntentLogEntry` records `chat` without TypeScript errors.

- [x] 2. Update classifier system prompt and validation in `intent.ts` to recognise `chat` as a valid pipeline (`src/main/handlers/intent.ts`) (wave: 1)
  Verify: `VALID_PIPELINES` includes `'chat'`; classifier prompt instructs the model to output `chat` for questions, conversational requests, and ambiguous non-task input; fallback is `{ pipeline: 'chat', mode: 'lean' }` (not `plan feature`).

- [x] 3. Add `run-chat` IPC handler in `src/main/handlers/runner.ts` using the full streaming pattern (`--output-format stream-json`, incremental `stdout.on('data')` processing, `claude-stdout` IPC events) so signals are processed in real-time (`src/main/handlers/runner.ts`) (wave: 1)
  Verify: Handler receives `{ prompt, projectFolder, pipelineMode }`, injects a minimal system context preamble, spawns Claude using the same `stream-json` + incremental stdout path as `run-claude` (not `spawnClaudeJson`), emits output via `claude-stdout` IPC events, and returns the session id; `[todo]` signals emitted mid-stream reach App.svelte's classifier before the run completes.

- [x] 4. Expose `runChat` in `contextBridge` and add typed wrapper to `ClaudeAPI` and `ipc.ts` (`src/preload/index.ts`, `src/renderer/src/types/claude.d.ts`, `src/renderer/src/lib/ipc.ts`) (wave: 2)
  Verify: `window.claude.runChat` is callable from the renderer; `ipc.runChat(prompt, folder, pipelineMode)` is typed and compiles without errors.

- [x] 5. Update `IntentConfirmRow.svelte` to handle the `chat` pipeline — display `chat` chip without a mode dropdown, and show a subtitle "direct reply — no agents will run" (`src/renderer/src/components/prompt/IntentConfirmRow.svelte`) (wave: 2)
  Verify: When `intentResult.pipeline === 'chat'`, the row shows the `chat` chip but omits the mode selector and reason; subtitle text is visible and styled consistently with the existing `trivial-note` style.

- [x] 6. Update `PromptBar.svelte` submit path: when `intentResult.pipeline === 'chat'`, call `ipc.runChat` instead of the normal pipeline `run` path on second Enter (`src/renderer/src/components/prompt/PromptBar.svelte`) (wave: 3)
  Verify: Pressing Enter twice with a classified `chat` intent calls `ipc.runChat`; normal pipeline intents are unaffected; terminal receives streamed output in `system`-styled lines.

- [x] 7. Add `add-todo` action capability to the chat system prompt in `runner.ts` so Claude can append a todo item to `board.json` by emitting a `[todo]` signal line (`src/main/handlers/runner.ts`) (wave: 3)
  Verify: The chat system prompt explicitly names `[todo] <task text>` as the only write action available; output is streamed to terminal; `[todo]` signal is processed by App.svelte's existing classifier and appended to the board without any pipeline-state guards triggering.

- [x] 8. Update the classifier system prompt to bias toward `chat` for questions and non-task input — "if uncertain, classify as chat, never accidentally trigger a pipeline" (`src/main/handlers/intent.ts`) (wave: 3)
  Verify: Prompt includes explicit instruction that questions, greetings, status queries, and ambiguous input must resolve to `chat`; a pipeline is only chosen when the input clearly names a development task.

Approach summary
**Key decisions:**
- `run-chat` handler lives in `runner.ts` alongside `run-claude`, using the identical `stream-json` + incremental stdout path — `spawnClaudeJson` buffers the entire response and cannot deliver signals in real-time.
- Reuse the existing `claude-stdout` terminal channel and `[todo]` signal — no new terminal infrastructure needed; the chat run looks like a terminal run to the renderer.
- `chat` is a first-class pipeline value in `IntentResult` — treated inline in `IntentConfirmRow` like `trivial` (no mode selector, no agents message).

**Trade-offs accepted:**
- Single action (`add-todo`) only for POC — no tool loop, no conversation threading; each chat submit is stateless.

### [x] Feature: Terminal Inline Diff View for Edit Operations

- [x] 1. Extend `formatProgressLabel` return type and Edit branch to capture `oldContent` (`src/main/shared.ts`)
  Verify: the function return type includes `oldContent: string | undefined` and the `Edit` branch populates it with `input.old_string` capped at 50 lines (same cap logic as `new_string`); `linesTotal` for Edit reflects the line count of `old_string`.

- [x] 2. Update `AgentProgress` type to include `oldContent` field (`src/renderer/src/types/claude.d.ts`) (wave: 1)
  Verify: `AgentProgress` interface has `oldContent?: string` alongside the existing `fileContent` field; no other fields changed.

- [x] 3. Extend `CodeWriteLine` interface and `appendCodeWriteLine` to accept and store `oldContent` (`src/renderer/src/stores/session.svelte.ts`) (wave: 1)
  Verify: `CodeWriteLine` has `oldContent?: string`; `appendCodeWriteLine` signature accepts an optional `oldContent` parameter and stores it on the line object.

- [x] 4. Pass `oldContent` from progress event into `appendCodeWriteLine` call (`src/renderer/src/App.svelte`) (wave: 2)
  Verify: the `onProgress` handler reads `d.oldContent` (typed as `string | undefined`) and passes it as the fifth argument to `session.appendCodeWriteLine`; no other logic in this block changes.

- [x] 5. Render diff view in Terminal.svelte for Edit lines that carry `oldContent` (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 2)
  Verify: when `cwl.oldContent` is present the expanded block renders removed lines prefixed with `- ` in red and added lines prefixed with `+ ` in green, one line per row, using a line-by-line split of `oldContent` and `codeContent`; the truncation footer still appears below the diff when `cwl.truncated` is true; when `oldContent` is absent (Write operations) the existing plain `<pre>` rendering is unchanged.

- [x] 6. Add CSS classes for diff line colours to Terminal.svelte (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 3)
  Verify: `.diff-line-removed` sets `color: var(--red)` with a subtle red background tint; `.diff-line-added` sets `color: var(--green)` with a subtle green background tint; both are scoped inside the `code-write-block` context and do not bleed into other terminal line types; font and size match the existing `.code-write-pre` rules (monospace, 10px).

Shipped: 2026-04-08

### [x] Feature: Terminal Output UX Overhaul

- [x] 1. Extend `TerminalLine` type and add new interfaces in session store (`src/renderer/src/stores/session.svelte.ts`)
  Add `agentGroup?: string` to the base `TerminalLine` interface. Add `RunSummaryLine` interface with `type: 'run-summary'`, `filesCreated: string[]`, `filesModified: string[]`. Add `'run-summary'` to the `LineType` union. Add `appendRunSummaryLine(filesCreated, filesModified)` action. Update `appendLine`, `appendToolCallLine`, `appendCodeWriteLine`, `appendThinkingLine` to accept and stamp an optional `agentGroup` parameter.
  Verify: `TerminalLine` has `agentGroup?: string`, `LineType` includes `'run-summary'`, `RunSummaryLine` is exported, and all four append functions accept an optional `agentGroup` argument.

- [x] 2. Add progress bar state to run store (`src/renderer/src/stores/run.svelte.ts`)
  Add `currentAgentId: string | null`, `toolCallCount: number`, and `progressStatus: string` fields to `RunState`. Add `setCurrentAgent(agentId: string)`, `incrementToolCallCount()`, `clearProgressBar()` actions. Reset `currentAgentId`, `toolCallCount`, and `progressStatus` to initial values in `startRun()` and `resetRun()`.
  Verify: `getRunState()` returns an object with `currentAgentId`, `toolCallCount`, and `progressStatus`; `setCurrentAgent('coder')` sets the field; `startRun(...)` resets them.

- [x] 3. Track current agent and accumulate file ops in App.svelte (`src/renderer/src/App.svelte`) (wave: 1)
  In the `onProgress` handler: extract the `agentId` field from the progress data (same shape already used by `applyProgress`); call `runStore.setCurrentAgent(agentId)` when it changes; call `runStore.incrementToolCallCount()` per tool-bearing event; pass current `agentId` as `agentGroup` to each `session.append*` call. Declare a local `fileOps` accumulator (`{ created: string[], modified: string[] }`) reset in `startRun`; populate it from `d.filePath` + `d.oldContent` presence during code-write detection. In `onDone`, call `session.appendRunSummaryLine(fileOps.created, fileOps.modified)` before the `run-divider` append (skip if both arrays are empty). Call `runStore.clearProgressBar()` in `onDone`.
  Verify: After a simulated run, the last line before `run-divider` has type `run-summary` with populated file arrays; `run.currentAgentId` is null after the run completes.

- [x] 4. Update Terminal.svelte to group lines by agentGroup, render agent-section headers, and add semantic density CSS (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 1)
  **Agent section grouping:** Change the `blocks` derived computation to sub-group lines within each `AnswerBlock` into `AgentSection[]` keyed by `agentGroup`. Where `agentGroup` changes, start a new section. Lines without `agentGroup` form a `null`-keyed section. Render each section with a slim coloured header bar using `AGENT_META[agentGroup].color` and `AGENT_META[agentGroup].label`. The header bar must be collapsible (same Set-swap pattern as existing `collapsed`). **Run-summary rendering:** Add a `{:else if line.type === 'run-summary'}` branch that renders a mini git-status block listing created (+) and modified (~) files using monospace layout. Import `RunSummaryLine` type. **Semantic density:** Add CSS rules — `line-prose` keeps current `line-height: 1.65`; add `.line-tool`, `.line-tool-call`, `.line-code-write`, `.line-thinking` a tighter density class `font-size: 10.5px; line-height: 1.3`. Keep the monospace font family intact on all line types.
  Verify: A block with lines from two different `agentGroup` values renders two collapsible headers using the correct AGENT_META label and color; a `run-summary` line renders a file list block; prose lines are visually taller than tool lines.

- [x] 5. Add sticky progress summary bar to Terminal.svelte (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 2)
  Add a `ProgressBar` sub-component inline at the top of the terminal scroll area (or as a positioned overlay above `PromptBar` — inside `.terminal-wrap` before the `.terminal` div). Read `run.currentAgentId`, `run.toolCallCount`, `run.status`, and `run.startedAt` from `getRunState()`. Use `getElapsedSeconds()` from `run.svelte.ts` for elapsed time (it already exists). Show the bar only when `run.status === 'running'` and `currentAgentId` is non-null. Display: `{AGENT_META[currentAgentId].label} · {toolCallCount} tool calls · {elapsed}s`. Style: thin bar (`height: 28px`), background uses `color-mix(in srgb, AGENT_META[currentAgentId].color 12%, var(--bg))`, left border in agent colour. Transitions out with `fly` when hidden.
  Verify: The bar appears during a run with a non-null `currentAgentId`, shows the correct label/count/elapsed, and disappears when status returns to `idle`/`done`.

- [x] 6. Export `getElapsedSeconds` from run store and verify it is accessible in Terminal.svelte (`src/renderer/src/stores/run.svelte.ts`) (wave: 2)
  `getElapsedSeconds` already exists but may not be live-reactive without being accessed inside a `$derived` or `$effect` block. If the function reads `Date.now()` imperatively without a reactive wrapper, add a `$derived` ticker or use a `setInterval`-based `$state` for elapsed seconds inside the component. Flag if a reactive seconds counter needs a separate local `$state` in Terminal.svelte (interval-based, cleared on run complete).
  Verify: The elapsed time shown in the progress bar updates every second during a live run without requiring a page interaction.

---

### [x] Feature: Terminal Streaming Rewrite — Claude Code CLI-style output

Shipped: 2026-04-09

Complete two-phase terminal streaming rewrite with block-based model, unified diff rendering, and session persistence.
