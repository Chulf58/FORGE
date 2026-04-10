# FORGE — Recovery Points

> Safe commits to roll back to if something breaks. Most recent first.

---

## dc1a4eb — Session 5: Glass wall terminal, reference formats, boundary rules (2026-04-07)

**Restore:** `git checkout dc1a4eb`

Structured tool call rendering: collapsible entries with icons, tool names, params, expandable results.
New claude-tool-result IPC event (5KB cap). ToolCallLine type in session store. Reference format
handling (blocks binary, supports text). Orchestrator boundary rules (direct/sprint/plan feature
criteria in ORCHESTRATOR_RULES). Process: stated reviewers must run before task done.

---

## f1c49dc — Session 4: Project references, signal validation, board cleanup (2026-04-07)

**Restore:** `git checkout f1c49dc`

Project references feature complete (4 tasks): fetch-reference IPC with SSRF/redirect/path protection,
list/delete handlers, UI with fetch/refetch/stale warnings, orchestrator snapshot + signal, multi-format
support. Signal validation warnings (silent skips → visible errors). Board cleanup (merges, deferrals,
audit). Documenter updates modules.json in all modes. Integrity-checker Check 11 (modules validation).
Triage rule in ORCHESTRATOR_RULES. Memory rule: always present approach + always run stated reviewers.

---

## 91484ea — Session 3: Board cleanup, signal validation, pipeline audit (2026-04-07)

**Restore:** `git checkout 91484ea`

Board consolidation: 5 done, 2 deleted, 6 merged into epics, 13 deferred, 14 new tasks.
Signal validation warnings implemented (3 silent skips → visible errors).
Triage count-based gate added to orchestrator rules.
Pipeline audit complete (9 active, 1 marginal, 2 dormant modes).
Feature value audit: observer→merge with auditor, TDD/tester parked, regression-risk→fold into triage.
31 files quarantined + PipelineVisualiser. Intent handler deregistered.

---

## 8fde7cd — Real One Chat + Terminal Readability + Doc Restructure (2026-04-07)

**Restore:** `git checkout 8fde7cd`

Full working state after the biggest single session. Includes:
- One Chat conversational orchestrator (single Enter, Sonnet session, pipeline handoff via [run-pipeline])
- 90% context reduction for conversation (~240KB → ~34KB)
- Project snapshot injection (TODOs, modules, planned items in system prompt)
- Terminal readability: dim work, gold accent, sticky gates, collapsible blocks, markdown rendering, question highlighting
- TODO enrichment levels (Light/Standard/Full) in Settings
- FORGE-OVERVIEW.md trimmed to narrative-only (Eras + philosophy)
- FORGE-REFERENCE.md generated from source-of-truth files
- FORGE-PRESENTATION.html slide deck with Era 18
- BACKSTAGE button removed
- Modules audit complete (One Chat module added, 5 modules updated)
- LIVE tab hides mode badge in one-chat mode

---

## 617ca64 — Pre-One Chat (Phases 1/1.5/2 complete) (2026-04-07)

**Restore:** `git checkout 617ca64`

Last state before Real One Chat work began. Includes:
- Haiku intent classifier + two-Enter confirmation (IntentConfirmRow)
- LIVE tab agent preview (Phase 1.5)
- Gates as conversation (inline in terminal)
- Right panel collapse toggle (290px width)
- Chat pipeline type for non-pipeline requests
- Intent classification log persistence

Use this if the One Chat orchestrator needs to be reverted entirely.
