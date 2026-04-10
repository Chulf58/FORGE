# FORGE — Changelog History

Changelog entries archived from docs/CHANGELOG.md when the file exceeds 200 lines.

---

## [2026-03-25] GENERAL.md injected via --append-system-prompt

- Orchestrator process now receives `docs/gotchas/GENERAL.md` prepended to system prompt before SKILLS.md, ensuring project-context rules are available alongside stack-specific guidance.
- If GENERAL.md is absent or unreadable, a warning is written to stderr and pipeline continues with SKILLS.md only — non-fatal condition.

---

## [2026-03-25] Terminal Code Writes — Phase 2 (Renderer Integration)

- Terminal now renders inline collapsible code blocks when agents write or edit files, if `showCodeWrites` setting is enabled.
- Code blocks display file path, content preview (up to 50 lines), and truncation indicator; user can toggle expansion per block.
- Added `showCodeWrites` toggle to Settings modal under BEHAVIOUR section; defaults to false to prevent clutter on first-time use.

---

## [2026-03-25] Pipeline Interactivity — Session Clarity Bundle (A + B)

- Removed unused `activeAgentId` prop from PipelineVisualiser; live agent status colouring now derives directly from agents.svelte.ts store.
- Improved block collapse labels in Terminal: now prefer agent name or run-header lines over generic first-line text.
- Made pulse-node animation self-contained in PipelineVisualiser; component no longer depends on global.css load order.
- Updated `.pipeline/modules.json` to document live colour-coded agent status and collapsible-blocks capabilities.

---

## [2026-03-25] SKILLS tab in FORGE SETTINGS — show generated stack templates

- New `get-stack-templates` IPC handler enumerates `appRoot/templates/*/docs/gotchas/SKILLS.md` files and returns them with stack name and parsed content.
- SettingsModal SKILLS tab now shows a second "STACK TEMPLATES" section with collapsible cards for each generated stack, using the same UI pattern as FORGE's own skills.
- Separate expand-state tracking (`expandedTemplates` record) prevents name collisions between FORGE stack names and generated template stack names.

---

## [2026-03-25] Shared StackSkillPicker Component

- Unified stack + skills picker component replaces separate WizardStepStack and WizardStepSkills step components; wizard now shows both stack selection and skills template status on a single step (2).
- Stack selection restricted to 45 known stacks (Java, TypeScript, Python, Go, Rust, etc.) plus AI-recommended stacks; no free-text stack names allowed. Skills check runs reactively when a stack is selected.
- Component is reused in both WizardModal (step 2) and ProjectOverviewModal (add stack modal), eliminating duplicate UI logic.
- Security: `generate-skills-for-stack` IPC handler now validates stack characters and includes path-traversal guard.

---

## [2026-03-25] Modal Restructure — Agent Management Distribution

- Agent management distributed across two modals: FORGE scaffold agents moved to a read-only AGENTS tab in SettingsModal; custom project agents moved to ProjectOverviewModal alongside modules and tech stacks.
- Standalone AgentModal and its AgentListPane/AgentEditorPane sub-components deleted; agent file CRUD now split by ownership and context.
- Two new IPC channels: `list-forge-agents` (reads scaffold agents from FORGE app root) and `forget-project` (removes project entry without deleting files); FORGE agents remain read-only; project agents fully editable.

---

## [2026-03-24] Dependency onboarding Phase A — dependency detection

- Added `findGit()` function to discover Git executable on Windows, macOS, and Linux (3-stage search: hardcoded paths, shell probe, bare PATH fallback), mirroring the existing `findClaude()` pattern.
- Added `checkDependencies()` to detect and report Git and Claude versions, exposed via two new IPC channels: `check-deps` (initial load) and `recheck-deps` (manual refresh). Wired through handler → main index → preload → types → ipc.ts. Phase A is main-process only; UI rendering deferred to Phase B.

---

## [2026-03-24] Claude CLI not found on .bat launch + --agents JSON exceeds 20 KB

