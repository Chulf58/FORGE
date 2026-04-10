# Handoff: Brainstormer Agent Split + Plugin Research

## Overview
Split the planner's dual Q&A + planning role into two agents: brainstormer (owns all clarifying questions, writes requirements docs) and planner (writes plans, no questions). Added Compound Engineering competitive research, Context7 integration research, plugin migration impact analysis task, and deprioritised multi-engine epic.

## Changes

### Brainstormer Agent (NEW)
- `.claude/agents/brainstormer.md` — new agent: classifies scope (trivial/small/large), asks 0-5 questions via [questions] signal, writes structured requirements to docs/brainstorms/<slug>.md with YAML frontmatter

### Planner Simplification
- `.claude/agents/planner.md` — removed Pass 1/Pass 2/Step 0 Q&A logic (~60 lines). Now reads brainstorm doc if exists, plans directly. No questions.

### Pipeline Routing
- `templates/code/CLAUDE.md` — pipeline updated: brainstormer (conditional based on input detail) → planner → researcher → reviewers. Orchestrator heuristic: skip brainstormer if input has acceptance criteria, file paths, or affected areas.

### Constants
- `src/renderer/src/lib/constants.ts` — brainstormer added to AGENT_META and plan feature agent lists (lean/standard/full)

### Orchestrator Rules
- `src/main/shared.ts` — removed Q&A-before-approach section (brainstormer handles it now)

### Board Changes
- Added high: knowledge-compound-step (done), forge-plugin-exploration, forge-plugin-migration-impact
- Added medium: knowledge-compound-refresh, ideate-command, scope-guardian-check, session-history-search, context7-integration
- Deprioritised: 4 multi-engine items high→low, tagged multi-engine-epic
- Marked done: many items from today's session
