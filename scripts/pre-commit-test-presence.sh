#!/usr/bin/env bash
# @covers scripts/pre-commit-test-presence.sh
# Pre-commit hook: refuse commits that add new source files without test coverage.
# Watched roots: mcp/, scripts/, agents/, hooks/, packages/forge-core/src/, bin/
# Coverage check: co-located test file, tests/ subtree, or // @covers directive
# Exit 0: all new source files have coverage. Exit 1: at least one uncovered.

set -euo pipefail

WATCHED_ROOTS=("mcp/" "scripts/" "agents/" "hooks/" "packages/forge-core/src/" "bin/")
SOURCE_EXTS_RE='\.(js|mjs|cjs|ts)$'
SKIP_EXTS_RE='\.(json|md|yml|yaml|sh|txt|css|html)$'
TEST_SUFFIX_RE='(-test|\.test|\.spec)\.(js|mjs|cjs|ts)$'

# Get all newly-added staged files
STAGED=$(git diff --cached --name-only --diff-filter=A 2>/dev/null || true)

if [[ -z "$STAGED" ]]; then
  exit 0
fi

# Get all staged files (for coverage checking)
ALL_STAGED=$(git diff --cached --name-only 2>/dev/null || true)

uncovered=()

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Check if file is under a watched root
  in_watched=false
  for root in "${WATCHED_ROOTS[@]}"; do
    if [[ "$file" == "$root"* ]]; then
      in_watched=true
      break
    fi
  done
  [[ "$in_watched" == false ]] && continue

  # Skip non-source extensions
  if echo "$file" | grep -qE "$SKIP_EXTS_RE"; then continue; fi

  # Skip if it IS a test file
  if echo "$file" | grep -qE "$TEST_SUFFIX_RE"; then continue; fi

  # Must be a source file — check coverage
  dir=$(dirname "$file")
  base=$(basename "$file")
  stem="${base%.*}"
  ext="${base##*.}"

  has_coverage=false

  # Check co-located test file
  for tsuffix in "-test.$ext" ".test.$ext" "-test.mjs" ".test.mjs" "-test.js" ".test.js"; do
    test_path="$dir/$stem$tsuffix"
    if echo "$ALL_STAGED" | grep -qxF "$test_path" 2>/dev/null; then
      has_coverage=true
      break
    fi
    if [[ -f "$test_path" ]]; then
      has_coverage=true
      break
    fi
  done

  if [[ "$has_coverage" == true ]]; then continue; fi

  # Check tests/ subtree
  tests_path="tests/$file"
  tests_stem="tests/${file%.*}"
  for tsuffix in "-test.$ext" ".test.$ext" "-test.mjs" ".test.mjs"; do
    candidate="$tests_stem$tsuffix"
    if echo "$ALL_STAGED" | grep -qxF "$candidate" 2>/dev/null; then
      has_coverage=true
      break
    fi
    if [[ -f "$candidate" ]]; then
      has_coverage=true
      break
    fi
  done

  if [[ "$has_coverage" == true ]]; then continue; fi

  # Check // @covers directive in any staged test file
  while IFS= read -r staged_file; do
    [[ -z "$staged_file" ]] && continue
    if echo "$staged_file" | grep -qE "$TEST_SUFFIX_RE" 2>/dev/null; then
      # Check if this staged test covers our source file
      if [[ -f "$staged_file" ]] && grep -qE "// @covers.*($file|$base|$stem)" "$staged_file" 2>/dev/null; then
        has_coverage=true
        break
      fi
    fi
  done <<< "$ALL_STAGED"

  if [[ "$has_coverage" == false ]]; then
    uncovered+=("$file")
  fi

done <<< "$STAGED"

if [[ ${#uncovered[@]} -gt 0 ]]; then
  echo "[pre-commit-test-presence] FAIL: new source files without test coverage:" >&2
  for f in "${uncovered[@]}"; do
    echo "  $f" >&2
  done
  echo "Add a test file or use git commit --no-verify to bypass." >&2
  exit 1
fi

exit 0
