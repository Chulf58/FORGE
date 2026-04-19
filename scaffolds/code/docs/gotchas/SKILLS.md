## Planner

### Universal

- Before planning a new feature, check whether it or something similar already exists in the codebase. Grep for the core noun or verb first. Planning a duplicate wastes the full pipeline.
- Always include an explicit error handling task for any feature involving I/O, network calls, or user input. "Handle errors" is not implicit — name the failure modes in the plan.
- If the feature touches auth, sessions, payments, or PII: flag it as security-sensitive in the plan so reviewer-safety receives the full checklist. Do not assume the reviewer will catch it without the signal.
- If the plan requires secrets or API keys: add an explicit task for secure credential handling. Never plan to hardcode them.

<!-- The architect agent adds stack-specific planner guidance below this line -->

---

## Coder

### Universal

- Never hardcode secrets, API keys, tokens, or credentials. If the plan requires them, flag it and stop — do not invent a storage mechanism not specified in the plan.
- Always write the error path. Every operation that can fail must have a structured failure return. "Happy path only" drafts are incomplete.
- Validate all user-supplied input at the boundary before it touches business logic or persistence. Assume all input is hostile until validated.

<!-- The architect agent adds stack-specific coder guidance below this line -->

---

## Implementer

### Universal

- Apply changes in dependency order — shared types/interfaces first, then logic layer, then consumers last.
- Read before editing — always read the current file before modifying it.
- No `any` types — use `unknown` with type narrowing.
- Match the surrounding file's code style exactly.

<!-- The architect agent adds stack-specific implementer guidance below this line -->

---

## Implementer-Triage

### Universal

- When building task briefs, extract only the gotchas relevant to each task's target files from GENERAL.md.
- If a target file type is not covered by any gotcha, omit the gotcha sub-section from the brief.

<!-- The architect agent adds stack-specific implementer-triage guidance below this line -->

---

## Researcher

### Universal

- Search the existing codebase for similar patterns before going to the web. The codebase is the highest-fidelity source for how this project solves problems.
- When researching external APIs: always check rate limits, authentication requirements, and error response shapes. These are the three most common sources of integration bugs.
- Do not web-search standard language APIs. Only use WebSearch for genuinely unknown external APIs, third-party library behaviour, or version-specific constraints not verifiable from the codebase.
- One-fetch rule: never fetch the same URL more than once per session.
- One-read rule: read each file path exactly once. Never re-read a file already in context.

<!-- The architect agent adds stack-specific researcher guidance below this line -->

---

## Refactor

### Universal

- Extract shared state into dedicated modules rather than passing data deeply through call chains.
- Merge modules that always change together. Separate files with coordinated mutations signal a missed abstraction.
- Split modules where consumers only ever read a subset.
- Replace magic numbers with named constants.

<!-- The architect agent adds stack-specific refactor guidance below this line -->

---

## Debug

### Universal

- Trace the full call path from trigger to observed failure before forming a hypothesis. Most bugs are not where the symptom appears.
- Check the most recent changes first — the majority of bugs are regressions from the last edit. `git diff` before reading the whole codebase.

<!-- The architect agent adds stack-specific debug guidance below this line -->

---

## Reviewer

### Universal

- Architecture boundaries from GENERAL.md must be respected.
- Every new public function/API must have matching type signatures.
- No `any` types — use `unknown` with type narrowing.
- All function parameters and return types explicitly typed.

<!-- The architect agent adds stack-specific reviewer guidance below this line -->

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

---

## Reviewer-Logic

### Universal

- Always verify the error path leaves the system in a consistent state — not just that the happy path works.
- Check for race conditions wherever async operations share mutable state, regardless of language.
- Confirm that input validation happens before any state mutation or persistence write — never after.

<!-- The architect agent adds stack-specific reviewer-logic guidance below this line -->

---

## Reviewer-Performance

### Universal

- Flag unbounded growth patterns — arrays, caches, or logs that grow without a cap.
- Flag expensive operations inside loops or reactive/event-driven contexts without debounce/throttle.
- Flag blocking I/O in handlers that should be non-blocking.

<!-- The architect agent adds stack-specific reviewer-performance guidance below this line -->

---

## Reviewer-Safety

### Universal

- Auth changes: check for session fixation, privilege escalation, missing re-authentication on sensitive actions, and insecure defaults.
- Payment flows: verify no card data is logged, stored in plain text, returned to the client, or passed through URLs.
- PII handling: personal data must not appear in logs, URLs, or error messages.
- No API keys, tokens, or credentials hardcoded in source files.
- Never pass user input directly to shell commands as part of the command string — use argv array form.
- String parameters interpolated into shell commands or structured formats: strip newlines with `.replace(/[\r\n]/g, ' ').trim()`.

<!-- The architect agent adds stack-specific reviewer-safety guidance below this line -->

---

## Reviewer-Style

### Universal

- Consistent file naming conventions (per GENERAL.md).
- Consistent code style (indentation, quotes, semicolons — per GENERAL.md).
- `import type { ... }` for type-only imports.
- No `any` — use `unknown` with narrowing.
- Explicit return types on all exported functions.

<!-- The architect agent adds stack-specific reviewer-style guidance below this line -->

---

## Tool-call-auditor

- After completing your audit and emitting any findings, emit the following as the **last line** of your output:
  `[pipeline-summary] mode=<apply-pipeline-mode> verdict=N/A`
- If agent-optimizer is triggered (recurring deviation found), do **not** emit `[pipeline-summary]` — that becomes agent-optimizer's responsibility after it presents its proposed changes.
- Never emit `[pipeline-summary]` more than once per run.
