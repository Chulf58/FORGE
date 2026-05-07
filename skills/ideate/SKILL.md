---
name: forge:ideate
description: "Run the FORGE critic -- adversarial codebase analysis. Use when: user wants improvement ideas, asks 'what should we fix', or wants a critical review of the project."
argument-hint: "[optional: focus area]"
allowed-tools: "Read Glob Grep"
---

Run the FORGE critic -- adversarial codebase analysis.

## STEP 1 — Dispatch (conductor only)

If `.pipeline/.worker-session` exists, this is a worker session — skip to STEP 2.

In a conductor session, call `forge_create_run` with:
- `sessionId`: your session ID (or `"unknown"`)
- `pipelineType`: `"ideate"`
- `feature`: the focus area from the user's input, or `"codebase-review"` if none
- `spawnWorker`: `true`

Report the run ID and log file to the user. Exit — the worker handles STEP 2.

<!-- Step 2 below is executed by the autonomous worker process.
     The conductor session exits after Step 1. -->

## STEP 2 — Run the critic

**Pre-scan (before critic dispatch):** Run the deterministic pre-scan script via Bash:

```
node scripts/critic-pre-scan.mjs
```

If the script exits non-zero, log a warning (`[ideate] pre-scan failed — proceeding without pre-scan data`) and continue. Do not abort the run. On success, `docs/context/pre-scan-findings.json` is written with dead-code, fragility, and security findings. The critic consumes it automatically in Step 1.

Before dispatching the critic agent, write `docs/context/critic-session.json` with:
```json
{
  "focusArea": "<focus area from ARGUMENTS, or null if none>",
  "focusFiles": []
}
```

If `$ARGUMENTS` is non-empty, set `focusArea` to the argument string. If `$ARGUMENTS` is empty or absent, set `focusArea` to `null`. Always write the file — the critic expects a consistent contract even when no focus is given.

Then invoke the **critic** agent. It critically analyses the project, finds weaknesses, missing capabilities, risky patterns, and improvement opportunities.

The critic uses six lenses: fragility, missing capabilities, technical debt, security/safety, user experience gaps, and architecture challenge. Maximum 10 findings, each referencing a specific file or module with citations.

**Post-critic verification:** After the critic completes, run the citation verifier via Bash:

```
node scripts/verify-critic-citations.mjs
```

If exit 0: verified findings are in `docs/context/critic-verified.json`. Read that file and emit `[todo]` signals only from verified findings:

```
[todo] HIGH: <title> — <description>
[todo] MEDIUM: <title> — <description>
[todo] LOW: <title> — <description>
```

If exit non-zero: log `[ideate] citation verification failed — no findings promoted to board` and continue. Do not emit `[todo]` signals from unverified findings.

After verification (or verification failure), call `forge_update_run` with `status: "completed"`.

$ARGUMENTS
