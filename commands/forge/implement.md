Run the FORGE implement feature pipeline. Read `docs/PLAN.md` for the approved plan.

## Pipeline sequence
1. **Coder-scout** (skip in LEAN): writes `docs/context/scout.json`
2. **Coder:** writes draft to `docs/context/handoff.md`
3. **Completeness-checker** (skip in LEAN): verifies plan coverage
4. **Reviewer-triage → reviewers:** dispatch based on mode
5. **Gate #2:** Write gate state FIRST, then present summary:
   - Write `.pipeline/gate-pending.json`: `{"gate":"gate2","feature":"<feature name>","status":"pending","applyKeyword":"apply feature: <feature>"}`
   - Present the implementation summary to the user
   - Ask user to type /forge:approve or /forge:discard

$ARGUMENTS
