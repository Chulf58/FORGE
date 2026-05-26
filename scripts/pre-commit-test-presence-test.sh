#!/usr/bin/env bash
# @covers scripts/pre-commit-test-presence-test.sh
# Test harness for pre-commit-test-presence.sh — 3 branches.
# Uses isolated temp git repos to avoid polluting the real worktree.
# Reports [pre-commit-test] 3/3 PASS on success, exits 0.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/pre-commit-test-presence.sh"

pass=0
fail=0

run_test() {
  local label="$1"
  local expected_exit="$2"
  local setup_fn="$3"

  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT

  # Init isolated git repo
  git -C "$tmpdir" init -q
  git -C "$tmpdir" config user.email "test@test.com"
  git -C "$tmpdir" config user.name "Test"

  # Run setup function in the temp dir context
  (cd "$tmpdir" && eval "$setup_fn") 2>/dev/null

  # Run the hook from inside the temp repo
  local actual_exit=0
  (cd "$tmpdir" && bash "$HOOK" 2>/dev/null) || actual_exit=$?

  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo "[pre-commit-test] PASS: $label"
    ((pass++)) || true
  else
    echo "[pre-commit-test] FAIL: $label (expected exit $expected_exit, got $actual_exit)"
    ((fail++)) || true
  fi

  trap - EXIT
  rm -rf "$tmpdir"
}

# Branch 1: MISSING-TEST — new source file, no test → hook must exit 1
setup_missing_test() {
  mkdir -p mcp/lib
  echo 'export function foo() {}' > mcp/lib/example-new-presence-sentinel.js
  git add mcp/lib/example-new-presence-sentinel.js
}
run_test "MISSING-TEST: new source without test → exit 1" 1 "$(declare -f setup_missing_test); setup_missing_test"

# Branch 2: PAIRED-TEST — source + co-located test both staged → hook must exit 0
setup_paired_test() {
  mkdir -p mcp/lib
  echo 'export function foo() {}' > mcp/lib/example-new-presence-sentinel.js
  echo '// @covers mcp/lib/example-new-presence-sentinel.js' > mcp/lib/example-new-presence-sentinel-test.js
  git add mcp/lib/example-new-presence-sentinel.js mcp/lib/example-new-presence-sentinel-test.js
}
run_test "PAIRED-TEST: source + test both staged → exit 0" 0 "$(declare -f setup_paired_test); setup_paired_test"

# Branch 3: DOC-ONLY — only CHANGELOG.md staged → hook must exit 0 (no false positive)
setup_doc_only() {
  echo '# Changelog' > CHANGELOG.md
  git add CHANGELOG.md
}
run_test "DOC-ONLY: doc file staged, no source → exit 0" 0 "$(declare -f setup_doc_only); setup_doc_only"

total=$((pass + fail))
echo ""
if [[ $fail -eq 0 ]]; then
  echo "[pre-commit-test] ${pass}/${total} PASS"
  exit 0
else
  echo "[pre-commit-test] ${pass}/${total} PASS, ${fail} FAIL"
  exit 1
fi
