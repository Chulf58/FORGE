// @covers agents/_archived/ + agents/coder-scout.md + agents/completeness-checker.md
//        + hooks/hook-utils.js + .pipeline/agent-roles.json
//
// Asserts the c62ac8af rectified state:
// - coder-scout + completeness-checker are at top-level agents/ (promoted)
// - 9 truly-dead agents are gone from _archived/
// - _archived/ subdirectory is removed
// - hook-utils.js has no _archived branch
// - agent-roles.json has coder-scout + completeness-checker entries
// - agent-roles.json has no stale entries for the 9 dead agents
//
// Background: TODO c62ac8af. The forge:_archived:coder-scout dispatch
// observed in r-e82c8161:588 was NOT drift — it was the worker correctly
// resolving the only available coder-scout. The fix is a placement bug:
// coder-scout + completeness-checker were misplaced in _archived/; the
// other 9 are truly dead.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEAD = [
  'agent-optimizer',
  'cleanup',
  'implementer-triage',
  'integrity-checker',
  'regression-risk',
  'researcher-triage',
  'reviewer-style',
  'reviewer-triage',
  'tool-call-auditor',
];

const PROMOTED = ['coder-scout', 'completeness-checker'];

test('promoted agents exist at top-level agents/', () => {
  for (const name of PROMOTED) {
    const promoted = resolve(repoRoot, 'agents', `${name}.md`);
    assert.equal(
      existsSync(promoted),
      true,
      `agents/${name}.md must exist (promoted from _archived/)`,
    );
  }
});

test('dead archived agents are gone', () => {
  for (const name of DEAD) {
    const archived = resolve(repoRoot, 'agents', '_archived', `${name}.md`);
    assert.equal(
      existsSync(archived),
      false,
      `agents/_archived/${name}.md must be deleted`,
    );
  }
});

test('_archived/ subdirectory is removed', () => {
  const dir = resolve(repoRoot, 'agents', '_archived');
  assert.equal(
    existsSync(dir),
    false,
    `agents/_archived/ directory must be gone`,
  );
});

test('hook-utils.js has no _archived branch', () => {
  const source = readFileSync(resolve(repoRoot, 'hooks', 'hook-utils.js'), 'utf8');
  assert.equal(
    source.includes('_archived'),
    false,
    `hooks/hook-utils.js must not reference _archived (the dead fallback branch)`,
  );
});

test('agent-roles.json has entries for promoted agents', () => {
  const roles = JSON.parse(
    readFileSync(resolve(repoRoot, '.pipeline', 'agent-roles.json'), 'utf8'),
  );
  for (const name of PROMOTED) {
    assert.ok(
      roles[name],
      `.pipeline/agent-roles.json must have entry for ${name}`,
    );
  }
});

test('agent-roles.json has no stale entries for dead agents', () => {
  const roles = JSON.parse(
    readFileSync(resolve(repoRoot, '.pipeline', 'agent-roles.json'), 'utf8'),
  );
  for (const name of DEAD) {
    assert.equal(
      roles[name],
      undefined,
      `.pipeline/agent-roles.json must not have stale entry for ${name}`,
    );
  }
});
