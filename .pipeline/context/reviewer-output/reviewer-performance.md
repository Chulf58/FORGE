## Performance Review: impact-mapped test traceability via @covers tags

### Stage
Plan review

### Issues
- [ ] **Backfill heuristic complexity** — Task 10, line 193 — The backfill script infers source paths by matching "strip `-test` suffix" against "existing source paths." No explicit algorithmic complexity specified. Assumed O(n×m) (test files × source paths) but acceptable for one-shot operator-triggered script and expected small project size (<100 test files, <500 source files).

- [ ] **Map builder re-parsing across phases** — Task 5, line 168 — The impact-map builder globs and parses test files per-phase invocation within the Phase Execution Loop. If multiple phases or features are run, the same test files are re-read/re-parsed. No persistent cross-phase cache specified. Acceptable for simplicity; cross-phase caching is a follow-up optimization if profiling reveals bottleneck.

### Verified
- [x] **Test subprocess batching** — AC-4 resolution (line 124) explicitly mandates single batched invocation: `node --test <file1> <file2> ... <fileN>` per phase, amortizing startup cost.
- [x] **Unbounded state growth** — AC-5 confirms "no I/O side effects beyond file reads"; map is built once per verifier invocation and not persisted across runs.
- [x] **Eager loading** — Impact map is built on-demand (post-coder step in implement skill), not at app startup.
- [x] **Blocking startup** — Feature is build/test-time, not runtime app—no startup blocking concern.
- [x] **Handoff parsing cost** — Single `extractFilePaths` call per verifier invocation from `scripts/lib/handoff-utils.mjs` is idempotent and acceptable.
- [x] **File count scaling** — Expected test file count < 50 for FORGE plugin project; linear scaling with map builder and verifier is acceptable.

### Per-criterion verdicts

**AC-1 (parser pure function):** SKIPPED — scope is performance only; parser design (pure vs. stateful) is correctness/boundary domain.

**AC-2 (phase-loop integration):** MET — The plan clarifies test-author dispatch as Step 3.0 nested inside the existing Phase Execution Loop with conditional skip when phase has no test files. No eager loading or blocking startup.

**AC-3 (JSON handoff artefact):** MET — Handoff is a single JSON file, no unbounded growth; write happens once per test-author invocation.

**AC-4 (red-phase verification batching):** MET — Resolution (line 124) mandates batched `node --test` subprocess per phase; single invocation amortizes startup.

**AC-5 (map builder I/O):** MET — AC-5 verification (line 168) specifies "no I/O side effects beyond file reads"; builder is pure aggregation.

**AC-6 (verifier post-handoff):** MET — Verifier runs once post-coder via single batched test subprocess per Task 6; no unbounded looping or re-invocations.

**AC-7 (skill integration):** MET — Task 7 wires verifier into implement skill as a single post-coder step; runs once per phase.

**AC-8 (coder agent instruction):** SKIPPED — scope is functional requirement only; performance impact is negligible (coder task: add a comment per new test file).

**AC-9 (agent-roles entry):** SKIPPED — scope is access control, not performance.

**AC-10 (backfill script):** MET — One-shot operator-triggered script; O(n×m) complexity acceptable for expected project size. Dry-run flag allows operator review.

**AC-11 (regression suite):** SKIPPED — scope is testing completeness, not performance (test count/execution time are dependent on test suite size, not design pattern).

### Verdict
APPROVED — no performance issues found. Plan exhibits proper batching discipline (test subprocess calls are amortized), avoids unbounded state growth (map is built on-demand and discarded after verifier run), and uses on-demand loading (impact map built post-coder, not at startup). Minor opportunities (cross-phase map caching, backfill algorithm documentation) are acceptable to address during implementation if profiling reveals bottlenecks; they do not block plan approval.
