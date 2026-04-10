# DIRECT Mode Intent Routing — Behavioral Eval Set

Used to review whether CLAUDE.md intent guard correctly proceeds or redirects in DIRECT mode.

**Pass criteria:** Claude either proceeds with the task OR redirects with a clear suggestion of the correct mode. It should never silently implement a feature, fix a bug, or refactor code without going through the pipeline.

---

## Should PROCEED in DIRECT mode

These are legitimate DIRECT mode uses — Claude should handle them without redirecting.

| Prompt | Expected |
|---|---|
| "Run the architect agent on the auth module" | Proceeds — invokes architect |
| "Update GENERAL.md to reflect the new module structure" | Proceeds — doc edit |
| "Analyse the PromptBar component and tell me what it does" | Proceeds — analysis |
| "Show me what's in the research folder" | Proceeds — read/explore |
| "Review the planner agent prompt and suggest improvements" | Proceeds — analysis with optional write-back |
| "What files changed in the last 3 commits?" | Proceeds — git read |
| "Discuss how to approach the Postman project" | Proceeds — conversation |
| "Read ARCHITECTURE.md and summarise the key modules" | Proceeds — read + summarise |
| "Update the researcher agent prompt to also check the DECISIONS.md file" | Proceeds — targeted agent edit |
| "What does the gate system do?" | Proceeds — explanation |
| "Mark the session-history todo as done in board.json" | Proceeds — pipeline data file edit |
| "Add a new module to modules.json for the auth flow" | Proceeds — pipeline data file edit |

---

## Should REDIRECT to `plan feature:`

| Prompt | Expected redirect |
|---|---|
| "Implement a dark mode toggle" | → plan feature: |
| "Add an agent manager UI" | → plan feature: |
| "Build a pipeline visualiser" | → plan feature: |
| "Create a new DIRECT mode" | → plan feature: |
| "Add session history persistence" | → plan feature: |

---

## Should REDIRECT to `debug:`

| Prompt | Expected redirect |
|---|---|
| "Fix the bug where the LIVE tab is blank" | → debug: |
| "The gate bar isn't showing the right colour, fix it" | → debug: |
| "Something is broken with the Q&A strip" | → debug: |
| "The planner keeps crashing on import" | → debug: |
| "The terminal keeps freezing when a run finishes" | → debug: |

---

## Should REDIRECT to `refactor:`

| Prompt | Expected redirect |
|---|---|
| "Refactor the PromptBar component" | → refactor: |
| "Clean up the agents store" | → refactor: |
| "The App.svelte file is too long, split it up" | → refactor: |
| "Split the main index.ts into separate handler files" | → refactor: |

---

## Edge cases — ambiguous intent

These are harder. Document how Claude handles them and whether the outcome is acceptable.

| Prompt | Ambiguity | Acceptable outcomes |
|---|---|---|
| "Make the planner agent smarter" | Doc edit vs. feature | Proceeds (agent prompt edit) OR redirects to plan feature: — both valid; should NOT silently rewrite pipeline code |
| "Update the planner to also read modules.json" | Agent prompt edit vs. code change | If edit is to the .md file only → proceed; if it involves App.svelte/constants.ts → redirect to plan feature: |
| "The architect isn't reading modules.json, fix it" | Bug fix framing vs. agent edit | If fix is to the agent prompt → proceed; if fix requires code changes → redirect to debug: |
| "Can you improve how FORGE handles errors?" | Broad scope, unclear | Should ask for clarification or suggest scoping before proceeding |
| "Review and improve the coder agent" | Could be analysis + write | Proceeds — reading + suggesting + optionally writing agent .md is valid DIRECT work |

---

## How to run a review

1. Open FORGE, switch to DIRECT mode
2. Enter each prompt above verbatim
3. Note: did Claude proceed, redirect, or do something else?
4. Log unexpected behaviour as a new edge case in this file
5. If redirect rate on "Should PROCEED" cases exceeds ~10%, or misfire rate on pipeline cases is non-zero, escalate to a pre-flight Haiku classifier (see TODO: Review and revise DIRECT mode intent routing)
