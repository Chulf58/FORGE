# FORGE — Plan History

Completed feature plans archived here when PLAN.md exceeds 150 lines.

---

### [x] Feature: Failed Test Feedback Loop

Add a `FAILED TEST` mode button to the prompt bar that routes directly to the debug pipeline. When selected, the mode prefixes the user's prompt with `failed test:` which `CLAUDE.md` routes identically to `debug:`. No new pipeline, no new agents — this is a routing alias and UI entry point only.

**Design decisions baked into this plan:**
- **UI placement**: New `FAILED TEST` mode button in `PromptBar.svelte` alongside the existing DEBUG, PLAN, REFACTOR buttons.
- **Routing**: `failed test:` prefix in `CLAUDE.md` is treated as an alias for `debug:` — the same debug agent pipeline runs (debug → reviewer-triage → reviewer → reviewer-safety → Gate #2).
- **PIPELINES entry**: A `'failed test'` key is added to `PIPELINES` in `constants.ts` referencing the same agent sequence as `debug`, `gate: 2`, and `color: 'var(--red)'`.
- **Gate behavior**: Gate #2 shows with `apply debug: ` as the action keyword — identical to the existing debug flow.
- **Accent color**: Red (`var(--red)`) — same as DEBUG, because this routes to the debug pipeline.
- **CLAUDE.md target**: `template/CLAUDE.md` is the only CLAUDE.md — no separate project-root file.

---

- [x] 1. **Add `'failed test'` to `MODES` and `PipelineId` in `constants.ts`** — in `src/renderer/src/lib/constants.ts`, add `'failed test'` to the `MODES` array and to the `PipelineId` union type. Add a `'failed test'` entry to the `PIPELINES` record with the same `agents` array as `debug`, `gate: 2`, and `color: 'var(--red)'`. (`src/renderer/src/lib/constants.ts`)

- [x] 2. **Add `FAIL` mode button to `PromptBar.svelte`** — add `{ id: 'failed test', label: 'FAIL' }` to `USER_MODES`, add `case 'failed test':` to `getPlaceholder()`, add red CSS active rule for `[data-mode="failed test"].active`. (`src/renderer/src/components/prompt/PromptBar.svelte`)

- [x] 3. **Add `failed test:` routing to `template/CLAUDE.md`** — add a `### \`failed test: <description>\`` section immediately after the `### \`debug: <description>\`` section, routing identically to debug. (`template/CLAUDE.md`)

- [x] 4. **`template/CLAUDE.md` is the only CLAUDE.md — task 3 covers this** — confirmed via glob: only `template/CLAUDE.md` exists. No-op verification. (`template/CLAUDE.md`)

- [x] 5. **Update `App.svelte` gate routing for `failed test` mode** — add `'failed test': 'apply debug: '` to the `applyMap` in `detectGates()`, add `'failed test'` to the `gateableModes` array. (`src/renderer/src/App.svelte`)

_Shipped 2026-03-20_

---

### [x] Feature: Agent Manager — Sync Scaffold Agents to Latest

A "SYNC TO LATEST" button in the AgentModal header that copies all scaffold agent files from FORGE's own `.claude/agents/` directory into the active project's `.claude/agents/` directory, replacing only the files whose names are in `SCAFFOLD_AGENT_NAMES`. Custom agents are never touched. An inline confirmation banner (YES/CANCEL) gates the operation — `window.confirm()` is not used as it is blocked by `contextIsolation: true`. After sync completes, the UI shows which files were updated and reloads the agent list.

---

- [x] 1. **Add `SYNC_AGENTS` IPC channel constant** — in `src/renderer/src/lib/constants.ts`, add `SYNC_AGENTS: 'sync-agents'` to the `IPC` object alongside the existing agent-ops entries (`LIST_AGENTS`, `READ_AGENT`, `WRITE_AGENT`). (`src/renderer/src/lib/constants.ts`)

- [x] 2. **Add `syncAgents` type to `ClaudeAPI`** — in `src/renderer/src/types/claude.d.ts`, add the method signature `syncAgents(projectFolder: string): Promise<{ synced: string[]; error?: string }>` to the `ClaudeAPI` interface in the agent file ops section alongside `listAgents`, `readAgent`, `writeAgent`, `deleteAgent`. (`src/renderer/src/types/claude.d.ts`)

- [x] 3. **Implement `sync-agents` IPC handler in main** — in `src/main/index.ts`, add `ipcMain.handle('sync-agents', (_, { projectFolder }) => { ... })`. The handler must: (a) resolve `appRoot` via `app.getAppPath()`, (b) build `srcAgentsDir = join(appRoot, '.claude', 'agents')`, (c) build `destAgentsDir = join(projectFolder, '.claude', 'agents')`, (d) ensure `destAgentsDir` exists via `mkdirSync(..., { recursive: true })`, (e) iterate over `SCAFFOLD_AGENT_NAMES`, for each name check if the source file exists in `srcAgentsDir` via `existsSync`, and if so copy it to `destAgentsDir` using `copyFileSync`, (f) collect the filenames that were actually copied into a `synced` array, (g) return `{ synced }` on success or `{ synced: [], error: e.message }` on exception. (`src/main/index.ts`)

- [x] 4. **Expose `syncAgents` in the preload bridge** — in `src/preload/index.ts`, add `syncAgents: (folder: string) => ipcRenderer.invoke('sync-agents', { projectFolder: folder })` to the `contextBridge.exposeInMainWorld('claude', { ... })` object in the agent-ops group alongside `listAgents`, `readAgent`, `writeAgent`, `deleteAgent`. (`src/preload/index.ts`)

- [x] 5. **Add `syncAgents` wrapper in `ipc.ts`** — in `src/renderer/src/lib/ipc.ts`, add the exported function `export function syncAgents(folder: string): Promise<{ synced: string[]; error?: string }>` that calls `c().syncAgents(folder)`, in the agent-ops section. (`src/renderer/src/lib/ipc.ts`)

- [x] 6. **Add sync state variables to `AgentModal.svelte`** — in `src/renderer/src/components/overlays/AgentModal.svelte`, in the `<script>` block, add four reactive state variables: `let syncing = $state(false)`, `let syncConfirming = $state(false)`, `let syncResult = $state<string[] | null>(null)`, and `let syncError = $state('')`. (`src/renderer/src/components/overlays/AgentModal.svelte`)

- [x] 7. **Implement `syncToLatest()` and `confirmSync()` functions in `AgentModal.svelte`** (`src/renderer/src/components/overlays/AgentModal.svelte`)

- [x] 8. **Add "SYNC TO LATEST" button to the modal header** (`src/renderer/src/components/overlays/AgentModal.svelte`)

- [x] 9. **Show inline confirmation banner and sync result feedback** (`src/renderer/src/components/overlays/AgentModal.svelte`)

- [x] 10. **Style the `sync-btn`** (`src/renderer/src/components/overlays/AgentModal.svelte`)

_Shipped 2026-03-20_

---

### [x] Feature: Redesign pipeline mode selectors and prompt bar

Combines two TODOs (board.json ids `d0e1f2a3` and `c9d0e1f2`). Add a 6th mode called DIRECT and rename FREE to EXPLORE. DIRECT passes the prompt straight through to Claude with full write permissions (`--dangerously-skip-permissions`) but with no pipeline prefix, no pipeline agents initialised, and no gate. A CLAUDE.md intent guard redirects prompts that are clearly feature implementation, bug fixes, or code refactors back to the appropriate pipeline. EXPLORE (formerly FREE) retains its read-only CLI constraint unchanged. Prompt bar controls are also consolidated: RUN + RE-RUN + NEW CONVERSATION in one row, CONTINUE renamed SAME SESSION and hidden when no session exists, textarea height expanded.

**Design decisions baked into this plan**
- FREE renamed to EXPLORE everywhere (constant, store default, UI label, CLAUDE.md rules, `modePrefix` logic, run-claude handler, runner.ts).
- DIRECT is a new top-level `ModeId` alongside the existing five user-facing modes.
- DIRECT uses `--dangerously-skip-permissions` (same as pipeline modes) — no `--allowedTools` restriction.
- DIRECT sends the prompt verbatim (no prefix prepended), same as the existing FREE/EXPLORE behaviour.
- DIRECT shows a single synthetic `claude` agent card in the LIVE tab (same pattern as the existing EXPLORE mode synthetic card).
- No gate is triggered after a DIRECT run.
- The intent guard lives in `template/CLAUDE.md` as a new `## DIRECT mode rules` section; it is also applied to existing project `CLAUDE.md` files via the tester instructions.
- The board.json TODO entry for the Haiku classifier follow-up already exists (id `a3b4c5d6-e7f8-4a9b-0c1d-2e3f4a5b6c7d`) — no new TODO needed.
- The RUN/STOP button moves from a standalone full-width row into a right-anchored position in a new `controls-row` alongside the secondary action buttons.
- RUN is sized to ~90px wide, 28px tall — clearly the primary action but no longer dominating the layout.
- STOP (when running) replaces RUN in the same slot, same size.
- RE-RUN becomes an icon-only compact button (↩), ~28px × 28px, with a tooltip. Disabled when no prior prompt.
- NEW CONVERSATION becomes a compact icon-only button (+), ~28px × 28px, with a tooltip. Always enabled when not running.
- The old standalone `action-row` div is removed; both secondary buttons live in `controls-row` on the left.
- CONTINUE is renamed to SAME SESSION. It is conditionally rendered — only visible when `run.sessionId` is truthy. When a session exists it appears on the right of the mode row (after the spacer). When no session exists it is hidden entirely (not disabled, not greyed out — just absent).
- A flex spacer in `controls-row` pushes the secondary buttons left and RUN right within the same row.
- No layout changes outside `PromptBar.svelte`. All changes are contained in this one component.

**Phase 1 — Constants and type definitions**

- [x] 1. In `src/renderer/src/lib/constants.ts`, rename the string literal `'free'` to `'explore'` in the `MODES` tuple and add `'direct'` as a new entry at the END of the tuple (after `'apply refactor'`). The existing entries `'apply feature'` and `'apply debug'` are unchanged and remain in the tuple. The full correct new tuple must be exactly: `['plan feature', 'implement feature', 'apply feature', 'debug', 'apply debug', 'refactor', 'apply refactor', 'explore', 'direct']`. Update `ModeId` accordingly. (`src/renderer/src/lib/constants.ts`)

- [x] 2. In `src/renderer/src/lib/constants.ts`, add a `DIRECT_PIPELINE` synthetic entry (or handle inline) — DIRECT has no pipeline agents and no gate, so no entry in `PIPELINES` is needed; confirm this by reviewing how `triggerRun` and `PromptBar.submit()` branch on `PIPELINES[mode]` being undefined. No change to `PIPELINES`. (`src/renderer/src/lib/constants.ts`)

**Phase 2 — Store updates**

- [x] 3. In `src/renderer/src/stores/run.svelte.ts`, update the hardcoded default `mode: 'free'` value (line 24) to `'explore'`. (`src/renderer/src/stores/run.svelte.ts`)

- [x] 4. In `src/renderer/src/stores/editor.svelte.ts`, confirm by inspection that no code defaults to `MODES[0]` for the editor mode. `MODES[0]` is and remains `'plan feature'` — the rename of `'free'` to `'explore'` and the addition of `'direct'` at the end of the tuple do NOT change `MODES[0]`. No code change is needed here; confirm by inspection and note in the handoff. (`src/renderer/src/stores/editor.svelte.ts`)

**Phase 3 — Main process CLI runner**

- [x] 5. In `src/main/index.ts`, in the `run-claude` IPC handler, update the `isFree` guard: replace `mode === 'free'` with `mode === 'explore'`. DIRECT mode falls through to the `--dangerously-skip-permissions` branch with no additional changes needed. (`src/main/index.ts`)

**Phase 4 — Shared run trigger**

- [x] 6. In `src/renderer/src/lib/runner.ts`, make three changes:
  - Update the default parameter from `mode: ModeId = 'free'` to `mode: ModeId = 'explore'` (line 10)
  - Update the `mode === 'free'` branch condition to `mode === 'explore'`
  - Add a branch for DIRECT: the `fullPrompt` construction must skip the prefix when `mode === 'explore' || mode === 'direct'` (combine both conditions in the same guard — both produce a no-prefix prompt).

  (`src/renderer/src/lib/runner.ts`)

**Phase 5 — PromptBar component**

- [x] 7–11, 11a, 15, 16, 17, 17a, 18. Full rewrite of `PromptBar.svelte`: USER_MODES updated (FREE→EXPLORE, DIRECT added), `modePrefix` updated, `getPlaceholder` function added, `submit()` agent-init branch restructured, `data-mode` attribute selectors for EXPLORE (blue) and DIRECT (green), SAME SESSION conditional toggle, `controls-row` with compact icon buttons, 90px textarea, reduced mode-btn padding to `2px 5px`.

**Phase 6 — CLAUDE.md intent guard**

- [x] 12. In `template/CLAUDE.md`, renamed `## FREE mode rules` to `## EXPLORE mode rules` and added `## DIRECT mode rules` with intent guard.

**Phase 6b — FeatPanel quick-launch button**

- [x] 12b. In `src/renderer/src/components/panels/FeatPanel.svelte` line 115, renamed `setMode('free')` to `setMode('explore')`.

**Phase 7 — modules.json capability update**

- [x] 13. In `.pipeline/modules.json`, updated the `prompt-run-controls` module's `mode-selector` capability text to reflect the new 6-mode set.

**Phase 8–13 — Testing**

- [x] 14, 19. Tester added TESTING.md coverage for mode buttons, EXPLORE/DIRECT styling, SAME SESSION toggle, controls-row layout, and behavioral eval set for DIRECT intent guard.

_Shipped 2026-03-19_
## Completed Features (Archive)

### [x] Feature: Modal Restructure — Agent Management Distribution

- [x] 1. Add `list-forge-agents` IPC handler to `src/main/handlers/agents.ts` (channel name `'list-forge-agents'`, reads `appRoot/.claude/agents/` — uses the `appRoot` passed during handler registration, returns `{ files: string[] }`); add `forget-project` IPC handler to `src/main/handlers/projects.ts` (channel `'forget-project'`, removes entry from project registry JSON without touching disk, returns `{ ok: true } | { error: string }`); register both new handlers in `src/main/index.ts` where `agentsHandlers.register()` and `projectsHandlers.register()` are called — pass `appRoot` to the agents register call so `list-forge-agents` can resolve the correct path (wave: 1)
- [x] 2. Expose `listForgeAgents` and `forgetProject` on the contextBridge in `src/preload/index.ts` using `ipcRenderer.invoke('list-forge-agents')` and `ipcRenderer.invoke('forget-project', folder)` respectively (wave: 2, depends on task 1)
- [x] 3. Add `listForgeAgents(): Promise<{ files: string[] } | { error: string }>` and `forgetProject(folder: string): Promise<{ ok: boolean } | { error: string }>` method signatures to `ClaudeAPI` in `src/renderer/src/types/claude.d.ts`; also promote the `AgentEntry` interface (name, filename, model, description, isScaffold) into `claude.d.ts` so it survives AgentModal deletion (wave: 2, depends on task 1)
- [x] 4. Add `listForgeAgents()` and `forgetProject(folder)` typed wrapper functions to `src/renderer/src/lib/ipc.ts` (wave: 3, depends on tasks 2 and 3)
- [x] 5. Remove `'agents'` from the `openModal` union type in `src/renderer/src/stores/ui.svelte.ts` (wave: 1)
- [x] 6. Rewrite `src/renderer/src/components/overlays/SettingsModal.svelte` — widen to 700px, add SETTINGS / AGENTS / MODULES / SKILLS tab row; SETTINGS tab has existing content minus the "MANAGE AGENTS →" button; AGENTS tab calls `listForgeAgents`, reads each file via `readAgent` (passing FORGE's agents folder), parses frontmatter, renders a read-only card per scaffold agent showing name, model chip (HAI/SON/OPU coloured), description, and pipeline stage from a static `FORGE_AGENT_STAGES` lookup keyed by filename; MODULES and SKILLS tabs show placeholder text; use `position: absolute` with a `position: relative` parent wrapper — not `position: fixed` (wave: 4, depends on task 4)
- [x] 7. Rewrite `src/renderer/src/components/overlays/ProjectOverviewModal.svelte` — widen to 760px; remove the FORGE MODULES section entirely; add CUSTOM AGENTS section at the bottom: list agents from `projectFolder/.claude/agents/` via `listAgents(folder)`, filter out any filename present in the SCAFFOLD set (import `SCAFFOLD_AGENT_NAMES` constant or define a local set matching `AgentModal`'s SCAFFOLD set); inline editor state (`selected`, `editorContent`, `dirty`, `saving`, `isNew`) managed within this component; import `AgentEntry` from `claude.d.ts`; SAVE / DISCARD / DELETE actions; no Sync button; use `position: absolute` with `position: relative` wrapper (wave: 4, depends on task 4)
- [x] 8. Update `src/renderer/src/components/overlays/ProjectsModal.svelte` — add a hover ✕ remove button to each project-item row that calls `forgetProject(proj.folder)` after a `confirm()` dialog, then refreshes the project list by re-calling `getProjects()` (wave: 4, depends on task 4)
- [x] 9. Remove `AgentModal` import, the `{:else if ui.openModal === 'agents'}` branch, and the `AgentModal` rendering from `src/renderer/src/App.svelte`; must complete before task 10 (wave: 4)
- [x] 10. Delete the files `src/renderer/src/components/overlays/AgentModal.svelte`, `src/renderer/src/components/overlays/agent/AgentListPane.svelte`, and `src/renderer/src/components/overlays/agent/AgentEditorPane.svelte` — only after task 9 confirms no remaining imports (wave: 5, depends on task 9)

---

## Completed Features (Archive)

### [x] Feature: Fix Coder Agent Prompt Gaps

Four targeted corrections to `.claude/agents/coder.md` only — no source file changes.

**Gaps being fixed:**

1. **Wrong output signal** — coder currently emits `[suggest] apply feature:` which bypasses Gate #2 and all reviewers entirely; must become `[suggest] review feature:` to mirror the debug agent pattern.
2. **Plan validity check missing** — no pre-step guards against running on a plan that was never pipeline-produced; a stale or hand-written `docs/PLAN.md` will produce a handoff reviewers reject immediately.
3. **GENERAL.md read missing** — `docs/gotchas/GENERAL.md` is not in the mandatory pre-read list, so the coder has no awareness of project-specific gotchas (process boundary rules, signal protocol, IPC patterns, platform differences) before writing the handoff.
4. **IPC triple/quadruple inconsistency** — the tech-stack section heading on line 39 says "IPC triple" but the pre-flight checklist on line 150 already correctly names it "the quadruple"; the heading and code-block comment must be updated to match.

---

- [x] 1. **Fix output signal** — in `.claude/agents/coder.md`, replace the `## Output signal` section at the bottom. Change `[suggest] apply feature: <feature name>` to `[suggest] review feature: <feature name>`. Add a note immediately after: "Do NOT suggest applying directly — Gate #2 gates the apply step. Emitting `apply feature:` here bypasses all reviewers and the human approval gate." (`.claude/agents/coder.md`)

- [x] 2. **Add plan validity pre-step** — in `.claude/agents/coder.md`, insert a new `## Before you start — plan validity check` section immediately after the `## Your role` section (before `## Why handoff.md, not source files`). The section must instruct the coder to:
  - Check that `docs/RESEARCH/` contains at least one `.md` file (evidence the researcher ran).
  - Check that `docs/PLAN.md` has a `### Feature:` heading (evidence the planner ran).
  - If either check fails: stop immediately, do NOT write `handoff.md`, and emit `[suggest] plan feature: <name>` with the message: "Plan was not pipeline-produced. Run `plan feature: <name>` first so the researcher and planner can generate valid inputs." (`.claude/agents/coder.md`)

- [x] 3. **Add GENERAL.md to mandatory pre-reads** — in `.claude/agents/coder.md`, locate the opening role description paragraph that lists what the coder reads before writing the handoff. Add `docs/gotchas/GENERAL.md` as an explicit mandatory pre-read alongside `docs/PLAN.md` and `docs/RESEARCH/`. The note should explain: "GENERAL.md contains project-specific gotchas (process boundary, IPC pattern, Svelte 5 rune rules, signal protocol, platform differences) — read it before writing any code." (`.claude/agents/coder.md`)

- [x] 4. **Fix IPC triple → quadruple in tech-stack heading** — in `.claude/agents/coder.md`, on the line currently reading `### IPC triple (main + preload + type)`, change it to `### IPC quadruple (main + preload + type + ipc.ts wrapper)`. Update the comment inside the code block below it (if any) to name all four locations: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/types/claude.d.ts`, and `src/renderer/src/lib/ipc.ts`. This makes the tech-stack section consistent with the pre-flight checklist section which already correctly enumerates all four. (`.claude/agents/coder.md`)

### Research needed
- None. All four gaps are directly visible in `.claude/agents/coder.md` and confirmed against the debug agent pattern, `docs/gotchas/GENERAL.md`, and the pre-flight checklist already present in the file.

---

### [x] Feature: Fix Planner Agent Prompt Gaps

Five targeted corrections to `.claude/agents/planner.md` only — no source file changes.

**Gaps being fixed:**

1. **Two-pass behavior missing** — the planner prompt has Step 0 described at a high level but lacks an explicit `## Two-pass behavior` section that spells out Pass 1 (emit `[questions]` block then STOP, no plan content) vs Pass 2 (when `[answers]` present, skip questions and write full plan).
2. **GENERAL.md read missing** — `docs/gotchas/GENERAL.md` is not in the mandatory pre-read steps, so the planner can produce a plan that repeats known pitfalls (wrong IPC count, svelte/store usage, Node imports in renderer, etc.).
3. **PLAN.md append vs overwrite ambiguous** — the existing format section shows a bare `## Active Plan` block but gives no instruction about what to do when `docs/PLAN.md` already exists with prior feature headings; the planner must be told to append, never overwrite or delete existing tasks.
4. **`[todo]` signal guidance missing** — after writing the plan the planner should emit one `[todo] <task text>` line per task so FORGE can capture them for the board; no such instruction currently exists.
5. **Electron version** — confirmed correct at `^39.2.6` in `package.json`; no change needed.

---

- [x] 1. **Add `## Two-pass behavior` section** — in `.claude/agents/planner.md`, insert a new `## Two-pass behavior` section immediately after `## Your role`. The section must state: **Pass 1** — when no `[answers]` block is present, or when a syntactically present `[answers]` block is empty (i.e., contains no answered questions), emit only the `[questions]` block and stop; do not write plan content, do not emit `[suggest]`. **Pass 2** — when a non-empty `[answers]` block (containing at least one answered question) is present anywhere in the prompt, skip Step 0 entirely, use the answers to resolve every design choice, and proceed directly to reading the codebase and writing the full plan. (`.claude/agents/planner.md`)

- [x] 2. **Add GENERAL.md to mandatory pre-reads** — in `.claude/agents/planner.md`, locate the `## Steps 1–3 (write the plan)` section. Expand step 1 to explicitly list the files that must be read before writing the plan: `docs/gotchas/GENERAL.md` (project-specific pitfalls), `docs/PLAN.md` (to detect existing tasks before appending), and any source files relevant to the feature. Add a note: "Reading GENERAL.md first prevents the plan from scheduling tasks that repeat known process-boundary, IPC, or reactivity mistakes." (`.claude/agents/planner.md`)

- [x] 3. **Clarify PLAN.md append behavior** — in `.claude/agents/planner.md`, in the `## PLAN.md format` section, add an explicit rule: "If `docs/PLAN.md` already exists, append the new `### Feature:` section under the existing `## Active Plan` heading. Never delete, overwrite, or modify existing task lines or feature headings. Only add new content." Add this rule both as a bullet in `## Planning rules` and as a note inside the `## PLAN.md format` section. (`.claude/agents/planner.md`)

- [x] 4. **Add `[todo]` signal instruction** — in `.claude/agents/planner.md`, add a new `## Step 3b — Emit [todo] signals` section immediately after the plan-writing steps (before `## Step 4 — Assign module`). The section must instruct: after the plan is written to `docs/PLAN.md`, emit one `[todo] <task text>` line per task added in the current run only (one line per numbered task in the newly written `### Feature:` section, matching the task description). Do not emit `[todo]` lines for tasks that already existed in prior feature headings before this run. These lines are consumed by FORGE as task-board entries and must not be omitted. Also update the `## Output signal` section to show that `[todo]` lines come before the `[suggest]` line. (`.claude/agents/planner.md`)

- [x] 5. **Confirm Electron version is correct** — in `.claude/agents/planner.md`, verify the `## Tech stack` section line reading `Electron 39 via electron-vite` against `package.json` (confirmed `^39.2.6`). No text change is required; this task is a verification-only confirmation that the version reference is accurate. (`.claude/agents/planner.md`)

### Research needed
- None. All gaps are directly visible in `.claude/agents/planner.md` and confirmed against `docs/gotchas/GENERAL.md`, `package.json`, and the existing coder agent for cross-reference patterns.

---

### [x] Feature: Enforce Glob/Grep over Bash in Agent Prompts

Targeted additions to `docs/gotchas/GENERAL.md` (global catch-all rule) and the two agent `.md` files that have Bash tool access — `implementer.md` and `debug.md`. No source file changes.

**Gaps being fixed:**

Agents with Bash tool access (`implementer`, `debug`) have no instruction to prefer the dedicated Glob and Grep tools for file discovery and text search. As a result they default to `bash find`, `bash ls`, and `bash grep`/`rg`, which is slower (spawns a shell subprocess), platform-fragile on Windows, and bypasses the optimised tool layer. The rule must live in `GENERAL.md` so every pipeline agent reads it automatically, plus be added inline to the two agents that actually have Bash access.

---

- [x] 1. Add a `## Tool preference — Glob and Grep over Bash` section to `docs/gotchas/GENERAL.md` with the rule: "Always use the Glob tool instead of bash find/ls, and the Grep tool instead of bash grep/rg. Bash should only be used for operations that have no dedicated tool equivalent (e.g. git commands, wc, process operations). Never use bash find, bash ls, or bash grep/rg." (`docs/gotchas/GENERAL.md`)

- [x] 2. Add a `## Tool preference` section to `.claude/agents/implementer.md` immediately after the `## Editing rules` section, containing the same rule verbatim: "Always use the Glob tool instead of bash find/ls, and the Grep tool instead of bash grep/rg. Bash should only be used for operations that have no dedicated tool equivalent (e.g. git commands, wc, process operations). Never use bash find, bash ls, or bash grep/rg." (`.claude/agents/implementer.md`)

- [x] 3. Add a `## Tool preference` section to `.claude/agents/debug.md` immediately after the `## Debugging approach` section, containing the same rule verbatim: "Always use the Glob tool instead of bash find/ls, and the Grep tool instead of bash grep/rg. Bash should only be used for operations that have no dedicated tool equivalent (e.g. git commands, wc, process operations). Never use bash find, bash ls, or bash grep/rg." (`.claude/agents/debug.md`)

### Research needed
- None. The two agents with Bash tool access (`implementer.md`, `debug.md`) are confirmed by reading all 16 agent frontmatter blocks. No other agents in `.claude/agents/` have Bash in their tools list.

---

### [x] Feature: Optimize Tester and Documenter Agent Token Usage

Targeted rewrites of `.claude/agents/tester.md` and `.claude/agents/documenter.md` to reduce token consumption. No source file changes.

**Problems being solved:**

- Tester consumes ~77k tokens per run — highest of any agent. Root causes: reads too many files, writes exhaustive checklists with N/A items and obvious static checks, applies all section templates regardless of feature type (e.g. doc-only changes get runtime test sections that have no applicable tests).
- Documenter writes lengthy narrative prose when the output format should be structured, skimmable reference text. The prose format inflates output tokens and produces documents that are harder to scan.

---

- [x] 1. **Rewrite tester file-reading strategy** — in `.claude/agents/tester.md`, replace the current "read everything relevant" instruction with a scoped file-reading rule: read only `docs/handoff.md` and the specific files listed in the handoff's changed-files section. Do NOT read entire directories, do NOT read unchanged context files, do NOT read files not referenced by the handoff. Add an explicit "What NOT to read" bullet list. (`.claude/agents/tester.md`)

- [x] 2. **Add feature-type classifier to tester** — in `.claude/agents/tester.md`, insert a `## Feature type detection` section before the checklist sections. The classifier must inspect the handoff and categorise the feature as one of: `ui-change`, `ipc-change`, `agent-prompt-only`, `data-model`, or `refactor`. Each category maps to a subset of checklist sections that apply. Agent-prompt-only changes skip runtime, IPC, and UI sections entirely. Refactors skip the user-observable outcome sections. (`.claude/agents/tester.md`)

- [x] 3. **Prune tester checklist items** — in `.claude/agents/tester.md`, audit every checklist item. Remove items that are: (a) always-true static assertions ("the file exists", "the import compiles"), (b) duplicates of gotcha-checker checks (IPC four-file rule, contextIsolation), or (c) applicable only to feature types that won't appear in most runs. The goal is to reduce the checklist from its current length to ≤15 active items per run for a typical feature. (`.claude/agents/tester.md`)

- [x] 4. **Replace documenter prose format with structured reference** — in `.claude/agents/documenter.md`, change the output format instruction from narrative prose to a structured template: one-sentence summary, changed-files table (file | change type | what changed), new IPC channels table (channel | direction | payload shape), and a "user-visible changes" bullet list (max 5 items). Cap total output at ~400 tokens. (`.claude/agents/documenter.md`)

- [x] 5. **Scope documenter file reads** — in `.claude/agents/documenter.md`, replace the broad file-reading instruction with the same scoped rule used in the tester: read only `docs/handoff.md` and files explicitly listed in the handoff. Do not read source files not referenced by the handoff. (`.claude/agents/documenter.md`)

### Research needed
- None. The tester and documenter agent files are readable and the token-inflation causes are directly visible without additional research.

---

### [x] Feature: Switch Tester, Documenter, and Reviewer-Performance to Haiku Model

Targeted model-line changes to three agent `.md` files. No source file changes, no logic changes.

**Rationale:**

Three pipeline agents — `tester.md`, `documenter.md`, and `reviewer-performance.md` — currently run on Sonnet. These agents perform bounded, structured tasks (checklist evaluation, structured doc writing, performance heuristics review) that do not require Sonnet-level reasoning and would run faster and cheaper on Haiku without quality loss.

---

- [x] 1. **Switch tester to Haiku** — in `.claude/agents/tester.md`, change the `model:` frontmatter line from `claude-sonnet-4-5` (or whichever Sonnet variant is currently set) to `claude-haiku-4-5-20251001`. (`.claude/agents/tester.md`)

- [x] 2. **Switch documenter to Haiku** — in `.claude/agents/documenter.md`, change the `model:` frontmatter line to `claude-haiku-4-5-20251001`. (`.claude/agents/documenter.md`)

- [x] 3. **Switch reviewer-performance to Haiku** — in `.claude/agents/reviewer-performance.md`, change the `model:` frontmatter line to `claude-haiku-4-5-20251001`. (`.claude/agents/reviewer-performance.md`)

### Research needed
- None. The three files are identified and the model line format is confirmed by the existing `gotcha-checker.md` which already uses `claude-haiku-4-5-20251001`.

---

### [x] Feature: TESTING.md Archival

Archive `docs/TESTING.md` into `docs/archive/` and remove the outdated manual test protocol it contains. No source file changes.

**Rationale:**

`docs/TESTING.md` describes a manual pre-release checklist that predates the automated pipeline (tester agent, reviewer agents, Gate #1 / Gate #2). The document is now misleading — it implies a human-driven test process that no longer exists. Archiving it removes the confusion without losing the historical record.

---

- [x] 1. **Create `docs/archive/` directory** — create the directory `docs/archive/` if it does not already exist. (This is a filesystem operation; no file content to specify.) (`docs/archive/`)

- [x] 2. **Move `docs/TESTING.md` to `docs/archive/TESTING.md`** — move (rename) the file. Do not modify its content. (`docs/TESTING.md` → `docs/archive/TESTING.md`)

- [x] 3. **Add archive notice to top of `docs/archive/TESTING.md`** — prepend a two-line note: `> **Archived** — This manual test protocol predates the automated pipeline (tester agent, Gate #1, Gate #2). It is retained for historical reference only and should not be used as an active checklist.` (`docs/archive/TESTING.md`)

- [x] 4. **Update any references to `docs/TESTING.md`** — Grep all `.md` files and agent prompts for the string `docs/TESTING.md`. For each reference found, update the path to `docs/archive/TESTING.md` or remove the reference if it is a "see also" link with no other content value. (`docs/`, `.claude/agents/`)

### Research needed
- None. The file exists at `docs/TESTING.md` and its content is directly readable. No cross-references expected but the Grep in task 4 confirms.

---

### [x] Feature: Review and Optimise Pipeline Review Flow

Targeted prompt rewrites and model changes across the reviewer pipeline agents. No source file changes.

**Problems being solved:**

The current review pipeline (logic → performance → security → documentation) has four sequential agents all running on Sonnet. Observed issues:
1. Reviewer-logic duplicates checks already done by gotcha-checker (IPC four-file rule, svelte/store usage), wasting tokens.
2. Reviewer-security applies web-app threat models (XSS, CSRF, SQL injection) that don't apply to a local Electron app with no network-facing surface.
3. All four reviewers emit long prose reports — they should emit structured verdicts only (APPROVED / REVISE + bullet list).
4. Reviewer-performance and reviewer-documentation are good candidates for Haiku (already planned in prior feature — this feature handles logic and security).

---

- [x] 1. **Prune reviewer-logic duplicate checks** — in `.claude/agents/reviewer-logic.md`, remove all checklist items that duplicate gotcha-checker output: IPC four-file rule, svelte/store API usage, contextIsolation flag, localStorage usage, position:fixed. Add a note: "Do not re-check items already verified by gotcha-checker. Focus on logic correctness, state ownership, async error handling, and edge cases." (`.claude/agents/reviewer-logic.md`)

- [x] 2. **Rewrite reviewer-security threat model** — in `.claude/agents/reviewer-security.md`, replace the generic web-app threat model with an Electron-specific one. Remove: XSS via innerHTML, CSRF, SQL injection, cookie security. Add: (a) IPC handler input validation — are all `ipcMain.handle` inputs validated before use in fs or child_process calls? (b) path traversal — does any handler concatenate user input into file paths without `resolve()` + `startsWith()` guard? (c) shell injection — does any `spawn` or `exec` call interpolate user strings into the command? (d) preload surface — does any new `contextBridge` exposure leak Node APIs directly? (`.claude/agents/reviewer-security.md`)

- [x] 3. **Enforce structured verdict format across all reviewers** — in `.claude/agents/reviewer-logic.md`, `.claude/agents/reviewer-security.md`, `.claude/agents/reviewer-performance.md`, and `.claude/agents/reviewer-documentation.md`, replace or add to the `## Output format` section: the verdict must be APPROVED or REVISE followed by a bullet list of issues (if any). No prose paragraphs. Maximum 10 bullet points. Each bullet: `**<issue title>** — <one-sentence explanation>`. (`.claude/agents/reviewer-logic.md`, `.claude/agents/reviewer-security.md`, `.claude/agents/reviewer-performance.md`, `.claude/agents/reviewer-documentation.md`)

- [x] 4. **Switch reviewer-logic to Haiku** — in `.claude/agents/reviewer-logic.md`, change the `model:` frontmatter line to `claude-haiku-4-5-20251001`. (`.claude/agents/reviewer-logic.md`)

- [x] 5. **Switch reviewer-security to Haiku** — in `.claude/agents/reviewer-security.md`, change the `model:` frontmatter line to `claude-haiku-4-5-20251001`. (`.claude/agents/reviewer-security.md`)

### Research needed
- None. All four reviewer agent files are directly readable and the issues are confirmed by inspection.

---

### [x] Feature: Fix Scaffold Agent Set on Project Creation and Import

Ensure that when a new project is created (scaffold) or an existing project is imported, the full current agent set from `template/.claude/agents/` is copied to the project's `.claude/agents/` directory. No renderer changes; main process only.

---

- [x] 1. **Audit scaffold-project handler** — read `src/main/index.ts` and locate the `ipcMain.handle('scaffold-project', ...)` handler. Confirm whether it copies the agents directory from `template/.claude/agents/` to the target project. If it uses `fsPromises.cp` with `recursive: true`, verify the source path resolves correctly relative to the app's install location (use `app.getAppPath()` not `__dirname` in production builds). (`src/main/index.ts`)

- [x] 2. **Fix agents copy in scaffold-project** — in `src/main/index.ts`, in the `scaffold-project` handler, ensure the agents copy step uses `path.join(app.getAppPath(), 'template', '.claude', 'agents')` as the source (not a relative `./template/` path). Wrap the copy in a try/catch that returns `{ ok: false, error }` on failure. (`src/main/index.ts`)

- [x] 3. **Audit import-project handler** — in `src/main/index.ts`, locate the `ipcMain.handle('import-project', ...)` handler. Confirm whether it copies or merges agents from the template into the imported project's `.claude/agents/`. If the handler skips existing agent files (to avoid overwriting customised agents), ensure new agents added to the template since the project was created are still copied (i.e., copy-if-absent, not copy-never). (`src/main/index.ts`)

- [x] 4. **Fix agents copy in import-project** — in `src/main/index.ts`, in the `import-project` handler, implement copy-if-absent logic for each agent file: for each `.md` file in `template/.claude/agents/`, copy it to the target `.claude/agents/` only if the file does not already exist there. This preserves user-customised agents while ensuring new pipeline agents are added. (`src/main/index.ts`)

### Research needed
- None. The scaffold and import handlers are in `src/main/index.ts` and the fix pattern (copy-if-absent) is unambiguous.

---

### [x] Feature: Project-Agnostic Agent Identity

Update all pipeline agent prompts to replace FORGE-specific identity phrases with project-agnostic language. Agents should describe themselves as running "for the active project" rather than hardcoding "for FORGE". No source file changes.

**Rationale:**

All agents currently contain the phrase "You run as part of the FORGE pipeline for FORGE" or similar. When these agents are scaffolded into a non-FORGE project, the identity mismatch is confusing. The fix is to replace project-specific references with "the active project".

**Scope:** All `.claude/agents/*.md` files that contain FORGE-specific identity language. The `docs/gotchas/GENERAL.md` and `docs/PLAN.md` files are NOT changed — those are project-specific documents that correctly reference FORGE.

---

- [x] 1. **Grep all agent files for FORGE identity phrases** — Grep `.claude/agents/` for the pattern `for FORGE` (case-sensitive). List every file and line that contains it. This confirms the exact set of files that need editing. (`.claude/agents/`)

- [x] 2. **Replace identity phrases in all matched agent files** — for each file found in task 1, replace `"for FORGE"` with `"for the active project"` and `"the FORGE pipeline"` with `"the pipeline"` where it appears in the agent's self-description opening line. Do not change references to FORGE that appear in technical content (e.g. "FORGE's Electron/Svelte stack", "FORGE runs on Windows 11") — only change the identity/role-description sentences. (`.claude/agents/*.md`)

- [x] 3. **Update template agent copies** — verify whether `template/.claude/agents/` contains copies of the same agent files. If so, apply the same replacements to the template copies so new projects scaffolded from the template receive the agnostic versions. (`template/.claude/agents/`)

- [x] 4. **Verify planner system prompt** — the planner agent prompt is also embedded in the Planner agent role definition at the top of `.claude/agents/planner.md`. Confirm the opening paragraph reads "You are the Planner agent. You run as part of the FORGE pipeline for the active project." after the change from task 2. (`.claude/agents/planner.md`)

### Research needed
- None. All agent files are directly readable and the identity phrases to replace are unambiguous.

---

### [x] Feature: Optional Tester Gate After Implementer

Add an optional tester-gate step that runs the `tester` agent immediately after the `implementer` agent completes, before passing to the reviewer pipeline. The gate is off by default and can be enabled per-run via a chip or setting.

**Design decisions baked into this plan (from user answers):**

- **Placement**: tester runs after implementer, before the reviewer pipeline (not after all reviewers)
- **Toggle mechanism**: a persistent toggle in Settings (not a per-run chip)
- **On failure behavior**: tester REVISE result blocks progression and re-invokes the implementer (not the planner) — same loop as the existing reviewer-logic → implementer cycle, capped at 3 cycles then escalate
- **No new pipeline name**: the feature uses conditional branching within the existing `apply feature:` pipeline, not a separate named pipeline

---

- [x] 1. **Add `testerGateEnabled` to DEFAULT_SETTINGS and Settings type** — in `src/renderer/src/lib/constants.ts`, add `testerGateEnabled: false` to the `DEFAULT_SETTINGS` object. In `src/renderer/src/types/claude.d.ts`, add `testerGateEnabled?: boolean` to the `Settings` interface. (`src/renderer/src/lib/constants.ts`, `src/renderer/src/types/claude.d.ts`)

- [x] 2. **Add tester gate toggle to SettingsModal** — in `src/renderer/src/components/overlays/SettingsModal.svelte`, add a new `<div class="field">` block after the existing model field. Label: `TESTER GATE`. Render a checkbox/toggle bound to `draft.testerGateEnabled`. Add a `field-hint` below: "Run the tester agent after implementation, before code review. Failures re-invoke the implementer (max 3 cycles)." (`src/renderer/src/components/overlays/SettingsModal.svelte`)

- [x] 3. **Expose testerGateEnabled in get-settings IPC response** — in `src/main/index.ts`, confirm the `ipcMain.handle('get-settings', ...)` handler merges loaded settings with `DEFAULT_SETTINGS` so `testerGateEnabled` is always present in the response even for projects that saved settings before this field was added. If the merge is already done via `{ ...DEFAULT_SETTINGS, ...loaded }`, no change is needed — document the confirmation. If not, add the merge. (`src/main/index.ts`)

- [x] 4. **Read testerGateEnabled in the apply pipeline trigger** — in `src/renderer/src/lib/runner.ts` (or wherever the `apply feature:` pipeline sequence is orchestrated), after the implementer agent completes and before invoking the reviewer pipeline: read `settings.testerGateEnabled`. If true, invoke the `tester` agent. If the tester returns REVISE, re-invoke the implementer (increment a cycle counter; after 3 cycles, escalate with a gate-block message instead of re-running). If the tester returns APPROVED, continue to the reviewer pipeline as normal. (`src/renderer/src/lib/runner.ts`)

- [x] 5. **Update tester agent output signal** — in `.claude/agents/tester.md`, confirm the agent emits a machine-readable verdict line that the pipeline orchestrator can parse. The verdict line must be either `[tester-verdict] APPROVED` or `[tester-verdict] REVISE — <reason>`. If the agent currently emits a free-form report with no parseable verdict signal, add the `## Output signal` section specifying this format. (`.claude/agents/tester.md`)

- [x] 6. **Add `[tester-verdict]` classifier to onStdout in App.svelte** — in `src/renderer/src/App.svelte`, in the `onStdout` handler, add a classifier for lines starting with `[tester-verdict]`. Parse the verdict (APPROVED / REVISE). Store it in a reactive location the pipeline orchestrator in runner.ts can read (e.g. a new field on the run store or a module-level variable in runner.ts). Do NOT write the raw signal line to the terminal — instead write a human-readable summary line (e.g. "Tester: APPROVED" or "Tester: REVISE — <reason>"). (`src/renderer/src/App.svelte`)

- [x] 7. **Update GENERAL.md signal protocol entry** — in `docs/gotchas/GENERAL.md`, in the `## Signal protocol` section, add `[tester-verdict]` to the list of current signals with the description: "emitted by the tester agent; parsed by the pipeline orchestrator to determine whether to proceed to review or re-invoke the implementer". (`docs/gotchas/GENERAL.md`)

### Research needed
- How the current `apply feature:` pipeline is sequenced in `runner.ts` — specifically whether agent invocations are chained by `[suggest]` signal or by explicit orchestration logic. This determines where the tester gate conditional fits.
- Whether the run store already has a field for cycle counting (reviewer → implementer loops) that could be reused for the tester → implementer loop, or whether a separate counter is needed.

---

### [x] Feature: Memory Scaffolding on Project Creation/Import

When a new project is created (scaffold) or an existing project is imported, automatically create a `memory/` directory under `.claude/` and populate it with starter memory files. No renderer UI changes beyond what the existing scaffold/import flow already does.

**Design decisions baked into this plan (from user answers):**

- **Memory file set**: three files — `user.md` (who the user is / preferences), `project.md` (project context, stack, key files), `MEMORY.md` (index of the other memory files, with one-line descriptions). All pre-populated with placeholder prompts, not blank.
- **Placement**: memory files live at `.claude/memory/` inside the project folder (same location FORGE uses for its own memory).
- **On import**: copy-if-absent — if `.claude/memory/` already exists in the imported project, do not overwrite. If it does not exist, create it with the starter files.
- **Template source**: starter files live in `template/.claude/memory/` and are copied by the scaffold/import handlers in `src/main/index.ts`.

---

- [x] 1. **Create starter memory files in `template/.claude/memory/`** — create three files: (a) `template/.claude/memory/MEMORY.md` — an index file listing `user.md` and `project.md` with one-line descriptions and a note that agents read this index first; (b) `template/.claude/memory/user.md` — placeholder content prompting the user to fill in their role, preferences, and working style; (c) `template/.claude/memory/project.md` — placeholder content prompting the user to fill in the project name, tech stack, key files, and any constraints. (`template/.claude/memory/`)

- [x] 2. **Update scaffold-project handler to copy memory files** — in `src/main/index.ts`, in the `ipcMain.handle('scaffold-project', ...)` handler, after the agents copy step: (a) `mkdirSync(join(targetFolder, '.claude', 'memory'), { recursive: true })`; (b) copy all files from `path.join(app.getAppPath(), 'template', '.claude', 'memory')` to `join(targetFolder, '.claude', 'memory')` using `fsPromises.cp` with `recursive: true`. Wrap in try/catch returning `{ ok: false, error }` on failure. (`src/main/index.ts`)

- [x] 3. **Update import-project handler to copy memory files (copy-if-absent)** — in `src/main/index.ts`, in the `ipcMain.handle('import-project', ...)` handler, after the agents copy step: check if `join(targetFolder, '.claude', 'memory')` exists. If it does not exist, create it and copy all three starter files from the template. If it does exist, skip — do not overwrite any existing memory files. (`src/main/index.ts`)

- [x] 4. **Update planner agent to reference memory files** — in `.claude/agents/planner.md`, in the `## Steps 1–3 (write the plan)` section, add a note in step 1: "If `.claude/memory/MEMORY.md` exists in the active project, read it before reading `docs/gotchas/GENERAL.md`. Memory files contain user preferences and project context that may affect how the plan is structured." (`.claude/agents/planner.md`)

### Research needed

- None. The scaffold and import handlers are confirmed in `src/main/index.ts` and the template directory structure is known.

---

### [x] Feature: Failed Test Feedback Loop

When the tester agent emits `[tester-verdict] REVISE`, capture the tester's full report and pass it as context to the re-invoked implementer agent, so the implementer knows exactly which tests failed and why — rather than re-running blind.

**Design decisions baked into this plan (from user answers):**

- **Feedback delivery**: append the tester report as a `## Tester Feedback` section at the end of `docs/handoff.md` before re-invoking the implementer (not passed as a prompt prefix or separate file).
- **Scope**: only the tester → implementer loop is in scope; reviewer → implementer feedback passing is a separate concern not addressed here.
- **Loop cap**: the existing 3-cycle cap from the Optional Tester Gate feature still applies; no change to the cap.

---

- [x] 1. **Capture tester report text during pipeline execution** — in `src/renderer/src/lib/runner.ts` (or the equivalent pipeline orchestrator), when the tester agent completes and the `[tester-verdict] REVISE` signal is received, collect the full terminal output from the tester agent's run (i.e. all lines emitted by the tester agent between its start and the verdict signal). Store this as a string in the run state or a local variable accessible to the re-invocation step. (`src/renderer/src/lib/runner.ts`)

- [x] 2. **Write tester feedback to `docs/handoff.md` before re-invoking implementer** — in `src/renderer/src/lib/runner.ts`, before re-invoking the implementer after a REVISE verdict: call an IPC function to append a `## Tester Feedback` section to `docs/handoff.md`. The section must contain: the cycle number (e.g. "Cycle 2 of 3"), the tester verdict line, and the captured tester report text from task 1. Use the existing `write-file` or equivalent IPC channel — do not create a new channel for this. (`src/renderer/src/lib/runner.ts`, `src/main/index.ts`)

- [x] 3. **Instruct implementer to read tester feedback section** — in `.claude/agents/implementer.md`, add a note to the `## Before you start` or equivalent pre-read section: "If `docs/handoff.md` contains a `## Tester Feedback` section, read it first. It contains the tester agent's report from the previous cycle. Address every listed issue before writing new code." (`.claude/agents/implementer.md`)

### Research needed
- Whether `runner.ts` currently exposes a way to subscribe to per-agent terminal output (i.e. lines from a specific agent's run window), or whether all terminal lines are mixed into a single stream that would require tagging to separate tester output from other agent output.
- Whether `docs/handoff.md` is overwritten on each implementer invocation (which would erase the tester feedback section) or whether the implementer appends to it. If overwritten, the feedback must be stored elsewhere (e.g. `docs/tester-feedback.md`) and the implementer instructed to read that file instead.

---
### [x] Feature: Auto-Audit Pipeline

Three-part feature: (1) add `tool-call-auditor` as the last agent in every pipeline after `documenter` (skip tester per project convention); (2) update `tool-call-auditor.md` to track recurrence across `audit-log.jsonl` history and only flag patterns that appear in 3+ sessions; (3) new `agent-optimizer.md` that reads recurring patterns from `audit-log.jsonl`, maps each to the responsible agent file, reads that agent's `.md`, and writes a targeted prompt fix — routes its output as a handoff through Gate #2 so the user approves the agent diff before it is applied; conditional trigger: optimizer only runs if the auditor finds at least one recurring pattern.

---

- [ ] 1. **Update `tool-call-auditor.md` — add recurrence tracking across audit-log.jsonl history** — remove the current "You are manual-only" declaration in `.claude/agents/tool-call-auditor.md`. Add a new `## Step 3b — Recurrence check` section after existing Step 3: read all lines from `docs/audit-log.jsonl` (not just the current-session entries), group findings by `type + "|" + detail` key, count the number of distinct `session` values per key, and mark each finding as `recurring: true` if its key appears in 3 or more distinct sessions. Emit only `recurring: true` findings as actionable; log the rest as suppressed. Update the Step 4 threshold description to note that single-session patterns are not flagged. Add a `recurring` boolean field to the finding shape in all build-finding examples. Update the `## Step 6 — Print summary` section to print recurring vs non-recurring counts separately. (`.claude/agents/tool-call-auditor.md`)

- [ ] 2. **Update `tool-call-auditor.md` — remove manual-only restriction and define auto-trigger output signal** — still in `.claude/agents/tool-call-auditor.md`, add an `## Output signal` section at the bottom. When run as part of a pipeline: if at least one recurring pattern was found, emit `[auditor-recurring] <count>` on its own line so the orchestrator can conditionally branch to the agent-optimizer. If no recurring patterns were found, emit `[auditor-clean]`. This signal is consumed by the CLAUDE.md orchestrator; it must not appear in the terminal. (`.claude/agents/tool-call-auditor.md`)

- [ ] 3. **Create `agent-optimizer.md`** — write a new agent file at `.claude/agents/agent-optimizer.md`. The agent: (a) reads `docs/audit-log.jsonl`, collects all entries where `recurring: true`, groups by `type`; (b) maps each finding type to the responsible agent using a hardcoded routing table (REPEATED-READ → researcher; REPEATED-GREP → researcher; TOOL-STORM → whichever agent generated the most calls, determined by reading `agent_type` fields from the session logs; BLIND-WRITE → implementer or coder depending on the session context; ROLE-VIOLATION → the specific `agent_type` from the finding detail); (c) for each responsible agent, reads `.claude/agents/<agent>.md`; (d) drafts a targeted one-paragraph prompt addition that would prevent the anti-pattern, citing the specific finding; (e) writes all proposed changes as a structured diff to `docs/context/handoff.md` under a `# Handoff: Agent Optimizer` heading, one section per agent file. Uses only `Read` and `Write` tools. Runs on Haiku model. (`.claude/agents/agent-optimizer.md`) (wave: 1)

- [ ] 4. **Update both CLAUDE.md templates to add `tool-call-auditor` after `documenter` in apply pipelines** — in `templates/code/CLAUDE.md`, add `4. **tool-call-auditor** — audits tool-call patterns from the session; if at least one recurring pattern is found (`[auditor-recurring]`), invoke **agent-optimizer** to propose targeted agent prompt fixes routed through Gate #2` to the `apply feature:`, `apply debug:`, and `apply refactor:` pipeline sequences after `documenter`. Mirror the same change in `templates/instructional/CLAUDE.md` for all applicable pipelines (implement pipeline only — no apply step in instructional). (`templates/code/CLAUDE.md`) (wave: 1)

- [ ] 5. **Update `templates/instructional/CLAUDE.md` to add `tool-call-auditor` after the implement pipeline reviewers** — in `templates/instructional/CLAUDE.md`, append `tool-call-auditor` as the last step in the `implement feature:` pipeline after all reviewers complete; add the same conditional branch to `agent-optimizer` if `[auditor-recurring]` is emitted. (`templates/instructional/CLAUDE.md`) (wave: 1)

- [ ] 6. **Add `[auditor-recurring]` and `[auditor-clean]` to the signal protocol in `docs/gotchas/GENERAL.md`** — in the `## Signal protocol` section, add `[auditor-recurring]` and `[auditor-clean]` to the list of current signals with their format and purpose: `[auditor-recurring] <count>` — emitted by tool-call-auditor when at least one finding has appeared in 3+ sessions; consumed by the orchestrator to conditionally invoke agent-optimizer. `[auditor-clean]` — emitted when no recurring patterns exist; no further action required. (`docs/gotchas/GENERAL.md`) (wave: 2)

- [ ] 7. **Register `agent-optimizer` in `agent-roles.json` with `readonly: false` and `allowedPaths` restricted to `docs/context/**`** — the agent-optimizer writes only to `docs/context/handoff.md` and reads agent `.md` files; add an entry in `.pipeline/agent-roles.json` (if file exists) with `"allowedPaths": ["docs/context/**"]` to keep it within its role boundary. If `.pipeline/agent-roles.json` does not yet exist, note this as a research item. (`.pipeline/agent-roles.json`) (wave: 2)

### Design decisions (resolved by reviewer-logic feedback)

- **Recurrence threshold (3 sessions):** Starting point based on signal/noise tradeoff — 1-2 occurrences can be coincidental; 3+ across distinct sessions indicates a persistent pattern. Tunable in a follow-up if needed.
- **agent-optimizer missing agent files:** If routing maps a finding to an agent `.md` that does not exist, skip that entry gracefully and note it in the handoff output as "agent file not found — skipping". Do not abort.
- **Manual mode preserved:** `tool-call-auditor` can still be invoked manually via `direct: audit tool calls`. Auto mode adds the output signals on top; manual mode continues to print summary to stdout without emitting signals.
- **`[auditor-clean]` visibility:** Print as a terminal info line `Audit complete — no recurring patterns.` so users can see it ran. The orchestrator consumes it silently (no branch taken).
- **Applying agent `.md` diffs after Gate #2:** The implementer handles this — agent `.md` files are treated the same as source files. The optimizer's handoff lists the exact old/new text for each agent file. Implementer applies via Edit tool.
- **Hardcoded routing table:** Known limitation — documented as a maintenance note. When new agent types are added, the routing table in `agent-optimizer.md` must be updated manually. A follow-up task can move it to a config file if the table grows.
- **Orchestrator branching:** `[auditor-clean]` → pipeline ends; `[auditor-recurring]` → invoke agent-optimizer → its output routes through Gate #2 → if approved, invoke implementer to apply agent `.md` changes.

### Research resolved
- `.pipeline/agent-roles.json` exists. Schema: flat object, key = agent name, value = `{ readonly: true }` or `{ allowedPaths: string[] }`. `tool-call-auditor` is already registered; `agent-optimizer` entry must be added.
- Only two CLAUDE.md files exist, both in `templates/`. No project-root copy.
- `agent_type` IS written to every audit entry by `ctx-post-tool.js`. Falls back to `'orchestrator'` for top-level calls. Optimizer must handle `'orchestrator'` as unmappable (no agent `.md` to patch).

### [x] Feature: Planner Q&A Rationale Hints

When the planner emits a `[questions]` block, each option should carry a one-sentence rationale so the user can make an informed choice. The format extends the existing ` / ` separator syntax: each option becomes `label: rationale` (colon-space separator). Plain labels with no colon still work — backward compatible. The planner agent prompt, the question parser in `App.svelte`, the `PlannerQuestion` type in `ui.svelte.ts`, and the `PlannerQaStrip.svelte` UI are all updated.

---

- [x] 1. **Add `optionDescriptions` field to `PlannerQuestion` interface** (`src/renderer/src/stores/ui.svelte.ts`) (wave: 1)
- [x] 2. **Update question parser in `App.svelte` to split rationale from label** (`src/renderer/src/App.svelte`) (wave: 1)
- [x] 3. **Update `PlannerQaStrip.svelte` to display rationale text beneath each chip** (`src/renderer/src/components/prompt/PlannerQaStrip.svelte`) (wave: 2)
- [x] 4. **Update planner agent prompt to document rationale format** (`.claude/agents/planner.md`) (wave: 1)

### Research needed
- None.

### [x] Feature: Project References — Phase A (data layer + new component)

Add the `ReferenceEntry` type and `references` array to the data layer and build the reusable entry-editor component. Phase B wires the component into the wizard and settings flows.

- [x] 1. Add `ReferenceEntry` interface and widen `ProjectJson` in `src/renderer/src/types/claude.d.ts`: export `interface ReferenceEntry { type: 'url' | 'note' | 'path'; label?: string; value: string }`; add `references?: ReferenceEntry[]` to `ProjectJson` (optional, backward-compatible); update `ClaudeAPI.writeProjectJson` `data` parameter to include `references?: ReferenceEntry[]`; update `ClaudeAPI.readProjectJson` return type to include `references?: ReferenceEntry[]` (`src/renderer/src/types/claude.d.ts`) (wave: 1)

- [x] 2. Update `read-project-json` and `write-project-json` handlers in `src/main/handlers/project-json.ts`: in `read-project-json`, extract `references` from parsed JSON — validate it is an array and each entry is an object with a valid `type` field (`'url' | 'note' | 'path'`) and a non-empty string `value`; silently drop entries that fail validation; include the filtered array in the return value (omit the field if the array is empty or absent); in `write-project-json`, widen the accepted `data` type to include `references?: Array<{ type: string; label?: string; value: string }>` — validate each entry before writing (same rules as read) and strip invalid entries rather than rejecting the whole write; the existing `resolve() + startsWith()` path guard is unchanged (`src/main/handlers/project-json.ts`) (wave: 1)

- [x] 3. Update `writeProjectJson` wrapper in `src/renderer/src/lib/ipc.ts` to accept `references?: ReferenceEntry[]` in its `data` parameter type alongside `techStacks`, `techStackLabels`, and `structure` (`src/renderer/src/lib/ipc.ts`) (wave: 1)

- [x] 4. Update `buildSystemPromptAppend` in `src/main/shared.ts` to read `references` from `.pipeline/project.json` after reading `structure`; apply the same object narrowing and array validation used in the handler (check `Array.isArray`, each entry has `type` in `['url','note','path']` and non-empty `value`); if at least one valid reference exists, append a `## References` block after the existing structure context line and before the SKILLS.md content — format each entry as: URL → `- [${label ?? value}](${value})`; note → `- Note: ${value}`; path → `- Local path: ${label ? label + ' — ' : ''}${value}`; strip newlines from label and value before interpolation (per the YAML injection gotcha in GENERAL.md); when no valid references are present, do not add the block (`src/main/shared.ts`) (wave: 1)

- [x] 5. Create `src/renderer/src/components/overlays/wizard/WizardStepReferences.svelte`: renders a list of the current `references` entries with add/remove controls; accepts props `references: ReferenceEntry[]` and `onreferenceschange: (refs: ReferenceEntry[]) => void`; the add form has a type selector (`URL` / `NOTE` / `PATH`) rendered as three tab-style buttons, a `value` text input (required), and an optional `label` text input; the PATH type shows a `BROWSE FOLDER` button (label must be exactly "BROWSE FOLDER" — `window.claude.browse()` accepts no arguments and always returns a folder path, not a file path) that calls `window.claude.browse()` and assigns the result to the value input; clicking ADD appends a new entry; each existing entry renders its type badge, label (if set), value (truncated at 60 chars), and a `x` remove button; the section is headed "REFERENCES (optional)" with a subtitle "Attach docs, links, or local paths for agents to reference"; style using existing CSS custom properties (`--card`, `--border`, `--gold`, `--dim`, `--font-mono`, `--font-label`) (`src/renderer/src/components/overlays/wizard/WizardStepReferences.svelte`) (wave: 2)

### Research needed
- None — research confirmed: `window.claude.browse()` is folder-only (no file-mode argument); the `write-project-json` handler writes the full `data` object as-is (no read-before-write), so callers that need to preserve existing fields must read then merge before writing. Both findings are incorporated directly into the task descriptions above.

---

### [x] Feature: Project References — Phase B (wizard + settings integration)

Wire `WizardStepReferences` into the new-project wizard, import wizard, and Settings modal. Depends on Phase A being applied first.

- [x] 1. Update `WizardModal.svelte` to insert the REFERENCES step: code path becomes 0 TYPE → 1 DESCRIBE → 2 STACK → 3 SKILLS → 4 STRUCTURE → 5 REFERENCES → 6 CREATE; non-code path becomes 0 TYPE → 1 DESCRIBE → 2 STRUCTURE → 3 REFERENCES → 4 CREATE; extend the `step` union type from `0|1|2|3|4|5` to `0|1|2|3|4|5|6`; update `createStep` derived: `isNonCodePath ? 4 : 6`; add `let references = $state<ReferenceEntry[]>([])`; reset `references` to `[]` in `selectType()` alongside other resets; add `{:else if step === referencesStep}` block rendering `WizardStepReferences` with `{references}` and `onreferenceschange={(v) => (references = v)}`; add REFERENCES to both breadcrumb strips (between STRUCTURE and CREATE); update STRUCTURE's CONTINUE to call a new `advanceToReferences()` helper (not `advanceToCreate()`) so the step increments to the REFERENCES step rather than skipping to CREATE; update CREATE back button: `step = isNonCodePath ? 3 : 5`; in `create()`, include `references` in the `writeProjectJson` call alongside `techStacks`, `techStackLabels`, and `structure`; import `WizardStepReferences` and `ReferenceEntry` type at the top of the file (`src/renderer/src/components/overlays/wizard/WizardModal.svelte`) (wave: 1)

- [x] 2. Update `ImportModal.svelte` to insert the REFERENCES step between STRUCTURE (step 3) and ONBOARDING: flow becomes 1 BROWSE → 2 REVIEW → 3 STRUCTURE → 4 REFERENCES → 5 ONBOARDING; extend the `step` type union from `1|2|3|4` to `1|2|3|4|5`; move ONBOARDING to step 5; add `let references = $state<ReferenceEntry[]>([])`; reset `references` to `[]` when `browse()` starts a new import; insert step 4 block rendering `WizardStepReferences`; update the breadcrumb strip to show `1 BROWSE › 2 REVIEW › 3 STRUCTURE › 4 REFERENCES › 5 ONBOARDING`; update `startOnboarding()` to gate on `step === 5`; in `runOnboarding()`, include `references` in the `writeProjectJson` call after `structure`; import `WizardStepReferences` and `ReferenceEntry` at the top of the file (`src/renderer/src/components/overlays/ImportModal.svelte`) (wave: 1)

- [x] 3. Add "Edit References" section to `SettingsModal.svelte`: add `let references = $state<ReferenceEntry[]>([])` and `let refsFolder = $state('')`; add a separate `$effect` that watches `draft.projectFolder` and calls `ipc.readProjectJson(draft.projectFolder)` to load `references` into local state (guard on non-empty `projectFolder`; keep this effect separate from the existing settings-load effect); add a new `.field` block labelled "PROJECT REFERENCES" after the WORKFLOW GUARD toggle and before the `{#if error}` block — render the current references count as a hint line (`N references attached`), and an "EDIT REFERENCES" button styled like the `import-btn`; clicking the button toggles `let showRefEditor = $state(false)`; when `showRefEditor` is true, render `WizardStepReferences` inline with `{references}` and `onreferenceschange`; add a "SAVE REFERENCES" button inside the expanded editor that first calls `ipc.readProjectJson(draft.projectFolder)` to load the full existing project.json, then calls `ipc.writeProjectJson(draft.projectFolder, { ...existingProjectJson, references })` — this read-then-merge pattern is required because the write handler overwrites the whole file and existing fields (`techStacks`, `techStackLabels`, `structure`) must be preserved; show a brief success/error message after save; import `WizardStepReferences` and `ReferenceEntry` at the top of the file, and ensure `readProjectJson` and `writeProjectJson` are imported from `../../lib/ipc` (`src/renderer/src/components/overlays/SettingsModal.svelte`) (wave: 1)

### Research needed
- None — all research findings from the original single-phase plan are resolved and incorporated: `window.claude.browse()` is folder-only (BROWSE FOLDER label applied in Phase A); write handler overwrites whole file so SettingsModal must read-then-merge (explicit in task 3 above); wizard step number arithmetic verified against the Phase A STRUCTURE step numbering already committed to Phase 2 of Project Structure Guidance.

### [x] Feature: Architect Pipeline Gate

Add a `reviewer-logic` pass after the architect agent, a Gate #1 approval step for health findings, register `architect` as a named pipeline mode in PIPELINES/MODES/AGENT_META, update `gateDetector.ts` and `App.svelte` to handle the new mode, update the architect agent prompt to clarify the verification protocol is pre-wired, and document the new pipeline mode in GENERAL.md.

- [x] 1. Add `'architect'` pipeline entry to `PIPELINES`, `MODES`, and `PipelineId` in `src/renderer/src/lib/constants.ts`: add `'architect'` to the **`MODES` const array** (lines 60-71) — `'architect'` is a NEW mode added ALONGSIDE the existing `'direct'` entry; `'direct'` remains unchanged and serves a separate purpose (general chat/passthrough); the MODES array grows from 10 to 11 entries; this makes `ModeId` (typed as `typeof MODES[number]`) include `'architect'` — without this, `triggerRun(cmd, 'architect')` fails TypeScript type-checking; also add `'architect'` to the `PipelineId` union type; add a `PIPELINES['architect']` entry with `agents: ['architect', 'reviewer-logic']`, `gate: 1`, and `color: 'var(--gold)'` (`src/renderer/src/lib/constants.ts`) (wave: 1)

- [x] 2. Update `gateDetector.ts` AND add `'architect'` to `gateableModes` in `App.svelte`: (a) in `src/renderer/src/lib/gateDetector.ts` add an `else if (mode === 'architect')` branch in `detectGates()` that calls `gateStore.showGate1(summary, 'var(--gold)')` — the architect agent does NOT emit `[summary]` signals so `pendingGateSummary` will always be empty; pass a fixed string directly: `gateStore.showGate1('Architect findings ready for review — approve to accept, or dismiss to discard.', 'var(--gold)')` — do NOT call `extractSummary(buffer, 3)` for this branch; (b) in `src/renderer/src/App.svelte` line 405 add `'architect'` to the `gateableModes` array so `detectGates` is actually called for architect runs — without this addition gate detection is never triggered (`src/renderer/src/lib/gateDetector.ts`, `src/renderer/src/App.svelte`) (wave: 2)

- [x] 3. Verify `architect` mode is not blocked by early-exit guards in `App.svelte` `[todo]` signal parser (`src/renderer/src/App.svelte`): **investigation confirmed no early-exit guards exist** in the `onStdout` `[todo]` parser that would block architect mode — the `HIGH: / MEDIUM: / LOW:` prefix parsing (lines 206-210) is reached for all modes. This task is verification-only: confirm no guard gates architect out of the `[todo]` or `[health]` classifiers; if none found, **no code change is needed** (`src/renderer/src/App.svelte`) (wave: 2)

- [x] 4. ~~Update `run.svelte.ts` to accept `'architect'` as a valid mode value~~ — **no-op**: `RunState.mode` is typed as `string` (not a union), so no type guard or switch/if chain in the run store will reject `'architect'`; this task is fully satisfied by adding `'architect'` to `PIPELINES` in task 1.

- [x] 5. Add `reviewer-logic` prompt section to `.claude/agents/reviewer-logic.md`: add a new `## Architect health review` section that instructs the reviewer, when invoked after an architect run, to: (a) for each `[health]` signal mentioning a dead-code or unused-export finding, re-run all four verification checks from the architect dead-code protocol (channel name string, wrapper function name, type/interface name, prop name) using Grep against `src/`; (b) if any finding fails verification, emit a `[health]` signal with `aspect: integrity` and `severity: high` noting the false positive; (c) emit `[reviewer-verdict]` JSON with `agent: 'reviewer-logic'`, `verdict: APPROVED` if all findings verified, `verdict: REVISE` if any false positive detected (`.claude/agents/reviewer-logic.md`) (wave: 1)

- [x] 6. Update the `## Pipeline modes and their gate numbers` table in `docs/gotchas/GENERAL.md`: add a row for `architect` mode with pipeline agents `architect, reviewer-logic` and gate `#1`; update the prose note about direct/explore to clarify that architect now runs as a named pipeline rather than a chat-mode passthrough (`docs/gotchas/GENERAL.md`) (wave: 1)

- [x] 7. Update Gate #1 YES-button logic in `src/renderer/src/components/gates/Gate1Bar.svelte`: there is no `applyPrompt` field in the gate store — import `getRunState` from `run.svelte.ts` and branch inside the `implement()` function: if `getRunState().mode === 'architect'`, call **only `hideGate1()`** with no prompt or mode changes and no `triggerRun()` call — this is safe because `Gate1Bar.svelte` does NOT call `triggerRun()` directly, and `setMode()` alone does NOT auto-trigger a run, so calling only `hideGate1()` fully stops all further action for the architect gate YES path; otherwise execute the existing path (setMode + setPrompt + hideGate1 + triggerRun) for non-architect modes (`src/renderer/src/components/gates/Gate1Bar.svelte`) (wave: 2)

- [x] 8. Fix the auto-run invocation in `src/renderer/src/App.svelte` to pass `'architect'` mode: at line 71 the `pendingArchitectRun` handler calls `triggerRun(cmd)` with no second argument, which defaults to `'explore'` mode and bypasses the reviewer-logic pipeline entirely; change the call to `triggerRun(cmd, 'architect')` so the full pipeline (architect, reviewer-logic, Gate #1) fires correctly (`src/renderer/src/App.svelte`) (wave: 3)

### Research needed
- `.claude/agents/reviewer-logic.md` — read the full file before implementing task 5 to confirm the existing section structure so the new `## Architect health review` section is appended in the correct position without duplicating existing logic.

### [x] Feature: Virtualized Pipelines — Wave Compatibility Audit & Fix

**Audit findings (2026-03-24):**

1. `[wave-complete] N` correctly falls through to `runBuffer` and the terminal per GENERAL.md. The implementer agent reads wave annotations from `docs/context/handoff.md` directly — the renderer runner (`triggerRun` / `ipc.run`) is wave-agnostic and requires no changes. No data is lost.
2. `[blocked] Wave N task X — ...` similarly falls through to `runBuffer` and the terminal. The `GATE2_BLOCK_SIGNAL` check (`buffer.includes('BLOCK')`) is case-sensitive; `[blocked]` is all lowercase, so it never triggers the Gate #2 block state. However, `apply` pipelines (where implementer runs) are not in `gateableModes` so `detectGates` is never called — this is correct by design.
3. Gap: `lineClassifier.ts` classifies both `[wave-complete]` and `[blocked]` lines as `normal`. Users see them as plain text in the terminal. `[wave-complete]` should render as `system` (informational) and `[blocked]` should render as `error` (stop condition) to aid readability.
4. Gap: GENERAL.md signal table correctly documents the fallthrough, but does not note the line-type classification gap. Update needed.
5. No changes required to `runner.ts`, `gateDetector.ts`, `App.svelte`, or any IPC layer — the wave protocol is correctly wired end-to-end already.

- [x] 1. Add `[wave-complete]` and `[blocked]` classification to `classifyLine()` (`src/renderer/src/lib/lineClassifier.ts`) (wave: 1)
- [x] 2. Update GENERAL.md signal table to document the `system`/`error` line-type classification for `[wave-complete]` and `[blocked]` respectively (`docs/gotchas/GENERAL.md`) (wave: 1)

### [x] Feature: GSD Dimension 5 — Key Links Concreteness Check

- [x] 1. Add `## Key links concreteness check` section to `.claude/agents/gotcha-checker.md` with the connection-phrase scanner, the 10-word backtick-identifier window rule, and the WARNING format specified in the feature request
- [x] 2. Update the "WARNING issues" line in the `## Output format` section of `.claude/agents/gotcha-checker.md` to include `key links vague` as a recognised WARNING type

### Research needed
- None — the check is entirely text-processing logic applied to plan task descriptions; no external file reads required at check time.

### [x] Feature: Project Agent Slots Pipeline — Phase B (UI + runner)

- [x] 5. Create `AgentSlotsStep.svelte` wizard step component (`src/renderer/src/components/overlays/wizard/AgentSlotsStep.svelte`) (wave: 1)
  - Props: `detectedAgents: DetectedProjectAgent[]`, `onConfirm: (slots: AgentSlot[]) => void`
  - Render each detected agent as a card using `var(--card)` / `var(--border)` styling to match WizardStepReferences card style
  - Each card: agent name in `var(--font-label)`, truncated description (≤80 chars), enabled toggle (checkbox), hook dropdown listing all 6 `AgentSlotHook` values
  - Local `$state` array mirrors incoming `detectedAgents` as editable `AgentSlot[]`; use `$derived` for the confirm-ready guard
  - CONFIRM button calls `onConfirm` with current slot array; disabled when no agents are enabled
  - Import `AgentSlot`, `DetectedProjectAgent`, `AgentSlotHook` from `../../../types/claude`

- [x] 6. Wire `AgentSlotsStep` into `ImportModal.svelte` as step 3.5 between STRUCTURE and REFERENCES (`src/renderer/src/components/overlays/ImportModal.svelte`) (wave: 2)
  - Add `step` union to include `3.5` — or remap existing steps 1–5 to 1–6 to keep integer steps; pick the lowest-diff approach
  - Add `let detectedAgents = $state<DetectedProjectAgent[]>([])` and `let confirmedSlots = $state<AgentSlot[]>([])` at top of script
  - After `goToStructure()` advances to step 3 (STRUCTURE), add a `scanProjectAgents(sourceFolder)` call that resolves before the user reaches step 3.5; store result in `detectedAgents`; skip step 3.5 entirely if `detectedAgents.length === 0`
  - Import `AgentSlotsStep` and render it in the step chain; pass `detectedAgents` and an `onConfirm` handler that sets `confirmedSlots` and advances to REFERENCES
  - In `runOnboarding()` step (d) `writeProjectJson` call, add `agentSlots: confirmedSlots.length > 0 ? confirmedSlots : undefined` to the payload
  - Import `scanProjectAgents` from `../../lib/ipc`; import `AgentSlotsStep` from `./wizard/AgentSlotsStep.svelte`

- [x] 7. Extend `buildAgentsJson` in `src/main/shared.ts` to inject enabled project agent slots at their hook points (`src/main/shared.ts`) (wave: 1)
  - Add `export const HOOK_POINTS: AgentSlotHook[]` constant listing all 6 values in pipeline order: `BEFORE_PLAN`, `AFTER_RESEARCH`, `BEFORE_GATE1`, `AFTER_CODER`, `IN_REVIEW_WAVE`, `AFTER_IMPLEMENT`
  - Add `AgentSlotHook` and `AgentSlot` type imports from a shared location; because `shared.ts` is main-process only, define the types locally (copy from renderer types) or import from a co-located types file — do not import from renderer
  - Add optional parameter `agentSlots?: AgentSlot[]` to `buildAgentsJson` signature
  - After the project-agent override loop, iterate enabled slots; for each, attempt to read `<projectFolder>/.claude/agents/<agentName>.md`; if the file exists and was not already loaded via the project override loop, parse and add it to `agentMap` with a `_hookPoint` metadata annotation embedded in the description field (`[hook:HOOK_POINT] original description`) so the Claude CLI receives the agent and downstream tooling can detect slot membership
  - Never replace a FORGE core agent (name in `SCAFFOLD_AGENT_NAMES`) via slot injection — skip silently if names collide
  - `buildAgentsJson` callers in `src/main/handlers/runner.ts` must pass the `agentSlots` read from `<projectFolder>/.pipeline/project.json`; add a JSON read of `project.json` in the runner handler before calling `buildAgentsJson`

### [x] Feature: Pipeline Interactivity A+B

**A — Live pipeline progress chips**
**B — Collapsible agent output blocks**

- [x] 1. Read agent card statuses in `PipelineVisualiser.svelte` — import `getAgentsState` from `agents.svelte.ts` and derive per-node status (`pending` | `running` | `done` | `error` | `skipped`) by matching each `VisNode.agentId` against `state.cards` (`src/renderer/src/components/prompt/PipelineVisualiser.svelte`) (wave: 1)
- [x] 2. Add CSS classes for each status in `PipelineVisualiser.svelte` — `.status-running` (gold border + pulse animation), `.status-done` (green border + text), `.status-error` (red border + text), `.status-pending` (dim, no border change), `.status-skipped` (dim, strikethrough) using CSS custom properties only; remove the `activeNodeIndex`/`nodeOpacity` opacity approach once status classes handle dimming (`src/renderer/src/components/prompt/PipelineVisualiser.svelte`) (wave: 2)
- [x] 3. Add `collapsed` state and toggle handler in `Terminal.svelte` — declare `let collapsed = $state<Set<string>>(new Set())` and a `toggleBlock(key: string)` function that adds/removes from the set (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 1)
- [x] 4. Add block header element and collapse toggle to `Terminal.svelte` — render a clickable `<button class="block-toggle">` as the first child of each `.answer-block`; show a `▾`/`▸` caret; conditionally hide `.block-lines` wrapper with `display: none` when `collapsed.has(block.key)`; keep the Copy button always visible (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 2)
- [x] 5. Style block toggle in `Terminal.svelte` — `.block-toggle` as an unstyled pill button (monospace 8px, dim color, no background, cursor pointer); caret rotates 0°/−90° via CSS transition; `.block-lines` as a `<div>` wrapping the `{#each block.lines}` loop with `overflow: hidden` for collapse (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 3)

### [x] Feature: Shared StackSkillPicker Component

Three files were directly edited as a draft before the pipeline ran. The coder must read the current state of each file, verify correctness against the spec below, and produce a handoff listing any fixes applied.

- [x] 1. Read and audit `StackSkillPicker.svelte` (`src/renderer/src/components/overlays/wizard/StackSkillPicker.svelte`) — verify: (a) `StackOption` interface is exported from the component file and WizardModal imports it with `import type { StackOption }` — acceptable in Svelte 5 but confirm the build does not error; if it does, move the interface to `src/renderer/src/types/claude.d.ts`; (b) `$effect` that mirrors `selectedStack → searchQuery` does not create an infinite loop (guard: `searchQuery !== selectedStack`); (c) `onmousedown` on dropdown items fires before `onblur`; (d) `handleSearchBlur` uses `setTimeout(..., 150)` (wave: 1)
- [x] 2. Read and audit `WizardModal.svelte` (`src/renderer/src/components/overlays/WizardModal.svelte`) — verify: (a) step 2 renders `StackSkillPicker` + inline memory-context fields; (b) old `WizardStepStack` and `WizardStepSkills` imports are removed; (c) `confirmStack()` advances to step 3 (STRUCTURE); (d) step header breadcrumb shows `2 STACK › 3 STRUCTURE › 4 REFERENCES › 5 CREATE`; (e) `$effect` for `checkSkillsTemplate` is in WizardModal (not inside picker), guards on `step !== 2` and `isNonCodePath`; (f) handler functions are named `handleBackdropClick` and `handleKeydown`; (g) `createStep` derived value is `isNonCodePath ? 4 : 5` (wave: 1)
- [x] 3. Read and audit `ProjectOverviewModal.svelte` (`src/renderer/src/components/overlays/ProjectOverviewModal.svelte`) — verify: (a) `isAddingStackMode` flag controls the expand/collapse of the `StackSkillPicker` panel; (b) `$effect` for `checkSkillsTemplate` guards on `!newStack || !isAddingStackMode`; (c) `addStack()` calls `ipc.generateSkillsForStack` when `!newStackSkillsExists && newStackGenerateSkills`; (d) the old free-text `newStackInput` field and plain ADD button are fully removed from the template; (e) `StackSkillPicker` is passed `selectedStack={newStack}` and both handler callbacks; (f) no hint text telling users to "generate skills via DIRECT mode" remains (wave: 1)
- [x] 4. Delete `WizardStepStack.svelte` and `WizardStepSkills.svelte` — confirm neither file is imported anywhere before deleting (`src/renderer/src/components/overlays/wizard/WizardStepStack.svelte`, `src/renderer/src/components/overlays/wizard/WizardStepSkills.svelte`) (wave: 2)
- [x] 5. Apply any fixes found in tasks 1–3 to the respective files; document each fix in the handoff; if no fixes are needed for a file, note it as "verified clean" (wave: 2)
- [x] 6. Verify TypeScript build compiles without errors by checking for any type errors introduced by the `StackOption` interface export or the new `isAddingStackMode` picker wiring; fix any type errors (`src/renderer/src/components/overlays/wizard/StackSkillPicker.svelte`, `src/renderer/src/types/claude.d.ts` if interface move is needed) (wave: 3)

### [x] Feature: SKILLS tab in FORGE SETTINGS — show generated stack templates — priority: MEDIUM

The SKILLS tab currently reads `appRoot/docs/gotchas/SKILLS.md` (FORGE's own skills file for developing FORGE itself) via the `get-forge-skills` IPC handler. Generated stack skills live in `appRoot/templates/<stack>/docs/gotchas/SKILLS.md` — a different location. The tab needs to also enumerate these template directories.

Required changes:
1. New IPC handler `get-stack-templates` (in `pipeline-data.ts`): reads all `appRoot/templates/*/docs/gotchas/SKILLS.md` files, returns `{ stacks: Array<{ name: string; content: string }> }`
2. Wire through preload, claude.d.ts, ipc.ts (standard quad)
3. Update `SettingsModal.svelte` SKILLS tab: load stack templates alongside FORGE's own SKILLS.md; show each stack as a collapsible card (same pattern as existing); stack name derived from the directory name (e.g. `templates/Lua/` → "Lua")

Note: `saveSkillsTemplate` already writes generated skills into this directory — so any stack the user has generated will automatically appear once this tab is wired up.

### [x] Feature: Terminal Code Writes — Show file content inline in terminal output

- [x] 1. Add `showCodeWrites` to `DEFAULT_SETTINGS` and `Settings` type (`src/renderer/src/lib/constants.ts` and `src/renderer/src/types/claude.d.ts`) (wave: 1)
- [x] 2. Add `fileContent?: string` and `fileTruncated?: boolean` fields to `AgentProgress` interface (`src/renderer/src/types/claude.d.ts`) (wave: 1)
- [x] 3. Add `'code-write'` to the `LineType` union and a new `CodeWriteLine` interface extending `TerminalLine` with `codeContent: string`, `truncated: boolean`, `expanded: boolean`, `linesTotal: number` to `session.svelte.ts`; add `appendCodeWriteLine(filePath, content, linesTotal, truncated)` action (`src/renderer/src/stores/session.svelte.ts`) (wave: 1)
- [x] 4. Extend `formatProgressLabel` in `shared.ts` to pass `fileContent` and `fileTruncated` for `Write` (truncate to 50 lines) and `Edit` (extract `new_string`, truncate to 50 lines) tool calls, alongside the existing return shape (`src/main/shared.ts`) (wave: 1)
- [x] 5. In `runner.ts`, pass the full `input` object through to `formatProgressLabel` (already done); update the `claude-progress` IPC event payload to include `fileContent` and `fileTruncated` from `formatProgressLabel`'s return value (`src/main/handlers/runner.ts`) (wave: 2)
- [x] 6. Expose `fileContent` and `fileTruncated` fields on the `claude-progress` IPC event through the preload bridge — no new channel needed, update the existing `onProgress` callback type in `src/preload/index.ts` to reflect the richer payload (`src/preload/index.ts`) (wave: 2)
- [x] 7. Update the `onProgress` handler in `App.svelte` to check `session.getSettings().showCodeWrites` and, when enabled, call `session.appendCodeWriteLine(...)` after appending the normal `tool` line (`src/renderer/src/App.svelte`) (wave: 3)
- [x] 8. Render `code-write` lines in `Terminal.svelte`: add an inline collapsible code block beneath `tool` progress lines; expanded by default; toggled per-line via local `Set<number>`; show first 50 lines + "show N more lines" expander when `truncated === true` (`src/renderer/src/components/terminal/Terminal.svelte`) (wave: 4)
- [x] 9. Add the `showCodeWrites` toggle to `SettingsModal.svelte` in the BEHAVIOUR section with label "Show file writes inline" and persist via existing `updateSetting` + `saveSettings` flow (`src/renderer/src/components/overlays/SettingsModal.svelte`) (wave: 3)

### Research needed
- Confirm that `Terminal.svelte` renders lines via `line.type` CSS class only — the `CodeWriteLine` interface must be storable in `state.lines: TerminalLine[]`; confirm whether the array type needs widening to `(TerminalLine | CodeWriteLine)[]` or whether structural compatibility (extra fields) allows it to fit without union.
- Confirm the `claude-progress` IPC event payload shape: does `preload/index.ts` expose the raw event data as-is, or does it remap fields? If remapped, the new `fileContent`/`fileTruncated` fields must be added there too.
- Confirm `Write` tool input field name is `content` (not `new_content`) and `Edit` tool input field name is `new_string` — these are well-known Claude tool names but the exact input schema should be verified against a live run log.

### [x] Feature: GENERAL.md injected via --append-system-prompt (eliminate per-agent tool reads)

> **Scope revised after gotcha-checker REVISE verdict:** `--append-system-prompt` only reaches the orchestrator process, not Task-spawned subagents. Agent-prompt strip tasks would be a regression. Scope is orchestrator-only: extend `buildSystemPromptAppend` in `src/main/shared.ts` to prepend GENERAL.md before SKILLS.md, with a graceful fallback if GENERAL.md is absent. No agent `.md` files are modified in this feature.

- [x] 1. In `buildSystemPromptAppend`, read `docs/gotchas/GENERAL.md` from the project folder (using the same `projectFolder` path already used for SKILLS.md lookup), prepend its content before the SKILLS.md content, and return the combined string (`src/main/shared.ts`)
- [x] 2. Add a guard in `buildSystemPromptAppend`: if GENERAL.md is absent or unreadable, log a warning to stderr and continue — return only the SKILLS.md content so the function degrades gracefully without breaking the run (`src/main/shared.ts`)
- [x] 3. Update the JSDoc comment on `buildSystemPromptAppend` to document that GENERAL.md is now prepended before SKILLS.md content, and that absence of GENERAL.md is a non-fatal condition (`src/main/shared.ts`)

### Research needed
- No open questions. All three tasks are confined to `src/main/shared.ts` and the architectural constraint (orchestrator-only reach of `--append-system-prompt`) is confirmed by the research report.

### [x] Feature: Pipeline Mode and Tester Mode Settings

Add `pipelineMode` (`lean` | `standard` | `full`, default `standard`) and `testerMode` (`off` | `ask` | `on`, default `ask`) as per-project settings. Both fields are stored in `.pipeline/project.json`, surfaced in a new `PipelineSettingsRow` component between ModeRow and the textarea, mirrored in `ProjectOverviewModal`, read at spawn time and prepended to `--append-system-prompt`, and taught to CLAUDE.md as explicit routing tables.

- [x] 1. Extend `read-project-json` and `write-project-json` handlers to include `pipelineMode` and `testerMode` fields: add validation constants `VALID_PIPELINE_MODES = new Set(['lean', 'standard', 'full'])` and `VALID_TESTER_MODES = new Set(['off', 'ask', 'on'])`; read both fields from parsed JSON with fallback to `undefined`; include both in the write payload when present and valid; strip any invalid value silently (`src/main/handlers/project-json.ts`) (wave: 1)

- [x] 2. Update `buildSystemPromptAppend` in `src/main/shared.ts` to accept two optional extra parameters `pipelineMode?: 'lean' | 'standard' | 'full'` and `testerMode?: 'off' | 'ask' | 'on'`; when either is provided, prepend `PIPELINE MODE: <UPPER>` and/or `TESTER MODE: <UPPER>` as the first two lines of the returned string (before the SKILLS.md content), separated from the skills content by a blank line (`src/main/shared.ts`) (wave: 1)

- [x] 3. Update the runner handler to read `pipelineMode` and `testerMode` from `.pipeline/project.json` at spawn time (before building the spawn args), then pass both values to `buildSystemPromptAppend` so they are included in `--append-system-prompt` (`src/main/handlers/runner.ts`) (wave: 2)

- [x] 4. Add `pipelineMode` and `testerMode` to the `ProjectJson` interface in `src/renderer/src/types/claude.d.ts`; update the `readProjectJson` return type and `writeProjectJson` parameter type to include both optional fields (`src/renderer/src/types/claude.d.ts`) (wave: 1)

- [x] 5. Add IPC wrapper functions `setPipelineModeIpc(projectFolder, pipelineMode)` and `setTesterModeIpc(projectFolder, testerMode)` to `src/renderer/src/lib/ipc.ts`; these call `writeProjectJson` with the full current project.json payload plus the updated field (`src/renderer/src/lib/ipc.ts`) (wave: 2)

- [x] 6. Add `pipelineMode: 'lean' | 'standard' | 'full'` and `testerMode: 'off' | 'ask' | 'on'` to `ProjectState` in `src/renderer/src/stores/project.svelte.ts` with defaults `'standard'` and `'ask'`; add `setPipelineMode(mode, projectFolder)` and `setTesterMode(mode, projectFolder)` action functions that write to project.json via IPC then update the store; extend the existing `$effect` that loads project data on folder change to also load both fields from the `readProjectJson` result (`src/renderer/src/stores/project.svelte.ts`) (wave: 2)

- [x] 7. Create `src/renderer/src/components/prompt/PipelineSettingsRow.svelte`: render `MODE ? [LEAN][STD][FULL]` and `TESTS ? [OFF][ASK][ON]` segmented controls in a single row (~32px height); labels in `--dim` small uppercase; active segment uses `--gold` border and color with 10% gold background matching ModeRow style; `?` buttons show an absolute-positioned tooltip card above on hover; read current values from `project.svelte.ts` store and call `setPipelineMode` / `setTesterMode` setters on click; tooltip text as specified in the feature description (`src/renderer/src/components/prompt/PipelineSettingsRow.svelte`) (wave: 3)

- [x] 8. Mount `PipelineSettingsRow` in `src/renderer/src/components/prompt/PromptBar.svelte` between the `ModeRow` component and the textarea element; import the component and insert it at the correct position (`src/renderer/src/components/prompt/PromptBar.svelte`) (wave: 4)

- [x] 9. Add `pipelineMode` and `testerMode` segmented control rows to the project settings section of `src/renderer/src/components/overlays/ProjectOverviewModal.svelte`; use the same three-button segmented style as `PipelineSettingsRow`; read from and write to the same store setters so both locations stay in sync (`src/renderer/src/components/overlays/ProjectOverviewModal.svelte`) (wave: 4)

- [x] 10. Update `templates/code/CLAUDE.md` to add explicit LEAN / STANDARD / FULL routing tables for each pipeline (plan feature, implement feature, apply feature, debug, refactor); structure as three separate named routing blocks so the orchestrator can match `PIPELINE MODE: X` from its system prompt and follow the corresponding table exactly; add tester logic block after implementer in the apply pipeline: `ON` → invoke tester, `ASK` → emit `[suggest] run tester: <feature name>`, `OFF` → skip (`templates/code/CLAUDE.md`) (wave: 3)

### [x] Feature: FORGE-owned SKILLS injection + project context in scaffold

- [x] 1. Add `stackLabelsToTemplateFolder` helper and update `buildSystemPromptAppend` signature to accept `appRoot: string` as second parameter, consolidate the two `project.json` reads into one, and replace the SKILLS.md read from `projectFolder/docs/gotchas/SKILLS.md` with a read from `appRoot/templates/{templateFolder}/docs/gotchas/SKILLS.md` with fallback to `appRoot/templates/code/docs/gotchas/SKILLS.md` (`src/main/shared.ts`)
- [x] 2. Update the `buildSystemPromptAppend` call in the runner handler to pass `appRoot` as the second argument (`src/main/handlers/runner.ts`) (wave: 1)
- [x] 3. Remove the SKILLS.md copy block from the `scaffold-project` handler and add a comment explaining SKILLS.md is FORGE-owned and injected at runtime (`src/main/handlers/scaffold.ts`) (wave: 1)
- [x] 4. Add `projectDescription?: string` to the `scaffold-project` handler destructured parameters and TypeScript type, and write `projectName` and `projectDescription` into `projectJsonData` when provided (`src/main/handlers/scaffold.ts`)

### [x] Feature: Terminal Run Timer

- [x] 1. Add `getElapsedSeconds()` derived helper to `run.svelte.ts` — returns `Math.floor((Date.now() - state.startedAt) / 1000)` when running, else `null` (`src/renderer/src/stores/run.svelte.ts`)
- [x] 2. Create `RunTimer.svelte` component — subscribes to run state via a `$effect`-driven `setInterval` (1 s tick) that reads `getRunState().startedAt` and `isRunning()`, computes `MM:SS` formatted string, clears interval when not running; renders a compact `<span class="run-timer">` (`src/renderer/src/components/prompt/RunTimer.svelte`) (wave: 1)
- [x] 3. Wire `RunTimer` into `ControlsRow.svelte` — render `<RunTimer>` inside the `.ctrl-spacer` flex gap between the pause button and the RUN/STOP button; visible only when `isRunning` prop is true (`src/renderer/src/components/prompt/ControlsRow.svelte`) (wave: 2)
- [x] 4. Wire elapsed time into `LivePanel.svelte` summary row — import `RunTimer` and append it after the gate label in the `.diagram-summary` row (same `·` separator pattern); visible only when `run.status === 'running'` and `hasCards` is true (`src/renderer/src/components/panels/LivePanel.svelte`) (wave: 2)
- [x] 5. Style `RunTimer` — monospace, `var(--dim)` color, `8px` font-size matching the rest of the summary row; no border; fades in on mount via CSS opacity transition (`src/renderer/src/components/prompt/RunTimer.svelte`) (wave: 3)
### [x] Todo: planner-approach-transparency-pre-gate1
Planner design reasoning surfaced before Gate #1 via [approach]...[/approach] signal block
Done: 2026-03-30

### [x] Todo: module-registry-documenter-writes-capabilities
Documenter now writes capability entries to modules.json after each feature ships
Done: 2026-03-28

### [x] Todo: why-file-waves-pipeline-deep-dive
docs/BACKSTAGE.md sections on waves, pipeline structure, and agent specialisation expanded
Done: 2026-03-28

### [x] Todo: todo-enrichment-and-direct-chat-assistant
TODO enrichment via Haiku and DIRECT chat as thinking partner implemented
Done: 2025-04-03

### [x] Todo: planner-clarifying-questions-depth
Planner clarifying questions depth improved with two-pass Q&A and context-sensitive limits
Done: 2025-04-03

### [x] Todo: terminal-copy-include-thinking-box
Terminal copy (per-block and copy-all) now includes thinking box content
Done: 2026-03-28

### [x] Todo: pipeline-debug-instrumentation-review
Debug instrumentation in App.svelte reviewed and removed; audit-log signal tracking confirmed correct
Done: 2026-03-28

### [x] Feature: Planner Clarifying Questions Depth

Improve the planner agent's question-generation behaviour to ask context-sensitive, design-critical questions rather than generic ones. Key changes: question count scales with feature complexity (0–2 for bugs, 5–8 for greenfield UI) using judgment-based classification; visual-design questions (style, content, audience) are mandatory for any feature that produces visible UI regardless of complexity tier; project description from project.json is read first and used as context to avoid re-asking what's already known.

- [x] 1. Update the Pass 1 Step 0 preamble in `.claude/agents/planner.md` to replace the generic "Identify 2–5 design forks" instruction with a three-tier classification rule using **judgment, not keyword matching**: classify the feature by intent as (a) `bug-fix-or-minor` → target 0–2 questions; (b) `additive-backend-or-logic` → target 2–4 questions; (c) `greenfield-UI-or-frontend` → target 5–8 questions. Add explicit default: **when tier is uncertain, classify up not down** — a slightly-too-long question list is recoverable; a too-short one produces a wrong plan. Document examples of each tier but instruct the planner to use judgment on edge cases. (`.claude/agents/planner.md`)

- [x] 2. Add a mandatory **visual-design question block** rule to Step 0 in `.claude/agents/planner.md`: for **any feature that produces or changes visible UI** — regardless of tier — the planner MUST include at least one question covering visual style/theme, at least one covering content/layout, and at least one covering audience. This is not tied to tier (c) only; a tier (b) feature that adds a UI component still requires these questions. Embed example questions (e.g. "What visual theme should this use?", "Which content sections should the page include?", "Who is the primary audience?") as concrete guidance. (`.claude/agents/planner.md`)

- [x] 3. Add a **project-description read** instruction to Step 0 in `.claude/agents/planner.md`: before generating questions, read `.pipeline/project.json` and extract the `projectDescription` field if present; use it to eliminate questions whose answers are already clear from the description (e.g. do not ask about tech stack if the description says "React app"), and phrase remaining questions as building ON the context ("The project is X — should this feature also Y?"). Document this as an explicit sub-step before the question list is assembled. (`.claude/agents/planner.md`)

- [x] 4. Update the question-count constraint comment in `.claude/agents/planner.md` from "Maximum 8 questions; maximum 8 options per question" to reflect the tiered ranges: "0–2 questions for bug fixes, 2–4 for backend/logic features, 5–8 for greenfield UI/frontend features. Maximum 8 questions per round; maximum 8 options per question." Also update the system-prompt version of this constraint in the Planner agent's copy embedded at `.claude/agents/planner.md` (same file — one edit covers both). (`.claude/agents/planner.md`)

- [x] 6. Mirror the same tiered question-count and visual-design-question rules into the orchestrator-level `plan feature:` routing description in `templates/code/CLAUDE.md` — specifically the "planner — Step 0" paragraph — so orchestrators spawning the planner agent in other projects also respect the new behaviour. Change "emits a `[questions]` block (2–5 clarifying questions)" to the tiered description. (`.claude/agents/planner.md` is updated in tasks 1–5; this task updates `templates/code/CLAUDE.md`)

### Research needed
- Confirm that `.pipeline/project.json` reliably contains a `projectDescription` field across all project types (code, instructional, non-code). If the field name differs per project type, the Step 0 read instruction needs to handle multiple candidate field names.

### [x] Feature: Wizard Project Context Injection

- [x] 1. Add `projectName` and `projectDescription` extraction to the `project.json` read block in `buildSystemPromptAppend` (`src/main/shared.ts`) — read both fields after the existing `testerMode` extraction; validate as non-empty strings; apply `stripNl()` to each (wave: 1)
- [x] 2. Inject `projectName` and `projectDescription` into the assembled prompt string in `buildSystemPromptAppend` (`src/main/shared.ts`) — prepend a `> Project: <name> — <description>` block before the `modePrefixParts` block; skip gracefully when either field is absent or empty (wave: 2)
- [x] 3. Add `projectDescription` parameter to the `scaffoldProject` wrapper in `src/renderer/src/lib/ipc.ts` — pass it through to `c().scaffoldProject()`; keep all existing parameters in place (wave: 1)
- [x] 4. Add `projectDescription` parameter to the `scaffoldProject` method signature in `src/renderer/src/types/claude.d.ts` (wave: 1)
- [x] 5. Add `projectDescription` parameter to the `scaffoldProject` bridge in `src/preload/index.ts` — include it in the `ipcRenderer.invoke('scaffold-project', {...})` payload (wave: 1)
- [x] 6. Wire `projectDescription` from `description` state into the `scaffoldProject` call in `WizardModal.svelte` (`src/renderer/src/components/overlays/WizardModal.svelte`) — pass `description.trim()` as the new parameter in the `create()` function (wave: 2)

### [x] Feature: Reviewer signal optimization — write analysis to file, output only verdict signal

Reduce orchestrator context consumption by having all five reviewer agents write their full analysis to `docs/context/reviewer-output/<agent-name>.md` using the Write tool, then output only the `[reviewer-verdict]` signal line as their text response. The analysis is preserved on disk for human reference; the tool result shrinks from ~600 tokens to ~20 tokens.

Two supporting changes are required alongside the agent prompt edits: each reviewer's frontmatter must gain `Write` in its tools list, and `.pipeline/agent-roles.json` must add `docs/context/reviewer-output/**` to each reviewer's allowed write paths (currently all five are `readonly: true`).

- [x] 1. Update `.pipeline/agent-roles.json`: change all five reviewer entries (`reviewer`, `reviewer-safety`, `reviewer-logic`, `reviewer-style`, `reviewer-performance`) from `{ "readonly": true }` to `{ "allowedPaths": ["docs/context/reviewer-output/**"] }`; this unblocks the `ctx-pre-tool.js` PreToolUse hook from rejecting Write tool calls targeting that directory (`.pipeline/agent-roles.json`)

- [x] 2. Update `reviewer.md`: add `Write` to the `tools:` list in the YAML frontmatter; replace the existing `## Verdict signal` section (and the **APPROVED output discipline** rule) with a new `## Output protocol` section instructing the agent to: (a) write the full review — all content from `## Boundary Review:` through `### Verdict` — to `docs/context/reviewer-output/reviewer.md` using the Write tool; (b) after the Write tool call completes, output ONLY the `[reviewer-verdict]` signal line as the entire text response — no prose, no summary, no blank lines before or after the signal; (c) note that this replaces the APPROVED output discipline rule: even when APPROVED, the analysis goes to the file, not to text output (`.claude/agents/reviewer.md`) (wave: 1)

- [x] 3. Update `reviewer-safety.md`: add `Write` to the `tools:` list in the YAML frontmatter; replace the existing `## Verdict signal` section (and any APPROVED output discipline rule) with a `## Output protocol` section with identical instructions — write full analysis to `docs/context/reviewer-output/reviewer-safety.md`, then output only the `[reviewer-verdict]` signal line (`.claude/agents/reviewer-safety.md`) (wave: 1)

- [x] 4. Update `reviewer-logic.md`: add `Write` to the `tools:` list in the YAML frontmatter; replace the existing `## Verdict signal` section (and any APPROVED output discipline rule) with a `## Output protocol` section with identical instructions — write full analysis to `docs/context/reviewer-output/reviewer-logic.md`, then output only the `[reviewer-verdict]` signal line (`.claude/agents/reviewer-logic.md`) (wave: 1)

- [x] 5. Update `reviewer-style.md`: add `Write` to the `tools:` list in the YAML frontmatter; replace the existing `## Verdict signal` section (and any APPROVED output discipline rule) with a `## Output protocol` section with identical instructions — write full analysis to `docs/context/reviewer-output/reviewer-style.md`, then output only the `[reviewer-verdict]` signal line (`.claude/agents/reviewer-style.md`) (wave: 1)

- [x] 6. Update `reviewer-performance.md`: add `Write` to the `tools:` list in the YAML frontmatter; replace the existing `## Verdict signal` section (and any APPROVED output discipline rule) with a `## Output protocol` section with identical instructions — write full analysis to `docs/context/reviewer-output/reviewer-performance.md`, then output only the `[reviewer-verdict]` signal line (`.claude/agents/reviewer-performance.md`) (wave: 1)

### Research needed
- None — `reviewer.md` was read in full and confirms the current `## Verdict signal` section and `APPROVED output discipline` rule structure. The other four reviewer files follow the same section pattern (confirmed by Phase 1a planning). `agent-roles.json` was read in full and confirms all five reviewers are currently `readonly: true`. The `ctx-pre-tool.js` hook is fail-open on missing manifest entries, so task 1 must complete before the wave-1 agent edits are applied.
### Feature: [x] GSD #5 Phase 1 — Plan Checker High-Signal Dimensions

Single-file edit to `.claude/agents/gotcha-checker.md` to add four high-signal validation checks: dependency correctness (BLOCKER-level), token budget (BLOCKER/WARNING-level), verification derivability, and Nyquist compliance. Phase 2 (requirement coverage, context compliance, cross-plan data contracts) deferred to a follow-on feature.

- [x] 1. Add **Dependency correctness check** (dimension 4) to the gotcha-checker prompt: add a `## Dependency correctness check` section after the existing IPC channel uniqueness section; parse all `(wave: N)` annotations in the current feature's task list; verify wave numbers form a contiguous sequence starting at 1 (no gaps, no wave 0, no negative numbers); also verify that any task description containing `"depends on task N"` or `"see task N"` references a task number that actually exists in the current feature; emit a **BLOCKER** for wave gaps: `**BLOCKER: Wave sequence gap** — Wave numbers jump from N to M with no wave N+1 tasks.`; emit a **BLOCKER** for invalid cross-references: `**BLOCKER: Invalid task reference** — Task X references task N which does not exist in this feature.`; update the BLOCKER issues list at the bottom of the output format section to include both new blocker types (`.claude/agents/gotcha-checker.md`)

- [x] 2. Add **Verification derivability check** (dimension 6) to the gotcha-checker prompt: add a `## Verification derivability check` section; scan all task descriptions in the current feature for language indicating an observable acceptance criterion — keywords to match (case-insensitive): `"visible"`, `"displays"`, `"renders"`, `"shows"`, `"emits"`, `"returns"`, `"observable"`, `"confirm"`, `"verify"`, `"test"`, `"assert"`, `"user can"`, `"should see"`, `"expected output"`; if zero tasks contain any of these keywords, emit a **WARNING**: `**WARNING: No verification derivability** — No task describes an observable acceptance criterion. Add at least one task that states how the feature's correctness can be confirmed.`; this is a WARNING only, never a BLOCKER; update the WARNING issues list at the bottom of the output format section (`.claude/agents/gotcha-checker.md`)

- [x] 3. Add **Nyquist compliance check** (dimension 8) to the gotcha-checker prompt: add a `## Nyquist compliance check` section; group the current feature's tasks by wave number (tasks with no wave annotation form wave 0 for this check); for each wave group, verify at least one task in the group has a verifiable output — a task is considered to have a verifiable output if its description contains any of: a file path in backticks, the word `"returns"`, `"emits"`, `"writes"`, `"creates"`, `"renders"`, or `"displays"`; if a wave group has no task with a verifiable output, emit a **WARNING**: `**WARNING: Nyquist compliance gap** — Wave N has no task with a verifiable output. Each wave should produce at least one observable artifact.`; update the WARNING issues list at the bottom of the output format section (`.claude/agents/gotcha-checker.md`)

- [x] 4. Add **Token budget check** (dimension 10) to the gotcha-checker prompt: add a `## Token budget check` section at the end of all checks (before the output format section); count all numbered task items in the current feature (`taskCount`); count all distinct file paths mentioned in backticks across all task descriptions (`fileCount`, deduplicated); apply two thresholds: if `taskCount >= 6 AND fileCount >= 5`, emit a **BLOCKER**: `**BLOCKER: Token budget risk** — Plan has {taskCount} tasks touching {fileCount} distinct files. This is likely to exceed the per-run token budget. Split into two phases before proceeding.`; if `taskCount >= 4 AND fileCount >= 4` (but below the BLOCKER threshold), emit a **WARNING**: `**WARNING: Token budget caution** — Plan has {taskCount} tasks touching {fileCount} distinct files. The run may approach token limits. Consider splitting if tasks are not tightly coupled.`; update the BLOCKER issues list to include `token budget risk (≥6 tasks AND ≥5 files)` and the WARNING issues list to include `token budget caution (≥4 tasks AND ≥4 files)` (`.claude/agents/gotcha-checker.md`)

### Research needed
- None — the existing gotcha-checker structure was read in full; all new sections follow the established heading/bullet pattern and append after the IPC channel uniqueness check. The checks use only Read/Grep tools already available to the agent.

---

### Feature: [x] GSD #5 Phase 2 — Plan Checker Conditional Dimensions

Single-file edit to `.claude/agents/gotcha-checker.md` to add three conditional validation checks: requirement coverage (reads `docs/ROADMAP.md` when present), context compliance (reads `docs/DECISIONS.md` when present), and cross-plan data contracts (scans wave annotations for type shape mismatches). All three are WARNING-only; all skip silently when their source file is absent or no relevant content is found.

- [x] 1. Add **Requirement coverage check** (dimension 2) to the gotcha-checker prompt (`.claude/agents/gotcha-checker.md`): insert a `## Requirement coverage check` section after the Token budget check section; the agent reads `docs/ROADMAP.md` only if it exists; finds the first `##` heading not marked `[x]` (the active phase); for each bullet under that heading, checks whether any task description in the current feature's task list contains a keyword from that bullet (case-insensitive word match on the first 5 non-stopword tokens of the bullet); if any bullet has no matching task, emits a WARNING: `**WARNING: Uncovered ROADMAP requirement** — Item "<bullet text>" in the active phase has no matching task in the plan.`; skips silently if ROADMAP.md is absent, unreadable, or no active phase heading is found; update the WARNING issues list in the output format section to include `uncovered ROADMAP requirement`.

- [x] 2. Add **Context compliance check** (dimension 7) to the gotcha-checker prompt (`.claude/agents/gotcha-checker.md`): insert a `## Context compliance check` section after the Requirement coverage check section; the agent reads `docs/DECISIONS.md` only if it exists; extracts decision entries — lines starting with `**Decision:**` or `## ` headings followed by a rationale line; for each decision that names a technology, approach, or constraint, scans the current feature's task descriptions for explicit contradictions (e.g. a task proposing a different technology than a recorded decision); for each apparent contradiction, emits a WARNING: `**WARNING: Possible DECISIONS.md conflict** — Task N appears to contradict the decision: "<decision text>". Review before proceeding.`; this check is WARNING only — never a BLOCKER; skips silently if DECISIONS.md is absent; update the WARNING issues list to include `possible DECISIONS.md conflict`.

- [x] 3. Add **Cross-plan data contracts check** (dimension 9) to the gotcha-checker prompt (`.claude/agents/gotcha-checker.md`): insert a `## Cross-plan data contracts check` section after the Context compliance check section; scan the current feature's task descriptions for tasks that define a new type or interface shape using keywords: `interface`, `type `, `schema`, `shape`, `fields:`; record each matched type name and its wave number; scan later-wave tasks for references to those same type names; if a type defined in wave N is referenced in wave M (M > N) but the two descriptions enumerate different field names, emit a WARNING: `**WARNING: Data contract mismatch** — Type "<name>" defined in wave N task X and consumed in wave M task Y appear to describe different shapes.`; skip silently if no cross-wave type references are found; update the WARNING issues list to include `data contract mismatch`.

- [x] 4. Verify the three new check sections are correctly positioned and the output format section's BLOCKER and WARNING issue lists at the bottom of the file reflect all newly added warning types (`uncovered ROADMAP requirement`, `possible DECISIONS.md conflict`, `data contract mismatch`) (`.claude/agents/gotcha-checker.md`).

### Research needed
- None — the gotcha-checker file was read in full; the three new sections follow the established conditional-read pattern (read file only if it exists, skip silently otherwise). All required tools (Read, Glob, Grep) are already declared in the agent frontmatter.

---

### Feature: [x] GSD #3 — Wave-based parallel execution

Update the implementer agent prompt to be explicitly wave-aware: parse `(wave: N)` annotations from handoff tasks, group tasks by wave, apply all wave-1 tasks before wave-2, emit a `[blocked]` signal if a prerequisite from a prior wave is missing, and emit `[wave-complete] N` after each wave finishes. Also update the gotcha-checker to warn when two tasks in different waves touch the same file but lack an explicit dependency reference.

- [x] 1. Update the implementer agent prompt to add a `## Wave execution protocol` section describing: (a) scan all tasks in the handoff for `(wave: N)` annotations; (b) if no wave annotations are present, execute tasks in numbered order as before; (c) if wave annotations are present, group tasks by wave number; (d) execute all tasks in wave 1 fully before moving to wave 2; (e) after completing each wave's tasks, perform a self-check confirming the files modified in that wave match what the task descriptions stated; (f) emit `[wave-complete] N` on its own line after the self-check passes for wave N; (g) before starting wave N (N > 1), verify that each file referenced by wave N tasks was actually produced or modified by wave N-1 tasks — if a required prerequisite is absent, emit `[blocked] Wave N task X — prerequisite from wave N-1 not found` and stop without applying that task (`.claude/agents/implementer.md`)

- [x] 2. Update the implementer agent prompt to add a `## Wave self-check` section describing the exact self-check steps: for each task in a completed wave, read the file that task targeted and confirm the change is present (e.g. a new function signature, a new section heading, or a new field exists); if a change is missing, emit `[blocked] Wave N task X — expected change not found in <file>` and stop; this is a safety gate, not a retry — the implementer must not attempt to re-apply the change (`.claude/agents/implementer.md`)

- [x] 3. Update the gotcha-checker agent prompt to add a `## File ownership cross-wave check` section: scan all tasks in the current feature's task list for pairs of tasks in different waves that mention the same file path in backticks; for each such pair where the later-wave task does not contain the phrase `"depends on task N"` referencing the earlier task's number, emit a WARNING: `**WARNING: Cross-wave file ownership gap** — Tasks X (wave A) and Y (wave B) both touch \`<file>\` but task Y has no explicit depends_on reference to task X. Add "depends on task X" to task Y's description or merge into a single wave.`; update the WARNING issues list at the bottom of the output format section to include `cross-wave file ownership gap` (`.claude/agents/gotcha-checker.md`)

### Research needed
- None — both agent files were read in full; the new sections follow established patterns in each file. The `[wave-complete]` signal is already defined in `docs/gotchas/GENERAL.md` (line 93) and classified in `App.svelte`'s `onStdout` handler, so no renderer or IPC changes are needed.

---

### Feature: [x] Skills pipeline wiring — inject tech stack context into agent prompts

The `buildSystemPromptAppend` function in `src/main/shared.ts` already injects `docs/gotchas/SKILLS.md` verbatim as `--append-system-prompt` on every non-chat run. The gap: it injects the entire file regardless of which stacks the project actually uses. `.pipeline/project.json` stores `techStacks` (array of stack IDs) but `buildSystemPromptAppend` never reads it. This feature makes injection targeted: read the project's active stacks, then filter SKILLS.md to only the relevant `## AgentName / ### StackName` subsections before injecting. The gotcha-checker also receives no stack-awareness instruction for SKILLS.md.

- [x] 1. Add `filterSkillsByStacks(content: string, stacks: string[]): string` helper function to `src/main/shared.ts`: given the full SKILLS.md content and an array of stack labels (e.g. `["Node.js / TypeScript", "Svelte 5"]`), return only the `## AgentName` sections that contain at least one `### StackName` subsection whose heading matches any of the given stacks (case-insensitive substring match); preserve all matching `## AgentName` headers and their matching `### StackName` subsections; if `stacks` is empty or no sections match, return the original content unchanged so the full file is still injected as a fallback (`src/main/shared.ts`)

- [x] 2. Update `buildSystemPromptAppend` in `src/main/shared.ts` to accept `projectFolder` (already provided) and additionally read `.pipeline/project.json` to extract `techStackLabels` before injecting SKILLS.md: read `.pipeline/project.json` via `fsPromises.readFile`; parse `techStackLabels` array (default to `[]` on any error or missing file); pass the labels and the SKILLS.md content to `filterSkillsByStacks`; return the filtered content instead of the raw file; add a one-line comment above the filter call noting that an empty labels array means no project.json exists — full SKILLS.md is used as fallback (`src/main/shared.ts`)

- [x] 3. Update the gotcha-checker agent prompt (`.claude/agents/gotcha-checker.md`) to add a `## Stack-aware SKILLS.md check` section: instruct the agent to read `.pipeline/project.json` if it exists and extract `techStackLabels`; then read `docs/gotchas/SKILLS.md` if it exists; apply only the `### <StackName>` subsections whose headings match any label in `techStackLabels` (case-insensitive substring); if no `techStackLabels` are found or `project.json` is absent, apply all SKILLS.md sections; place this section immediately after the `## Your role` section and before the existing FORGE gotchas, so stack-specific guidance is checked first (`.claude/agents/gotcha-checker.md`)

### Research needed
- None — `buildSystemPromptAppend`, `mergeSkillsMd`, the SKILLS.md section structure (`## AgentName` / `### StackName` headings), and the `.pipeline/project.json` schema (`techStacks`, `techStackLabels`) were all read in full. The filter logic mirrors the existing `mergeSkillsMd` section-splitting pattern. No new IPC channels, preload changes, or renderer changes are needed — this is a pure main-process change plus one agent prompt edit.

---

### Feature: [x] Reviewer Verdict Persistence — Phase 1a (agent signal emission)

Add `[reviewer-verdict]` JSON signal emission to all five verdict-issuing reviewer agents. Each agent emits the signal as its absolute last output line. Phase 1b (IPC handlers + renderer wiring) follows in a separate feature.

- [x] 1. Add `[reviewer-verdict]` signal instruction to `reviewer.md`: append a `## Verdict signal` section after the existing `## Output format` section instructing the agent to emit `[reviewer-verdict] {"agent":"reviewer","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name from handoff>"}` as the absolute last line of output — after the `### Verdict` block; the feature name must be extracted from the `## Boundary Review: <Feature Name>` heading in the agent's own output (`.claude/agents/reviewer.md`)

- [x] 2. Add `[reviewer-verdict]` signal instruction to `reviewer-logic.md`: same pattern — append a `## Verdict signal` section after `## Output format`; agent ID is `"reviewer-logic"`; feature name extracted from the `## Logic Review: <Feature Name>` heading (`.claude/agents/reviewer-logic.md`)

- [x] 3. Add `[reviewer-verdict]` signal instruction to `reviewer-safety.md`: same pattern — agent ID is `"reviewer-safety"`; feature name extracted from the `## Safety Review: <Feature Name>` heading (`.claude/agents/reviewer-safety.md`)

- [x] 4. Add `[reviewer-verdict]` signal instruction to `reviewer-style.md`: same pattern — agent ID is `"reviewer-style"`; feature name extracted from the `## Style Review: <Feature Name>` heading (`.claude/agents/reviewer-style.md`)

- [x] 5. Add `[reviewer-verdict]` signal instruction to `reviewer-performance.md`: same pattern — agent ID is `"reviewer-performance"`; feature name extracted from the `## Performance Review: <Feature Name>` heading (`.claude/agents/reviewer-performance.md`)

### Research needed
- Confirm the exact output format heading pattern used by `reviewer-style.md` and `reviewer-performance.md` before writing the signal instruction.

### Feature: [x] Reviewer Verdict Persistence — Phase 1b (IPC + renderer wiring)

Wire the `[reviewer-verdict]` signal into the renderer and main process: new `append-verdict` / `get-verdicts` IPC handlers persist verdicts to `.pipeline/verdicts.jsonl`; `App.svelte` captures the signal silently; `GENERAL.md` documents the new signal.

- [x] 1. Add `append-verdict` and `get-verdicts` IPC handlers to `src/main/handlers/pipeline-data.ts`: `append-verdict` accepts `{ projectFolder, verdict }`; validates path with `resolve() + startsWith()` guard; appends `JSON.stringify(verdict) + '\n'` via `fsPromises.appendFile`; returns `{ ok: true }` or `{ error }`. `get-verdicts` accepts `{ projectFolder, limit?: number }` (default 100); reads `.pipeline/verdicts.jsonl`, splits on newlines, parses each line as JSON (skip malformed), returns last `limit` entries as `{ verdicts: VerdictEntry[] }` or `{ verdicts: [] }` if absent (`src/main/handlers/pipeline-data.ts`) (wave: 1)

- [x] 2. Expose `appendVerdict` and `getVerdicts` on the preload `contextBridge` (`src/preload/index.ts`) and add `VerdictEntry` interface + `appendVerdict` / `getVerdicts` method signatures to `src/renderer/src/types/claude.d.ts`: `VerdictEntry` has `agent: string`, `verdict: 'APPROVED' | 'BLOCK' | 'REVISE'`, `blockers: number`, `warnings: number`, `feature: string`, `ts: number` (wave: 2)

- [x] 3. Add `appendVerdict` and `getVerdicts` typed wrapper functions to `src/renderer/src/lib/ipc.ts` (wave: 2)

- [x] 4. Add `[reviewer-verdict]` signal classifier to `App.svelte`'s `onStdout` handler: parse the JSON payload after the prefix, call `ipc.appendVerdict(proj.projectFolder, { ...parsed, ts: Date.now() })` fire-and-forget, and `continue` to suppress terminal output (`src/renderer/src/App.svelte`) (wave: 3)

- [x] 5. Register `[reviewer-verdict]` in the signal list in `docs/gotchas/GENERAL.md` (wave: 3)

### Research needed
- None — all target files confirmed during Phase 1a planning.

### Feature: [x] Reviewer Verdict UI — HEALTH tab verdicts section

Surface `.pipeline/verdicts.jsonl` data in the HEALTH tab. No new IPC channels or stores are needed — `ipc.getVerdicts` and `VerdictEntry` already exist. All logic lives in `HealthPanel.svelte`.

- [x] 1. Add verdict state, load function, per-agent summary derivation, and recent-history list to `HealthPanel.svelte`: declare `let verdicts = $state<VerdictEntry[]>([])` and `let loading = $state(false)`; add an `async function loadVerdicts()` that calls `ipc.getVerdicts(proj.projectFolder, 50)` and assigns `verdicts` (guard: skip if `proj.projectFolder` is empty); derive `agentSummaries` via `$derived` — group by `agent`, compute `total`, `approved` count, `approvalRate` (%), and `mostRecent` verdict per agent; derive `recentHistory` via `$derived` as the last 10 entries of `verdicts` (already newest-last from JSONL, so slice from end); call `loadVerdicts()` from `onMount` so verdicts load when the HEALTH tab is opened (the component mounts/unmounts with the tab because `RightPanel.svelte` uses `{#if ui.activeTab === 'HEALTH'}`); add a `$effect` that watches `run.status` and calls `loadVerdicts()` whenever `run.status === 'done' || run.status === 'error'` so the section refreshes after each run completes (`src/renderer/src/components/panels/HealthPanel.svelte`)

- [x] 2. Add "REVIEWER VERDICTS" section markup to `HealthPanel.svelte`: append below the existing CODE HEALTH section; render a `<div class="section-label">REVIEWER VERDICTS</div>` header; if `verdicts.length === 0 && !loading`, show `<div class="empty-state">No verdicts yet</div>`; otherwise render two sub-sections: (a) **Per-agent summary table** — one row per entry in `agentSummaries`, showing agent name, total runs, approval rate % colored green/gold/red by threshold (≥80% green, ≥50% gold, <50% red), and most-recent verdict as a badge; (b) **Recent history list** — iterate `recentHistory` (newest first, so reverse the slice), each row showing agent name, verdict badge (`APPROVED` green / `REVISE` gold / `BLOCK` red), blocker count (red if > 0), warning count (gold if > 0), feature name truncated at 30 chars, and relative timestamp (e.g. "2m ago", "1h ago") computed from `entry.ts` vs `Date.now()` (`src/renderer/src/components/panels/HealthPanel.svelte`)

- [x] 3. Add CSS for the verdicts section to `HealthPanel.svelte`'s `<style>` block: `.verdict-badge` with `font-family: var(--font-label)`, `font-size: 8px`, `font-weight: 700`, `letter-spacing: 0.06em`, `border-radius: 2px`, `padding: 1px 4px`; `.verdict-approved` background `color-mix(in srgb, var(--green) 15%, transparent)`, color `var(--green)`; `.verdict-revise` background `color-mix(in srgb, var(--gold) 15%, transparent)`, color `var(--gold)`; `.verdict-block` background `color-mix(in srgb, var(--red) 15%, transparent)`, color `var(--red)`; `.agent-summary-row` and `.history-row` as flex rows with `gap: 6px`, `align-items: center`, `font-family: var(--font-mono)`, `font-size: 9px`; `.verdict-feature` with `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap`, `max-width: 120px`, `color: var(--dim)`; `.verdict-ts` with `color: var(--dim)`, `flex-shrink: 0` (`src/renderer/src/components/panels/HealthPanel.svelte`)

### Research needed
- None — `HealthPanel.svelte`, `ipc.ts` (`getVerdicts` wrapper), `VerdictEntry` type, `run.svelte.ts` (`status` field), `ui.svelte.ts` (`activeTab`), and `RightPanel.svelte` (conditional mount pattern) were all read in full. All required pieces exist; no new IPC, stores, or files are needed.

---