- Fixed `findClaude()` to recognize the official Claude desktop app installation at `%LOCALAPPDATA%\AnthropicClaude\claude.exe` and attempt a synchronous `where`/`which` probe before falling back to bare 'claude' string, resolving intermittent ENOENT errors when FORGE is launched via .bat files in environments where PATH may not be fully initialized.
- Fixed `--agents` JSON payload exceeding 20 KB warning by adding a `mode` parameter to `buildAgentsJson()` and filtering the agent set to only those relevant to the current pipeline mode (e.g., `plan feature` loads 7 agents instead of all 21). Added an 8000-byte per-agent prompt cap to ensure large agents like gotcha-checker cannot exceed the budget alone.

---

## [2026-03-24] Tech stack confirmation button now clickable in wizard

- Fixed response envelope mismatch in WizardModal.svelte advance() function: unwrapped res.result to correctly populate selectedStack from the research-stack IPC response, enabling the CONFIRM button that was permanently disabled.
- Updated researchStack() type in claude.d.ts to match actual handler return shape: Promise<{ ok?, error?, result?: { recommended?, alternatives?, confidence? } }>.

---

## [2026-03-24] FORGE shows thinking dots but returns no answer at all

- Fixed TypeError in App.svelte onStdout handler caused by calling non-existent `agentsStore.detectAgentTransition()` function. The error aborted the stdout loop and dropped all subsequent lines from appearing in the terminal when agent-typed output (lines starting with `▶`, `⏺`, or `◈`) appeared early in a run.
- Fixed silent run hang in PromptBar.svelte by awaiting `ipc.run()` return value and handling early-return error paths (folder not found, Claude CLI not installed). When the IPC handler returns an error payload, the renderer now appends an error line to the terminal and calls `runStore.finishRun()` to end the run instead of leaving it in 'running' state indefinitely.

---

## [2026-03-24] Pipeline Interactivity A+B

- PipelineVisualiser.svelte now uses live status classes (status-pending/running/done/error/skipped) derived from AgentCard data, replacing opacity/color helpers. Running agents display gold pulsing animation; completed agents show green. Supports parallel waves with multiple running chips.
- Terminal.svelte collapsible output blocks: each answer block group has a toggle button with caret (▾/▸) and first-line summary. Blocks can be collapsed to hide content while keeping the copy button visible and accessible.

---

## [2026-03-24] Copy Button Per Answer

- Replaced global terminal copy button with per-answer-block copy buttons that appear on hover
- Each answer block (delimited by run-divider lines) now has its own copy button at top-right, with "Copied!" flash feedback after 1.5 seconds
- Implemented via `$derived.by` block splitting and per-block copy state; removed getCopyText import from session store

---

## [2026-03-24] Project Agent Slots Pipeline — Phase B (UI + runner)

- Created `AgentSlotsStep.svelte`: new wizard step component for users to select which detected project agents to enable and assign to pipeline hook points
- Extended `ImportModal.svelte`: made `goToStructure` async to pre-scan agents at step 2→3 transition; added conditional step 3.5 with agent selection UI; passed confirmed slots to `writeProjectJson`
- Updated `shared.ts`: `buildAgentsJson` extended with optional `agentSlots` parameter; enabled slots are injected with `[hook:HOOK_POINT]` metadata annotation in description field; FORGE core agents protected from override
- Updated `runner.ts`: reads confirmed `agentSlots` from `.pipeline/project.json` and passes to `buildAgentsJson` when spawning Claude CLI
- Phase B completes the full UI-to-runtime flow: users select agents → slots persisted → runner injects into CLI agents payload

---

## [2026-03-24] Project Agent Slots Pipeline — Phase A (data layer + IPC)

- Added three new types: `AgentSlotHook` (six-value enum), `DetectedProjectAgent` (detected project agent metadata), and `AgentSlot` (configured slot assignment)
- Created `scan-project-agents` IPC channel: scans `<projectFolder>/.claude/agents/`, filters out FORGE core agents, infers hook-point suggestions, returns structured agent list
- Registered handler in main process, exposed via preload, wrapped in typed renderer ipc.ts helper
- Extended `write-project-json` handler to validate and persist `agentSlots` array to `.pipeline/project.json`
- Phase B (UI + runner integration) deferred to follow separately

---

## [2026-03-24] FLOW.md Phase 2: Apply Phase, Waves, Signals, Cross-Cutting, Pipeline Modes

