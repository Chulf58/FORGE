## Safety Review: test-author agent and pipeline split

### Issues
None identified.

### Verified
- [x] **Process spawning** — test-author calls `node --test <file-path>` via Bash (AC-4, AC-5). Same risk profile as existing coder invocations in `skills/implement/SKILL.md` Step 2b, which already runs test commands without sanitization concerns. Test file paths come from the plan, not untrusted input. Bash tool passes constructed args array (not shell string interpolation).
- [x] **Handoff artefact injection** — test-author writes `docs/context/test-author-handoff.md` containing test file paths and failure output (AC-3). Coder reads this as markdown text, not executable code. Plan does not require output sanitization, but coder inherits responsibility for safe usage (outside plan-stage scope). No path traversal: writes scoped to `docs/context/` directory per allowedPaths enforcement.
- [x] **Write-target enforcement** — `.pipeline/agent-roles.json` entry `"test-author": { "allowedPaths": ["hooks/*-test.js", "mcp/*-test.mjs", "scripts/*-test.mjs", "docs/context/test-author-handoff.md"] }` (AC-7). Verified `hooks/ctx-pre-tool.js` lines 148-196: hook correctly interprets wildcard patterns (`*-test.js` basename matching) and exact paths. Test-author cannot escape permitted write targets. Pattern matching logic at lines 57-80 handles recursive `/**` globs, basename wildcards, and exact matches correctly.
- [x] **Agent isolation** — test-author is invoked before coder sees plan or implementation reasoning (AC-2, AC-3). This is intentional subagent isolation per GENERAL.md §TDD discipline and research findings. No risk; isolation is a security pattern (least privilege).
- [x] **Red-phase abort state** — AC-4 specifies abort when test passes without implementation but does not require cleanup. Test file remains in worktree if red-phase exits 0 and triggers abort. This is a process concern, not a security vulnerability; worktree is not "inconsistent" in a safety sense, just incomplete.
- [x] **Model and context** — test-author specified on Haiku with `tools: [Read, Write, Glob, Grep, Bash]` (AC-1). Model choice is a performance/reliability trade-off, not a security issue. allowedPaths enforcement applies regardless of model.
- [x] **Handoff schema** — AC-3 specifies handoff structure (test file paths + failure output, no reasoning leakage). No injection surface from markdown structure; coder reads this as text, not executed code.

### Per-criterion verdicts

- **AC-1** (test-author.md agent file): SKIPPED — plan-stage review focuses on safety surface; file structure (frontmatter, Permissions) is outside safety scope.
- **AC-2** (skill split integration): SKIPPED — skill integration and control flow are outside safety scope; reviewed by reviewer-boundary.
- **AC-3** (handoff artefact): MET — handoff path is scoped to `docs/context/`, markdown-based, no executable injection surface identified.
- **AC-4** (red-phase abort): MET — abort is a straightforward exit; no cleanup required for safety (stale files are a process concern, not a vulnerability).
- **AC-5** (green-phase verification): MET — same test-command execution as existing coder flow; no new injection surface.
- **AC-6** (failing tests): SKIPPED — test structure is outside safety scope; verified by regression suite.
- **AC-7** (agent-roles.json allowedPaths): MET — paths constrain writes to test files and handoff artefact; ctx-pre-tool.js enforcement is correct and tested (hook-utils pattern matching verified).

### Verdict
APPROVED — no safety issues identified. All critical surfaces (process spawning, handoff injection, write-target enforcement, agent isolation) are either covered by existing mitigations or within acceptable risk profile given current coder behavior.
