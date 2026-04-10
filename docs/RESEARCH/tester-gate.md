# Research: Optional Tester Gate After Implementer

---

## Question: Does `triggerRun` support `continueSession` threading?

**Finding:**

`triggerRun` in `src/renderer/src/lib/runner.ts` does NOT currently support `continueSession`. Its signature is:

```ts
export function triggerRun(prompt: string, mode: ModeId = 'explore'): void
```

It always calls `runStore.startRun(prompt, mode, false)` — the third argument `continueSession` is hardcoded to `false`.

However, the session ID is still threaded through correctly. On line 16 of `runner.ts`:

```ts
const sessionId = runStore.getRunState().sessionId
```

And on line 31:

```ts
ipc.run(fullPrompt, projectFolder, mode, false, sessionId)
```

The `sessionId` is captured from the current run state and passed to `ipc.run`. This is the same pattern used in `Gate2Bar.svelte` (line 32: `ipc.run(fullPrompt, projectFolder, keyword, false, run.sessionId)`).

The `continueSession` boolean and the `sessionId` parameter are two separate concepts in the `ipc.run` call:
- `sessionId` — passes the previous session's ID to Claude CLI so it can continue the conversation
- `continueSession` — a UI-layer flag used by `runStore.startRun` to record user intent; it does NOT affect whether the session ID is threaded to the IPC call

Because `triggerRun` already captures and passes the current `sessionId`, any run triggered from `TesterGateBar` via the existing `triggerRun` will automatically continue the same Claude session — **without needing to add a `continueSession` parameter**. The session continuity is already wired through the `sessionId` path.

The `continueSession: boolean` in `runStore` is only used as a display/intent flag; it does not control whether the session ID is forwarded.

**Source:**
- `src/renderer/src/lib/runner.ts` lines 16, 18, 31
- `src/renderer/src/stores/run.svelte.ts` lines 46–56 (`startRun` signature, `continueSession` field)
- `src/renderer/src/components/gates/Gate2Bar.svelte` line 32 (established precedent for IPC call pattern with session ID)
- `src/renderer/src/lib/ipc.ts` lines 18–26 (`run` wrapper signature)

**Recommendation:**

Task 8 in the plan says "verify that `triggerRun` already passes `continueSession` through to `ipc.run`; if not, add an optional `continueSession?: boolean` parameter." The finding is that `triggerRun` always passes `false` for `continueSession` but **does** pass the existing `sessionId`. Since session continuity in Claude CLI depends on the `sessionId` (not the boolean), the tester and documenter sub-runs will already have full context of the implementer's session.

The coder does NOT need to add a `continueSession` parameter to `triggerRun`. The existing session threading is sufficient. Task 8 can be satisfied with a comment confirming this — no code change to `triggerRun` is required. The plan's task 5 should call `triggerRun` exactly as it currently works, since it already captures the live `sessionId`.

One caveat: `runStore.startRun` is called with `continueSession = false` from `triggerRun`. This means the SAME SESSION checkbox in the UI would not reflect the sub-run's continuation intent. This is cosmetic only — it does not break session threading. If the Coder wants to set the flag for consistency, they can pass `true` to `runStore.startRun` in a local copy of the call sequence inside `TesterGateBar`, mirroring what `PromptBar.submit()` does on line 71.

---

## Question: How does CLAUDE.md route single-agent prefixes like `tester:` and `documenter:`?

**Finding:**

`CLAUDE.md` lives at `template/CLAUDE.md` (the live orchestration file for managed projects). There is no `CLAUDE.md` at the project root — that path does not exist. The template file is confirmed active.

Reading `template/CLAUDE.md` in full reveals that **there is no routing entry for bare `tester:` or `documenter:` prefixes**. The file defines these pipeline routes only:
- `plan feature: <description>`
- `implement feature: <description>`
- `apply feature: <description>` — runs implementer → tester → documenter
- `debug: <description>`
- `apply debug: <description>` — runs implementer → tester → documenter
- `refactor: <file or area>`
- `apply refactor: <file or area>` — runs implementer → tester → documenter

There is no entry for `tester: <anything>` or `documenter: <anything>`.

If FORGE called `triggerRun('run', 'tester')` or `triggerRun('tester: run', 'direct')`, the orchestrator would have no pipeline routing rule for it. In `direct` mode, Claude would likely interpret `tester: run` as a free-form prompt and either: (a) try to run the tester agent inline as a sub-agent call, (b) interpret the colon as a label and free-associate, or (c) correctly identify it means "invoke the tester sub-agent." The behavior would be non-deterministic and is not guaranteed to invoke only the tester.

The `PIPELINES` constant in `src/renderer/src/lib/constants.ts` also has no entry for `'tester'` or `'documenter'` as standalone pipeline IDs. The ModeId type union does not include them.

**Source:**
- `template/CLAUDE.md` — full pipeline routing section
- `src/renderer/src/lib/constants.ts` lines 29–46 (`PipelineId` union, `PIPELINES` record)

**Recommendation:**

Do NOT use `triggerRun('run', 'tester')` or wrap the prompt as `tester: run`. There are two viable alternatives:

**Option A (recommended): Use `direct` mode with an explicit agent invocation instruction.**
Fire `triggerRun('Run the tester agent now. Read docs/context/handoff.md and write the test checklist to docs/TESTING.md.', 'direct')`. In `direct` mode, CLAUDE.md explicitly says "Running or invoking a named agent" is a permitted direct-mode action. The orchestrator will invoke the tester sub-agent. This requires no changes to CLAUDE.md or constants.

**Option B: Add `tester` and `documenter` as new pipeline IDs.**
Add `'tester'` and `'documenter'` to `PipelineId`, `PIPELINES`, and add routing entries to `template/CLAUDE.md`. This is the cleanest long-term solution but adds scope (4 files: constants.ts, CLAUDE.md, and potentially preload/main for nothing new). Not recommended for this feature.

