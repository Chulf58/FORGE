## Active Plan

### Feature: Smart Module Assignment

- [ ] 1. Add `classify-module` IPC handler to `src/main/handlers/pipeline-data.ts`
  Accepts `{ title, description, modules, projectFolder }`. Builds a structured prompt from module `id`, `name`, `description`, `notes`, and `capabilities[].text` fields and calls `spawnClaudeJson` with `claude-haiku-4-5-20251001`. Returns `{ action: 'ASSIGN' | 'RESTRUCTURE' | 'CREATE', moduleId?: string, newModuleName?: string, newModuleDescription?: string, reason: string }`. Times out after 10 s and returns `{ action: 'ASSIGN', moduleId: fallback }` using the existing `guessModule()` result as fallback. On any error also falls back to guessModule result.
  Verify: handler registered and returns a typed object with `action` field; calling with a known module set returns ASSIGN for a matching title.

- [ ] 2. Register the new channel in `src/preload/index.ts`
  Expose `classifyModule(title, description, modules, projectFolder)` on the `window.claude` contextBridge object, calling `ipcRenderer.invoke('classify-module', ...)`.
  Verify: `window.claude.classifyModule` is present in DevTools after app reload.

- [ ] 3. Add typed method signature to `ClaudeAPI` in `src/renderer/src/types/claude.d.ts`
  Add `classifyModule(title: string, description: string, modules: AppModule[], projectFolder: string): Promise<ClassifyModuleResult>`. Define `ClassifyModuleResult` interface with `action`, `moduleId?`, `newModuleName?`, `newModuleDescription?`, `reason` fields.
  Verify: TypeScript compilation succeeds with the new interface; `ClassifyModuleResult` is importable from the types file.

- [ ] 4. Add `classifyModule` helper in `src/renderer/src/lib/ipc.ts`
  Export `classifyModule(title, description, modules, projectFolder)` wrapping `c().classifyModule(...)`, matching the pattern of existing helpers like `enrichTodo`.
  Verify: function is exported and TypeScript resolves its return type to `Promise<ClassifyModuleResult>`.

- [ ] 5. Add prompt template and model constant to `src/renderer/src/lib/constants.ts` alongside enrich-todo config
  Add `CLASSIFY_MODULE_MODEL = 'claude-haiku-4-5-20251001'` and `CLASSIFY_MODULE_PROMPT_TEMPLATE` string. The template must instruct the LLM to output valid JSON matching `ClassifyModuleResult`, include the three action types with clear criteria (ASSIGN when a module clearly matches, RESTRUCTURE when an existing module should absorb this capability under a clearer name, CREATE when no module fits), and include a `reason` field.
  Verify: constants exported; template string includes all three action keywords and a JSON output instruction.

- [ ] 6. Replace inline `guessModule()` call in `promoteTodoToPlanned()` with async LLM classification in `src/renderer/src/stores/project.svelte.ts`
  Make `promoteTodoToPlanned` async. After the todo is found, call `classifyModule(title, description, modules, projectFolder)` via ipc.ts. On ASSIGN result, use the returned `moduleId`. On any error or timeout (indicated by fallback result), use the existing `guessModule()` result. Store the raw `ClassifyModuleResult` on the planned item for use by the confirmation step. Return `Promise<string | null>`.
  Verify: `promoteTodoToPlanned` is async; a successful LLM call sets `moduleName` on the new planned item; errors fall back silently without blocking promotion.

- [ ] 7. Add `moduleClassifyPending` state to `src/renderer/src/stores/ui.svelte.ts` for RESTRUCTURE/CREATE confirmation flow
  Add `moduleClassifyPending: ClassifyModuleResult & { plannedId: string } | null` to `UIState`. Export `setModuleClassifyPending(result)` and `clearModuleClassifyPending()` actions.
  Verify: state field initialises to `null`; setter and clearer exported and type-correct.

