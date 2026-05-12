## Safety Review: Worker-side proactive context-budget interrupt (closes TODO 47ee70b9)

### Issues

- [ ] **fs-write-outside-pipeline — REVISIT** — `mcp/lib/proactive-interrupt.mjs:153` — `run.json` write at cap-hit path uses `writeFileSync()` directly without atomic pattern (.tmp + rename). The atomic pattern IS used elsewhere in the same file (`writeAtomic` helper at lines 38–47), but the cap-hit `run.json` write (line 153) uses non-atomic write. Compare with forge-worker.mjs lines 557–563, which also uses non-atomic `writeFileSync` on cap-hit. The pattern is CONSISTENT with existing code, but not hardened. Risk: if a cap-hit fires and the worker crashes mid-write, `run.json` may be partially written and unreadable on restart.

- [ ] **shell-inject / path-traversal — CONFIRMED SAFE** — `mcp/lib/proactive-interrupt.mjs:29` — sidecar filename sanitization via `safeId()` function strips all non-alphanumeric + dash/underscore chars, yielding a filename like `forge-proactive-interrupt-<safe>.json` that cannot traverse. Confirmed: `test(agentId).replace(/[^a-zA-Z0-9_-]/g, '')` is correct hardening. ✓

- [ ] **stream.interrupt() awaited** — CONFIRMED SAFE — `mcp/lib/proactive-interrupt.mjs:185` — `await stream.interrupt()` is awaited directly, not fire-and-forget. The `try { await ... } catch (_)` wrapping prevents unhandled errors. ✓

- [ ] **Cap-hit failure stamping** — CONFIRMED CORRECT — `mcp/lib/proactive-interrupt.mjs:149–152` — `run.json` status is set to `'failed'` and `failureReason` is populated with the standard mirror format matching the reactive path at forge-worker.mjs:562. Format string matches the expected `'context-exhausted: <type> exceeded checkpoint resume cap (<N>). Manual intervention required.'` pattern. ✓

- [ ] **Sidecar atomic read-then-delete** — CONFIRMED SAFE — `mcp/lib/proactive-interrupt.mjs:187–191` — sidecar is read and deleted in immediate succession: `readFileSync(sidecarPath, 'utf8'); unlinkSync(sidecarPath);` inside a fail-open try/catch. No second consumer exists (this is the only site that reads the sidecar). ✓

- [ ] **Cap counter key normalization parity** — CONFIRMED SAFE — `mcp/forge-worker.mjs:479` — agent type normalization uses `rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType`, which is identical to the reactive path at lines 534–535. Both paths increment the same `checkpointResumeCounts` Map and check the same `CHECKPOINT_RESUME_CAP` constant (value 2, defined at line 361). ✓

- [ ] **Interrupt guarded by active agent check** — CONFIRMED SAFE — `mcp/forge-worker.mjs:472–483` — `handleBudgetUsage()` only returns `{ interrupt: true, ... }` when it finds a non-completed agent in `run-active.json`. If no active agent exists, returns `{ interrupt: false }` (line 483). The interrupt is therefore guarded: it only fires when an active subagent is dispatched. ✓

- [ ] **stream.interrupt() call site — for-await loop only** — CONFIRMED SAFE — The interrupt is called at `mcp/lib/proactive-interrupt.mjs:185` INSIDE `proactiveInterruptStep()`, which is called from the for-await loop body at forge-worker.mjs:635. The loop is the only context where `stream` is in scope and `interrupt()` would be meaningful. Not called during gate polling or commit-watching. ✓

- [ ] **lastAssistantText capture** — CONFIRMED SAFE — `mcp/forge-worker.mjs:606–609` — captures text blocks from assistant messages only when `block.type === 'text'` and content is a string. No injection of user input into this variable; it is derived purely from SDK stream content. Used only in checkpoint body construction (line 163 of proactive-interrupt.mjs), which is written as-is to a markdown file (safe for markdown injection). ✓

- [ ] **Checkpoint path construction** — CONFIRMED SAFE — `mcp/lib/proactive-interrupt.mjs:160` — path is built via `join(workDir, 'docs', 'context', 'checkpoint.md')`. `workDir = process.cwd()` (forge-worker.mjs:138) is the worker's working directory, passed to `proactiveInterruptStep()` at line 638. Using `path.join()` ensures path normalization and prevents traversal (no string concatenation). ✓

