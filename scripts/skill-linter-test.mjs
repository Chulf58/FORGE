#!/usr/bin/env node
// @covers scripts/skill-linter.mjs
//
// Tests for skill-linter.mjs — 4-category reference linter for SKILL.md files.
// Run: node scripts/skill-linter-test.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const LINTER = join(PROJECT_ROOT, 'scripts', 'skill-linter.mjs');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    passed++;
  }
}

// Create a temp dir with a fixture skill that has one bad reference per category
const fixtureBase = mkdtempSync(join(tmpdir(), 'skill-linter-test-fixture-'));
const skillDir = join(fixtureBase, 'skills', 'test-skill');
mkdirSync(skillDir, { recursive: true });

const fixtureContent = `---
name: test-skill
description: Fixture skill for linter tests
---

## Test step

- Run \`scripts/this-file-does-not-exist-abc123.mjs\` to process
- Use agent \`forge:fake-agent-xyz999\` for the pipeline
- Invoke \`/forge:fake-skill-xyz999\` for setup
- Call \`forge_fake_tool_xyz999\` to complete
`;

writeFileSync(join(skillDir, 'SKILL.md'), fixtureContent, 'utf8');

// --- Test 1: fixture exits 1 with one error per category ----------------------
console.log('\n[skill-linter-test] Test 1: fixture errors detected');
{
  const result = spawnSync(process.execPath, [LINTER, '--skills-dir', join(fixtureBase, 'skills')], {
    encoding: 'utf8',
  });

  assert(result.status === 1, `exit code should be 1, got ${result.status}`);

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    assert(false, `stdout should be valid JSON: ${result.stdout}`);
    parsed = null;
  }

  if (parsed) {
    assert(
      parsed.errors['file-paths'].length === 1,
      `file-paths should have 1 error, got ${parsed.errors['file-paths'].length}`,
    );
    assert(
      parsed.errors['file-paths'][0].token.includes('this-file-does-not-exist-abc123.mjs'),
      `file-paths error should name the missing file, got: ${JSON.stringify(parsed.errors['file-paths'][0])}`,
    );

    assert(
      parsed.errors['agent-names'].length === 1,
      `agent-names should have 1 error, got ${parsed.errors['agent-names'].length}`,
    );
    assert(
      parsed.errors['agent-names'][0].token === 'forge:fake-agent-xyz999',
      `agent-names error should name fake-agent-xyz999, got: ${JSON.stringify(parsed.errors['agent-names'][0])}`,
    );

    assert(
      parsed.errors['skill-names'].length === 1,
      `skill-names should have 1 error, got ${parsed.errors['skill-names'].length}`,
    );
    assert(
      parsed.errors['skill-names'][0].token === '/forge:fake-skill-xyz999',
      `skill-names error should name /forge:fake-skill-xyz999, got: ${JSON.stringify(parsed.errors['skill-names'][0])}`,
    );

    assert(
      parsed.errors['mcp-tools'].length === 1,
      `mcp-tools should have 1 error, got ${parsed.errors['mcp-tools'].length}`,
    );
    assert(
      parsed.errors['mcp-tools'][0].token === 'forge_fake_tool_xyz999',
      `mcp-tools error should name forge_fake_tool_xyz999, got: ${JSON.stringify(parsed.errors['mcp-tools'][0])}`,
    );
  }
}

// --- Test 2: real skills dir exits 0 with no errors ---------------------------
console.log('\n[skill-linter-test] Test 2: real skills/ passes clean');
{
  const result = spawnSync(process.execPath, [LINTER], {
    encoding: 'utf8',
    cwd: PROJECT_ROOT,
  });

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    parsed = null;
  }

  assert(result.status === 0, `real skills dir should exit 0, got ${result.status}. stdout: ${result.stdout}`);

  if (parsed) {
    assert(
      parsed.errors['file-paths'].length === 0,
      `real skills: file-paths errors should be empty, got: ${JSON.stringify(parsed.errors['file-paths'])}`,
    );
    assert(
      parsed.errors['agent-names'].length === 0,
      `real skills: agent-names errors should be empty, got: ${JSON.stringify(parsed.errors['agent-names'])}`,
    );
    assert(
      parsed.errors['skill-names'].length === 0,
      `real skills: skill-names errors should be empty, got: ${JSON.stringify(parsed.errors['skill-names'])}`,
    );
    assert(
      parsed.errors['mcp-tools'].length === 0,
      `real skills: mcp-tools errors should be empty, got: ${JSON.stringify(parsed.errors['mcp-tools'])}`,
    );
  }
}

// --- Cleanup ------------------------------------------------------------------
try {
  rmSync(fixtureBase, { recursive: true, force: true });
} catch {
  // Non-fatal cleanup failure
}

// --- Summary ------------------------------------------------------------------
const total = passed + failed;
console.log(`\n[skill-linter-test] ${passed}/${total} PASS`);
process.exit(failed > 0 ? 1 : 0);
