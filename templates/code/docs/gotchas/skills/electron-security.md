# electron-security (generated: 2026-03-31)

## Planner

- If the feature touches auth, sessions, payments, or PII: flag it as security-sensitive in the plan so reviewer-safety receives the full checklist.
- If the plan requires secrets or API keys: add an explicit task for secure credential handling. Never plan to hardcode them.

## Coder

- `contextIsolation: true` — must be enabled; renderer cannot access Node APIs directly.
- `nodeIntegration: false` — must be disabled; renderer runs in a browser sandbox.
- `webSecurity: false` and `allowRunningInsecureContent: true` are both forbidden.
- Every `ipcMain.handle` that accepts user-controlled input (file paths, strings) must validate at the boundary: `path.resolve()` + `startsWith(allowedDir)` traversal guard before any `fs` operation.
- String parameters interpolated into shell commands or YAML: strip newlines with `.replace(/[\r\n]/g, ' ').trim()`.
- Never pass user input directly to `spawn` or `exec` as part of the command string — use the argv array form.
- No API keys, tokens, or credentials hardcoded in source files.
- No sensitive data written to `localStorage` or `sessionStorage`.

## Implementer

- Verify `contextIsolation: true` and `nodeIntegration: false` remain set after any BrowserWindow config change.
- Every write handler: confirm `resolve()` + `startsWith()` path traversal guard is present before any `fsPromises` call.

## Researcher

- Flag anything crossing the main/renderer process boundary — any Node.js API used in the renderer is a hard blocker.
- Confirm any third-party library works with Svelte 5 runes and electron-vite — libraries built for Svelte 4 stores are not compatible.
- FORGE runs on Windows 11 — flag any Unix-only APIs, POSIX paths, or SIGTERM assumptions.

## Reviewer

- `contextIsolation: true` — must be enabled.
- `nodeIntegration: false` — must be disabled.
- `webSecurity: false` — must NOT be present; flag as BLOCK if introduced.
- Every IPC handler with user-controlled file path input has `resolve()` + `startsWith()` guard.
- No secrets hardcoded in any source file.
- No sensitive data in `localStorage` or `sessionStorage`.
- Settings persisted to project-folder JSON files must not include auth tokens or credentials.

## Gotcha Checker

- `sandbox: false` is currently required for preload scripts in this FORGE setup — accepted risk, do not change.
- `SIGTERM` is not supported on Windows — use `childProcess.kill()` (sends TerminateProcess on Windows) followed by null-assignment.
- Never expose `ipcMain` or `BrowserWindow` references to the renderer side via contextBridge.

## Debug

- Windows process kill — `SIGTERM` is not supported on Windows. Use `claudeProcess.kill()` + `claudeProcess = null` to terminate the child process.
- Spawn with `shell: !claudeCmd.endsWith('.exe')` — `.exe` uses `shell: false` to avoid double-escaping; `.cmd` uses `shell: true`.
