// @covers packages/forge-core/src/runs/git-executable.js
//
// getGitExecutable resolves the git executable (PATH probe → Windows install-location
// fallback). It lives in its OWN leaf module — NOT in createWorktree.js — because that
// module imports getRun/updateRun → schemas.js → zod. Spawned scripts that run from a
// git worktree (e.g. covers-verify.mjs) have NO node_modules, so any zod-pulling import
// chain crashes them with ERR_MODULE_NOT_FOUND (soak r-8c327c9a). The leaf must therefore
// depend on NOTHING but node builtins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getGitExecutable } from './git-executable.js';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'git-executable.js'), 'utf-8');

test('getGitExecutable resolves to a non-empty executable string', () => {
  const git = getGitExecutable();
  assert.equal(typeof git, 'string');
  assert.ok(git.length > 0, 'must resolve git (PATH or an install-location candidate)');
});

test('getGitExecutable is memoized (same value on repeat calls)', () => {
  assert.equal(getGitExecutable(), getGitExecutable());
});

test('git-executable.js has ZERO forge-core-internal imports (zod-free contract)', () => {
  // The whole point of the leaf: it must be importable in a node_modules-less worktree.
  // Any relative import (./x.js) risks transitively pulling schemas.js -> zod. Only
  // `node:`-prefixed builtins are allowed.
  const importLines = SRC.split('\n').filter((l) => /^\s*import\b/.test(l));
  for (const line of importLines) {
    assert.match(line, /from '(node:[^']+)'/,
      'git-executable.js may import ONLY node: builtins — found a non-builtin import: ' + line.trim());
  }
});
