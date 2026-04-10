# svelte5-reactivity (generated: 2026-03-31)

## Planner

- Store state tasks go before component tasks — a component cannot wire up a store action that does not exist yet.
- Svelte 5 store files must use `.svelte.ts` extension — plan the filename explicitly to avoid a coder using `.ts` which breaks rune processing.

## Coder

- Use `$state`, `$derived`, `$effect`, `$props` runes — never `writable()`, `readable()`, `derived()`, or `get()` from `svelte/store`.
- Store files must use `.svelte.ts` extension — `.ts` files cannot process runes and `$state` will silently not be reactive.
- Declare state in `.svelte.ts` store files as `const state = $state<T>({ ... })`; export a getter returning the reactive proxy and named action functions that mutate it directly.
- `$state` belongs in `.svelte.ts` store files or component `<script>` blocks — not in plain `.ts` utilities.
- Array mutations: use in-place methods (`push`, `splice`, `sort`) — never spread-replace (`state.items = [...state.items, x]`), which loses fine-grained reactivity.
- `$effect` cleanup: return a cleanup function when registering listeners or intervals (`return () => clearInterval(id)`).
- `untrack()` from `svelte`: wrap reads inside an effect that should not re-trigger when that value changes.

## Implementer

- Never introduce `writable()`, `readable()`, or `get()` — leave legacy patterns alone unless the handoff explicitly updates them.
- No `any` types — use `unknown` with type narrowing.
- `$effect` cleanups must return a function when registering listeners or intervals.

## Reviewer

- Only Svelte 5 rune APIs: `$state`, `$derived`, `$effect`, `$props` — no `writable()`, `readable()`, `get()`.
- Store files use `.svelte.ts` extension (not `.ts`).
- `$effect` cleanups return a function when registering listeners or intervals.
- No `$state` in plain `.ts` files — runes only work in `.svelte.ts` and `.svelte` files.

## Reviewer-Logic

- Stale closure in `$effect` — an effect that reads a reactive value inside a callback (setTimeout, event handler) captures the value at registration time. Use `$state.snapshot()` or access directly inside the callback.
- Re-entrancy in `$effect` — an effect that writes to the same reactive value it reads from will loop infinitely.
- Event listeners in `$effect` without cleanup — `window.addEventListener` inside an effect must be matched by `return () => window.removeEventListener(...)`.
- Prop defaults via `$props()` — use `let { value = defaultVal }: { value?: Type } = $props()` not `$props().value ?? defaultVal`.
- Conditional `$effect` registration — `$effect` must be called unconditionally at component initialisation, not inside an `if` block.

## Reviewer-Performance

- `$effect` on high-frequency events (mousemove, scroll, resize) without debounce/throttle is a frame-rate killer — flag any effect that subscribes to DOM events without a rate limiter.
- `$derived` with expensive computation (array sort, filter, deep clone) runs synchronously on every dependency change — flag if the input collection is large or the computation is O(n²)+.
- Array size in `$state`: unbounded arrays that grow without a cap will eventually OOM — flag `push()` calls inside `$effect` or IPC handlers with no corresponding trim/slice.
- `$effect` registered without cleanup for intervals/timeouts leaks across component mount/unmount cycles — every `setInterval` and repeating `setTimeout` needs a cleanup return.
- Avoid expensive DOM reads (`getBoundingClientRect`, `offsetHeight`) inside reactive effects — they force layout recalculation on every dependency change.

## Refactor

- Extract shared state into `.svelte.ts` stores rather than passing props deeply — if the same value is read in 3+ components, it belongs in a store.
- Merge stores that always change together and are always read together — separate files with coordinated mutations signal a missed abstraction.
- Split stores where some components only ever read a subset — over-subscription causes unnecessary re-renders.
- Ensure every state mutation goes through an exported action function — direct `state.field = value` from components is allowed for component-local state only.
- Array spread patterns (`state.items = [...state.items, x]`) → replace with in-place mutations (`state.items.push(x)`).

## Gotcha Checker

- Store file extension `.svelte.ts` required for rune processing. A store named `.ts` compiles but `$state` will not be reactive — mutations silently do nothing.
- `untrack()` missing in save effect — an `$effect` that reads `projectFolder` will re-trigger on folder change before new data loads. Wrap folder reads in `untrack()`.
- `$effect` on high-frequency events (mousemove, scroll) without debounce/throttle is a frame-rate killer.
- `$derived` with expensive computation runs synchronously on every dependency change — memoize heavy work manually if needed.
- Array size in `$state`: unbounded arrays that grow without a cap will eventually OOM.

## Debug

- Store file extension — `.svelte.ts` required. A store named `.ts` compiles but `$state` will not be reactive; mutations silently do nothing.
- `untrack()` missing in save effect — an `$effect` that reads `projectFolder` will re-trigger on folder change before new data loads. Wrap folder reads in `untrack()`.
