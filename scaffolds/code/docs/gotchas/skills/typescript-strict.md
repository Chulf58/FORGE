# typescript-strict (generated: 2026-03-31)

## Coder

- No `any` — use `unknown` and narrow, or define the interface.
- No non-null assertions (`!`) without an inline comment explaining why it is safe.
- Explicit return types on all exported functions.
- `import type { ... }` for type-only imports.
- 2-space indent, single quotes, semicolons, trailing commas in multi-line structures.
- No `console.log` in committed code.
- No commented-out code blocks.
- Always `path.join()` / `path.resolve()` in the main process — never string concat with `/` or `\\`.
- Spawn with `shell: !claudeCmd.endsWith('.exe')` for Claude executable detection on Windows.

## Implementer

- No `any` types — use `unknown` with narrowing.
- `import type { ... }` for type-only imports.
- 2-space indent, single quotes, semicolons, trailing commas. Match the surrounding file's style exactly.
- Always `path.join()` / `path.resolve()` in main process files — never string concatenation.

## Researcher

- Search the existing codebase for similar patterns before going to the web — the codebase is the highest-fidelity source for how this project solves problems.
- When researching external APIs: always check rate limits, authentication requirements, and error response shapes — these are the three most common sources of integration bugs.
- FORGE runs on Windows 11 — flag any Unix-only APIs, POSIX paths, or SIGTERM assumptions before recommending a solution.
- One-fetch rule: never fetch the same URL more than once per session — use what is already in context.
- One-read rule: read each file path exactly once — never re-read a file already in context.

## Reviewer

- No `any` types — use `unknown` with narrowing.
- No unguarded non-null assertions (`!`) without explanatory comment.
- All function parameters and return types explicitly typed.
- New types/interfaces exported from the appropriate file.
- File paths use `path.join()` — never string concatenation with `/` or `\\`.
- No Unix-only API assumptions in code targeting Windows.
- No `*Sync` fs calls (`readFileSync`, `writeFileSync`) in IPC handlers — they block the event loop and freeze the UI.

## Reviewer-Performance

- `*Sync` file operations (`readFileSync`, `writeFileSync`, `readdirSync`) on the main process event loop block the renderer — flag any sync FS call not bounded in size or frequency.

## Refactor

- Replace magic numbers with named constants in `constants.ts`.
- `import type { ... }` for all type-only imports — reduces bundle size and makes dependencies explicit.

## Gotcha Checker

- Always `path.join()` / `path.resolve()` in the main process — never string concat with `/` or `\\`.
- No `*Sync` fs calls (`writeFileSync`, `readFileSync`, `readdirSync`) in IPC handlers — they block the event loop and freeze the UI. Use `fsPromises.*` equivalents.
