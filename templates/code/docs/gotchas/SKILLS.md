## Planner

### Universal

- Before planning a new feature, check whether it or something similar already exists in the codebase. Grep for the core noun or verb first. Planning a duplicate wastes the full pipeline.
- Always include an explicit error handling task for any feature involving I/O, network calls, or user input. "Handle errors" is not implicit — name the failure modes in the plan.
- If the feature touches auth, sessions, payments, or PII: flag it as security-sensitive in the plan so reviewer-safety receives the full checklist. Do not assume the reviewer will catch it without the signal.
- If the plan requires secrets or API keys: add an explicit task for secure credential handling. Never plan to hardcode them.

### Electron / Svelte

- IPC tasks must follow the four-file dependency order: main handler → preload bridge → type declaration → ipc.ts helper → renderer component. Plan each as a separate task in this sequence so waves respect the order.
- New IPC channels always require all four locations (ipcMain.handle, preload contextBridge, claude.d.ts, ipc.ts). Plan them as explicit tasks — omitting one breaks the contract silently.
- Store state tasks go before component tasks. A component cannot wire up a store action that doesn't exist yet.
- Svelte 5 store files must use `.svelte.ts` extension — plan the filename explicitly to avoid a coder using `.ts` which breaks rune processing.
- For features with UI: always ask about CSS token usage (project palette is `--gold`, `--blue`, `--red`, `--green`, `--text`, `--dim`, `--border`, `--bg`, `--card`). New colours not in the palette require a separate design decision.
- `position: fixed` does not work inside Electron panels — plan `position: absolute` or flexbox layout instead. Flag this if the feature involves any overlay or floating element.
- For features that add IPC event listeners in the renderer (e.g. `ipcRenderer.on`): plan an explicit cleanup task so listener accumulation doesn't fire callbacks multiple times across runs.

---

## Coder

### Universal

- Never hardcode secrets, API keys, tokens, or credentials. If the plan requires them, flag it and stop — do not invent a storage mechanism not specified in the plan.
- Always write the error path. Every operation that can fail must have a structured failure return. "Happy path only" drafts are incomplete.
- Validate all user-supplied input at the boundary before it touches business logic or persistence. Assume all input is hostile until validated.

### Electron / Svelte

**IPC quadruple — all four locations required (BLOCK if any missing)**

Every new channel must have all four locations. Missing one breaks the contract silently.

```ts
// 1. src/main/handlers/<domain>.ts
ipcMain.handle('my-channel', (_event, { arg }: { arg: string }) => { return { result: arg } })

// 2. src/preload/index.ts — inside contextBridge.exposeInMainWorld
myChannel: (arg: string) => ipcRenderer.invoke('my-channel', { arg }),

// 3. src/renderer/src/types/claude.d.ts — inside ClaudeAPI interface
myChannel(arg: string): Promise<{ result: string }>

// 4. src/renderer/src/lib/ipc.ts
export function myChannel(arg: string) { return c().myChannel(arg) }
```

- File-writing handlers must apply `resolve()` + `startsWith()` path traversal guard before any `fs` call.
- New handler files must be registered in `src/main/index.ts`.
- Do NOT add channel names to the legacy `IPC` object in `constants.ts` — use literal strings.

**Svelte 5 runes — mandatory**

```ts
// Store file (src/renderer/src/stores/foo.svelte.ts)
const state = $state<FooState>({ count: 0, label: '' })
export function getFooState() { return state }
export function increment() { state.count++ }
```

- Use `$state`, `$derived`, `$effect`, `$props` — never `writable()`, `readable()`, `derived()`, or `get()` from `svelte/store`.
- Store files must use `.svelte.ts` extension — `.ts` files cannot process runes.
- `$state` belongs in `.svelte.ts` store files or component `<script>` blocks. Not in plain `.ts` utilities.
- Array mutations: use in-place methods (`push`, `splice`, `sort`) — never spread-replace (`state.items = [...state.items, x]`), which loses fine-grained reactivity.
- `$effect` cleanup: return a cleanup function when registering listeners or intervals (`return () => clearInterval(id)`).
- `untrack()` from `svelte`: read a value inside an effect without registering it as a dependency.

**Windows compatibility**

- Always `path.join()` / `path.resolve()` in the main process — never string concat with `/` or `\\`.
- Process kill: `process.kill()` + `process = null` — `SIGTERM` may not work on Windows.
- Spawn with `shell: !claudeCmd.endsWith('.exe')` for Claude executable detection.

