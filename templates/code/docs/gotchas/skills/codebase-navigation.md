# codebase-navigation (generated: 2026-03-31)

## Planner

- Before writing tasks, search for the core noun or verb of the feature using Grep. If it already exists, plan an extension of the existing code — not a new parallel implementation.
- Identify which modules the plan will touch by reading their public interfaces (exports, API surface), not their full implementations.
- When the project is unfamiliar: read the entry point file(s) first to understand the top-level structure before reading any detail file.
- Never plan to reimplement something that Grep shows already exists in the codebase.

## Researcher

- Start every investigation by grepping for the pattern, not by reading files. Find the relevant file first, then read the relevant section.
- Read entry point files and module index files before implementation files — they give the map before the territory.
- One-read rule: read each file path exactly once per session. Extract everything needed before moving on; never re-read.
- Apply offset and limit when reading large files: grep for the target section start line, then read from that offset with a 300–400 line cap.
- When searching for a pattern, use the most specific term first. Broaden only if the specific search returns nothing.

## Coder

- Before implementing a new function, grep for the signature or behaviour it provides — the codebase may already have it.
- Read the file being modified and one level of its direct imports before writing. Do not read the full dependency tree.
- When the handoff references a type or interface from another file, read only that file's type definition — not its full implementation.

## Debug

- Start from the symptom: read the file where the failure is observed, then trace one call level outward at a time. Do not read unrelated modules.
- Grep for the error message string before reading any file — it usually points directly to the origin.
- One-read rule applies during debug: extract all hypotheses from a file before moving to the next one.

## Gotcha Checker

- For plans that touch more than 5 files: check whether any of the touched files are imported by files NOT in the plan. These are implicit risk surfaces the plan has not accounted for.
- If the plan introduces a new file that duplicates the role of an existing file, flag it — parallel implementations diverge silently over time.
