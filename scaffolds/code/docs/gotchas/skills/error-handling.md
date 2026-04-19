# error-handling (generated: 2026-03-31)

## Planner

- When a task involves I/O, network, file system, or user input: name the specific failure modes in the task description — not just the success path.
- If the feature reads from an external source, add a separate task for the degraded-state experience — what does the user see when it fails?
- Never write "handle errors" as a task. Write the specific failure: "handle API timeout", "handle missing config file", "handle malformed JSON response".

## Coder

- Every operation that can fail must return a structured result: `{ data: T } | { error: string }` — never throw where a return is possible.
- Never use a bare catch with an empty body — swallowing errors silently makes bugs undebuggable. Log before discarding or rethrow.
- Distinguish error categories at the boundary: input validation (return immediately, user-fixable), external system errors (log, surface, possibly retry), internal invariant violations (throw, these are bugs).
- Error messages must include context: not "read failed" but "read failed: path=X reason=Y".
- Do not let errors change shape mid-stack — if the boundary returns `{ error: string }`, every layer above must preserve that shape, not convert it to a thrown exception.
- Never catch a specific error type and then rethrow a generic one — the call stack is lost.

## Implementer

- Verify that every catch block in the handoff has a corresponding action: rethrow, return structured error, or an inline comment explaining why silent discard is safe.
- Never introduce a catch block that only logs — if it logs, it must also return or rethrow so the caller knows the operation failed.

## Reviewer-Logic

- Every catch block must be verified: does it rethrow, return a structured error, or have a documented reason for silent discard? BLOCK if none of these are true.
- Callers of functions that return `{ data } | { error }` must handle both branches — BLOCK if the error branch is ignored.
- Error state must leave the system consistent: if a write fails halfway, the data structure must still be valid.
- Error messages must include enough context to diagnose the problem without a debugger.

## Reviewer-Safety

- Error messages must not include credentials, tokens, session IDs, or PII — flag any error that interpolates user-supplied data without sanitization.
- Stack traces must not reach the end user in production — verify error surfaces return a user-safe message, not a raw exception.

## Debug

- Classify the error before tracing: input validation (wrong data from caller), external system (API/file/DB unavailable), internal invariant (code bug). The fix strategy differs for each.
- A swallowed exception (empty catch or catch that returns null) is the most common reason a bug is invisible. Search for these first.
- If the error message lacks context, add logging before tracing further — a "null reference" with no surrounding state cannot be traced without it.
