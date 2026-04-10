# electron-ipc (generated: 2026-03-31)

## Planner

- IPC tasks must follow the four-file dependency order: main handler → preload bridge → type declaration → ipc.ts helper → renderer component. Plan each as a separate task in this sequence so waves respect the order.
- New IPC channels always require all four locations (ipcMain.handle, preload contextBridge, claude.d.ts, ipc.ts). Plan them as explicit tasks — omitting one breaks the contract silently.
- For features that add IPC event listeners in the renderer: plan an explicit cleanup task so listener accumulation does not fire callbacks multiple times across runs.

## Coder

- New channel requires all four files: (1) `ipcMain.handle('my-channel', ...)` in `src/main/handlers/<domain>.ts`, (2) `myChannel: (...) => ipcRenderer.invoke('my-channel', ...)` in `src/preload/index.ts`, (3) method signature on `ClaudeAPI` in `src/renderer/src/types/claude.d.ts`, (4) typed helper exported from `src/renderer/src/lib/ipc.ts`.
- File-writing handlers must apply `resolve()` + `startsWith()` path traversal guard before any `fs` call.
- New handler files must be imported and called in `src/main/index.ts` — omitting this means the channel is never registered.
- Do NOT add channel names to the legacy `IPC` object in `constants.ts` — use literal strings in the handler and preload.
- All async handlers must have a top-level try/catch returning `{ ok: false, error: e.message }` on failure.

## Implementer

- Apply IPC changes in dependency order: `claude.d.ts` types first, then main handler, then `index.ts` registration, then preload, then `ipc.ts` helper, then stores, then components last.
- File-writing handlers: verify `resolve()` + `startsWith(allowedDir)` guard is present before any `fsPromises` call.
- New handler module: confirm it is imported and called in `src/main/index.ts`.

## Implementer-Triage

- `src/main/handlers/*.ts` tasks: include IPC quadruple requirement and path traversal guard in the brief.
- `src/preload/index.ts` tasks: include contextBridge pattern and IPC quadruple requirement.
- `src/renderer/src/lib/ipc.ts` tasks: include IPC quadruple requirement.
- `src/renderer/src/types/claude.d.ts` tasks: include IPC quadruple requirement and type correctness rules.
- `src/main/index.ts` tasks: include handler registration pattern — new handler files must be registered here.

## Researcher

- `src/renderer/src/types/claude.d.ts` — full IPC API surface (ClaudeAPI interface); check here first to see if a channel already exists before planning a new one.
- `src/main/handlers/*.ts` — existing handler patterns and channel name conventions.
- `src/preload/index.ts` — contextBridge bridge pattern; all exposed methods are here.
- `src/renderer/src/stores/` — reactive store patterns (all `.svelte.ts`); understand how stores consume IPC before designing new channels.
- Flag anything that crosses the main/renderer boundary — any Node.js API used in the renderer is a hard blocker.

## Reviewer

- No Node.js APIs (`fs`, `path`, `child_process`, `ipcMain`, `os`) in renderer code (`src/renderer/`).
- No browser/DOM APIs in main process code (`src/main/`).
- No direct Electron imports in renderer — only `window.claude.*` calls via the contextBridge.
- Preload script uses only `contextBridge` and `ipcRenderer` — nothing else.
- Every new channel has all four locations: `ipcMain.handle` in handlers/, method in contextBridge, type in `ClaudeAPI`, helper in `ipc.ts`.
- Return types in main handlers match what the renderer expects — mismatched shapes are silent runtime bugs.
- No `localStorage` or `sessionStorage` — settings persisted via IPC handlers or project-folder JSON files only.

## Reviewer-Logic

- `ipcMain.handle` callbacks must be `async` if they `await` anything — returning a non-async function that returns a Promise is also acceptable but must be consistent.
- Unhandled rejections in IPC handlers crash the main process — every `async` handler must have a top-level `try/catch` with a structured error return (e.g. `{ error: message }`).
- Renderer callers must handle the `{ error }` response shape from handlers — silent discard of error fields is a bug.
- `ipcMain` handlers returning Promises: do NOT mark `async` if the handler body is `return new Promise(executor)`. Mixing async + new Promise creates double-wrapping.

## Reviewer-Performance

- Listener accumulation — `ipcRenderer.on()` without `offAll()` before each run fires callbacks N times. Cumulative listener count grows with every run — flag if `offAll()` is absent.
- IPC payload size — large objects (file trees, full log buffers) passed over IPC are serialised/deserialised on every call. Flag payloads over ~1MB or calls that fire on every keystroke/tick.
- Main process blocking — `*Sync` file operations (`readFileSync`, `writeFileSync`) on the main process event loop block the renderer. Flag any sync FS call in a handler that is not bounded in size.

## Refactor

- Batch related IPC calls that always fire together into a single channel returning a combined result — avoids serialisation overhead on every interaction.
- Extract repeated IPC wiring (handler + preload + types + ipc.ts) into a consistent pattern — deviations from the quadruple are latent bugs.

## Debug

- IPC channel not found — most common cause: channel added to main handler but not exposed in contextBridge. Check all four locations: handler, preload, claude.d.ts, ipc.ts.
- Listener accumulation — `ipcRenderer.on()` registers a new callback every call. Without `offAll()` at run start, handlers fire N times after N runs.
- Reactive proxy over IPC — Svelte 5 `$state` objects are Proxy wrappers. Strip before sending: `$state.snapshot(obj)` or `JSON.parse(JSON.stringify(obj))`.
- stdout chunking — Claude CLI output arrives as partial lines. Split on `\n`, buffer the trailing fragment; do not assume each data event is a complete line.
- Promise executor naming — if `path.resolve` is in scope, name executor params `(resolvePromise, rejectPromise)` not `(resolve, reject)` — shadowing the import causes silent bugs.