**CSS tokens — project palette only**

`--gold`, `--blue`, `--red`, `--green`, `--text`, `--dim`, `--border`, `--bg`, `--card`, `--gold-dim` — never hardcode hex values.

**No `position: fixed`**

`position: fixed` collapses inside Electron renderer panels. Use `position: absolute` or flex/grid. Root-level modal backdrops are the only safe exception.

---

## Implementer

### Electron / Svelte

**Mandatory dependency order**

Apply changes in this sequence to avoid breaking the build mid-apply:

1. `src/renderer/src/types/claude.d.ts` — add new interfaces/method signatures first
2. `src/main/handlers/<domain>.ts` — add IPC handlers
3. `src/main/index.ts` — register new handler module if applicable
4. `src/preload/index.ts` — expose via contextBridge
5. `src/renderer/src/lib/ipc.ts` — add typed helper
6. `src/renderer/src/stores/*.svelte.ts` — add reactive state
7. `src/renderer/src/components/**/*.svelte` — wire up UI last

**Svelte 5 conventions**

- Never introduce `writable()`, `readable()`, or `get()` — leave legacy patterns alone unless the handoff explicitly updates them.
- No `any` types — use `unknown` with type narrowing.
- `$effect` cleanups must return a function when registering listeners or intervals.

**Code style**

2-space indent, single quotes, semicolons, trailing commas. Match the surrounding file's style exactly.

---

## Implementer-Triage

### Electron / Svelte

**File-type gotcha extraction — use these defaults when building briefs:**

| Target file type | Include from GENERAL.md |
|---|---|
| `.svelte` component | Svelte 5 rune rules; `position: fixed` gotcha; CSS token palette |
| `src/main/handlers/*.ts` | IPC quadruple requirement; path traversal guard; Windows process kill |
| `src/preload/index.ts` | contextBridge pattern; IPC quadruple requirement |
| `src/renderer/src/lib/ipc.ts` | IPC quadruple requirement |
| `src/renderer/src/types/claude.d.ts` | IPC quadruple requirement |
| `src/renderer/src/stores/*.svelte.ts` | Svelte 5 `$state` rules; `.svelte.ts` extension requirement; array mutation rules |
| `src/main/index.ts` | Handler registration pattern |

If the target file doesn't match any row above, omit the gotcha sub-section from the brief.

---

## Researcher

### Universal

- Search the existing codebase for similar patterns before going to the web. The codebase is the highest-fidelity source for how this project solves problems.
- When researching external APIs: always check rate limits, authentication requirements, and error response shapes. These are the three most common sources of integration bugs.
- Do not web-search standard language or browser APIs (localStorage, fetch, innerHTML, addEventListener, Date.now(), CSS pseudo-classes, ARIA attributes, etc.). Only use WebSearch for genuinely unknown external APIs, third-party library behaviour, or version-specific constraints not verifiable from the codebase.
- Do not check caniuse.com for mainstream browser APIs — Fetch, Geolocation, CSS Grid, Flexbox, Promise, async/await, and any API with >95% global support need no compatibility check.
- One-fetch rule: never fetch the same URL more than once per session. Use what you already have in context.
- No bash commands — use Glob/Grep to find files, Read to read, Write to write. `ls`, `find`, `cat`, `echo`, and all heredoc patterns are forbidden.
- One-read rule: read each file path exactly once. Never re-read a file already in context.
- Use the Write tool for research output — never bash cat/echo/heredoc commands. One Write call replaces ten bash commands.

### Electron / Svelte

**Research priorities — check in this order:**

1. **Existing codebase patterns first** — grep for similar functionality before going to the web. The codebase is consistent; matching existing patterns is almost always correct.
2. **Electron/IPC constraints** — flag anything crossing the main/renderer boundary. Any Node.js API used in the renderer is a hard blocker.
3. **Svelte 5 compatibility** — confirm any third-party library works with Svelte 5 runes and electron-vite. Libraries built for Svelte 4 stores are not compatible.
4. **Windows compatibility** — FORGE runs on Windows 11. Flag any Unix-only APIs, POSIX paths, or `SIGTERM` assumptions.

**Key files for researching IPC and architecture:**

- `src/renderer/src/types/claude.d.ts` — full IPC API surface (ClaudeAPI interface)
- `src/main/handlers/*.ts` — existing handler patterns and channel names
- `src/preload/index.ts` — contextBridge bridge pattern
- `src/renderer/src/stores/` — reactive store patterns (all `.svelte.ts`)
- `src/renderer/src/lib/constants.ts` — shared constants, MODES, PIPELINES

