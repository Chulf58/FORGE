# SKILLS

Per-agent guidance for the FORGE pipeline on a Vanilla HTML/CSS/JavaScript stack.

---

## Planner

- Plan features as progressive enhancement: start with working HTML, layer CSS, then JS behaviour.
- Treat the DOM as the source of truth. Features that manipulate state must plan where that state lives (data attributes, hidden inputs, JS module variables) — no framework state exists here.
- Never plan a dependency install for something achievable natively: fetch over axios, `<dialog>` over modal libraries, CSS custom properties over CSS-in-JS.
- When a feature requires async work, plan for both success and failure paths in the UI — there is no error boundary to catch unhandled rejections.
- Flag any task that requires a build step (bundler, transpiler, minifier) — the team must decide upfront whether to introduce one. Vanilla projects often have no build step; do not assume one exists.
- Plan CSS layout via Flexbox or Grid, not floats or tables. Flag any layout that requires a specific browser baseline (e.g. `subgrid`, `:has()`).
- For any feature that reads or writes `localStorage`/`sessionStorage`, plan for the possibility of `SecurityError` (private browsing quota exceeded) and cross-origin restrictions.
- If interactivity requires focus management (modals, drawers, tooltips), plan explicit `tabindex` and `aria-*` attributes — there is no component library providing these defaults.

---

## Researcher

- Confirm browser support for every Web API before recommending it. Check MDN and caniuse.com for the project's declared baseline. Key APIs to verify: `ResizeObserver`, `IntersectionObserver`, `CSS.registerProperty`, `Dialog`, `Popover API`, `View Transitions`, `Speculation Rules`.
- Research whether a native HTML element already solves the problem before proposing a JS solution (e.g. `<details>`/`<summary>` for accordions, `<dialog>` for modals, `<datalist>` for autocomplete).
- For CSS: verify that custom property inheritance, `@layer` cascade order, and `@container` query support are within the project's target browsers.
- For JS module patterns: confirm whether the project uses ES modules (`type="module"` on `<script>`) or classic scripts. The two have different scoping, strict-mode, and CORS rules — mixing them causes silent failures.
- When researching third-party scripts (analytics, maps, payments): document their impact on `DOMContentLoaded` and `load` event timing, since Vanilla projects often rely on those events directly.
- Research `fetch` CORS requirements for any planned API calls. Vanilla code has no proxy middleware — preflight failures are a common runtime blocker.

---

## Coder

### HTML

- Use semantic elements: `<main>`, `<nav>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>`. Never use a `<div>` when a semantic element fits.
- Always pair form inputs with `<label for="...">` — never use placeholder text as the only label.
- Use `<button type="button">` for interactive controls that are not form submissions. Missing `type` defaults to `submit` inside a `<form>` and causes accidental submissions.
- Prefer `<a href="...">` for navigation and `<button>` for actions. Never attach click handlers to `<div>` or `<span>` for interactivity.
- Use `data-*` attributes to pass data from markup to JS — avoids coupling JS to CSS class names.
- Images must have meaningful `alt` text. Decorative images get `alt=""`.
- Always specify `lang` on `<html>`. Always include `<meta charset="UTF-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">`.

### CSS

- Use CSS custom properties (`--token: value`) for all repeated values (colours, spacing, radii, z-indices). Define them on `:root`.
- Use `@layer` to manage cascade order explicitly when mixing reset, base, component, and utility styles.
- Prefer logical properties (`margin-inline`, `padding-block`) over directional shorthands for i18n compatibility.
- Never use `!important` except inside utility layers or to override third-party styles — document any exception inline.
- Use `clamp()` for fluid typography and spacing instead of media-query breakpoint duplication.
- Avoid `z-index` values above 10 without a comment explaining the stacking context. Always create an explicit stacking context (`isolation: isolate`) on components that contain z-indexed children.
- Use `:focus-visible` instead of `:focus` to avoid removing outlines for mouse users while keeping them for keyboard users.
- Never override `outline: none` without providing an equivalent visible focus indicator.
- Prefer `gap` over margin hacks for spacing flex/grid children.
- Use `prefers-reduced-motion` media query to disable or reduce animations.

### JavaScript

- Use `const` by default; `let` when reassignment is needed; never `var`.
- Use `addEventListener` — never assign to `onclick`, `onchange`, etc. inline or via property assignment in new code.
- Always remove event listeners when they are no longer needed (e.g. on modal close, on component destroy). Store the reference to the handler so it can be passed to `removeEventListener`.
- Never use `innerHTML` with untrusted or user-supplied strings — use `textContent` for text, or build elements via `document.createElement` / `insertAdjacentElement`. If `innerHTML` is unavoidable for trusted markup, add an inline comment explaining why it is safe.
- Prefer `closest()` and `matches()` for event delegation over attaching listeners to every child element.
- Use `fetch` with explicit error handling: a non-2xx response does **not** throw — always check `response.ok`.
- Wrap `localStorage` access in try/catch — `SecurityError` is thrown in some private browsing contexts.
- Use `async`/`await` over raw Promise chains for readability. Always `await` inside try/catch or attach `.catch()`.
- Never block the main thread: move heavy computation to a Web Worker. Avoid synchronous XHR entirely.
- Debounce `scroll`, `resize`, and `input` event handlers — these fire at very high frequency.
- Use `DOMContentLoaded` (not `load`) as the earliest safe point to query the DOM. If the script is already deferred or a module, neither is needed.
- Use ES modules (`import`/`export`) for any project that supports them — classic global-scope scripts lead to naming collisions as the codebase grows.
- Avoid `document.write` — it blocks parsing and is a security risk.

