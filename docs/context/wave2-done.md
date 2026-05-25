# Wave 2 — Done

## Files created
- `evals/graders/signal-grader.mjs` — `gradeSignals(output, expectedSignals)` → `{ ok, matched, missing }`
- `evals/graders/file-presence-grader.mjs` — `gradeFilePresence(baseDir, paths)` → `{ ok, present, missing }`
- `evals/graders/verdict-letter-grader.mjs` — `gradeVerdictLetter(output, expectedVerdicts)` → `{ ok, matched, missing }`

## Files modified
- `mcp/forge-worker.mjs` — Added watchdog-stamp block in `finally` (after `stampOrphanAgents`, before `inputChannel.close()`). Writes `watchdog-stamp.json` sidecar when `run.json` has no `failureReason`. Wrapped in try/catch — cleanup never blocks exit.
- `mcp/lib/tools/run-lifecycle.js` — Added watchdog-stamp sidecar merge in `forge_get_run` handler, after the loop-guard sidecar merge block, still within the `if (run)` check. Merges `failureReason` + `status` from sidecar only when run.json values are absent/null.

## Green bar verification

```
node scripts/eval-runner-test.mjs
[eval-runner-test] PASS: 15/15 assertions passed
EXIT: 0

node scripts/worker-watchdog-test.mjs
[worker-watchdog-test] PASS: watchdog stamp present in both files
EXIT: 0
```

## Notes for Wave 3
- Tasks 11, 17a, 17b are complete and green.
- Wave 3 covers Task 12 (`scripts/eval-from-run.mjs`) which depends on Tasks 9 and 11. Both are now satisfied.
- Task 13 (bulk scenario coverage) depends on Task 12 — Wave 3 must ship Task 12 before Wave 4 can attempt Task 13.
- `mcp/forge-worker.mjs` watchdog stamp uses `resolvedMainProjectRoot` (not `workDir`) to locate run.json, matching the path used by all other run-lifecycle code in the worker.