---

## Refactor

### Electron / Svelte

**Svelte 5 refactoring patterns**

- Extract shared state into `.svelte.ts` stores rather than passing props deeply. If the same value is read in 3+ components, it belongs in a store.
- Split large `.svelte` files: keep `<script>` logic lean — move derived computations to stores, move IPC calls to `ipc.ts`, move constants to `constants.ts`.
- Replace prop-drilling with store getter calls. Prop chains longer than 2 levels are a smell.
- Replace `createEventDispatcher` (Svelte 4) with callback props (`onX: () => void` in `$props()`).
- Array spread patterns (`state.items = [...state.items, x]`) → in-place mutations (`state.items.push(x)`).

**Store refactoring**

- Merge stores that always change together and are always read together. Separate files with coordinated mutations signal a missed abstraction.
- Split stores where some components only ever read a subset — over-subscription causes unnecessary re-renders.
- Ensure every state mutation goes through an exported action function. Direct `state.field = value` from components is allowed for component-local state but not for shared store state.

**IPC refactoring**

- Batch related IPC calls that always fire together into a single channel returning a combined result.
- Extract repeated IPC wiring (declare in handler + preload + types + ipc.ts) into a consistent pattern — deviations from the quadruple are bugs waiting to happen.

**Component structure**

- Extract repeated UI patterns (badge, tag, status dot) into shared components in `src/renderer/src/components/` rather than duplicating markup.
- Move inline styles into scoped `<style>` blocks using CSS tokens.
- Replace magic numbers with named constants in `constants.ts`.

---

## Debug

### Universal

- Trace the full call path from trigger to observed failure before forming a hypothesis. Most bugs are not where the symptom appears.
- Check the most recent changes first — the majority of bugs are regressions from the last edit. `git diff` before reading the whole codebase.

### Electron / Svelte

**Most bugs cross a process boundary — trace the full path first:**

```
Main process (Node.js)  ←→  Preload (contextBridge)  ←→  Renderer (Svelte)
```

**Common FORGE bug patterns — check in this order**

- **IPC channel not found** — most common cause: channel added to main handler but not exposed in contextBridge. Check all four locations: main handler, preload, types, ipc.ts.
- **Listener accumulation** — `ipcRenderer.on()` registers a new callback every call. Without `offAll()` at run start, handlers fire N times after N runs.
- **Reactive proxy over IPC** — Svelte 5 `$state` objects are Proxy wrappers. Strip before sending: `$state.snapshot(obj)` or `JSON.parse(JSON.stringify(obj))`.
- **Store file extension** — `.svelte.ts` required for rune processing. A store named `.ts` compiles but `$state` won't be reactive — mutations silently do nothing.
- **`untrack()` missing in save effect** — an `$effect` that reads `projectFolder` will re-trigger on folder change before new data loads. Wrap folder reads in `untrack()`.
- **Windows process kill** — `SIGTERM` not supported on Windows. Use `claudeProcess.kill()` + `claudeProcess = null`.
- **stdout chunking** — Claude CLI output arrives as partial lines. Split on `\n`, buffer the trailing fragment.
- **`position: fixed` collapse** — collapses to zero inside Electron panels. Use `position: absolute` or flex/grid.

---

## Reviewer

### Electron / Svelte

**Three-layer boundary checklist**

- No Node.js APIs (`fs`, `path`, `child_process`, `ipcMain`, `os`) in renderer code (`src/renderer/`)
- No browser/DOM APIs in main process code (`src/main/`)
- No direct Electron imports in renderer — only `window.claude.*` calls via the contextBridge
- Preload script uses only `contextBridge` and `ipcRenderer` — nothing else

**IPC completeness checklist**

Every new channel must have all four locations:
- [ ] `ipcMain.handle('channel-name', ...)` in `src/main/handlers/`
- [ ] Method exposed via `contextBridge` in `src/preload/index.ts`
- [ ] Type signature in `ClaudeAPI` in `src/renderer/src/types/claude.d.ts`
- [ ] Helper function in `src/renderer/src/lib/ipc.ts`
- [ ] Return types in main handlers match what the renderer expects

**Svelte 5 correctness**

- Only Svelte 5 rune APIs: `$state`, `$derived`, `$effect`, `$props` — no `writable()`, `readable()`, `get()`
- Store files use `.svelte.ts` extension (not `.ts`)
- `$effect` cleanups return a function when registering listeners or intervals

