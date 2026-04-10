# convention-matching (generated: 2026-03-31)

## Coder

- Before naming a new function, variable, or type: grep for 2–3 existing examples of the same kind in the same file or module and match the naming pattern.
- Before adding a new error handling pattern: grep to find how existing error paths are handled in the file. Match the established shape rather than introducing a second convention.
- Before choosing an import style (relative path, barrel/index file, path alias): check what the surrounding files use and match it.
- If naming conventions conflict between files in the same module, match the file being edited — do not introduce a third convention.
- When the project has a linter or formatter config (.eslintrc, prettier, .editorconfig): treat it as the authoritative style source, not personal preference.

## Implementer

- Preserve the exact indent width, quote style, trailing comma policy, and blank-line count between functions of the file being edited.
- Do not introduce a new import style into a file that already uses a consistent import style.
- If the file uses JSDoc comments on public functions, add JSDoc to any new public function. If it does not, do not introduce JSDoc.
- If the file uses a specific error return shape (thrown exception vs `{ error }` return vs callback), match it — do not introduce a second pattern.

## Reviewer-Style

- Any identifier that breaks the established naming pattern of the surrounding module is a REVISE — even if the name is valid in isolation.
- Any import style that differs from the rest of the file is a REVISE.
- Any error handling shape that differs from the established pattern in the same file is a REVISE — consistency matters more than the coder's preferred style.
- Formatting deviations from surrounding code (different indent, different quote style, different bracket placement) are a REVISE even if they match a valid external standard.
- If the file has no JSDoc and the handoff adds JSDoc to new functions only, flag as REVISE — partial documentation is harder to maintain than none.

## Refactor

- Before proposing a naming change: check how widely the old name is used. A rename that touches 20+ files is a separate dedicated refactor, not an inline fix bundled with feature work.
- When unifying divergent conventions across files: establish the target convention explicitly in a single commit rather than fixing files opportunistically across multiple features.
- Do not mix convention cleanup with logic changes in the same commit — reviewers cannot tell which diff is the fix and which is the cleanup.
