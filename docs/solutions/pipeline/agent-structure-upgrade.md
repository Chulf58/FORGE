---
title: Agent Frontmatter Upgrade — maxTurns, Effort Tiers, Trigger Examples
category: pipeline
date: 2026-04-11
files_touched:
  - agents/*.md (all 28)
tags:
  - agent metadata
  - resource budgeting
  - intent triggers
  - effort classification
  - agent discovery
---

## Problem
Agents had no turn budgets; could spiral into context bloat. No effort metadata for orchestrators to estimate cost. Descriptions were generic — Claude Code and future orchestrators couldn't match agents to tasks effectively.

## Solution
Upgraded all 28 agent YAML frontmatter with three new fields:
1. **`maxTurns`** — turn budget. Three tiers: light (5 turns: triage/scout agents), medium (10 turns: reviewers/utility), heavy (25 turns: coder/planner/implementer/researcher).
2. **`effort`** — "low", "medium", or "high". Orchestrators use this to estimate session cost and route heavy tasks to appropriate time windows.
3. **Trigger examples in description** — rewrote all 28 descriptions with "Use when:" + 2–4 concrete scenarios. E.g., planner: "Use when breaking down a multi-day feature", "when dependencies must be sequenced". Helps matching.

All field names lowercase, quoted as needed for YAML safety. Tested on 28 agents across all agent types (pipeline, reviewer, utility, specialized).

## Key patterns
- **Three-tier turn budgeting:** Light agents (triage, scout, gotcha-checker) get 5 turns max — fast decision gates. Medium agents (reviewers, utility) get 10. Heavy agents (coder, planner, implementer, researcher) get 25 — room to reason. Architect and specialized agents split between 10 and 15 based on complexity.
- **Effort metadata for cost estimation:** `low` effort = 1–2 turns, ~5k tokens; `medium` = 5–10 turns, ~20–30k tokens; `high` = 10–25 turns, ~50–100k tokens. Future orchestrators multiply effort × hourly_cost to estimate session budget.
- **Trigger examples over generic descriptions:** Instead of "Plans features", write "Use when: breaking down a multi-day feature, sequencing dependencies, determining spike order". Claude Code's agent picker (if built) can use fuzzy match on these examples.

