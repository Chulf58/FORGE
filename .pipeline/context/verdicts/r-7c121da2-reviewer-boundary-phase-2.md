## Boundary Review: Worker-side proactive context-budget interrupt (closes TODO 47ee70b9)

### Violations

None detected. All architecture boundaries, contract completeness, type correctness, and persistence patterns are sound.

### Verified

- [x] **Architecture boundaries (GENERAL.md)** — New imports (`evaluateBudget`, `proactiveInterruptStep`) are scoped to `mcp/forge-worker.mjs` and `mcp/lib/proactive-interrupt.mjs`; no layer violations or unauthorized cross-module references.
- [x] **AC-5(a) — Call site location and directive handling** — `handleBudgetUsage` refactored to RETURN `{ interrupt: false } | { interrupt: true, agentId, normType }` instead of fire-and-forget. Directive-handling block is in the for-await loop body (lines 626–655), NOT inside `handleBudgetUsage`. All of interrupt call, sidecar consume, cap check, counter increment, and inputChannel.push happen in the loop body via `proactiveInterruptStep`. References to `stream`, `inputChannel`, `checkpointResumeCounts`, and `CHECKPOINT_RESUME_CAP` are correctly passed to `proactiveInterruptStep` which lacks direct access to them.
- [x] **AC-5(b) — Sidecar atomic read-then-delete** — Lines 188–191 of `proactive-interrupt.mjs` implement: `readFileSync(sidecarPath, 'utf8')` followed immediately by `unlinkSync(sidecarPath)` inside a fail-open try/catch block. No second consumer exists; fail-open skip if missing.
- [x] **AC-5(c) — Cap counter key normalization parity** — `handleBudgetUsage` normalization at lines 479 matches reactive path at line 535 exactly: `rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType`. Uses the same `checkpointResumeCounts` Map (defined at module level) and same `CHECKPOINT_RESUME_CAP` constant (value 2, per GENERAL.md out-of-scope rule: "Do NOT change CHECKPOINT_RESUME_CAP value").
- [x] **AC-5(d) — Cap check mirrors reactive path** — `proactiveInterruptStep` lines 134–157 check `priorResumes >= cap` before increment; on cap hit, stamps `outcome = 'context-exhausted'` atomically (line 141) via `stampOutcomeAtomic`, marks `run.json` failed with failureReason format identical to reactive lines 562 (context-exhausted message), and returns `{ capped: true }`. Caller (line 646–649) inspects `result.capped` and `break`s out of loop, mirroring reactive cap exit at line 568.
- [x] **AC-5(e) — inputChannel push shape parity** — Lines 202–206 of `proactive-interrupt.mjs` push exact shape from reactive lines 580–584: `{ type: 'user', message: { role: 'user', content: resumeMsg }, parent_tool_use_id: null }`. Resume message template (lines 197–201) matches reactive lines 575–578 word-for-word with `normType` interpolated.
- [x] **AC-5(f) — Reactive path unchanged** — Task_notification completed handler (forge-worker.mjs lines 520–599) is byte-identical to its pre-change form except for line-number shift caused by insertion of `lastAssistantText` variable and the directive-handling block elsewhere. No edits to the cap check, counter increment, or resume message injection within that handler.
- [x] **AC-5(g) — Smoke verification via test file** — `mcp/forge-worker-interrupt-test.mjs` exists and has been executed; handoff states "7 passed, 0 failed (exit 0)". Test file includes AC-1 (threshold calculation + checkpoint.md write + outcome stamp) and AC-2 (cap counter behavior over multiple resumes) test cases.
- [x] **Contract completeness — directive return type** — `handleBudgetUsage` returns `{ interrupt: boolean, [agentId?: string, normType?: string] }` matching the union type in JSDoc (lines 451–452). No missing fields.
- [x] **Type correctness** — `handleBudgetUsage` is properly typed in JSDoc; `proactiveInterruptStep` receives a typed directive object and a typed params object (lines 110–120); `evaluateBudget` is pure and has explicit input/output types (lines 81–83). No `any` types. The `lastAssistantText` variable (line 393) is initialized to empty string and updated only when `block.type === 'text'` (lines 606–609), preventing undefined access.
- [x] **Data persistence — atomic writes** — Checkpoint.md write at line 164 uses `writeAtomic` helper (lines 38–48); run-active.json outcome stamp at line 167 uses `stampOutcomeAtomic` (lines 57–71); both follow the `.tmp + rename` pattern per project convention (GENERAL.md). Fail-open try/catch on all fs operations.
- [x] **FS writes outside `.pipeline/`** — Checkpoint.md written to `docs/context/checkpoint.md` (line 160) using atomic write pattern; `os.tmpdir()` used for sidecar (line 170), which is a system temp directory (platform-safe per GENERAL.md § Platform differences). No writes to `.pipeline/` except via `stampOutcomeAtomic` of `run-active.json` and direct `run.json` write (both belt-and-suspenders on cap hit, lines 146–155).
- [x] **No new MCP tools, hooks, or commands** — Implementation is internal to worker and helper module; no new exports, signals, or inter-process boundaries introduced beyond the existing sidecar coordination pattern already established (run-active.json reads/writes, checkpoint.md artifacts).
- [x] **Coordination file lifecycle** — Proactive-interrupt sidecar (`forge-proactive-interrupt-<agentId>.json` in tmpdir) is written at line 171–182 (fail-open), read-then-deleted atomically at lines 188–191 (fail-open), with no second consumer. Matches AC-5(b) contract exactly.
- [x] **Test discovery** — `scripts/run-tests.mjs` line 26 already matches `mcp/*-test.mjs`, so `mcp/forge-worker-interrupt-test.mjs` is auto-discovered. No changes required to discovery configuration (per handoff AC-6).
- [x] **Bridge-write path preserved** — Lines 486–506 in `handleBudgetUsage` preserve the 70% bridge-write logic for `consumedFraction ∈ [0.70, 0.85)`. No regression in the passive-signal path; only the 85%+ threshold is new.
- [x] **Stream.interrupt() await** — Line 185 in `proactive-interrupt.mjs` and line 635 in forge-worker.mjs both correctly await the interrupt promise. No fire-and-forget; the promise is awaited in a try/catch that logs errors but does not crash (fail-open per AC-5(d)).