**Option C: Use `apply feature:` mode with a special flag or suffix.**
Not viable — `apply feature:` always runs the full implementer → tester → documenter chain from CLAUDE.md's perspective.

The plan's task 5 says to call `triggerRun` with `'tester: run'` using the `apply` keyword's pipeline mode. This will not work as written — CLAUDE.md has no `tester:` route. The coder must use Option A (direct mode with explicit agent invocation phrasing) for both the tester and documenter sub-runs.

---

## Question: Should tester auto-chain documenter via its own signal, or should TesterGateBar sequence them directly?

**Finding:**

**Current tester output signal** (`.claude/agents/tester.md`, line 98):

```
[suggest] apply feature: <feature name>  (Documenter should run after you)
```

This `[suggest]` signal is processed by `App.svelte`'s `onStdout` handler (lines 209–214). It is captured as a chip and added to `uiStore.chips` — it does NOT auto-fire any run. Chips are passive UI elements that the user clicks or gate actions consume. There is no code in `App.svelte`'s `onDone` that auto-fires a run based on `[suggest]` chip content. The `[suggest]` signal is purely a clickable suggestion for the user.

There is **no existing `[suggest]`-driven auto-fire mechanism** in the current architecture. The existing pattern is:
1. Signals like `[CONTEXT-CHECKPOINT]` → App.svelte `onDone` auto-reinvokes (`triggerRun`)
2. `[suggest]` → chips displayed in UI for user to click manually
3. Gate approvals (Gate2Bar `apply()`) → fire next run programmatically

The `onDone` handler in `App.svelte` (lines 273–361) processes: checkpoint reinvocation, gate detection (`detectGates`), task promotion (plan/apply mode), and buffer cleanup. It does not contain any logic that reads chip content or fires runs based on `[suggest]` signals.

**Option A analysis (TesterGateBar sequences both):**
`TesterGateBar.runTester()` fires the tester run. When the tester finishes, `App.svelte`'s `onDone` would need to detect that a tester sub-run just completed and auto-fire the documenter. This requires either: a new `testerSubRunPending` flag in `App.svelte`, or a new signal from the tester. The mode used for the sub-run (likely `direct`) makes detection ambiguous — `onDone` has no way to know whether the `direct` run was a tester sub-run or a user-initiated direct prompt.

**Option B analysis (tester emits `[run-documenter]` or similar):**
A new signal like `[run-documenter]` caught by `App.svelte`'s `onStdout` — sets a flag; `onDone` checks the flag and fires the documenter. This matches the `[CONTEXT-CHECKPOINT]` precedent exactly: signal sets `checkpointPending = true`, `onDone` checks and auto-fires. The same pattern applied: `[run-documenter]` sets `documenterPending = true`, `onDone` fires `triggerRun(...)` for the documenter. This is architecturally identical to the existing checkpoint mechanism and requires no new state or sequencing logic outside `App.svelte`.

**Option B is the better architectural fit** because:
1. It mirrors the only existing auto-fire pattern (`[CONTEXT-CHECKPOINT]` → `checkpointPending`)
2. All signal detection and run sequencing is centralized in `App.svelte` — not scattered across gate components
3. `TesterGateBar` stays thin: YES fires tester, SKIP fires documenter directly — that's all it needs to know
4. The tester agent already emits a signal at the end of its run (`[suggest] apply feature: ...`); changing that to `[run-documenter]` (or adding it alongside) is a one-line agent prompt change

**Source:**
- `src/renderer/src/App.svelte` lines 97–114 (signal constants), 209–214 (`[suggest]` handling), 280–292 (checkpoint reinvocation pattern), 273–361 (full `onDone` handler)
- `.claude/agents/tester.md` lines 95–98 (current output signal)
- `src/renderer/src/lib/runner.ts` (triggerRun — what auto-fire calls use)

**Recommendation:**

Use **Option B with the `[run-documenter]` signal approach**. The implementation for the coder:

1. Add `const RUN_DOCUMENTER_SIGNAL = '[run-documenter]'` to `src/renderer/src/lib/constants.ts`
2. In `App.svelte`'s `onStdout` handler, add a branch for `trimmed === RUN_DOCUMENTER_SIGNAL` that sets `documenterPending = true` and `continue`s (never written to terminal — same as `TESTER_GATE_SIGNAL`)
3. In `App.svelte`'s `onDone`, after the checkpoint guard, add: if `documenterPending && exitCode === 0`, reset flag, call `triggerRun('Run the documenter agent now. Read docs/context/handoff.md and update CHANGELOG and docs.', 'direct')`, and `return`
4. In `.claude/agents/tester.md`, change the output signal from `[suggest] apply feature: <name>` to `[run-documenter]` (no `[suggest]` needed — the documenter fires automatically)
5. `TesterGateBar`'s SKIP handler fires the documenter directly using the same `triggerRun` call as step 3

This means the tester gate YES path is: fire tester → tester emits `[run-documenter]` → `onDone` auto-fires documenter. The SKIP path is: `TesterGateBar.runDocumenter()` calls `triggerRun(...)` directly, bypassing the tester entirely. Both paths produce the same documenter invocation.

One important note: the plan's task 9 says to change the implementer's output signal to emit `[tester-gate]` instead of `[suggest]`. The implementer currently emits `[suggest] apply feature: <feature name>`. Removing `[suggest]` means the chip that normally fires `apply feature:` in the UI will not appear. This is intentional for the tester gate flow — the `[tester-gate]` signal replaces it. The coder should be aware this changes the entire end-of-implementer UX and verify no other code path depends on the implementer's `[suggest]` chip.