- Completed docs/FLOW.md with five new sections (6–10): Apply phase pipeline describing implementer, tester, and documenter agents; wave execution protocol with annotation scanning, self-checks, and [wave-complete]/[blocked] signals; signal reference table documenting all 13 protocol signals; cross-cutting concerns covering token budgets and context checkpoints; pipeline modes reference table with all 10 modes
- FLOW.md now complete as single-source reference for task lifecycle, agent responsibilities, signal protocol, and pipeline orchestration

---

## [2026-03-24] FLOW.md Phase 1 — Task Lifecycle Documentation

- Created `docs/FLOW.md` documenting the complete task lifecycle through the FORGE pipeline: from user prompt through planner, researcher, gotcha-checker, and review waves to Gate #1, then implement phase with coder, reviewer-triage, specialist reviewers, and Gate #2
- Phase 1 covers Overview, Plan phase pipeline (agent sequence and responsibilities), Gate #1 mechanics, Implement phase pipeline, and Gate #2 mechanics with visual states and verdict persistence
- Includes ASCII flow diagrams of top-level lifecycle and detailed agent responsibilities; Phase 2 deferred to cover Apply phase, wave execution, signal reference, and cross-cutting concerns

---

## [2026-03-24] GSD Dimension 5 — Key Links Concreteness Check

- Implemented missing GSD dimension 5 ("key links — critical connections are concrete not vague") as a new validation check in `.claude/agents/gotcha-checker.md`
- Check scans task descriptions for connection verbs and warns when no backtick-quoted identifier appears within a 10-word window, enforcing explicit references to functions, channels, stores, or files
- Appended new WARNING type `key links vague` to the gotcha-checker's output format recognition list

---

## [2026-03-24] GSD Re-Evaluation Audit

- Scored FORGE against original 10-dimension GSD quality framework: 9 dimensions shipped (scope sanity, requirement coverage, goal-backward framing [coarse], dependency correctness, verification derivability, context compliance, Nyquist compliance, cross-plan data contracts, token budget); dimension 5 (key links concreteness) remains a gap
- Audit report written to `docs/RESEARCH/gsd-reeval-2026-03-24.md` with evidence-sourced scorecard, score delta analysis, gap identification, and top 3 recommended next steps

---

## [2026-03-24] Virtualized Pipelines — Wave Compatibility Audit & Fix

- Fixed `lineClassifier.ts` to classify `[wave-complete]` lines as `'system'` (dim italic) and `[blocked]` lines as `'error'` (red) in terminal output; previously both fell through as `'normal'`
- Updated `docs/gotchas/GENERAL.md` signal table to document that wave-protocol signals are typed by `lineClassifier.ts`, not passed through as plain text

---

## [2026-03-24] Architect Pipeline Gate

- Registered `'architect'` as a first-class named pipeline mode with agents `['architect', 'reviewer-logic']` and Gate #1, enabling health-check runs that fire review gates without triggering follow-on implementation
- Wired `gateDetector.ts` and `App.svelte` to detect and display Gate #1 on architect run completion; updated `Gate1Bar.svelte` so the YES button dismisses-only (no follow-on `implement feature` run) when mode is architect
- Fixed `pendingArchitectRun` handler in `App.svelte` to explicitly pass `'architect'` mode to `triggerRun`, replacing implicit default to `'explore'`
- Added `## Architect health review` section to `reviewer-logic.md` with dead-code verification checks and verdict rules; documented the architect mode in `docs/gotchas/GENERAL.md` pipeline modes table

---

## [2026-03-24] Project References — Phase B (wizard + settings integration)

- Wired `WizardStepReferences` component into new-project wizard (`WizardModal`): added REFERENCES step between STRUCTURE and CREATE on both code and non-code paths; step indices adjusted dynamically (code: 0–6, non-code: 0–4)
- Integrated references into import wizard (`ImportModal`): new step 4 REFERENCES inserted between STRUCTURE and ONBOARDING; references written to project.json during import onboarding
- Added references editor to Settings modal (`SettingsModal`): expandable inline editor with read-before-write pattern to preserve other project.json fields; independent effect hook to avoid mutual interference with settings updates

---

## [2026-03-24] Project References — Phase A (data layer + new component)

- Added `ReferenceEntry` type and `references` array to the data layer: new interface with three entry types (URL, note, path), each with an optional label; bidirectional persistence through handlers and IPC
- Implemented `buildSystemPromptAppend` integration: references are now extracted from `.pipeline/project.json` and injected into agent context via system prompt, formatted as Markdown links or path references
- Created `WizardStepReferences.svelte` component: reusable entry editor with type selector (URL/note/path), optional label input, path browser integration, and live validation

