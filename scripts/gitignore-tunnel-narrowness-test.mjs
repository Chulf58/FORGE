#!/usr/bin/env node
// Regression-lock oracle: asserts that the .gitignore tunnel remains narrow.
//
// The tunnel allows ONLY mcp/node_modules/@anthropic-ai/claude-agent-sdk/ to be
// tracked while all its siblings are ignored. Known suspects:
//   - claude-agent-sdk-win32-x64 (243 MB — exceeds GitHub 100 MB blob limit)
//   - sdk (not the missing import; unrelated package)
//
// Uses `git check-ignore -q <path>` which works independent of disk state —
// avoids the vacuous-pass failure mode of `git ls-files --others` enumeration
// (which silently passes when the suspect path doesn't exist on disk).
//
// Oracle should PASS today — the tunnel is currently correct.
// It is a regression-lock: it FAILS if a sibling becomes un-ignored.
//
// Run: node --test scripts/gitignore-tunnel-narrowness-test.mjs
//      or via:  node scripts/run-tests.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Known suspect siblings — paths that MUST stay ignored.
const SUSPECT_SIBLINGS = [
  'claude-agent-sdk-win32-x64',
  'sdk',
];

// The positively-tracked SDK path — must NOT be ignored (tunnel lets it through).
const TRACKED_SDK = 'claude-agent-sdk';

/**
 * Run `git check-ignore -q <path>` and return the exit code.
 * Exit 0  = path IS ignored
 * Exit 1  = path is NOT ignored
 * Exit 128 = git error (bad repo / bad args)
 */
function gitCheckIgnore(relPath) {
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', relPath],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  return result.status;
}

// ── Suspect siblings must be IGNORED (exit 0) ────────────────────────────────

for (const sibling of SUSPECT_SIBLINGS) {
  const relPath = `mcp/node_modules/@anthropic-ai/${sibling}/`;

  test(`suspect sibling "${sibling}" is ignored by .gitignore tunnel`, () => {
    const exitCode = gitCheckIgnore(relPath);

    if (exitCode !== 0) {
      // Emit the explicit regression banner before asserting so it appears
      // in the test output even if assert.strictEqual's message is truncated.
      process.stderr.write(
        `TUNNEL REGRESSION: ${relPath} is no longer ignored — gitignore tunnel broken\n`,
      );
    }

    assert.strictEqual(
      exitCode,
      0,
      `TUNNEL REGRESSION: ${relPath} is no longer ignored — gitignore tunnel broken`,
    );
  });
}

// ── Tracked SDK must NOT be ignored (exit 1) — tunnel still lets it through ──

test(`tracked SDK "claude-agent-sdk" is NOT ignored (tunnel passes it through)`, () => {
  const relPath = `mcp/node_modules/@anthropic-ai/${TRACKED_SDK}/`;
  const exitCode = gitCheckIgnore(relPath);

  assert.strictEqual(
    exitCode,
    1,
    `TUNNEL REGRESSION: ${relPath} is now being ignored — the SDK is no longer tracked through the tunnel`,
  );
});
