# change-safety (generated: 2026-03-31)

## Planner

- For any change to a shared utility, helper, or exported function: add an explicit task to verify all callers are accounted for.
- Prefer additive changes (new function alongside old) over modifying existing shared functions when the caller surface is unknown or large.
- If the plan modifies a type or interface: order the type change task before any task that consumes the changed type.
- If the plan renames or removes an exported symbol: add a migration task that updates all call sites before the removal task.

## Coder

- Only modify files listed in the plan. If an unlisted file must change to make the feature work, surface it as a finding — do not silently edit it.
- When modifying a shared function's signature: add the new version alongside the old rather than breaking all callers at once, unless the handoff explicitly covers all callers.
- Every change to a public interface must be accompanied by a scan of its callers. If callers outside the plan scope would break, flag it before writing.
- Do not refactor, rename, or reformat code that is not part of the task — unrelated changes obscure the diff and make review harder.

## Implementer

- If a task touches a file that is also targeted by another task in the same wave, flag the conflict before applying — concurrent writes to the same file corrupt the result.
- Apply changes to type definitions and interfaces before applying changes to their consumers.
- Do not reformat, reorganize, or clean up code outside the scope of the task.
- If a file has been modified by a previous wave task in this run, re-read it before applying the current task — do not apply on top of a stale version.

## Gotcha Checker

- Identify files in the plan that are imported by files NOT in the plan — these are the implicit risk surface. Flag each one.
- If any plan task modifies a function signature: verify the plan accounts for all callers, including test files and utility modules.
- If the plan changes a shared constant: check whether that constant is used in configuration files, seed data, or build scripts, not just source files.
- If the plan adds a new required parameter to an existing function: verify the plan includes tasks for every call site.

## Reviewer-Logic

- Every modified function's callers must be accounted for in the plan or the handoff. If a function is changed and its callers are not mentioned, flag as REVISE.
- Type changes must be applied before consumer changes — if the handoff applies them in the wrong order, flag as BLOCK.
- Verify that additive changes (new alongside old) do not introduce naming ambiguity for future callers.
- If an exported symbol is removed, verify the handoff accounts for all importers — a missing importer update is a BLOCK.