---

## [2026-03-24] Project Structure Guidance in Wizard

- Added `structure` field to `.pipeline/project.json` with five options (standalone, plugin, library, service, module); persisted via updated type system and IPC handlers
- Wired structure end-to-end: stored in project.json, extracted by build system, and prepended to agent context (`--append-system-prompt`) with human-readable description
- Created `WizardStepStructure.svelte` component with 5-option tile UI; integrated into both `WizardModal` and `ImportModal` with automatic detection helper that infers structure from project description keywords

---

## [2026-03-24] Architect [todo] colon-format signals

- Architect agent now emits `[todo]` signals in colon format: `[todo] HIGH: title — detail.` instead of the legacy em-dash format with separate Files trailer
- File context is now placed inline in the detail sentence rather than in a structured `Files:` block
- Updated `App.svelte` regex classifier to parse the new colon-separated priority format and preserve bare-format fallback for planner/documenter signals

---

## [2026-03-24] TODO Priority Field

- Added `priority` field to `TodoItem` interface with three levels (high/medium/low); items without a priority default to medium via fallback operator
- Extended `TodoPanel` with filter/sort UI strip allowing users to filter by priority level and toggle between date and priority sort
- Added priority badges (H/M/L with colour coding) to pending items; click to cycle priority through high→medium→low→high
- Updated `[todo]` signal classifier in `App.svelte` to parse architect's em-dash format (`HIGH — title: detail.`) and extract priority; bare `[todo]` signals default to medium priority

---

## [2026-03-24] Reviewer Verdict UI — HEALTH tab verdicts section

- Added verdict state management and async `loadVerdicts()` to `HealthPanel.svelte` that fetches from `ipc.getVerdicts` on mount and after runs complete
- Derived per-agent summaries with approval rates (green/gold/red thresholds) and recent-history list (newest-first, last 10 entries) from verdicts data
- Rendered REVIEWER VERDICTS section with two subsections: per-agent table showing agent name, total runs, approval %, and most-recent verdict badge; recent-history list showing verdict badge, agent, blocker/warning counts, feature name (truncated), and relative timestamp helper

---

## [2026-03-24] Reviewer Verdict Persistence — Phase 1b (IPC + renderer wiring)

- Added `append-verdict` and `get-verdicts` IPC handlers in `src/main/handlers/pipeline-data.ts` that persist verdicts to `.pipeline/verdicts.jsonl` with server-side timestamp; payload validated and path-guarded with `isAbsolute()` + `resolve()` + `startsWith()` pattern
- Exposed `appendVerdict` and `getVerdicts` methods on preload contextBridge and added `VerdictEntry` type to `src/renderer/src/types/claude.d.ts` with verdict union (`APPROVED` | `BLOCK` | `REVISE`) and blocker/warning counts
- Added `[reviewer-verdict]` signal classifier in `App.svelte` that parses JSON payload with field-by-field type narrowing, calls `ipc.appendVerdict` fire-and-forget (never blocks the run), and suppresses the line from terminal output
- Registered `[reviewer-verdict]` signal in `docs/gotchas/GENERAL.md` with full description: emitted by each reviewer agent as last output line; never defaults to APPROVED on malformed or missing fields

---

## [2026-03-24] Reviewer Verdict Persistence — Phase 1a (agent signal emission)

- Added `## Verdict signal` section to all five reviewer agent prompts (`.claude/agents/reviewer.md`, `reviewer-logic.md`, `reviewer-safety.md`, `reviewer-style.md`, `reviewer-performance.md`) that instructs each agent to emit a `[reviewer-verdict]` JSON signal as the absolute last output line
- Each signal encodes the agent ID, verdict (APPROVED/BLOCK/REVISE), blocker count, warning count, and feature name; Phase 1b will wire IPC handlers to consume and display these signals

---

---

## [2026-04-02] One Chat Phase 1b — Intent Confirmation UI

