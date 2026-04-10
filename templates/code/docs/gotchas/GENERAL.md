# Gotchas — GENERAL

Global rules for this project. Loaded by every agent on every run.

<!-- The architect agent fills this in during onboarding based on the project's tech stack. -->
<!-- Add project-specific gotchas here as you discover them during development. -->

---

## Three-layer boundary (Electron projects)

If this is an Electron app, never put Node.js code in the renderer or browser code in the main process. Always use IPC.

## No silent error swallowing

Never catch an error and do nothing. Always propagate, log, or surface it to the user.

## Read before editing

Always read the current content of a file before modifying it. Never assume the content matches the plan.
