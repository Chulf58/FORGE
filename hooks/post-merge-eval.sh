#!/bin/bash
# post-merge-eval.sh — Non-blocking full eval after merges to catch indirect regressions.
#
# Wire this to git:
#   cp hooks/post-merge-eval.sh .git/hooks/post-merge && chmod +x .git/hooks/post-merge
#
# Non-blocking: always exits 0. Results go to evals/scheduled-runs/<ISO-date>.json.
# Conductor or contributor reads evals/scheduled-runs/ to see regression reports.
# Use `node scripts/eval-scheduled-freshness.mjs` to verify the mechanism is firing.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

node "$PROJECT_ROOT/scripts/eval-agent-prompts.mjs" --scheduled
echo "[post-merge-eval] eval complete. Check evals/scheduled-runs/ for results."
exit 0
