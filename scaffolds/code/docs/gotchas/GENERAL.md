# Gotchas — GENERAL

Global rules for this project. Loaded by every agent on every run.

<!-- The architect agent fills this in during onboarding based on the project's tech stack. -->
<!-- Add project-specific gotchas here as you discover them during development. -->

---

## No silent error swallowing

Never catch an error and do nothing. Always propagate, log, or surface it to the user.

## Read before editing

Always read the current content of a file before modifying it. Never assume the content matches the plan.