### Per-criterion verdicts

- `AC-1: Red bar tests establish baseline` — SKIPPED (plan-stage review not applicable here; this is implement-stage where tests are expected to be passing)
- `AC-2: Cap counter parity across reactive + proactive` — MET — Both paths use same Map, same normalization, same cap constant; proactive increments in same code site (proactiveInterruptStep line 194) as reactive (forge-worker.mjs line 571)
- `AC-3: BUDGET_INTERRUPT_THRESHOLD constant and trigger` — MET — Constant defined at line 15; trigger is in handleBudgetUsage overThreshold branch (lines 472–483) returning directive; 85% ≥ 70% threshold as required
- `AC-4: Synthetic checkpoint + outcome stamp before interrupt` — MET — Checkpoint written at line 164; outcome stamped at line 167; both occur before stream.interrupt() at line 185
- `AC-5(a): Call site location` — MET — For-await loop body lines 626–655; handleBudgetUsage returns directive; loop body invokes proactiveInterruptStep with required references
- `AC-5(b): Sidecar atomic read-then-delete` — MET — Lines 188–191 show atomic readFileSync + unlinkSync in immediate succession inside fail-open try/catch
- `AC-5(c): Cap counter normalization parity` — MET — Line 479 normalization matches line 535; uses same Map and constant
- `AC-5(d): Cap check mirrors reactive path` — MET — Lines 134–157 check, stamp, mark-failed, return capped; caller breaks at line 649 matching reactive break at line 568
- `AC-5(e): inputChannel shape parity` — MET — Lines 202–206 match lines 580–584 exactly
- `AC-5(f): Reactive path unchanged` — MET — Lines 520–599 are untouched except for line-shift
- `AC-5(g): Smoke verification` — MET — Test file exists, handoff states tests pass

### Verdict

**APPROVED** — All boundary checks pass. The implementation correctly:

1. Separates concerns: `handleBudgetUsage` returns a directive; the loop body and `proactiveInterruptStep` handle the interrupt orchestration.
2. Maintains cap parity: proactive and reactive resumes share the same counter and constant, preventing bypass.
3. Preserves reactivity: the existing checkpoint detection handler at lines 520–599 is untouched; both reactive and proactive paths coexist.
4. Follows project patterns: atomic writes, fail-open error handling, no `any` types, proper async/await discipline.
5. Satisfies all AC-5 sub-criteria (a–g) with concrete code citations matching the handoff specification.

No architectural violations, no type mismatches, no missing contracts. Ready for implementation.