**TypeScript correctness**

- No `any` types — use `unknown` with type narrowing
- No unguarded non-null assertions (`!`) without explanatory comment
- All function parameters and return types explicitly typed
- New types/interfaces exported from the appropriate file

**Windows compatibility**

- File paths use `path.join()` — never string concatenation with `/` or `\\`
- Claude CLI referenced as `process.platform === 'win32' ? 'claude.cmd' : 'claude'`
- No Unix-only API assumptions

**Persistence**

- No `localStorage` or `sessionStorage`
- Settings persisted via IPC handlers or project-folder JSON files only

---

## Reviewer-Logic

### Universal

- Always verify the error path leaves the system in a consistent state — not just that the happy path works.
- Check for race conditions wherever async operations share mutable state, regardless of language.
- Confirm that input validation happens before any state mutation or persistence write — never after.

### Electron / Svelte

**Svelte 5 reactive patterns to check**

- **Stale closure in `$effect`** — an effect that reads a reactive value inside a callback (e.g. a setTimeout or event handler inside the effect body) captures the value at registration time, not at callback time. Use `$state.snapshot()` or access the reactive value directly inside the callback.
- **Re-entrancy in `$effect`** — an effect that writes to the same reactive value it reads from will loop infinitely. Check for circular dependencies.
- **Event listeners in `$effect` without cleanup** — `window.addEventListener` inside an effect must be matched by `return () => window.removeEventListener(...)`. Missing cleanup accumulates listeners across re-renders.
- **Prop defaults via `$props()`** — use `let { value = defaultVal }: { value?: Type } = $props()` not `$props().value ?? defaultVal` — the latter defeats Svelte's reactivity tracking on the prop.
- **`createEventDispatcher`** — Svelte 4 pattern; should be `onX` callback props in Svelte 5. Flag if introduced in new code (leave existing usages alone).
- **Conditional `$effect` registration** — `$effect` must be called unconditionally at component initialisation (not inside an `if` block). Conditional logic goes inside the effect body.

**IPC async patterns**

- `ipcMain.handle` callbacks must be `async` if they `await` anything — returning a non-async function that returns a Promise is also acceptable but must be consistent.
- Unhandled rejections in IPC handlers crash the main process — every `async` handler must have a top-level `try/catch` with a structured error return (e.g. `{ error: message }`).
- Renderer callers must handle the `{ error }` response shape from handlers — silent discard of error fields is a bug.

---

## Reviewer-Performance

### Electron / Svelte

**Svelte reactive patterns**

- `$effect` on high-frequency events (mousemove, scroll, resize) without debounce/throttle is a frame-rate killer. Flag any `$effect` that subscribes to DOM events without a rate limiter.
- `$derived` with expensive computation (array sort, filter, deep clone) runs synchronously on every dependency change. Flag if the input collection is large or the computation is O(n²)+.
- Array size in `$state`: unbounded arrays that grow without a cap will eventually OOM. Flag `push()` calls inside `$effect` or IPC handlers with no corresponding trim/slice.

**Electron / IPC**

- **Listener accumulation** — `ipcRenderer.on()` without `offAll()` before each run fires callbacks N times. Cumulative listener count grows with every run.
- **IPC payload size** — large objects (file trees, full log buffers) passed over IPC are serialised/deserialised on every call. Flag payloads > ~1MB or calls that fire on every keystroke/tick.
- **Main process blocking** — `*Sync` file operations (`readFileSync`, `writeFileSync`) on the main process event loop block the renderer. Flag any sync FS call not inside an `ipcMain.handle` response path (where blocking is expected but should be bounded).

**Component lifecycle**

- `$effect` registered without cleanup for intervals/timeouts/listeners leaks across component mount/unmount cycles. Every `setInterval`, `setTimeout` (if repeating), and `addEventListener` in an effect needs a cleanup return.
- Avoid expensive DOM reads (`getBoundingClientRect`, `offsetHeight`) inside reactive effects — they force layout recalculation on every dependency change.

---

## Reviewer-Safety

### Universal

- Auth changes: check for session fixation, privilege escalation, missing re-authentication on sensitive actions, and insecure defaults regardless of stack.
- Payment flows: verify no card data is logged, stored in plain text, returned to the client, or passed through URLs. This applies in any language.
- PII handling: personal data must not appear in logs, URLs, or error messages. Flag if new fields are introduced that could contain PII without a stated retention or access policy.

