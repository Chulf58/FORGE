---
title: Enforcement Mechanisms — Bash Guard, Context Reinjection, Stop Hook
category: pipeline
date: 2026-04-11
files_touched:
  - hooks/bash-guard.js
  - hooks/ctx-post-compact.js
  - hooks/ctx-stop.js
  - hooks/hooks.json
  - forge-rules.md
tags:
  - tool enforcement
  - context preservation
  - advisory checks
  - hook-based governance
  - exit code 2
---

## Problem
Agents could use expensive Bash commands (cat, grep, find, sed) when cheaper dedicated tools existed. Context reinjection was missing after compaction — rules would be lost mid-session. Pipeline incompleteness had no warning system. Approval-first rule was prompt-enforced only.

## Solution
Three enforcement hooks plus a curated rules file:
1. **Bash guard (PreToolUse):** Blocks Bash commands that should use dedicated tools (cat→Read, grep→Grep, find→Glob, sed→Edit, wc→Read), exits code 2 to force replanning. Whitelists git, npm, node, process ops. Inspired by GSD and Disciplined Process Plugin.
2. **Context reinjection (PostCompact):** Fires after mid-session compaction; re-injects `forge-rules.md` (35-line curated rules: tool selection, approach-first, pipeline mode, gate approval, token conservation) via additionalContext. Prevents rule loss mid-session.
3. **Stop hook (Stop event):** Fires when Claude finishes responding. Checks 3 conditions (incomplete pipeline agents, pending gate, unapplied handoff) with 30-minute staleness guard. Outputs advisory via additionalContext — never blocks, just reminds.

## Key patterns
- **Exit code 2 enforcement:** PreToolUse hook exits code 2 to force agent replanning; cannot be bypassed. Paired with clear stderr message telling which tool to use.
- **Rule preservation post-compaction:** After context compression, rules are lost. PostCompact hook solves this by re-injecting via additionalContext stdout JSON — minimal payload (35 lines).
- **Staleness guard on advisories:** 30-minute threshold prevents false positives from abandoned runs or stale handoff content. Calculate staleness as `(now - createdAt) > 30m`.
- **Advisory-only final checks:** Stop hook never blocks; only reminds. Allows user to decide (incomplete pipeline might be intentional; pending gate might be awaiting approval elsewhere). Respects agency while surfacing risks.

