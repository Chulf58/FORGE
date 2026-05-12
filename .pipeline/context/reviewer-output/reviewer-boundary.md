## Boundary Review: Worker-side proactive context-budget interrupt (closes TODO 47ee70b9)

### Findings

- **AC-1: Sidecar coordination contract** — Task 4 specifies a proactive-interrupt sidecar (`forge-proactive-interrupt-<agentId>.json`) as "belt-and-suspenders" to record the intended outcome. However, Task 5's Verify line does not clearly specify the read/delete lifecycle contract. The plan states the sidecar is read in Task 5, but does not specify: (a) whether it is read atomically with deletion (single operation), or (b) whether the task_notification handler is responsible for cleanup if the sidecar persists. Recommend Task 5 Verify clarify: "read and delete atomically in a single file operation in the proactive-interrupt code site (forge-worker.mjs lines ~433–478), or Task 5 Verify should add a cleanup statement like "...deleted by the resume injection site or (if not reached) cleaned up on the next task_notification handler cycle."

- **AC-2: Cap counter key derivation parity** — The reactive checkpoint path (forge-worker.mjs lines 503–540) normalizes agent type with `rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType` before storing in `checkpointResumeCounts`. Task 5 Verify line says "the same key derivation as the reactive path" but does not cite this specific normalization code. Task 5 should explicitly state: "normalize the agent type by removing 'forge:' prefix if present (same as lines 503–504) before storing in checkpointResumeCounts, using the same `CHECKPOINT_RESUME_CAP` constant (defined line 361)."

- **AC-3: `stream.interrupt()` call site safety — confirmed** — Task 5 Verify correctly specifies the interrupt must be awaited "inside the proactive-interrupt code site (forge-worker.mjs ~lines 433–478 area, inside `handleBudgetUsage` or its caller-driven companion in the for-await loop body)." This is architecturally sound because `handleBudgetUsage()` is async (line 440 signature) and is awaitable, allowing the interrupt to be awaited in the call site. The current fire-and-forget at lines 585–587 is safe to change because it's a .catch() wrapper — awaiting inside handleBudgetUsage before the catch resolves the safety concern. However, the Verify wording is ambiguous: it says "inside handleBudgetUsage or its caller-driven companion in the for-await loop body" — these are two different locations. Task 5 should pick one: either the interrupt is called and awaited inside handleBudgetUsage itself (cleaner, colocated), or it's called in the for-await loop body after handleBudgetUsage returns. Recommend clarify to "the interrupt is awaited directly inside handleBudgetUsage() after the checkpoint writes complete, or (if deferred) immediately after awaiting handleBudgetUsage() in the for-await loop body (line ~585), before the .catch() handler."

- **AC-4: inputChannel injection shape parity — confirmed** — Task 5 Verify correctly cites "the same shape as the existing reactive injection at forge-worker.mjs lines 549–553" and that location shows the concrete shape: `{ type: 'user', message: { role: 'user', content: resumeMsg }, parent_tool_use_id: null }`. The plan specifies the resumeMsg contains `[resume-from-checkpoint]` prefix, which matches the reactive pattern. No ambiguity here.

- **AC-5: Out-of-scope boundary — verified** — Reviewed all 8 tasks against the Out of scope section (lines 150–156):
  - Tasks 1–2 add tests (in-scope).
  - Task 3 adds threshold constant and trigger in handleBudgetUsage (in-scope, does not touch reactive handler at lines 492–568 or CHECKPOINT_RESUME_CAP value).
  - Task 4 writes checkpoint.md and run-active.json outcome stamp (in-scope, checkpoint.md is a new artifact, run-active.json stamping is explicitly allowed per line 519 pattern).
  - Task 5 injects resume message and increments counter (in-scope, uses same counter `checkpointResumeCounts` and cap `CHECKPOINT_RESUME_CAP` as reactive path).
  - Task 6 updates run-tests.mjs discovery (in-scope).
  - Tasks 7–8 smoke test and regression (in-scope).
  - No task modifies the reactive `[CONTEXT-CHECKPOINT]` path at lines 340–365 or lines 492–568. No task changes `CHECKPOINT_RESUME_CAP` value (stays at 2) or `BUDGET_THRESHOLD_CONSUMED` (stays at 0.70). No task touches apply/documenter stages. **Out-of-scope boundary respected.**