### Electron / Svelte

**Electron security baseline**

- `contextIsolation: true` — must be enabled; renderer cannot access Node APIs directly.
- `nodeIntegration: false` — must be disabled; renderer runs in a browser sandbox.
- `sandbox: false` is currently required for preload scripts in this setup — note as accepted risk, do not change without testing.
- `webSecurity: false` and `allowRunningInsecureContent: true` are both forbidden — flag immediately as BLOCK if introduced.

**IPC handler validation**

- Every `ipcMain.handle` that accepts user-controlled input (file paths, strings, JSON) must validate and sanitise at the boundary before using the value.
- File path parameters: apply `path.resolve()` + `startsWith(allowedDir)` traversal guard before any `fs` operation.
- String parameters interpolated into shell commands or YAML/Markdown: strip newlines with `.replace(/[\r\n]/g, ' ').trim()`.
- Never pass user input directly to `spawn` or `exec` as part of the command string — use the argv array form.

**Process lifecycle**

- `SIGTERM` is not supported on Windows — using it to kill `claude` child process will silently fail. Use `childProcess.kill()` (sends SIGTERM on Unix, TerminateProcess on Windows) followed by null-assignment.
- Never expose `ipcMain` or `BrowserWindow` references to the renderer side.

**Secrets and credentials**

- No API keys, tokens, or credentials hardcoded in source files.
- No sensitive data written to `localStorage` or `sessionStorage` (both persist across sessions and are accessible to any script).
- Settings persisted to project-folder JSON files should not include secrets — flag if a new settings field appears to store auth tokens.

---

## Reviewer-Style

### Electron / Svelte

**File naming conventions**

- Svelte components: `PascalCase.svelte` (e.g. `SettingsModal.svelte`, `TodoPanel.svelte`)
- Store files: `camelCase.svelte.ts` (e.g. `session.svelte.ts`, `run.svelte.ts`)
- Handler files: `kebab-case.ts` (e.g. `pipeline-data.ts`, `project-agents.ts`)
- Utility/lib files: `camelCase.ts` (e.g. `ipc.ts`, `constants.ts`, `runner.ts`)

**Svelte component structure — always in this order**

```svelte
<script lang="ts">
  // imports, props, state, effects
</script>

<!-- template -->

<style>
  /* scoped CSS */
</style>
```

**Svelte 5 idioms**

- Props via `$props()` destructuring — not individual `export let` declarations.
- Callbacks as props (`onsubmit: () => void`) — not `createEventDispatcher`.
- No `on:click` directive syntax (Svelte 4) — use `onclick={handler}` (Svelte 5).

**CSS conventions**

- CSS tokens only: `--gold`, `--blue`, `--red`, `--green`, `--text`, `--dim`, `--border`, `--bg`, `--card`, `--gold-dim`. No hardcoded hex values.
- All styles scoped to the component `<style>` block — no global CSS unless intentionally in `global.css`.
- Font families via CSS variables: `var(--font-mono)`, `var(--font-label)`.
- `position: fixed` is forbidden inside renderer panels — use `position: absolute` or flex/grid.
- Electron titlebar drag region: use `-webkit-app-region: drag` on the titlebar element; interactive children need `-webkit-app-region: no-drag`.

**TypeScript style**

- 2-space indent, single quotes, semicolons, trailing commas.
- `import type { ... }` for type-only imports.
- No `any` — use `unknown` with narrowing.
- Explicit return types on all exported functions.

---

## Reviewer

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

- `verdict`: `APPROVED` (no issues), `REVISE` (minor issues, gate proceeds), or `BLOCK` (hard blockers, gate disabled)
- `blockers`: integer count of BLOCK-level findings; 0 if APPROVED
- `warnings`: integer count of REVISE-level findings; 0 if APPROVED or BLOCK
- `feature`: taken verbatim from the feature name heading in your review output
- Each reviewer emits its own signal independently; do not aggregate other reviewers' verdicts

---

## Tool-call-auditor

- After completing your audit and emitting any findings, emit the following as the **last line** of your output:
  `[pipeline-summary] mode=<apply-pipeline-mode> verdict=N/A`
- If agent-optimizer is triggered (recurring deviation found), do **not** emit `[pipeline-summary]` — that becomes agent-optimizer's responsibility after it presents its proposed changes.
- Never emit `[pipeline-summary]` more than once per run.