- **Two-Enter confirmation flow:** First Enter triggers classification and displays pipeline/mode chips; second Enter confirms (with optional dropdown overrides) and starts the run.
- **`IntentConfirmRow` component:** New UI row showing detected pipeline/mode with dropdown selectors, dismissable error chips, and "override" button to clear and revert to manual mode selection.
- **`pipelineModeOverride` parameter:** Optional seventh param to `ipc.run()` carries confirmed intent mode through the IPC chain into `runner.ts`, which applies it to the system prompt without persisting to disk.
- **Local override state:** Component-local `overridePipeline` and `overrideMode` capture user dropdown edits; survive one submit cycle and are cleared when confirmation fires or user dismisses.
- **Conditional UI hiding:** `ModeRow` and `PipelineSettingsRow` hide while chips are visible, preventing manual mode conflicts with detected intent.

---

## [2026-04-02] One Chat Phase 1a — Intent Detection IPC + State

- **New IPC channel `classify-intent`:** Invokes Haiku to classify user prompts into pipeline and mode; runs async in background with 5s timeout and lean fallback.
- **Editor store extensions:** Added `intentResult` and `intentPending` fields; action functions `setIntentResult()`, `clearIntentResult()`, `setIntentPending()` for Phase 1b consumers.
- **Type exports:** New discriminated union `IntentResult` in `claude.d.ts` covering success (pipeline, mode, reason) and failure (error code) cases.

---

## [2026-04-02] Pipeline QA Actions

- **TRIVIAL mode gate:** Added UI block in PromptBar.svelte that prevents plan/implement/debug/refactor/failed-test/architect runs when `pipelineMode === 'trivial'`, directing user to apply directly.
- **Agent scope hardening:** All agent routing and binding rules now strictly enforced; planner, coder, implementer, and tool-call-auditor updated to prevent cross-mode agent substitution and `[summary]` emission in wrong phases.
- **Reviewer-triage sidecar timing:** Sidecar write moved before formatted output to guarantee persistence even under token truncation.
- **Tool-call-auditor calibration:** Added Step 3g to extract reviewer verdict calibration data from review archive on demand.
- **Vanilla HTML skill:** New `templates/code/docs/gotchas/skills/vanilla-html.md` covering DOM queries, event delegation, localStorage, CSS properties, and multi-page consistency patterns.

---

## [2026-04-02] Process audit and pipeline modes redesign

- **Agent cleanup:** Removed spec-agent, domain-context, nyquist-auditor (deprecated, overlapping scope). Cleanup agent restructured: reviewer-output wipe and sidecar deletion moved inline to documenter; cleanup now on-demand only.
- **Tester removed from apply pipelines:** Tester agent no longer runs during apply phases; added `testerEnabled` UI toggle (ChipsStrip) to allow testing on demand when apply chip present.
- **Pipeline modes redesigned:** Replaced `sprint` pipeline type with five configurable modes (direct, sprint, lean, standard, full); lean now default. Modes define reviewer set per task complexity; feature mode no longer hardcoded.
- **Documenter refactored:** Steps 1-3 (cleanup) moved inline; PLAN archival now owned by documenter directly. Intent log and FORGE-OVERVIEW updates made conditional on significance.
- **IPC wiring for testerEnabled:** Full chain from UI toggle through runner to agent JSON builder; parity with other boolean settings.

---

## [2026-04-02] Promotion persistence bug fix + terminal UX task

- Fixed TODO→PLANNED promotion persistence: board save failure no longer triggers disk reload that overwrites valid in-memory state.
- Gate 1 demotion now calls `saveBoard()` explicitly, avoiding silent skip during concurrent reloads.
- Added path traversal guard to board save handler (pipeline-data.ts) following project convention.
- Added terminal UX glass-wall task to FORGE board: documenting gap between FORGE terminal and Claude Code CLI transparency.

---

## [2026-04-02] QA Session 2 — terminal noise, dismiss flow, USAGE redesign

