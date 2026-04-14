---
name: forge:ideate
description: "Run the FORGE ideator -- adversarial codebase analysis. Use when: user wants improvement ideas, asks 'what should we fix', or wants a critical review of the project."
argument-hint: "[optional: focus area]"
context: fork
allowed-tools: "Read Glob Grep Agent"
---

Run the FORGE ideator -- adversarial codebase analysis.

Invoke the **ideator** agent. It critically analyses the project, finds weaknesses, missing capabilities, risky patterns, and improvement opportunities. Emits [todo] signals for actionable improvements.

The ideator uses five lenses: fragility, missing capabilities, technical debt, security/safety, and user experience gaps. Maximum 10 findings, each referencing a specific file or module.

This is a read-only exploration -- no files are modified.

$ARGUMENTS