- [ ] 8. Add `'module-classify'` to the modal union in `src/renderer/src/stores/ui.svelte.ts`
  Extend `openModal` discriminated union to include `'module-classify'`. This allows the existing `openModal` / `closeModal` flow to surface the confirmation dialog.
  Verify: TypeScript compilation succeeds; `openModal('module-classify')` type-checks without error.

- [ ] 9. Create `src/renderer/src/components/overlays/ModuleClassifyModal.svelte`
  Renders when `ui.openModal === 'module-classify'` and `ui.moduleClassifyPending` is non-null. Shows the LLM's `reason`, the proposed action (RESTRUCTURE or CREATE), and the new module name/description. Two buttons: "Apply" (calls `applyModuleClassify()`) and "Cancel" (calls `closeModal()` and `clearModuleClassifyPending()`). ASSIGN actions never reach this modal — they are applied silently.
  Verify: modal renders with the pending result data; Apply button is disabled when `reason` is empty; Cancel dismisses without mutating modules.

- [ ] 10. Wire RESTRUCTURE/CREATE confirmation into `src/renderer/src/stores/project.svelte.ts`
  Export `applyModuleClassify(result: ClassifyModuleResult, plannedId: string)`. For RESTRUCTURE: update the existing module's name and description via `updateModule()`. For CREATE: call `addModule()` with `newModuleName` and `newModuleDescription`, then set the planned item's `moduleName` to the new module's name. After applying, call `clearModuleClassifyPending()` and `closeModal()`.
  Verify: RESTRUCTURE updates the matching module's name in `state.modules`; CREATE pushes a new module and assigns it to the planned item; modal closes after either action.

- [ ] 11. Wire the modal into `src/renderer/src/App.svelte`
  Add `{#if ui.openModal === 'module-classify'}<ModuleClassifyModal />{/if}` alongside the existing overlay branches. Import `ModuleClassifyModal`.
  Verify: opening `'module-classify'` modal renders the overlay; other modals are unaffected.

- [ ] 12. Update callers of `promoteTodoToPlanned` in `App.svelte` to handle the new async signature and RESTRUCTURE/CREATE pending state
  `await promoteTodoToPlanned(...)`. After promotion, if `ui.moduleClassifyPending` is non-null with action RESTRUCTURE or CREATE, call `openModal('module-classify')` to surface the confirmation. ASSIGN actions need no UI — the module is already applied.
  Verify: after a plan feature run, Gate #1 approval triggers promotion; for ASSIGN the planned item gets its module silently; for RESTRUCTURE/CREATE the confirmation modal appears.

### Research needed
- `spawnClaudeJson` in `pipeline-data.ts` — confirm it accepts an optional `cwd` string as third param vs second param ordering (the `enrich-todo` handler passes `cwd` as second arg and model as third; verify the signature hasn't changed).
- Confirm whether `promoteTodoToPlanned` callers in `App.svelte` use `await` already or if they fire-and-forget (the current implementation is sync, so callers likely don't await).
- The `guessModule()` function in the store is private (no `export`). Confirm it can be called from within the same file for the fallback path — it can, but note the RESTRUCTURE/CREATE branch calls store actions from within the store which is the correct pattern.

### Approach summary
**Key decisions:**
- Extend `pipeline-data.ts` (existing Haiku call pattern) rather than a new handler file — lowers boilerplate, keeps enrichment-class calls co-located.
- ASSIGN is silent and auto-applied; only RESTRUCTURE/CREATE trigger a modal confirmation — matches user's answer 2 and avoids unnecessary interruptions for the common case.

**Trade-offs accepted:**
- `promoteTodoToPlanned` becomes async, requiring caller updates in App.svelte — unavoidable given the LLM call must complete before the planned item's module is set.
- Fallback to `guessModule()` on timeout/error means the existing keyword matcher remains as a safety net — no regression risk for existing behaviour.

**Uncertainties:**
- Whether the 10 s timeout should be implemented as a `Promise.race` in the handler or in the store call — plan leaves this to the implementer; either location is valid given the fallback is the same.
