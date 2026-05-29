#!/usr/bin/env node
'use strict';
// @covers hooks/ctx-pre-tool.js
// Regression tests for the deny-layer feature in ctx-pre-tool.js.
// Tests that a DENY-LAYER runs before the existing allow-list logic:
// (1) normalizes agent_type by stripping leading 'forge:' prefix,
// (2) checks deniedPaths patterns in agent-roles.json,
// (3) denies writes matching deniedPaths regardless of allowedPaths,
// (4) preserves existing allow-list behavior (readonly, allowedPaths restrictions).
//
// Run: node hooks/ctx-pre-tool-test.js
// Auto-discovered by scripts/run-tests.mjs via hooks/*-test.js suffix.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
    passed++;
  } else {
    console.error('  FAIL  ' + label);
    failed++;
  }
}

/**
 * Runs the hook with a JSON payload written to stdin.
 * Expects cwd to be set to the temp fixture directory.
 * Returns { exitCode, stdout, stderr }.
 */
function runHook(payload, cwdDir) {
  const input = JSON.stringify(payload);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'ctx-pre-tool.js')], {
    input,
    encoding: 'utf8',
    timeout: 5000,
    cwd: cwdDir,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/**
 * Creates a minimal .pipeline/agent-roles.json fixture in the temp dir.
 */
function createFixture(tmpDir, rolesManifest) {
  const pipelineDir = path.join(tmpDir, '.pipeline');
  fs.mkdirSync(pipelineDir, { recursive: true });
  const rolesPath = path.join(pipelineDir, 'agent-roles.json');
  fs.writeFileSync(rolesPath, JSON.stringify(rolesManifest, null, 2), 'utf8');
}

console.log('\n── ctx-pre-tool-test.js ──────────────────────────────────────────────────');
console.log('Testing deny-layer: agent_type normalization + deniedPaths enforcement\n');

// ── Case 1: NAMESPACED code-writer denied on a test file ────────────────────
// Fixture: coder role with allowedPaths and deniedPaths.
// Payload: agent_type='forge:coder' (should strip 'forge:' prefix),
//          writing to 'scripts/phase-verify.test.mjs' (matches deniedPaths pattern).
// Expected: permissionDecision = 'deny'
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      coder: {
        allowedPaths: ['docs/context/handoff.md'],
        deniedPaths: ['*-test.*', '*.test.*'],
      },
    };
    createFixture(tmpDir, fixture);
    // The test file ALREADY EXISTS → editing it is the weakening case → deny.
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'phase-verify.test.mjs'), '// existing test\n', 'utf8');

    const payload = {
      tool_name: 'Write',
      agent_type: 'forge:coder',
      tool_input: { file_path: 'scripts/phase-verify.test.mjs' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision === 'deny',
      'Case 1: namespaced coder (forge:coder) denied on test file'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 2: BARE code-writer denied on a hyphen-test file ───────────────────
// Fixture: coder role with allowedPaths and deniedPaths.
// Payload: agent_type='coder' (bare, no prefix),
//          writing to 'scripts/foo-test.mjs' (matches deniedPaths pattern '*-test.*').
// Expected: permissionDecision = 'deny'
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    // allowedPaths INCLUDES scripts/** so the existing allow-list would PERMIT this
    // write — isolating the deny-layer as the only thing that can deny it. (If
    // allowedPaths were handoff.md-only, the allow-list would deny for the wrong
    // reason and the test would pass without exercising the deny-layer.)
    const fixture = {
      coder: {
        allowedPaths: ['scripts/**'],
        deniedPaths: ['*-test.*', '*.test.*'],
      },
    };
    createFixture(tmpDir, fixture);
    // The test file ALREADY EXISTS → editing it is the weakening case → deny.
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'foo-test.mjs'), '// existing test\n', 'utf8');

    const payload = {
      tool_name: 'Write',
      agent_type: 'coder',
      tool_input: { file_path: 'scripts/foo-test.mjs' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision === 'deny',
      'Case 2: bare coder denied on hyphen-test file'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 2b: code-writer ALLOWED to CREATE a NEW test file ──────────────────
// The deny-layer blocks EDITING an existing test (the weakening case), NOT
// creating a new one (legit where no test-author ran). File does NOT exist → allow.
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      coder: {
        allowedPaths: ['scripts/**'],
        deniedPaths: ['*-test.*', '*.test.*'],
      },
    };
    createFixture(tmpDir, fixture);
    // Do NOT create the test file — this is a NEW test creation.

    const payload = {
      tool_name: 'Write',
      agent_type: 'forge:coder',
      tool_input: { file_path: 'scripts/brand-new-thing.test.mjs' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision !== 'deny',
      'Case 2b: coder allowed to CREATE a new (non-existent) test file'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 3: Code-writer allowed on a SOURCE file (no over-block) ────────────
// Fixture: coder role with allowedPaths and deniedPaths.
// Payload: agent_type='forge:coder',
//          writing to 'scripts/phase-verify.mjs' (does NOT match deniedPaths).
// Expected: NOT denied (exit 0, no deny JSON — pass through to allowedPaths check,
//           which also passes because we're testing that deniedPaths doesn't over-block).
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      coder: {
        allowedPaths: ['docs/context/handoff.md', 'scripts/**'],
        deniedPaths: ['*-test.*', '*.test.*'],
      },
    };
    createFixture(tmpDir, fixture);

    const payload = {
      tool_name: 'Write',
      agent_type: 'forge:coder',
      tool_input: { file_path: 'scripts/phase-verify.mjs' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision !== 'deny',
      'Case 3: coder allowed on source file (not denied by deniedPaths)'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 4: Test-writing lane NOT denied on a test file (no deniedPaths) ─────
// Fixture: test-author role with allowedPaths but NO deniedPaths.
// Payload: agent_type='forge:test-author',
//          writing to 'scripts/foo.test.mjs'.
// Expected: NOT denied (test-author has no deniedPaths, so deny-layer passes through).
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      'test-author': {
        allowedPaths: ['scripts/**'],
        // No deniedPaths
      },
    };
    createFixture(tmpDir, fixture);

    const payload = {
      tool_name: 'Write',
      agent_type: 'test-author',
      tool_input: { file_path: 'scripts/foo.test.mjs' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision !== 'deny',
      'Case 4: test-author not denied on test file (no deniedPaths)'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 5: REGRESSION — readonly agents still denied ───────────────────────
// Fixture: gotcha-checker with readonly:true (existing behavior).
// Payload: agent_type='gotcha-checker', writing to 'docs/PLAN.md'.
// Expected: permissionDecision = 'deny' (readonly enforcement preserved).
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      'gotcha-checker': { readonly: true },
    };
    createFixture(tmpDir, fixture);

    const payload = {
      tool_name: 'Write',
      agent_type: 'gotcha-checker',
      tool_input: { file_path: 'docs/PLAN.md' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision === 'deny',
      'Case 5a: readonly agent (gotcha-checker) still denied'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Case 6: REGRESSION — allowedPaths checking still works ─────────────────
// Fixture: reviewer-boundary with allowedPaths.
// Payload: agent_type='reviewer-boundary',
//          writing to 'docs/context/reviewer-output/x.md' (allowed).
// Expected: NOT denied (allowedPaths enforcement preserved).
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pre-tool-test-'));
  try {
    const fixture = {
      'reviewer-boundary': {
        allowedPaths: ['docs/context/reviewer-output/**'],
      },
    };
    createFixture(tmpDir, fixture);

    const payload = {
      tool_name: 'Write',
      agent_type: 'reviewer-boundary',
      tool_input: { file_path: 'docs/context/reviewer-output/x.md' },
    };

    const { exitCode, stdout } = runHook(payload, tmpDir);
    const output = stdout ? JSON.parse(stdout) : {};
    const decision = output.hookSpecificOutput?.permissionDecision;

    assert(
      decision !== 'deny',
      'Case 6: reviewer-boundary allowed on permitted path'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('\n────────────────────────────────────────────────────────────────────────');
console.log(`Summary: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
