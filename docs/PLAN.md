## Active Plan

### Feature: Structured findings contract — Slice 1 (folds TODOs 4623e1d2 + 8eded49c)

SHIPPED 2026-05-12 (r-ded76e32) — reviewers APPROVED at gate2

Summary: Upgrade `lean-risk-classify.mjs` triggered output from flat strings to structured finding objects, write `findings.json`, and inject findings into reviewer prompts so reviewers emit per-finding `FIND-<id>:` verdicts alongside existing AC verdicts.

**Scope summary (Slice 1 contract):**
`lean-risk-classify.mjs` currently pushes `"rule:snippet"` strings into `triggered`. This slice replaces those with `{rule, file, line, snippet, suggestedCheck}` objects, preserving the legacy string array as `triggeredRulesLegacy` for back-compat. `reviewer-dispatch.mjs` writes the structured array to `<wt>/docs/context/findings.json` in addition to the existing `lean-gate.json`. Four reviewer agents (`reviewer-safety`, `reviewer-boundary`, `reviewer-logic`, `reviewer-performance`) read `findings.json` when present, scope review to domain-relevant findings, and emit `FIND-<id>: CONFIRMED / DISMISSED / NEEDS-INVESTIGATION` lines alongside existing per-AC verdict lines. `skills/implement/SKILL.md` injects a `[findings: <path>]` prefix into reviewer prompts. Reviewer overall verdict shape (BLOCK/REVISE/APPROVED) is unchanged.

**Out of scope:**
- AST detection upgrade (Slice 3 — depends on findings contract being stable first)
- Per-finding verdict aggregation (Slice 2 — depends on this slice)
- `agents/reviewer-tests.md` integration (separate TDD chain per audit line 228)
- `scripts/phase-verify.mjs` lint-ratchet / LoC-delta checks (Slice 4 — independent)

