# code-structure (generated: 2026-03-31)

## Planner

- If a plan task would add more than ~150 lines of new logic to a single file, split it into subtasks by responsibility boundary.
- If two tasks in the plan modify the same shared utility, flag the ordering dependency explicitly — the second task must not assume the first has run.

## Coder

- One function should have one reason to change. If a function does two distinguishable things, split it.
- Name variables and functions for what they represent, not how they are computed. `filteredUsers` not `result2`. `isActive` not `flag`.
- Magic numbers and magic strings must be named constants. A literal `86400` or `"pending"` with no nearby explanation is a bug waiting to happen.
- A comment that explains what the code does is a sign the code should be rewritten. A comment that explains why is valuable — keep those.
- Extract a block into a named function when the block needs a comment to describe what it does.
- Do not nest more than 3 levels of conditionals. Invert guards and return early instead.
- Dead code (unreachable branches, unused variables, removed features) must be deleted, not commented out.

## Implementer

- Match the surrounding file's style exactly: indent width, quote style, trailing commas, blank-line conventions. Do not reformat lines that are not part of the task.
- Do not introduce new global state in a module that previously had none unless the handoff explicitly calls for it.

## Reviewer-Style

- Functions longer than 50 lines are a REVISE — flag for extraction unless the length is a single linear data transformation.
- Nested ternaries more than 2 levels deep are a REVISE — replace with early returns or named variables.
- Magic literals (numbers or strings with no named constant and no adjacent explanatory comment) are a REVISE.
- Identifiers that are single letters (except loop counters i, j, k and conventional type params T, K, V) are a REVISE.
- Commented-out code blocks are a REVISE — delete them, git history preserves them.
- Dead code (exports with no importers, unreachable branches) is a REVISE.

## Refactor

- Extract when a code block has been duplicated in 3 or more places.
- Inline when a helper function is called from only one place and the call site is clearer than the indirection.
- Replace magic literals with named constants in a shared constants file, not as inline variable declarations.
- Flatten deeply nested conditionals with early returns — each guard clause at the top reduces nesting for everything below.
- Replace prop-drilling chains longer than 2 levels with a shared store or context.