---

## Reviewer

### Boundary checks

- Flag any `innerHTML` assignment that receives non-literal content as a potential XSS vector. Require proof that the input is sanitised or static.
- Flag any `eval()`, `new Function()`, or `setTimeout(string)` usage — these are code injection risks.
- Flag inline event handlers in HTML (`onclick="..."`) — they execute in global scope and are hard to remove.
- Flag missing `rel="noopener noreferrer"` on `<a target="_blank">` links — exposes `window.opener`.
- Flag `document.write` as a hard block.
- Flag hardcoded secrets, API keys, or credentials in JS files.
- Flag `localStorage` writes that store sensitive data (tokens, PII) without a documented security rationale.

### Quality checks

- Confirm all async paths have error handling (`try/catch` or `.catch()`).
- Confirm event listeners added dynamically are also removed when no longer needed.
- Confirm no layout-thrashing patterns: reads (e.g. `getBoundingClientRect`) and writes (style mutations) should not alternate inside a loop.
- Check that CSS specificity is not inflated with ID selectors or unnecessary nesting just to override other rules.
- Check that `tabindex` values are only 0 or -1 — positive `tabindex` breaks natural focus order.

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

- `verdict`: `APPROVED` (no issues), `REVISE` (minor issues, gate proceeds), or `BLOCK` (hard blockers, gate disabled)
- `blockers`: integer count of BLOCK-level findings; 0 if APPROVED
- `warnings`: integer count of REVISE-level findings; 0 if APPROVED or BLOCK
- `feature`: taken verbatim from the feature name heading in your review output
- Each reviewer emits its own signal independently; do not aggregate other reviewers' verdicts

---

## Implementer

- Apply HTML, CSS, and JS in separate files unless the plan explicitly specifies inline styles or inline scripts.
- When adding a `<script>` tag, use `defer` for DOM-dependent scripts, or `type="module"` for ES module scripts. Never place scripts before `</body>` as a substitute for `defer`.
- When adding new CSS selectors, check the existing stylesheet for conflicts before appending new rules. Prefer adding to an existing rule block over duplicating selectors.
- When adding event listeners, verify the target element is already in the DOM at the point of attachment — guard with a null check or move the script to after the element is rendered.
- For multi-file features, update `<link>` and `<script>` tags in the HTML entry point as part of the same change — do not leave dangling imports.
- Never add a `<meta http-equiv="Content-Security-Policy">` tag without confirming it does not break existing inline scripts or styles in the project.
- Preserve existing `data-*` attributes on elements being modified unless the plan explicitly removes them — other scripts may depend on them.

---

## Tester

- Test in at least two browsers (Chromium-based + Firefox) — CSS layout bugs and JS API availability differ.
- Test keyboard navigation end-to-end for every interactive feature: Tab, Shift+Tab, Enter, Escape, Space, arrow keys where applicable.
- Test with the browser zoom set to 200% — layout should not break or overflow viewport.
- Test with a screen reader (NVDA/JAWS on Windows, VoiceOver on Mac) for any new UI components.
- Test `fetch`-dependent features with the network throttled to Slow 3G and with the request blocked entirely — verify error states render correctly.
- Test `localStorage`-dependent features in a private/incognito window — quota may be zero.
- Test form submissions: submit with all fields empty, submit with invalid data, submit with valid data, and double-submit (rapid successive clicks).
- Verify no console errors or warnings on any tested page at rest and after interactions.
- Test `prefers-reduced-motion: reduce` and `prefers-color-scheme: dark` if the project supports them — verify transitions and colours respond correctly.
- Check that removing JavaScript entirely (disable JS in devtools) leaves the page content accessible and readable — progressive enhancement baseline.

---

## Documenter

- Record every new `data-*` attribute in `docs/ARCHITECTURE.md` under the component that owns it — they are the implicit API between HTML and JS.
- Record every CSS custom property added to `:root` with its purpose and accepted value range.
- Record browser-specific workarounds inline as comments in the source file **and** as a note in `docs/DECISIONS.md` explaining why the workaround was needed.
- When documenting a JS module, note its dependencies (which DOM IDs or classes it queries) so future refactors know what HTML to preserve.
- Changelog entries must note whether a change is additive, breaking (requires HTML template changes), or invisible (CSS/logic only) — consumers of partial templates need this distinction.
- Archive the relevant plan section with the shipped feature tag and date in `docs/CHANGELOG.md`.

---

## Tool-call-auditor

- After completing your audit and emitting any findings, emit the following as the **last line** of your output:
  `[pipeline-summary] mode=<apply-pipeline-mode> verdict=N/A`
- If agent-optimizer is triggered (recurring deviation found), do **not** emit `[pipeline-summary]` — that becomes agent-optimizer's responsibility after it presents its proposed changes.
- Never emit `[pipeline-summary]` more than once per run.