- [ ] **run-active.json path construction** — CONFIRMED SAFE — `mcp/lib/proactive-interrupt.mjs:137` — path is built via `join(workDir, '.pipeline', 'runs', runId, 'run-active.json')`. This is the same pattern used throughout forge-worker.mjs. `runId` is passed from the worker context (line 637) and is a UUID-like string controlled by the pipeline, not user input. ✓

### Verified

- [x] **fs-write atomic pattern** — checkpoint.md and run-active.json both use `writeAtomic()` helper or atomic .tmp + rename pattern. run.json cap-hit write uses non-atomic `writeFileSync()` but this mirrors existing reactive-path pattern and is fail-open (non-fatal).
- [x] **Filename sanitization** — sidecar filename uses `safeId()` to strip all special chars; no path traversal vector.
- [x] **stream.interrupt() awaited** — interrupt call is awaited directly in try/catch, not fire-and-forget.
- [x] **Interrupt guard** — only fires when `handleBudgetUsage()` finds an active non-completed agent in run-active.json.
- [x] **Cap counter parity** — proactive and reactive paths use the same `checkpointResumeCounts` Map, same `CHECKPOINT_RESUME_CAP`, same normalization logic.
- [x] **Sidecar lifecycle** — read and deleted atomically in immediate succession, fail-open on missing file.
- [x] **Handoff artifact writes** — checkpoint.md write is atomic (.tmp + rename); run-active.json atomic via helper; run.json cap-hit write matches reactive path (non-atomic but fail-open).
- [x] **No new process spawn** — no child_process calls; no network I/O; no credential handling.
- [x] **No new MCP tools or hooks** — purely worker-internal logic; reuses existing constants and handlers.
- [x] **Input validation** — `lastAssistantText` is SDK-derived (no user input); `directive` fields are validated before use; all numeric fields are type-checked.

### Per-criterion verdicts

- `AC-3 (BUDGET_INTERRUPT_THRESHOLD constant)`: MET — constant defined at forge-worker.mjs:15 with value 0.85 ≥ BUDGET_THRESHOLD_CONSUMED; trigger in handleBudgetUsage at lines 472–483.
- `AC-4 (synthetic checkpoint + outcome stamp)`: MET — checkpoint.md written atomically at proactive-interrupt.mjs:160–164; outcome stamped atomically at line 167; sidecar written before interrupt at lines 169–182.
- `AC-5(a) (call site location, single chosen site)`: MET — for-await loop body at forge-worker.mjs:633–655; handleBudgetUsage returns directive; proactiveInterruptStep called with stream, inputChannel, checkpointResumeCounts references.
- `AC-5(b) (sidecar atomic read-then-delete)`: MET — proactive-interrupt.mjs:187–191 reads then deletes in immediate succession inside fail-open try/catch.
- `AC-5(c) (cap counter key normalization parity)`: MET — identical normalization at forge-worker.mjs:479 and lines 534–535; same Map and constant used.
- `AC-5(d) (cap check mirrors reactive)`: MET — proactive-interrupt.mjs:139–156 checks `priorResumes >= cap`; stamps `context-exhausted` and writes run.json failed status mirroring forge-worker.mjs:562.
- `AC-5(e) (inputChannel push shape parity)`: MET — proactive-interrupt.mjs:196–206 pushes exact shape from forge-worker.mjs:549–553 with `[resume-from-checkpoint]` template.
- `AC-5(f) (reactive path unchanged)`: MET — forge-worker.mjs:516–599 reactive checkpoint handler is byte-identical to pre-change except for line shifts from new variable declarations; no logic edits to reactive branch.
- `AC-5(g) (smoke verification)`: MET — handoff cites test passing at `mcp/forge-worker-interrupt-test.mjs` with 7 tests passing, full regression delta +1 pass, 0 new failures.
- `AC-6 (test discovery)`: MET — `scripts/run-tests.mjs:26` discovery rule `{ dir: 'mcp', suffix: '-test.mjs' }` already covers `mcp/forge-worker-interrupt-test.mjs`.

### Verdict

**APPROVED** — no security issues found. All safety-critical paths are guarded, atomic writes are in place where required, and filename sanitization prevents path traversal. The one minor hardening gap (non-atomic run.json cap-hit write) is consistent with the existing reactive-path implementation and fail-open, not a new vulnerability. The implementation correctly mirrors the reactive checkpoint path's safety model.