- Thinking blocks (`[thinking]...[/thinking]`) now render as dim system lines with `⟨thinking⟩` header instead of being suppressed; improves glass-wall UX.
- `[pipeline-summary]` signal consumed and formatted: shows `◈ Reviewers noted warnings (no blockers) — proceeding` instead of raw signal when REVISE verdict has 0 blockers.
- DISCARD PLAN button at Gate 1 now restores the task to the top of the TODO list via `demotePlannedToTodo()`, preventing orphaned tasks.
- Q&A terminal output split: questions logged to audit only on submission, answers (user's actual text) logged to terminal separately just before QA strip clears.
- TODO card buttons scaled to match PlannedPanel: plan-btn 7px font, confirm buttons 10px font, reduced padding for visual compactness.
- USAGE tab redesigned: cost as hero number (gold), tokens secondary inline; token breakdown replaced with 4px proportional bar (gold=cache, blue=input, grey=output) + legend; SESSION and PROJECT panels side-by-side below divider.

---

## [2026-04-02] QA Fix Session — pipeline UI, gate flow, and agent audit

- Gate 1 now shows blocked state with `✕ GATE 1 — PLAN BLOCKED` (red) when plan-stage reviewers block; IMPLEMENT button hidden until unblocked.
- Gate 1 IMPLEMENT button auto-sends implement run; added DISCARD PLAN button to dismiss bad plans without archival.
- Pipeline chips (e.g., `implement feature:` prefix) now auto-send runs; non-pipeline chips still fill prompt only.
- PlannedPanel shows confirmation row before implementing; removed MARK DONE button (pipeline-only state).
- TodoPanel shows confirmation row before auto-sending plan; reduced card height and font sizes for compactness.
- USAGE tab displays token breakdown grid: input, cache-read (highlighted gold), output with % share and estimated cost.
- Q&A questions logged to terminal and `audit-log.jsonl` with full question/option text for quality evaluation.
- Fixed 5 agent model audit entries: researcher, reviewer-performance, reviewer-triage, tester, documenter now report haiku correctly.
- Plan-stage BLOCK verdicts log integrity health signal with blocker/warning counts.
- TODO enrichment prompt rewritten to single sentence with no scope expansion.

---

## [2026-04-01] QA Fix Session — 8 tasks across pipeline, UI, and agent system

- Fixed TODO enrichment prompt: single-sentence rewrite with no scope expansion, preventing over-engineered descriptions.
- Added Gate 1 blocked state: gate now shows `PLAN BLOCKED` in red when plan-stage reviewers block, hides implement button until unblocked.
- Auto-send pipeline chips: chips matching known mode prefixes (e.g. `implement feature:`) now trigger run directly; non-pipeline chips still fill prompt only.
- Added plan-stage BLOCK traceability: blocked plan verdicts log to HEALTH tab with agent name, blocker count, and feature name for audit.
- Added USAGE tab cost breakdown: 4-column grid (input, cache-read, output tokens + rates) shows estimated cost per run at Sonnet reference rates.
- Fixed 5 agent model mismatches in constants: researcher, reviewer-performance, reviewer-triage, tester, documenter now correctly report haiku instead of sonnet.

---

## [2026-04-01] CLAUDE.md injection, planner Pass 1 enforcement, a11y fixes

- Fixed orchestrator bypass when project has no CLAUDE.md file: runner now copies `templates/code/CLAUDE.md` to project root before spawn, ensuring pipelines are invoked instead of direct implementation.
- Fixed planner skipping Pass 1: added mandatory check before tool use that scans for `[answers]` block; if absent, planner runs Pass 1 only (reads project.json, emits Q&A questions, stops).
- Fixed two Svelte a11y warnings in BackstageModal and TodoPanel: added tabindex and keyboard handlers to interactive elements with role="dialog" and role="button".

---

## [2026-04-01] Agent sync + capabilities crash fix + cache debug cleanup

- Fixed Windows pipeline critical issue: when agent JSON exceeds 20k character limit, agents are now synced to projectFolder/.claude/agents/ before spawning Claude CLI, fixing missing Q&A, direct source writes, and excessive token usage.
- Fixed crash on TODO→PLANNED promotion when modules loaded from disk lack a capabilities array (undefined.push error).
- Removed debug console logging that was cluttering output and misrepresenting token counts.

---

## [2026-03-31] Gate 2 override button and tab fix

- Gate 2 blocked state now shows an override button (APPLY ANYWAY) alongside DISMISS, allowing users to proceed when the gate is blocking on false positives or missing reviewer verdicts.
- Fixed App.svelte calling `setActiveTab('TERMINAL')` instead of `setActiveTab('LIVE')`, which caused the right panel to appear blank when the architect auto-ran on project import.

---

## [2026-03-31] Skills system overhaul, agents tab fixes, spec-agent coupling

- SKILLS tab in SettingsModal redesigned: hierarchical grouped view (Universal / Electron / Svelte5 / TypeScript groups → expandable capability cards → agent sections with rule count badges). Stack Templates and FORGE SKILLS sections removed.
- AGENTS tab now shows all 30 scaffold agents (was 20); agent cards are clickable and expand to show full agent prompt body with frontmatter stripped.
- Six universal capability skill files added to `templates/code/docs/gotchas/skills/`: `error-handling`, `api-rest`, `code-structure`, `codebase-navigation`, `change-safety`, `convention-matching` — apply to all projects regardless of tech stack, including large imports.
- `skills-generator.md` updated: 6 universal capabilities now listed as always-generate, stack-to-capabilities map revised, reference files section added pointing to templates as format examples.
- `modules.json`: new `skills-system` module wires together the template library, skills-generator agent, injection pipeline, and SKILLS tab — dependency traversal now detects when template changes require agent updates. Architect GAPS audit also added 3 missing IPC channels, 8 agent keyFile registrations, `app-layout` module, wizard sub-step keyFiles, and BackstageModal keyFile.
- spec-agent coupling fixed in `planner.md`: `docs/SPEC.md` added as a conditional mandatory read (Step 1, Pass 2, and Read-first rule) so spec-agent output is never silently ignored when `specAgent: true`.

---

## [2026-03-31] Capability-scoped skills — granular injection (Phases 2 + 3)

- Agents now receive only the skills relevant to their current task via capability-scoped `.md` files stored in `templates/code/docs/gotchas/skills/` rather than monolithic stack sections.
- Project `.json` now stores a `capabilities` array (e.g., `["electron-ipc", "svelte5-reactivity"]`); wizard and import flows auto-populate it based on stack selection.
- `buildSystemPromptAppend` now calls `filterSkillsByCapabilities` to inject only matching files, with graceful fallback to full stack skills if the array is absent or empty.

---

## [2026-03-31] User domain knowledge + platform skills staleness + SKILLS density audit

- Added optional domain knowledge textarea to wizard and import flows; user-supplied context is appended to generated `docs/gotchas/GENERAL.md` as a new section for project-specific guidance.
- Updated skills-generator to stamp each stack section with a generation date; integrity-checker now detects and flags stale SKILLS sections (>90 days old) as health signals.
- Restructured SKILLS.md Phase 1: prioritized high-frequency patterns (IPC quadruple, channel-not-found errors) and consolidated redundant code examples.

---

## [2026-03-31] Signal protocol QA audit layer

- Signal logging: every classified signal (suggest, todo, module, health, summary, checkpoint, etc.) is appended to `docs/context/signal-log.jsonl` at classification time for auditing.
- Audit pass: tool-call-auditor Step 3f reads the signal log and detects 5 anomaly patterns (triage-no-verdict, blocked-no-chip, duplicate-research-status, duplicate-triage-dispatch, verdict-malformed) that enter the same findings list as tool-call violations.
- IPC infrastructure: new `signal-log-clear` and `signal-log-append` handlers; signal logging is fire-and-forget and does not block the classifier hot path.

---

## [2026-03-31] Inter-agent sidecar status files

- Researcher now writes `docs/context/researcher-status.json` with status (SKIPPED/READY/BLOCKED) before emitting signal; coder reads this to decide whether to proceed or emit revise chip.
- Reviewer-triage writes `docs/context/triage-dispatch.json` with authoritative reviewer list; orchestrator reads sidecar first, falls back to prose `### Invoke` list.
- Coder writes `docs/context/coder-status.json` with architecture/decision/IPC flags before suggesting; documenter reads sidecar first, falls back to `## Doc hints`, then derivation.

---

## [2026-03-31] Signal protocol expansion — research-status, triage-dispatch, doc-hints, board todos

- Added `[research-status]` signal: researcher emits READY/SKIPPED/BLOCKED at end of run; BLOCKED converts to a suggest chip ("revise plan: research blocked — <reason>"); READY/SKIPPED suppressed from terminal.
- Added `[triage-dispatch]` signal: reviewer-triage emits comma-separated agent list at dispatch; consumed silently for now (orchestrator wiring is a follow-on).
- Coder handoff format now includes `## Doc hints` section with explicit `arch-update:` and `decision:` flags; documenter reads flags directly instead of re-deriving them.

---
