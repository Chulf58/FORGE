# Research: Redesign pipeline mode selectors and prompt bar

## Question: Confirm all 'free' string literal sites in the codebase — are all rename sites accounted for?

**Finding:** A grep for `free` across all `.ts` and `.svelte` files under `/src` returns exactly 10 hits. The planner's estimate of 5 was for specific files; there are 10 total occurrences across the codebase. Full list:

| File | Line | Content |
|---|---|---|
| `/src/main/index.ts` | 270 | `const isFree = mode === 'free'` |
| `/src/renderer/src/lib/constants.ts` | 55 | `'free'` in `MODES` tuple |
| `/src/renderer/src/lib/runner.ts` | 10 | `mode: ModeId = 'free'` (default parameter) |
| `/src/renderer/src/lib/runner.ts` | 15 | `mode === 'free' ? prompt : ...` |
| `/src/renderer/src/lib/runner.ts` | 20 | `if (mode === 'free')` |
| `/src/renderer/src/stores/run.svelte.ts` | 24 | `mode: 'free'` (state initialiser) |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 20 | `{ id: 'free', label: 'FREE' }` |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 28 | `if (mode === 'free') return ''` |
| `/src/renderer/src/components/prompt/PromptBar.svelte` | 126 | `editor.mode === 'free'` (placeholder ternary) |
| `/src/renderer/src/components/panels/FeatPanel.svelte` | 115 | `setMode('free')` (architect quick-launch button) |

The plan covers the first 9 sites across tasks 1–11. The 10th site — `FeatPanel.svelte` line 115 — is explicitly acknowledged in plan Phase 6b as task 12b: rename `setMode('free')` to `setMode('explore')`. All 10 sites are therefore covered by the plan.

No `'free'` literals appear in `gate.svelte.ts`, `App.svelte`, `editor.svelte.ts`, `ui.svelte.ts`, `session.svelte.ts`, or `agents.svelte.ts`.

`editor.svelte.ts` line 25 uses `mode: MODES[0]`, not a string literal — it will resolve to `'explore'` automatically once the `MODES` tuple is updated in task 1 (provided `'explore'` is placed first, which the plan states). However, the current `MODES` tuple has `'plan feature'` as `MODES[0]`, not `'free'`, so the editor default is already `'plan feature'`, not `'free'`. The run store (`run.svelte.ts` line 24) is the one with the stale `'free'` default; it uses a raw string and must be updated explicitly via task 3.

**Source:** grep across `/src/` for `free`; `/src/renderer/src/stores/editor.svelte.ts` lines 3–25; `/src/renderer/src/lib/constants.ts` line 55

**Recommendation:** All 10 rename sites are covered by the plan tasks. The coder should work through them in order: constants first (task 1), then stores (tasks 3–4), then main process (task 5), then runner.ts (task 6), then PromptBar.svelte (tasks 7–11), then FeatPanel.svelte (task 12b). No additional sites were missed.

---

## Question: Confirm whether template/CLAUDE.md is the only CLAUDE.md that needs updating, or whether a live project CLAUDE.md at the Forge root also needs patching

**Finding:** A glob for `**/CLAUDE.md` across the entire project returns exactly one result: `/template/CLAUDE.md`. There is no `CLAUDE.md` at the Forge repo root (`C:/Users/cuj/Forge/CLAUDE.md` does not exist). There are no other `CLAUDE.md` files anywhere in the project tree outside `template/`.

The current `template/CLAUDE.md` contains a `## FREE mode rules` section at line 188 that reads: "In free chat (no pipeline prefix), agents may read any project file but must not modify source files..." — this is the section that needs renaming to `## EXPLORE mode rules` and a new `## DIRECT mode rules` section needs to be added after it.

For existing live projects that have already been scaffolded or imported: the scaffold handler in `/src/main/index.ts` writes `template/CLAUDE.md` verbatim into the project directory at creation time. The import handler does the same. Projects that were created before this change will retain their old `CLAUDE.md` with `## FREE mode rules` and no `## DIRECT mode rules`. Those projects will not receive the guard automatically — the user must re-import or manually update them. This caveat is already acknowledged in the plan's design decisions section.

**Source:** glob result returning only `/template/CLAUDE.md`; `/template/CLAUDE.md` lines 188–191

**Recommendation:** Only `template/CLAUDE.md` requires a code change. No root-level `CLAUDE.md` exists to patch. The tester should note in `docs/TESTING.md` that existing projects need manual re-import or copy-paste to receive the DIRECT mode guard.

---

## Question: Check how agentsStore.initAgents(['claude']) and agentsStore.clearAgents() behave for FREE mode — confirm DIRECT can reuse the same synthetic card pattern

**Finding:** `initAgents` is defined in `/src/renderer/src/stores/agents.svelte.ts` at line 58. It takes `agentIds: string[]` and maps each id through `AGENT_META` to produce an `AgentCard` array with status `'pending'`, all null progress fields, and zero token counts. It also resets `totalTokens` and `estimatedCost` to zero (but intentionally leaves `sessionTokens` and `sessionCost` accumulating).

`AGENT_META` in `/src/renderer/src/lib/constants.ts` line 8 has an entry for `'claude'`: `{ label: 'Claude', model: 'sonnet', color: 'var(--gold)' }`. This means `initAgents(['claude'])` produces exactly one card: label "Claude", model "sonnet", color gold, status "pending".

