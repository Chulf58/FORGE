#!/usr/bin/env node
// @covers scripts/skill-linter.mjs
// TDD guard shim — delegates to skill-linter-test.mjs (the canonical test).
// This file exists so hooks/tdd-guard.js can resolve a .test.mjs for skill-linter.mjs.
// Run-tests.mjs discovers skill-linter-test.mjs directly (scripts/*-test.mjs pattern).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testFile = join(__dirname, 'skill-linter-test.mjs');

const result = spawnSync(process.execPath, [testFile], { stdio: 'inherit' });
process.exit(result.status ?? 1);