- **AC-6: Wiring gaps — none detected** — The plan's cross-process coordination is internal to forge-worker.mjs (sidecar written in Task 4, read in Task 5, same process). No new exports, signals, or inter-agent contracts are introduced. The `[resume-from-checkpoint]` signal is already established (existing reactive path at line 549); Task 5 reuses it. No wiring gaps.

- **AC-7: Schema/contract changes — none** — The plan does not modify any handler signatures, MCP tool schemas, or public APIs. It adds a new internal coordination file (sidecar) and a new constant (`BUDGET_INTERRUPT_THRESHOLD`) but no schema boundaries are crossed.

- **AC-8: Resolution 2026-05-12 correctness — confirmed** — The research finding (SDK does not fire `task_notification: completed` on `stream.interrupt()`) directly justifies Task 5's rewrite to inject the resume message synchronously after `await stream.interrupt()` returns. This is a critical change from the original design (which relied on the reactive handler at lines 492–568). The plan correctly pivots the injection point and cites the research artifact. The gotcha-check warning (task 5 key-links concreteness) is resolved by the rewritten Verify line with backtick-quoted constants and exact line-range citations.

### Verified

- [x] **Out-of-scope boundary** — All 8 tasks respect the explicit out-of-scope rules (lines 150–156); no forbidden modifications detected.
- [x] **Cap counter ownership** — Both reactive (lines 507–540) and proactive (Task 5) paths use the same `checkpointResumeCounts` Map keyed by normalized agent type.
- [x] **Contract completeness** — The reactive checkpoint handler's contract (read run-active.json, increment counter, check cap, inject message to inputChannel) is fully specified in Task 5; no missing methods or fields.
- [x] **New constants scoped correctly** — `BUDGET_INTERRUPT_THRESHOLD` (Task 3) and the sidecar file path are internal to forge-worker.mjs.
- [x] **Resolution addresses research finding** — Task 5's pivot to synchronous resume injection (after `await stream.interrupt()`) directly solves the SDK research finding (task_notification does not fire on interrupt).

### Per-criterion verdicts

- `AC-1: Sidecar read/delete contract`: NOT_MET — Task 5 Verify must explicitly specify atomic read-then-delete or cleanup lifecycle.
- `AC-2: Cap counter key normalization`: NOT_MET — Task 5 Verify must cite the exact normalization code (lines 503–504) for parity confirmation.
- `AC-3: Call site location clarity`: NOT_MET — Task 5 Verify must pick one call site (inside handleBudgetUsage vs. for-await loop body) and specify "awaited" to be unambiguous.
- `AC-4: inputChannel shape parity`: MET — Correctly cites forge-worker.mjs lines 549–553 as the shape template.
- `AC-5: Out-of-scope boundary`: MET — No task violates the explicit out-of-scope rules.
- `AC-6: Wiring gaps`: MET — No new exports or signals; reuses existing `[resume-from-checkpoint]` contract.
- `AC-7: Schema/contract changes`: MET — No public API or handler signature changes.
- `AC-8: Resolution correctness`: MET — Research finding and gotcha-check warning both addressed.

### Verdict

**REVISE** — Three spec-precision issues in Task 5's Verify line require planner clarification:

1. **Sidecar lifecycle** — Specify atomic read-then-delete or cleanup contract.
2. **Cap counter key normalization** — Cite the exact agent-type normalization code (lines 503–504) for parity verification.
3. **Call site location** — Pick one location (inside handleBudgetUsage vs. for-await loop body) and specify "awaited" explicitly.

These are not architectural blockers — they are fixable inline edits to the Verify lines. The plan's strategy and TDD wave ordering are sound. Once Task 5's Verify is clarified with these three concrete details, the plan is implementable.
