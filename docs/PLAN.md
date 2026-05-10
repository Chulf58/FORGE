## Active Plan

### Feature: wiring-verify (TDD chain Wave 5)

Summary: Post-handoff script proves every new exported symbol / agent / hook / signal has at least one consumer, closing the unwired-helper failure mode.

#### Phase 1 — Failing tests (TDD wave 1 — red bar)

- [ ] 1. Write failing tests for the wiring verifier (`scripts/wiring-verify-test.mjs`) (wave: 1)
  Intent: Establish a red bar before any implementation exists — prevents Red+Green collapse per research §3.2.
  Verify: AC-1: `node --test scripts/wiring-verify-test.mjs` exits non-zero; test cases assert (a) **smoke-pass** — a synthetic handoff declaring a new helper that IS imported elsewhere emits zero `[wiring-gap]` lines and exits 0 under `--strict`, (b) **smoke-gap** — a synthetic handoff declaring a new helper with no callers emits `[wiring-gap] <symbol>` to stderr and exits non-zero under `--strict`, (c) **diagnostic-only default** — without `--strict`, a zero-consumer helper still emits `[wiring-gap]` but exits 0, (d) **new agent detection** — a synthetic handoff listing a new `agents/<name>.md` with no reference in any skill/config emits `[wiring-gap] agent:<name>`, (e) **new hook detection** — a new `hooks/<name>.js` with no entry in `hooks/hooks.json` emits `[wiring-gap] hook:<name>`; all tests use `assertVerifierLoaded` to fail genuinely until `scripts/wiring-verify.mjs` exists. No `.skip` markers.

#### Phase 2 — Implementation (TDD wave 2 — green bar)

- [ ] 2. Implement wiring verifier (`scripts/wiring-verify.mjs`) (wave: 2)
  Depends: 1
  Intent: Detect zero-consumer exports, agents, hooks, and CLI scripts in post-handoff context so unwired helpers surface before merge rather than silently at runtime.
  Verify: AC-2: `node --test scripts/wiring-verify-test.mjs` exits 0; verifier reads handoff "Files modified" via `extractSection('Files modified', handoffText)` + `extractCodeBlockContent(...)` from `scripts/lib/handoff-utils.mjs` (same pattern as `covers-verify.mjs` lines 59–67 — do NOT import private functions from `lean-risk-classify.mjs`); for each new file, parses wiring patterns (see feature request table) using language-aware regex; for each symbol with zero consumers across the codebase (excluding the new file itself) emits `[wiring-gap] <symbol>` to stderr; exits 0 by default (diagnostic), exits non-zero with `--strict`; emits `[wiring] <N> exports verified, <M> gaps` summary line to stderr.

- [ ] 3. Wire verifier into implement, debug, and refactor skills (`skills/implement/SKILL.md`, `skills/debug/SKILL.md`, `skills/refactor/SKILL.md`) (wave: 2)
  Depends: 2
  Intent: Surface wiring gaps before reviewers see the handoff, mirroring the covers-verify post-coder step pattern already present in `skills/implement/SKILL.md` lines 227–232.
  Verify: AC-3: All three SKILL.md files contain a step running `node scripts/wiring-verify.mjs --handoff=docs/context/handoff.md --root=<worktreePath>` after the coder writes the handoff and before reviewer dispatch; the step logs `[wiring] <N> exports verified, <M> gaps` as diagnostic stderr (NOT a registered control signal — no `docs/SIGNAL-PROTOCOL.md` update needed); `[wiring-gap]` lines are collected and appended as a `## Wiring gaps` section to the handoff for reviewer visibility; a gap does not block the pipeline.

- [ ] 4. Add wiring-gap rule to reviewer-boundary agent (`agents/reviewer-boundary.md`) (wave: 2)
  Depends: 2
  Intent: Make reviewer-boundary surface wiring gaps in verdicts so the human at Gate #2 sees any unwired code explicitly flagged, not buried in diagnostic output.
  Verify: AC-4: `agents/reviewer-boundary.md` contains a new checklist item under `### Architecture boundaries` (or a new `### Wiring` subsection) stating: for handoffs declaring new exports, agents, hooks, or signals, check whether `## Wiring gaps` is present in the handoff; if gaps exist, surface them as REVISE findings listing each `[wiring-gap]` item; existing boundary checklist items are not removed or reordered.

#### Phase 3 — Regression (TDD wave N)

- [ ] 5. Full regression suite green after wiring-verify feature (`scripts/wiring-verify-test.mjs`, `scripts/run-tests.mjs`) (wave: 3)
  Depends: 2, 3, 4
  Intent: Confirm the new test file passes and the existing suite remains green — no regressions from new scripts or agent/skill edits.
  Verify: AC-5: `node --test scripts/wiring-verify-test.mjs` exits 0; then `node scripts/run-tests.mjs` exits 0 with no skipped or deleted cases.

### Research needed

None — all design decisions can be made from codebase evidence and the c652b885 TODO body. Key findings: `extractSection` + `extractCodeBlockContent` from `scripts/lib/handoff-utils.mjs` are the correct public exports (same pattern used by `covers-verify.mjs` lines 59–67); `[wiring]` / `[wiring-gap]` are diagnostic stderr only, not registered control signals (per SIGNAL-PROTOCOL.md design principle 4 — unread signals must not be registered); `skills/implement/SKILL.md` lines 227–232 are the exact pattern to mirror for the post-coder step in all three skills; `agents/reviewer-boundary.md` `### Architecture boundaries` checklist is the correct insertion point for the wiring-gap rule.

### Approach summary
- Decision: Pure ESM verifier reads handoff via existing `handoff-utils.mjs` exports (Option B, same as covers-verify); wired into all three pipeline skills (implement/debug/refactor) as post-coder Bash subprocess steps; reviewer-boundary gets a checklist rule to surface gaps in verdicts; diagnostic-only by default, blocking with `--strict`; TDD-structured in three waves per GENERAL.md §TDD discipline.
- Trade-off: Regex-based export/registration detection (no AST) — fast and dependency-free but may miss exotic re-export patterns; flagged in the TODO as a promote-later item (cluster 28cf18b4).
- Uncertainty: Regex patterns for detecting new agent/hook registrations depend on codebase conventions staying stable; if conventions change the patterns need updating.
