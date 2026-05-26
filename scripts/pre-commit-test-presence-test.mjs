#!/usr/bin/env node
// @covers scripts/pre-commit-test-presence-test.mjs
// Thin wrapper for pre-commit-test-presence-test.sh
// Allows run-tests.mjs to auto-discover via -test.mjs suffix.
// Skips gracefully if bash is not available (Windows without WSL/Git Bash).

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Check bash availability
const bashCheck = spawnSync('bash', ['--version'], { stdio: 'pipe', timeout: 5000 });
if (bashCheck.error || bashCheck.status !== 0) {
  process.stdout.write('[pre-commit-test-presence-test] SKIP: bash not available on this platform\n');
  process.exit(0);
}

const result = spawnSync(
  'bash',
  [join(__dirname, 'pre-commit-test-presence-test.sh')],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout: 60000,
  }
);

if (result.error) {
  process.stderr.write('[pre-commit-test-presence-test] spawn error: ' + result.error.message + '\n');
  process.exit(1);
}

process.exit(result.status ?? 1);
