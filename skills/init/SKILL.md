---
name: init
description: "Initialize a new FORGE project. Use when: user wants to set up FORGE in a new project, or says 'init', 'setup', 'initialize'."
argument-hint: "[optional: project name]"
allowed-tools: "Read Write Glob Bash"
---

Initialize a new FORGE project. Check if .pipeline/project.json exists (abort if so). Ask: project name, tech stack, description. Create .pipeline/ (project.json, board.json, modules.json) and docs/ (PLAN.md, gotchas/GENERAL.md). Print "FORGE project initialized."

$ARGUMENTS