In `runner.ts` lines 20–21, the existing FREE mode branch calls `agentsStore.initAgents(['claude'])` — single synthetic card, no pipeline agents. The card transitions from `'pending'` to `'running'` automatically when the first non-Agent/Task tool call arrives via `applyProgress` (lines 105–115 in `agents.svelte.ts`).

`clearAgents()` at line 77 sets `state.cards = []` and resets run-level token counts. It is called in `runner.ts` line 25 and `PromptBar.svelte` line 49 for any mode where `PIPELINES[mode]` is undefined and the mode is not FREE. For DIRECT mode, the plan requires `initAgents(['claude'])` instead of `clearAgents()` — this matches the FREE pattern exactly.

No structural changes to `agents.svelte.ts` are needed. The `'claude'` AGENT_META entry already exists and is used by FREE mode today.

**Source:** `/src/renderer/src/stores/agents.svelte.ts` lines 58–82; `/src/renderer/src/lib/constants.ts` lines 7–8; `/src/renderer/src/lib/runner.ts` lines 20–25; `/src/renderer/src/components/prompt/PromptBar.svelte` lines 47–49

**Recommendation:** DIRECT can reuse the identical `initAgents(['claude'])` call. The coder should update both `runner.ts` line 20 (changing `mode === 'free'` to `mode === 'explore' || mode === 'direct'`) and `PromptBar.svelte` line 49 (changing the `else agentsStore.clearAgents()` branch to also handle `mode === 'direct'` with `initAgents(['claude'])`). No changes to `agents.svelte.ts` or `constants.ts` AGENT_META are needed.

---

## Question: Confirm the CSS variable --blue exists in the theme and is suitable for EXPLORE active state

**Finding:** `--blue` is defined in `/src/renderer/src/assets/global.css` at line 32: `--blue: #5fa3e0;`. The comment reads "secondary accent — tool progress, code, refactor". It is a medium-brightness sky blue against the dark background (`--bg: #1a1c19`).

`--blue` is already used in the FORGE UI for several interactive elements: `a` link color (line 98), `.line-tool` left-border tint (line 235), `code` span background (line 243), and the `.action-btn.new-convo` button border and color (line 448–455 of global.css). The plan's `color-mix(in srgb, var(--blue) 12%, transparent)` pattern for the active state background matches existing patterns already used for `.action-btn.new-convo:hover` at line 454.

`--green` is defined at line 34: `--green: #5adba0;`. Comment: "success, new conversation, gate YES". It is already used for `.line-prompt`, `.badge-done`, and the `.action-btn.new-convo` accents. Both variables are well-established in the theme.

The `PromptBar.svelte` component's local `.mode-btn.active` CSS currently uses `var(--gold)` for all modes. The plan adds `data-mode` attribute selectors to override with `--blue` for EXPLORE and `--green` for DIRECT. The `color-mix()` function is supported in Chromium 111+ (Electron's renderer uses Chromium, so this is safe).

**Source:** `/src/renderer/src/assets/global.css` lines 31–35, 97–99, 234–236, 243–245, 448–455; `/src/renderer/src/components/prompt/PromptBar.svelte` lines 201–205

**Recommendation:** `--blue` is confirmed suitable for EXPLORE active state. `--green` is confirmed suitable for DIRECT. Both are defined in `:root` and will cascade into the scoped `<style>` block of `PromptBar.svelte` without any issues. The `color-mix()` syntax in the plan is safe for Electron's Chromium renderer. No global CSS changes are needed — the new rules belong only in `PromptBar.svelte`'s scoped `<style>` block.

---

## Question: Check whether any snapshot tests, type tests, or automated checks reference ModeId or the 'free' literal that would break on rename

**Finding:** A glob for `**/*.test.*` and `**/*.spec.*` within `/src` returns zero files. There are no automated test files anywhere in the project source tree (`src/`, `docs/`, `.claude/`, `.pipeline/`, `template/`). The only `.test.` and `.spec.` files in the repo are inside `node_modules/` (third-party packages: gensync, simple-update-notifier, json-schema-traverse, devalue, exponential-backoff) — none of which reference FORGE's `ModeId` type.

`ModeId` is referenced in 5 source locations (all renderer-side): `constants.ts` line 56 (definition), `editor.svelte.ts` lines 2 and 7 (import and field type), `runner.ts` line 8 (import), and `PromptBar.svelte` lines 10 and 19 (import and local array type). All five are in files already targeted by the plan's tasks. TypeScript will enforce the type change automatically — any site that still passes `'free'` after the `MODES` tuple is updated will produce a TypeScript compile error, which acts as a built-in safety net to catch missed rename sites.

There are no Vitest, Jest, Playwright, or Cypress config files in the project root. `package.json` has no `test` script (or if it does, it runs no FORGE-specific tests). The pipeline tester agent writes to `docs/TESTING.md` as a manual checklist only — no automated execution.

**Source:** glob returning no project-level test files; grep for `ModeId` returning 5 source locations; absence of test runner config

**Recommendation:** No automated tests will break. The TypeScript compiler is the only enforcement layer — after the `MODES` tuple rename in task 1, any remaining `'free'` string passed to a `ModeId`-typed parameter will produce a compile error, which is the correct failure mode. The coder should do a `tsc --noEmit` check (or trust electron-vite's build) after completing all tasks to confirm zero type errors remain.
