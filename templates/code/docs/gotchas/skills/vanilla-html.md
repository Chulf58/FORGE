# vanilla-html (generated: 2026-04-02)

## Planner

- Before planning a DOM interaction feature, check whether a `data-*` attribute pattern is already in use for state binding — plan to extend it rather than introduce a second approach.
- localStorage tasks must include both the write path (on user action) and the read path (on page load). A plan that includes one without the other is incomplete.
- CSS custom property changes affect every page that imports the stylesheet — scope the blast radius in the plan when changing tokens used across multiple pages.
- For any feature that adds JavaScript, check whether the project already has a module pattern (ES modules, IIFE, or plain scripts). Plan to match it — do not introduce a second pattern.

## Coder

- **DOM queries**: prefer `document.getElementById` over `document.querySelector` for IDs — it is faster and intent-explicit. Use `querySelector` only for complex selectors with no ID equivalent.
- **Event delegation**: when adding listeners to a dynamically rendered list (e.g. tank cards, gallery items), attach one listener to the container and check `event.target.closest('[data-role]')` — do not attach individual listeners per item.
- **localStorage**: always wrap reads in a try/catch — `localStorage` throws in private browsing mode on some browsers. Use a fallback default on parse failure: `JSON.parse(val) ?? defaultValue`. Never store objects without `JSON.stringify`; never read without `JSON.parse`.
- **CSS custom properties**: use `document.documentElement.style.setProperty('--token', value)` to update tokens at runtime. Do not reach into individual element styles — token updates cascade automatically.
- **Script loading order**: scripts that depend on DOM elements must be deferred (`defer` attribute) or placed before `</body>`. Inline scripts in `<head>` that query elements will find nothing.
- **`data-theme` toggle**: read `document.documentElement.dataset.theme`, toggle between values, persist to localStorage. Never toggle classes on body for theme — the project uses `[data-theme]` on `<html>`.

## Implementer

- Preserve the exact indentation and quote style of the file being edited — HTML files in this project mix tabs and spaces differently across files; match the file being edited, not a global standard.
- When adding a `<script>` tag, check whether the file uses `defer`, `type="module"`, or plain script — add the new tag with the same loading strategy.
- When adding a new CSS rule, place it in the same section as semantically similar rules — do not append all new rules to the bottom of the file.
- `data-theme` guard: any new inline `<script>` in `<head>` that reads theme preference must be synchronous and placed before the first visible element to prevent flash-of-wrong-theme.

## Reviewer

- No boundary checks apply — vanilla HTML has no IPC or process boundary. Focus on: (a) does the JavaScript interact with the correct elements by ID/class/data attribute? (b) are script tags in the correct load order relative to the DOM they query?
- If a new IPC-like mechanism is introduced (e.g. `postMessage`, `BroadcastChannel`), flag it for explicit review — these are not expected patterns in this project.

## Reviewer-Safety

- **localStorage**: any localStorage write that stores user-controlled input must sanitise before storage to prevent stored XSS on read. Flag any `localStorage.setItem` where the value originates from `innerHTML`, `textContent`, or form input without sanitisation.
- **innerHTML**: flag any assignment to `element.innerHTML` that includes user-controlled or URL-derived content — use `textContent` for plain strings, `DOMParser` for structured HTML.
- **External URLs**: flag any dynamically constructed `<script src>`, `<img src>`, or `fetch()` URL that includes user-controlled segments — path traversal and content injection risk.

## Reviewer-Logic

- **Event listener cleanup**: if a listener is added inside a function that is called multiple times (e.g. on each render), verify that old listeners are removed before new ones are added — or that the parent element is replaced entirely.
- **localStorage race**: on pages that open in multiple tabs, `localStorage.getItem` reads may be stale. If the feature requires cross-tab consistency, flag the absence of a `storage` event listener.
- **`closest()` null check**: `event.target.closest(selector)` returns null when no ancestor matches. Verify that the code guards against null before reading properties on the result.

## Reviewer-Style

- Any new CSS rule that duplicates an existing token (`--color-*`, `--font-*`) is a REVISE — use the token, not a hardcoded value.
- Any JavaScript function longer than 30 lines that has no internal comment explaining its structure is a REVISE — vanilla JS has no type system to document intent.
- Inline event handlers (`onclick="..."` in HTML attributes) are a REVISE if the project uses external `.js` files — mixing patterns makes refactoring harder.

## Reviewer-Performance

- Flag any event listener attached inside a render loop (e.g. `forEach` that calls `addEventListener`) — each render duplicates listeners unless the container is replaced.
- Flag any `localStorage.getItem` called on every scroll or input event — debounce or cache the value.
- Flag any CSS animation applied to a property other than `transform` or `opacity` — layout-triggering animations (width, height, top, left) cause reflows on every frame.

## Gotcha-Checker

- **FOTWT (flash of wrong theme)**: any feature that adds a new overlay colour or background must check whether it sources from CSS custom properties. Hardcoded `rgba()` values break the dark/light toggle — they must be replaced with `var(--token)` references.
- **Multi-page consistency**: HTML changes (new nav items, footer changes, `<head>` includes) must be applied to all pages that share the same shell structure. Missing a page is a common failure mode — grep for the pattern across all `.html` files before assuming the task is complete.
- **Script path relativity**: scripts referenced as `src="js/foo.js"` assume the page is at the root. Pages in subdirectories need `../js/foo.js`. Check the page's location before writing the path.
- **`data-*` attributes as state**: if a feature uses `data-selected`, `data-active`, or similar on dynamic elements, verify that the attribute is cleared when state resets — stale data attributes cause incorrect CSS targeting.
