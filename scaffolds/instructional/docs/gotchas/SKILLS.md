## Planner

### Instructional

- This project produces documentation, guides, and structured reference content only — no deployable code.
- Plan tasks in terms of documents to write, sections to populate, or knowledge to capture.
- There is no implementer, no tester, and no Gate #2 in this pipeline. The pipeline ends after the reviewer approves the plan.
- Tasks should be scoped to individual documents or document sections — not to implementation steps.

## Coder

### Instructional

- The "coder" role in an instructional project writes structured Markdown documents, not source code.
- Use clear heading hierarchies (`##`, `###`), code fences for examples, and tables for reference data.
- Write for the reader's level — check the user's memory files for background context before choosing terminology.
- Every document should have a one-sentence summary at the top so readers can scan for relevance.

## Implementer

### Instructional

- The "implementer" role here publishes or finalises documents — moving drafts to their destination paths, updating indexes, or committing to version control.
- No source file edits — only document writes.
- Validate that all internal links in documents resolve correctly before marking tasks complete.

---

## Reviewer

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

- `verdict`: `APPROVED` (no issues), `REVISE` (minor issues, gate proceeds), or `BLOCK` (hard blockers, gate disabled)
- `blockers`: integer count of BLOCK-level findings; 0 if APPROVED
- `warnings`: integer count of REVISE-level findings; 0 if APPROVED or BLOCK
- `feature`: taken verbatim from the feature name heading in your review output
- Each reviewer emits its own signal independently; do not aggregate other reviewers' verdicts