**Files to touch (with audit-cited line ranges):**
1. `scripts/lean-risk-classify.mjs` — lines 194–211 (handoff classifier `triggered.push`) and lines 304–323 (diff classifier `triggered.push`)
2. `scripts/reviewer-dispatch.mjs` — lines 166–173 (rule iteration reading `triggeredRules`) and the result write at ~line 284 (via SKILL.md reference)
3. `agents/reviewer-safety.md` — verdict format section (~lines 104–133 per audit)
4. `agents/reviewer-boundary.md` — verdict format section (same structure)
5. `agents/reviewer-logic.md` — verdict format section (same structure)
6. `agents/reviewer-performance.md` — verdict format section (same structure)
7. `skills/implement/SKILL.md` — line 292 area (reviewer prompt prefix injection, mirror of `[reviewer-output-dir: …]`)

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [x] 1. Add failing test for structured finding object shape (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Establish a red bar that passes only once the classifier emits `{rule, file, line, snippet, suggestedCheck}` objects rather than `"rule:snippet"` strings, preventing silent shape regression.
  Verify: AC-1: `node scripts/findings-contract-test.mjs` exits non-zero before any classifier change; the test asserts that each element of `triggeredRules` is an object with all five required keys, not a string; `triggeredRulesLegacy` is an array of strings matching the old format.

- [x] 2. Add failing test for `findings.json` write path (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Lock down the new file artifact produced by the dispatch script so absence or wrong schema is caught deterministically before reviewers are spawned.
  Verify: AC-2: A test case in `scripts/findings-contract-test.mjs` calls the dispatch path with a known classification result and asserts that `docs/context/findings.json` is written and contains a JSON array whose elements each have `rule`, `file`, `line`, `snippet`, and `suggestedCheck` keys; exits non-zero before dispatch script change.

- [x] 3. Add failing test for reviewer prompt injection contract (`scripts/findings-contract-test.mjs`) (wave: 1)
  Intent: Verify that the `[findings: <path>]` prefix line is prepended to reviewer prompts when `findings.json` exists, so the injection is mechanically confirmed rather than manually audited.
  Verify: AC-3: A test case asserts the assembled reviewer prompt string begins with `[findings: ` and the path resolves to a readable file; exits non-zero before `skills/implement/SKILL.md` is updated.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [x] 4. Upgrade classifier `triggered` output to structured objects (`scripts/lean-risk-classify.mjs`) (wave: 2)
  Depends: 1
  Intent: Replace `"rule:snippet"` string pushes with `{rule, file, line, snippet, suggestedCheck}` objects in both the handoff and diff classifiers, and add `triggeredRulesLegacy` for back-compat.
  Verify: AC-4: The test from task 1 exits 0; `triggeredRules` elements are objects with all five keys; `triggeredRulesLegacy` is an array of strings in the original `"rule:snippet"` format; `lean-risk-classify.mjs` lines 194–211 and 304–323 are updated. See Resolution items 1, 2, 3, 4 below for `line` nullability, dual-location synchronization, finding-ID assignment, and `suggestedCheck` field source.

- [x] 5. Write `findings.json` from dispatch script (`scripts/reviewer-dispatch.mjs`) (wave: 2)
  Depends: 1, 2, 4
  Intent: Make structured findings available to reviewer agents as a side-car file alongside `lean-gate.json`, without changing the existing `lean-gate.json` write.
  Verify: AC-5: The test from task 2 exits 0; `<wt>/docs/context/findings.json` is written when `triggeredRules` is non-empty; the file contains a JSON array with the same objects as `triggeredRules`; `lean-gate.json` write is unchanged. See Resolution item 5 below for worktree-path validation.

- [x] 6. Inject `[findings: <path>]` prefix into reviewer prompts (`skills/implement/SKILL.md`) (wave: 2)
  Depends: 2, 3, 5
  Intent: Pass the structured findings path to each reviewer so reviewers can scope their analysis to the pre-identified risk surface rather than re-deriving it from raw diff text.
  Verify: AC-6: The test from task 3 exits 0; `skills/implement/SKILL.md` contains a `[findings: <path>]` injection step immediately adjacent to the existing `[reviewer-output-dir: …]` step at line 292; the path resolves to `<worktreePath>/docs/context/findings.json`.

- [x] 7. Update four reviewer agents to read `findings.json` and emit `FIND-<id>:` lines (`agents/reviewer-safety.md`, `agents/reviewer-boundary.md`, `agents/reviewer-logic.md`, `agents/reviewer-performance.md`) (wave: 2)
  Depends: 5, 6
  Intent: Close the loop so reviewers consume pre-identified findings and emit structured verdicts per finding, eliminating re-derivation of the risk surface from raw diff text.
  Verify: AC-7: Each of the four reviewer agents contains a section instructing them to (a) read `docs/context/findings.json` when it exists, (b) scope review to findings in their declared domain, and (c) emit one `FIND-<id>: CONFIRMED / DISMISSED / NEEDS-INVESTIGATION` line per relevant finding; overall BLOCK/REVISE/APPROVED verdict shape is unchanged.

#### Phase 3 — Smoke test and regression (TDD wave N)

- [x] 8. Smoke test: classifier emits N findings, reviewer emits N `FIND-<id>:` lines (`scripts/findings-contract-test.mjs`) (wave: 3)
  Depends: 4, 5, 6, 7
  Intent: Validate the end-to-end contract from classifier output to reviewer verdict line so a shape mismatch between the two layers is caught before the slice ships.
  Verify: AC-8: A smoke-test scenario in `scripts/findings-contract-test.mjs` runs the classifier against a synthetic handoff that triggers exactly 3 risk patterns, writes `findings.json`, and asserts that a simulated reviewer output contains exactly 3 `FIND-<id>:` lines (one CONFIRMED, one DISMISSED, one NEEDS-INVESTIGATION); test exits 0. See Resolution item 3 below for order-independent assertion.

- [x] 9. Full regression suite green after Slice 1 changes (`scripts/run-tests.mjs`) (wave: 3)
  Depends: 4, 5, 6, 7, 8
  Intent: Confirm that the shape change in `lean-risk-classify.mjs` and the new dispatch write do not break any existing test that consumes `triggeredRules` as strings.
  Verify: AC-9: `node scripts/run-tests.mjs` exits 0 with no previously-passing tests now failing; `scripts/findings-contract-test.mjs` exits 0; `triggeredRulesLegacy` presence ensures any consumer reading the old string format still gets a string array.

### Research needed

None — audit r-63c937e9 already covers the design decisions; cite it from `docs/RESEARCH/deterministic-pre-review-cluster.md` §Slice 1.

### Approach summary
- Decision: Extend classifier output to structured objects + write `findings.json` side-car + inject into reviewer prompts + add `FIND-<id>:` verdict lines in reviewers. TDD-structured in three waves. Audit r-63c937e9 establishes all design decisions.
- Trade-off: `triggeredRulesLegacy` adds a redundant string array that must be removed once all consumers migrate (Slice 2 dependency cleanup); accepted to avoid a big-bang consumer migration.
- Uncertainty: The `line` field in `{rule, file, line, snippet, suggestedCheck}` requires the classifier to track character offset → line number — confirm the regex `exec` loop provides enough context to compute this or fall back to `null` (see Resolution item 1).

### Resolution 2026-05-12 (Slice 1 reviewer REVISE response)

Addresses spec-precision items from r-ded76e32 gate1 reviewers (reviewer-logic REVISE, reviewer-safety REVISE). All 5 items are clarifications, not blockers (per reviewers' own framing).

**1. `line` field nullability (reviewer-logic)** — `line` is REQUIRED but accepts `null` when the classifier cannot compute a line number from the regex match. Object shape: `{rule: string, file: string, line: number | null, snippet: string, suggestedCheck: string}`. AC-4 test must assert that when present, `line` is either a positive integer or `null`. Computation: in the handoff classifier, the `exec` loop yields a character offset within `addedCode`; convert to line number via `addedCode.slice(0, m.index).split('\n').length`. Falls back to `null` only if the offset is unavailable (defensive guard, not expected in practice).

**2. Dual-location synchronization (reviewer-logic)** — Both `triggered.push(…)` sites at `lean-risk-classify.mjs:194-211` (handoff classifier) and `:304-323` (diff classifier) MUST emit objects with identical key sets. AC-4 test must call both code paths and assert shape equivalence — same five keys present, same types, same null/non-null treatment for `line`. Implementation should extract a shared `pushFinding(triggered, {rule, file, line, snippet, suggestedCheck})` helper if duplication grows, but the AC enforces shape regardless of code factoring.

**3. Smoke test finding-ID determinism (reviewer-logic)** — Finding IDs are assigned by the classifier as `FIND-<N>` where `N` is the sequential 1-based index in the order findings are pushed to `triggered`. The smoke test (AC-8) is ORDER-INDEPENDENT: it parses the simulated reviewer output, collects the `FIND-<N>:` lines into a set, and asserts the set equals `{FIND-1, FIND-2, FIND-3}` with the expected total of 3 (one CONFIRMED, one DISMISSED, one NEEDS-INVESTIGATION). The test does NOT assert which finding gets which verdict.

**4. `suggestedCheck` field source + sanitization (reviewer-safety)** — `suggestedCheck` is a STATIC string defined alongside each entry in `RISK_CONTENT_PATTERNS` and `RISK_DIFF_PATTERNS` in `lean-risk-classify.mjs`. NOT derived from match content. No sanitization required since the field is editor-authored constant text controlled by the pattern table. AC-4 test asserts: (a) every pattern entry in both tables has a non-empty static `suggestedCheck` string defined; (b) the field on each emitted finding object equals the matching pattern's static `suggestedCheck` value. No string interpolation of match content into this field is permitted.

**5. Worktree path validation (reviewer-safety)** — `findings.json` write target MUST be inside the worktree. AC-5 implementation requires: (a) validate `<worktreePath>` exists and is a directory via `fs.statSync(...).isDirectory()` before write; (b) compute the resolved target as `path.join(worktreePath, 'docs/context/findings.json')`; (c) call `path.resolve(target)` and assert the resolved path starts with `path.resolve(worktreePath) + path.sep` (rejects path-traversal attempts). On any validation failure: log `[reviewer-dispatch] findings.json write rejected: <reason>` to stderr and skip the write (fail-open — do NOT throw, do NOT crash the dispatch script). AC-5 test asserts the write path is rejected when `worktreePath` is non-directory OR when the resolved target escapes the worktree root.

---

# Plan — Worker-side proactive context-budget interrupt

### Feature: Worker-side proactive context-budget interrupt (closes TODO 47ee70b9)

Summary: Add proactive pre-truncation interrupt to `mcp/forge-worker.mjs` so agents that approach context exhaustion are stopped cleanly, a synthetic checkpoint is written, and the existing checkpoint-resume handler recovers them automatically.

## Context (what exists today)

**`mcp/forge-worker.mjs` — current state (citations):**
- Line 11–16: `BUDGET_THRESHOLD_CONSUMED = 0.70`, `BUDGET_CONTEXT_WINDOW = 200_000`, `BUDGET_AUTOCOMPACT_FACTOR = 0.835`, `BUDGET_DEBOUNCE_MS = 30_000` — constants for the bridge-file approach already shipped.
- Lines 383–408: `budgetLastWriteAt` map and `readAgentSidecar()` — per-agent sidecar lookup to find a subagent's session_id.
- Lines 410–431: `writeBridge()` — writes `claude-ctx-<sessionId>.json` (remaining budget %) to `tmpdir()` so the PostToolUse hook can signal the subagent.
- Lines 433–478: `handleBudgetUsage()` — fires on every `assistant` message's `usage` block; writes bridge when session-cumulative tokens > 70% of usable window.
- Line 339: `const stream = query({...})` — `stream` is the `Query` object; `sdk.d.ts:1960` confirms it has `interrupt(): Promise<void>`.
- Lines 361–362: `CHECKPOINT_RESUME_CAP = 2`, `checkpointResumeCounts` Map — reactive cap, keyed by normalized agent type.
- Lines 492–568: Reactive checkpoint handler — fires on `task_notification: completed`; reads `run-active.json`; if `latest.outcome === 'checkpoint'`, injects `[resume-from-checkpoint]` message into `inputChannel` and increments resume count.
- Lines 583–587: `handleBudgetUsage(u).catch(...)` — called on every `assistant` message usage block; already tracking session-cumulative tokens.

**`hooks/subagent-stop.js` — current state (citations):**
- Lines 340–365: Checkpoint detection block — reads `lastMessage` for `[CONTEXT-CHECKPOINT]` signal AND checks `docs/context/checkpoint.md` exists; if both true, stamps `outcome = 'checkpoint'`. Without agent cooperation (no signal), this block never fires.
- Lines 446–468: Writes `run-active.json` with updated `entry.outcome`.

**SDK types (citations):**
- `sdk.d.ts:1960–1970`: `Query` interface extends `AsyncGenerator`; has `interrupt(): Promise<void>` described as "stop processing and return control to the caller."
- `sdk.d.ts:5248`: `TerminalReason` includes `'aborted_streaming'` and `'aborted_tools'` — interruption is a first-class terminal state.
- `sdk.d.ts:1120–1123`: `Options.abortController?: AbortController` — alternative abort path.

**CLAUDE-WORKER.md checkpoint resume protocol:** When the worker receives `[resume-from-checkpoint]` prefix it re-dispatches the named agent via `Agent(subagent_type=<X>)` with the prefix, instructing the agent to read `docs/context/checkpoint.md`. The cap (2 resumes) applies.

## Strategy decision

**Strategy A (token-budget heuristic) — CHOSEN.**

Evidence from code: `handleBudgetUsage()` (lines 433–478) ALREADY tracks session-cumulative tokens per assistant message and fires bridge writes at 70% consumed. The per-agent sidecar (lines 394–408) resolves `agent_id → session_id`. What is missing is the `interrupt()` call when the threshold is crossed.

The existing `BUDGET_THRESHOLD_CONSUMED = 0.70` triggers bridge writes (passive signal to the subagent). The proactive interrupt should fire at a higher threshold — e.g. 85% consumed — to give the agent a window to finish any in-flight tool call before hard stop. 85% is ~170 k tokens consumed out of ~167 k usable (200 k × 0.835), which empirically precedes the truncation observations cited in the TODO (planner: 148 s ≈ ~175 k tokens, researcher: 135 s ≈ ~165 k tokens).

**Why not B (time-based) or C (tool-count):** Strategy A reuses already-instrumented session-cumulative token data, making it immediately hookable into `handleBudgetUsage()` with minimal new code. Strategies B and C require separate per-agent dispatch-start timestamps or tool-call counters that are not yet tracked.

**Open question resolved: does `stream.interrupt()` stop only the active subagent or the parent?**
Static analysis of `sdk.d.ts:1960` and `sdk.d.ts:5248`: `interrupt()` is a method on the parent `Query` handle (`stream`), not on a per-subagent handle. The type description says "Interrupt the current query execution" — the query IS the parent session. Therefore `stream.interrupt()` stops the entire parent query, which terminates the currently dispatched subagent along with it. The for-await loop exits and control returns to the caller. This is acceptable — the worker exits cleanly after writing the synthetic checkpoint, and the existing `task_notification: completed` handler (line 492) will fire before the loop exits (since the subagent completes when interrupted), allowing the checkpoint outcome to be detected. If `task_notification` does NOT fire on interrupt (an unknown), the worker falls back to writing `run-active.json` directly before calling `interrupt()` as belt-and-suspenders.

**Can the worker construct a usable synthetic checkpoint.md from streamed assistant text?**
Yes, with caveats. The worker's `for await` loop receives all `assistant` messages including partial tool outputs. The last `assistant` message before interrupt contains the most recent text block. This is not the agent's internal state — it is the last visible output (partial analysis, last paragraph written, etc.). The synthetic checkpoint will contain: the last assistant text block + a one-line auto-interrupt note. Quality is lower than an agent-written checkpoint (no structured "what remains" section), but the `[resume-from-checkpoint]` prompt instructs the agent to read it and continue — a partial-state checkpoint is better than no checkpoint.

**Coordination with `hooks/subagent-stop.js`:**
The hook stamps `outcome` based on `last_assistant_message` content and artifact presence (lines 340–365). For a proactively interrupted agent: (a) the agent did NOT emit `[CONTEXT-CHECKPOINT]`, so the reactive path (line 344) does not fire; (b) the worker writes `docs/context/checkpoint.md` BEFORE calling `interrupt()`, so the file will exist when `subagent-stop.js` runs. However, without the signal in `last_assistant_message`, the hook still won't stamp `outcome = 'checkpoint'`.

**Solution:** The worker must stamp `outcome = 'checkpoint'` in `run-active.json` DIRECTLY before calling `interrupt()`, bypassing the hook. This is the same approach used at line 518–522 for `context-exhausted` stamping: the worker writes `run-active.json` directly when it has information the hook lacks. The hook write (lines 460–467) will overwrite the entry afterwards — so the worker must also set a flag that causes the next `task_notification: completed` message to re-read the (potentially hook-overwritten) entry and check for checkpoint. Belt-and-suspenders: the worker writes a small sidecar file (e.g. `<tmpdir>/forge-proactive-interrupt-<agentId>.json`) recording the intended checkpoint outcome, and the `task_notification` handler re-stamps from the sidecar if `latest.outcome !== 'checkpoint'`.

## Out of scope

- Do NOT modify or replace the reactive `[CONTEXT-CHECKPOINT]` path in `hooks/subagent-stop.js` — augment only.
- Do NOT change `CHECKPOINT_RESUME_CAP` value (stays at 2).
- Do NOT change `BUDGET_THRESHOLD_CONSUMED` (stays at 0.70 for bridge writes).
- Do NOT touch apply/documenter/refactor/debug worker stages — only the subagent dispatch loop.
- Do NOT add interrupt logic for non-subagent contexts (gate polling, watchFile handlers, etc.).

## Tasks

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

TDD applies: this is enforcement infrastructure (truncation guard that fails silently if broken). Per `docs/RESEARCH/tdd-agentic-llm-setups.md` §3.2, Red+Green collapse failure mode is prevented by writing tests first that confirm the red bar before implementation exists.

- [ ] 1. Add failing unit tests for proactive interrupt logic (`mcp/forge-worker-interrupt-test.mjs`) (wave: 1)
  Intent: Establish a red bar verifying per-agent interrupt threshold detection, synthetic checkpoint write, and `run-active.json` outcome stamp before any worker code changes exist.
  Verify: AC-1: `node mcp/forge-worker-interrupt-test.mjs` exits non-zero; tests assert (a) threshold calculation fires at the correct consumed fraction, (b) checkpoint file is written with auto-interrupt note before `interrupt()` is called, (c) `run-active.json` entry for the agent has `outcome: 'checkpoint'` after the stamp step.

- [ ] 2. Add failing test for cap interaction with proactive interrupts (`mcp/forge-worker-interrupt-test.mjs`) (wave: 1)
  Intent: Confirm that proactive checkpoints count against the same `CHECKPOINT_RESUME_CAP` counter as reactive checkpoints, preventing double-counting or cap bypass.
  Verify: AC-2: A test case in `mcp/forge-worker-interrupt-test.mjs` simulates two proactive interrupt + resume cycles for the same agent type, then asserts the cap counter reaches 2 and a third would be rejected with `context-exhausted` outcome; exits non-zero before implementation.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 3. Add proactive interrupt threshold constant and trigger to `handleBudgetUsage` (`mcp/forge-worker.mjs`) (wave: 2)
  Depends: 1
  Intent: Elevate the existing bridge-write monitoring into an active interrupt so agents that exceed 85% context consumption are stopped before model truncation, not just signalled.
  Verify: AC-3: `node mcp/forge-worker-interrupt-test.mjs` threshold tests exit 0; a new `BUDGET_INTERRUPT_THRESHOLD` constant (≥ `BUDGET_THRESHOLD_CONSUMED`) is present in `mcp/forge-worker.mjs`; `handleBudgetUsage()` calls `stream.interrupt()` when `consumedFraction >= BUDGET_INTERRUPT_THRESHOLD` and an active agent sidecar exists; the 70% bridge-write path is unchanged.

- [ ] 4. Write synthetic checkpoint and stamp outcome before interrupt (`mcp/forge-worker.mjs`) (wave: 2)
  Depends: 1, 3
  Intent: Ensure the checkpoint file and outcome stamp exist before `interrupt()` is called so the resume handler can detect and re-dispatch the agent correctly.
  Verify: AC-4: `node mcp/forge-worker-interrupt-test.mjs` checkpoint-write tests exit 0; `docs/context/checkpoint.md` contains the last assistant text block and a one-line "auto-interrupted at <reason>" note; the active agent's entry in `run-active.json` has `outcome: 'checkpoint'` written atomically before `interrupt()` is invoked; a proactive-interrupt sidecar (`forge-proactive-interrupt-<agentId>.json` in `tmpdir()`) records the intended outcome as belt-and-suspenders.

- [ ] 5. Inject `[resume-from-checkpoint]` into `inputChannel` immediately after `await stream.interrupt()` resolves (`mcp/forge-worker.mjs`) (wave: 2)
  Depends: 4
  Intent: Because the SDK does NOT fire `task_notification: completed` after `interrupt()` (Resolution 2026-05-12 — research finding in `docs/RESEARCH/sdk-interrupt-task-notification-ordering.md`), the reactive re-stamp branch never runs. The worker must inject the resume message synchronously in the same for-await loop body that called `interrupt()`, BEFORE the loop exits.
  Verify: AC-5: All sub-criteria below MUST be true.
    - **(a) Call site location — single chosen site.** The existing fire-and-forget call at `mcp/forge-worker.mjs:585-587` (`handleBudgetUsage(u).catch(...)`) is refactored to `await handleBudgetUsage(u)` wrapped in `try { ... } catch (err) { writeLog(...) }`. `handleBudgetUsage` is changed to RETURN a directive object `{ interrupt: true, agentId: <string>, normType: <string> } | { interrupt: false }` instead of fire-and-forget. The interrupt call (`await stream.interrupt()`), the sidecar read/delete, the cap check, the counter increment, and the `inputChannel.push(...)` ALL happen in the for-await loop body at lines ~585–588 immediately after `await handleBudgetUsage(u)` returns with `interrupt: true` — NOT inside `handleBudgetUsage` itself. Rationale: `handleBudgetUsage` does not have access to `stream`, `inputChannel`, or `checkpointResumeCounts`; pivoting the decision to the loop body keeps those references colocated and matches the reactive handler's location at lines 492–568.
    - **(b) Sidecar atomic read-then-delete.** The sidecar `<tmpdir>/forge-proactive-interrupt-<agentId>.json` (written in task 4) is consumed via: `const raw = readFileSync(sidecarPath, 'utf-8'); unlinkSync(sidecarPath);` in immediate succession inside a `try { ... } catch (_) { /* fail-open */ }` block. No second consumer exists. If the file is missing on read (race or fail-open from task 4), skip injection and continue — the for-await loop will eventually terminate via the SDK's interrupt-driven loop exit.
    - **(c) Cap counter key normalization parity.** Use the EXACT same normalization as the reactive path at `mcp/forge-worker.mjs:503-504`: `const rawType = directive.normType || ''; const normType = rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType;`. Use the SAME Map (`checkpointResumeCounts`) and SAME constant (`CHECKPOINT_RESUME_CAP`, defined at line 361). Increment via `checkpointResumeCounts.set(normType, priorResumes + 1)` mirroring line 540.
    - **(d) Cap check (mirrors lines 507–538).** Before increment, check `priorResumes = checkpointResumeCounts.get(normType) || 0`. If `priorResumes >= CHECKPOINT_RESUME_CAP`, stamp `outcome = 'context-exhausted'` in `run-active.json` (using the same atomic-write pattern as lines 515–520) and `break` out of the for-await loop. Do NOT call `inputChannel.push(...)`. Also write `run.json` `status = 'failed'` with `failureReason` mirroring the format at line 531. Reuse line 537's `break;` exit pattern.
    - **(e) inputChannel push shape parity.** When not capped, push the message using the EXACT shape from lines 549–553: `inputChannel.push({ type: 'user', message: { role: 'user', content: resumeMsg }, parent_tool_use_id: null });`. `resumeMsg` is constructed via the same template as lines 544–547 with `normType` interpolated.
    - **(f) Reactive path unchanged.** No edits to lines 492–568 (the existing `task_notification: completed` checkpoint detection branch). The agent-emitted `[CONTEXT-CHECKPOINT]` case continues to use that path; the proactive path is purely additive.
    - **(g) Smoke verification.** `node mcp/forge-worker-interrupt-test.mjs` (task 7) exercises this end-to-end: simulates handleBudgetUsage returning `interrupt: true`, asserts `stream.interrupt()` is awaited, sidecar is read-then-deleted, counter is incremented, and the resume message is pushed to inputChannel with the exact shape above.

- [ ] 6. Register new test file with `scripts/run-tests.mjs` discovery (`scripts/run-tests.mjs`) (wave: 2)
  Depends: 1
  Intent: Make the new interrupt test discoverable by the regression runner so it is included in every CI pass without manual registration.
  Verify: AC-6: `node scripts/run-tests.mjs` discovers and runs `mcp/forge-worker-interrupt-test.mjs`; `run-tests.mjs` test discovery pattern at line 26 already covers `mcp/*-test.mjs` — confirm the new file name matches, or add it explicitly if needed; `run-tests.mjs` exits 0 only when the new test exits 0.

#### Phase 3 — Smoke test and regression (TDD wave N)

- [ ] 7. Smoke test for end-to-end proactive interrupt → resume flow (`mcp/forge-worker-interrupt-test.mjs`) (wave: 3)
  Depends: 3, 4, 5
  Intent: Validate the full cycle — threshold crossed → checkpoint written → outcome stamped → `task_notification` handler re-dispatches with `[resume-from-checkpoint]` — using an artificially low interrupt threshold.
  Verify: AC-7: A smoke-test case in `mcp/forge-worker-interrupt-test.mjs` runs the `handleBudgetUsage` + `task_notification` path with `BUDGET_INTERRUPT_THRESHOLD` overridden to 0.01 (fires immediately); asserts that `docs/context/checkpoint.md` exists, `run-active.json` shows `outcome: 'checkpoint'`, and the resume message injected into `inputChannel` begins with `[resume-from-checkpoint]`; test exits 0.

- [ ] 8. Full regression suite green after interrupt changes (`scripts/run-tests.mjs`) (wave: 3)
  Depends: 3, 4, 5, 6, 7
  Intent: Confirm the proactive interrupt additions do not break any existing test, including the budget-monitoring and checkpoint-reactive paths.
  Verify: AC-8: `node scripts/run-tests.mjs` exits 0 with no previously-passing tests now failing; `mcp/forge-worker-interrupt-test.mjs` exits 0 for all test cases including smoke test.

## Risk surface

- **`reviewer-safety`**: Worker writes `docs/context/checkpoint.md` and modifies `run-active.json` from inside the budget monitoring path — both are fs writes outside `.pipeline/` (checkpoint.md is under `docs/`). Must use atomic write (.tmp + rename) pattern per project convention.
- **`reviewer-safety`**: `stream.interrupt()` halts the entire parent query. If called at an unexpected point (e.g. during gate polling or commit), it terminates the worker session unrecoverably. Guard: only call `interrupt()` when an active non-completed agent is confirmed in `run-active.json` AND the worker is actively in the subagent-dispatch loop (not waiting at a gate).
- **`reviewer-boundary`**: The proactive-interrupt sidecar (`forge-proactive-interrupt-<agentId>.json`) is a new coordination file between `handleBudgetUsage()` and the `task_notification` handler in the same process. If the two writes race (unlikely — both are in the same event loop), the sidecar must be read atomically (read-then-delete in the task_notification handler).
- **`reviewer-boundary`**: Cap interaction — proactive interrupts must increment `checkpointResumeCounts` the same way as reactive checkpoints. If they increment in different places, the cap could be bypassed (agent gets 4 resumes: 2 reactive + 2 proactive). Fix: the cap check and increment in the `task_notification` handler (lines 507–540) must apply regardless of whether the checkpoint was proactive or reactive.
- **`reviewer-safety`**: `sdk.d.ts:1970` `interrupt()` returns `Promise<void>` — must be awaited. Non-awaited interrupt in the budget loop (which is `async` but fire-and-forget via `.catch(...)`) could lose the interrupt signal. The interrupt call must be made directly in the `for await` loop body, not inside `handleBudgetUsage()`.

### Research needed

None — resolved 2026-05-12. See Resolution below and `docs/RESEARCH/sdk-interrupt-task-notification-ordering.md`.

### Resolution 2026-05-12 (research finding + gotcha-check WARNING)

Addresses the one open question from the original `### Research needed` block above and the single WARNING from the plan-stage gotcha-check (key-links concreteness on task 5).

**1. SDK research finding (resolves the open question)** — Researcher (run r-7c121da2) inspected `mcp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` and `sdk.mjs`. Verdict: **NO** — `task_notification: completed` does NOT reliably fire after `stream.interrupt()`. Evidence:
  - `sdk.d.ts:1966-1970` — `Query.interrupt()` doc says only "stop processing and return control to the caller"; no mention of flushing pending notifications.
  - `sdk.d.ts:5246` — `TerminalReason` comment explicitly states the value is "Unset when ... interrupted externally". The `completed` terminal reason (the one tied to a `task_notification: completed` emission) is not set on interrupt — the actual terminal reason is `'aborted_streaming'` or `'aborted_tools'`.
  - `sdk.mjs` (compiled runtime) — grep for `aborted_streaming` returned zero readable matches; interrupt code path is in minified form. No readable flush-notifications-before-return code path was extractable. Static evidence converges on NO.

  Implication: the planner's original task 5 design (re-stamp inside the existing reactive `task_notification: completed` handler at lines 492–568) is invalid — that handler never fires on a proactive interrupt. Task 5 is rewritten above to inject `[resume-from-checkpoint]` directly into `inputChannel` IMMEDIATELY after `await stream.interrupt()` resolves, mirroring the existing reactive injection pattern at forge-worker.mjs lines 549–553. The cap counter (`checkpointResumeCounts`) is incremented in the same code site, so the cap (2) is shared across reactive + proactive paths — this also resolves the cap-bypass risk flagged in `## Risk surface` for reviewer-boundary.

  Full research artifact: `docs/RESEARCH/sdk-interrupt-task-notification-ordering.md`.

**2. Gotcha-checker WARNING (task 5 key-links concreteness)** — The original task 5 prose used "reads sidecar" without a backtick-quoted file name. The rewritten task 5 above now backtick-quotes `forge-proactive-interrupt-<agentId>.json` and `checkpointResumeCounts` and `CHECKPOINT_RESUME_CAP` in the Verify line, and cites the exact forge-worker.mjs line ranges for both the injection site (~585–588 in the for-await loop body) and the existing reactive injection shape (549–553). Warning resolved.

### Resolution 2026-05-12 (round 2 — reviewer-boundary REVISE response)

Addresses 3 spec-precision issues from the plan-stage reviewer-boundary verdict (REVISE, 0 blockers, 3 warnings). All 3 are inline fixes to task 5's Verify sub-criteria; no architectural change.

**1. Sidecar lifecycle (AC-1 from reviewer)** — Task 5 Verify sub-criterion (b) now specifies atomic read-then-delete: `readFileSync(sidecarPath, 'utf-8'); unlinkSync(sidecarPath);` in immediate succession inside a fail-open try/catch. No second consumer exists. If missing on read, skip injection (fail-open).

**2. Cap counter key normalization (AC-2 from reviewer)** — Task 5 Verify sub-criterion (c) now cites the EXACT normalization code from `mcp/forge-worker.mjs:503-504`: `rawType.startsWith('forge:') ? rawType.slice('forge:'.length) : rawType`. Uses the same `checkpointResumeCounts` Map and same `CHECKPOINT_RESUME_CAP` constant (line 361). Cap check mirrors lines 507–538 (sub-criterion d).

**3. Call site location (AC-3 from reviewer)** — Task 5 Verify sub-criterion (a) picks ONE site definitively: the for-await loop body at lines ~585–588, immediately after `await handleBudgetUsage(u)`. `handleBudgetUsage` is refactored to return a directive object instead of fire-and-forget; the interrupt call, sidecar consumption, cap check, counter increment, and inputChannel push ALL happen in the loop body (NOT inside `handleBudgetUsage`). Rationale documented inline: `handleBudgetUsage` lacks references to `stream`, `inputChannel`, and `checkpointResumeCounts`; pivoting the decision to the loop body colocates those references with the existing reactive handler at lines 492–568.

### Approach summary
- Decision: Strategy A (token heuristic) extended with a second threshold constant (`BUDGET_INTERRUPT_THRESHOLD`) that triggers `stream.interrupt()` after synthetic checkpoint write and direct `run-active.json` stamp. Reuses existing `handleBudgetUsage()` instrumentation with minimal new code.
- Trade-off: `stream.interrupt()` stops the entire parent query (not just the active subagent) — this is acceptable because the worker exits cleanly and the checkpoint resume re-dispatches the agent, but it means the interrupt cannot be partial. Accepted as the only interrupt mechanism available in the SDK.
- Uncertainty: Whether `task_notification: completed` fires after `stream.interrupt()` — if it does not, the resume injection point must shift to immediately post-interrupt rather than the task_notification handler.
