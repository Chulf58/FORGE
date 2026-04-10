# svelte5-components (generated: 2026-03-31)

## Planner

- For features with UI: always check CSS token usage (project palette is `--gold`, `--blue`, `--red`, `--green`, `--text`, `--dim`, `--border`, `--bg`, `--card`). New colours not in the palette require a separate design decision.
- `position: fixed` does not work inside Electron panels — plan `position: absolute` or flexbox layout instead.

## Coder

- CSS tokens only — never hardcode hex values. Palette: `--gold`, `--blue`, `--red`, `--green`, `--text`, `--dim`, `--border`, `--bg`, `--card`, `--gold-dim`.
- `position: fixed` collapses inside Electron renderer panels. Use `position: absolute` or flex/grid. Root-level modal backdrops are the only safe exception.
- Props via `$props()` destructuring — not individual `export let` declarations.
- Callbacks as props (`onsubmit: () => void`) — not `createEventDispatcher`.
- No `on:click` directive syntax (Svelte 4) — use `onclick={handler}` (Svelte 5).

## Implementer

- Never introduce `createEventDispatcher` — use `onX` callback props in `$props()` instead.
- No `on:click` directive syntax (Svelte 4) — use `onclick={handler}` (Svelte 5).
- CSS tokens only — no hardcoded hex values.

## Implementer-Triage

- `.svelte` component tasks: include Svelte 5 rune rules, `position: fixed` gotcha, and CSS token palette in the brief.
- `src/renderer/src/stores/*.svelte.ts` tasks: include `$state` rules, `.svelte.ts` extension requirement, and array mutation rules in the brief.

## Reviewer-Style

- Component structure order: `<script lang="ts">` first (imports, props, state, effects), then template, then `<style>` last.
- Props via `$props()` destructuring — not individual `export let` declarations.
- Callbacks as props (`onsubmit: () => void`) — not `createEventDispatcher`.
- No `on:click` directive syntax (Svelte 4) — use `onclick={handler}` (Svelte 5).
- CSS tokens only — no hardcoded hex values anywhere in `<style>`.
- `position: fixed` is forbidden inside renderer panels.
- All styles scoped to the component `<style>` block — no global selectors unless intentional.
- Font families via CSS variables: `var(--font-mono)`, `var(--font-label)`.
- Electron titlebar drag region: use `-webkit-app-region: drag`; interactive children need `-webkit-app-region: no-drag`.
- File naming: Svelte components `PascalCase.svelte`, stores `camelCase.svelte.ts`, handlers `kebab-case.ts`, utilities `camelCase.ts`.

## Refactor

- Split large `.svelte` files — keep `<script>` logic lean; move derived computations to stores, IPC calls to `ipc.ts`, constants to `constants.ts`.
- Replace prop-drilling with store getter calls — prop chains longer than 2 levels are a smell.
- Replace `createEventDispatcher` (Svelte 4) with callback props (`onX: () => void` in `$props()`).
- Extract repeated UI patterns (badge, tag, status dot) into shared components in `src/renderer/src/components/` rather than duplicating markup.
- Move inline styles into scoped `<style>` blocks using CSS tokens.

## Gotcha Checker

- `position: fixed` collapse — collapses to zero inside Electron panels. Use `position: absolute` or flex/grid.
- `createEventDispatcher` — Svelte 4 pattern; should be `onX` callback props in Svelte 5. Flag if introduced in new code.

## Debug

- `position: fixed` collapse — collapses to zero height inside Electron renderer panels. Replace with `position: absolute` or flex/grid layout.
- `createEventDispatcher` — Svelte 4 pattern that silently fails in Svelte 5. Replace with `onX` callback props via `$props()`.
