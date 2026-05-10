#!/usr/bin/env node
// Tests for scripts/wiring-verify.mjs — post-handoff wiring verifier.
//
// AC-1 assertions:
//   (a) smoke-pass — synthetic handoff declaring a new helper that IS imported
//       elsewhere emits zero [wiring-gap] lines and exits 0 under --strict
//   (b) smoke-gap — synthetic handoff declaring a new helper with no callers
//       emits [wiring-gap] <symbol> to stderr and exits non-zero under --strict
//   (c) diagnostic-only default — without --strict, a zero-consumer helper still
//       emits [wiring-gap] but exits 0
//   (d) new agent detection — a synthetic handoff listing a new agents/<name>.md
//       with no reference in any skill/config emits [wiring-gap] agent:<name>
//   (e) new hook detection — a new hooks/<name>.js with no entry in
//       hooks/hooks.json emits [wiring-gap] hook:<name>
//
// Run: node --test scripts/wiring-verify-test.mjs

// @covers scripts/wiring-verify.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VERIFIER = resolve(__dirname, 'wiring-verify.mjs');

// ─── Shared helpers ──────────────────────────────────────────────────────────

function makeTmpProject() {
  const root = mkdtempSync(join(tmpdir(), 'wiring-verify-test-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'docs', 'context'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  mkdirSync(join(root, 'hooks'), { recursive: true });
  mkdirSync(join(root, 'skills'), { recursive: true });
  return root;
}

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function makeHandoff(modifiedFiles) {
  const fileList = modifiedFiles.join('\n');
  return [
    '## Files modified',
    '',
    '```',
    fileList,
    '```',
    '',
    '## Summary',
    '',
    'Test handoff for wiring-verify tests.',
  ].join('\n');
}

function runVerifier(root, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [
      VERIFIER,
      `--handoff=${join(root, 'docs/context/handoff.md')}`,
      `--root=${root}`,
      ...extraArgs,
    ],
    { encoding: 'utf8', cwd: root },
  );
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Assert the verifier module exists and loaded without MODULE_NOT_FOUND.
 * Calling this at the top of each test guarantees all five tests genuinely
 * fail (red bar) until scripts/wiring-verify.mjs is implemented.
 */
function assertVerifierLoaded(result, label) {
  assert.ok(
    existsSync(VERIFIER),
    `${label} — scripts/wiring-verify.mjs must exist before tests can pass`,
  );
  assert.ok(
    !result.stderr.includes('Cannot find module') &&
      !result.stderr.includes('MODULE_NOT_FOUND'),
    `${label} — wiring-verify.mjs must load without MODULE_NOT_FOUND; stderr=${result.stderr}`,
  );
}

// ─── (a) smoke-pass ──────────────────────────────────────────────────────────

test('(a) smoke-pass: new helper imported elsewhere exits 0 under --strict with no [wiring-gap]', () => {
  const root = makeTmpProject();
  try {
    // The new file being declared in the handoff
    writeFile(
      root,
      'scripts/new-helper.mjs',
      [
        'export function newHelper() { return 42; }',
      ].join('\n'),
    );

    // A consumer that imports the exported symbol
    writeFile(
      root,
      'scripts/consumer.mjs',
      [
        'import { newHelper } from "./new-helper.mjs";',
        'export function run() { return newHelper(); }',
      ].join('\n'),
    );

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/new-helper.mjs']));

    const result = runVerifier(root, ['--strict']);

    assertVerifierLoaded(result, '(a)');

    // No wiring gaps expected — symbol has a consumer
    assert.ok(
      !result.stderr.includes('[wiring-gap]'),
      `(a) stderr must not contain [wiring-gap] when symbol is imported; stderr=${result.stderr}`,
    );

    assert.equal(
      result.code,
      0,
      `(a) verifier should exit 0 when all symbols are wired; stderr=${result.stderr}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (b) smoke-gap with --strict ─────────────────────────────────────────────

test('(b) smoke-gap: new helper with no callers emits [wiring-gap] and exits non-zero under --strict', () => {
  const root = makeTmpProject();
  try {
    // The new file being declared — no other file imports it
    writeFile(
      root,
      'scripts/orphan-helper.mjs',
      [
        'export function orphanHelper() { return "nobody calls me"; }',
      ].join('\n'),
    );

    // An unrelated file that does not import orphan-helper
    writeFile(
      root,
      'scripts/unrelated.mjs',
      [
        'export function unrelated() { return "unrelated"; }',
      ].join('\n'),
    );

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/orphan-helper.mjs']));

    const result = runVerifier(root, ['--strict']);

    assertVerifierLoaded(result, '(b)');

    assert.ok(
      result.stderr.includes('[wiring-gap]'),
      `(b) stderr must contain [wiring-gap] when symbol has no consumers; stderr=${result.stderr}`,
    );

    assert.ok(
      result.stderr.includes('orphanHelper'),
      `(b) [wiring-gap] line must name the unwired symbol; stderr=${result.stderr}`,
    );

    assert.notEqual(
      result.code,
      0,
      `(b) verifier must exit non-zero under --strict when gaps exist; code=${result.code}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (c) diagnostic-only default (no --strict) ───────────────────────────────

test('(c) diagnostic-only: zero-consumer helper emits [wiring-gap] but exits 0 without --strict', () => {
  const root = makeTmpProject();
  try {
    // The new file being declared — no other file imports it
    writeFile(
      root,
      'scripts/unwired-default.mjs',
      [
        'export function unwiredDefault() { return "unwired"; }',
      ].join('\n'),
    );

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['scripts/unwired-default.mjs']));

    // Run WITHOUT --strict (default diagnostic mode)
    const result = runVerifier(root);

    assertVerifierLoaded(result, '(c)');

    // Gap must still be reported to stderr
    assert.ok(
      result.stderr.includes('[wiring-gap]'),
      `(c) stderr must contain [wiring-gap] even without --strict; stderr=${result.stderr}`,
    );

    // But exit code must be 0 (diagnostic, not blocking)
    assert.equal(
      result.code,
      0,
      `(c) verifier must exit 0 in default (non-strict) mode even when gaps exist; stderr=${result.stderr}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (d) new agent detection ─────────────────────────────────────────────────

test('(d) new agent file with no reference in skills/config emits [wiring-gap] agent:<name>', () => {
  const root = makeTmpProject();
  try {
    // A new agent file with no references anywhere in the project
    writeFile(
      root,
      'agents/phantom-agent.md',
      [
        '---',
        'name: phantom-agent',
        'model: sonnet',
        '---',
        '',
        '# Phantom Agent',
        '',
        'This agent does something useful.',
      ].join('\n'),
    );

    // A skills file that does NOT reference phantom-agent
    writeFile(
      root,
      'skills/implement/SKILL.md',
      [
        '# Implement Skill',
        '',
        'This skill references coder and reviewer-boundary.',
        '```',
        'agents: ["coder", "reviewer-boundary"]',
        '```',
      ].join('\n'),
    );

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['agents/phantom-agent.md']));

    const result = runVerifier(root, ['--strict']);

    assertVerifierLoaded(result, '(d)');

    assert.ok(
      result.stderr.includes('[wiring-gap]'),
      `(d) stderr must contain [wiring-gap] for unreferenced agent; stderr=${result.stderr}`,
    );

    assert.ok(
      result.stderr.includes('agent:phantom-agent'),
      `(d) [wiring-gap] must include agent:phantom-agent; stderr=${result.stderr}`,
    );

    assert.notEqual(
      result.code,
      0,
      `(d) verifier must exit non-zero under --strict when agent gap exists; code=${result.code}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── (e) new hook detection ───────────────────────────────────────────────────

test('(e) new hook file with no entry in hooks/hooks.json emits [wiring-gap] hook:<name>', () => {
  const root = makeTmpProject();
  try {
    // A new hook file
    writeFile(
      root,
      'hooks/new-hook.js',
      [
        '// New hook — not yet registered in hooks.json',
        'module.exports = function newHook(payload) {',
        '  return { action: "continue" };',
        '};',
      ].join('\n'),
    );

    // hooks.json that does NOT reference new-hook.js
    writeFile(
      root,
      'hooks/hooks.json',
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/existing-hook.js"',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    writeFile(root, 'docs/context/handoff.md', makeHandoff(['hooks/new-hook.js']));

    const result = runVerifier(root, ['--strict']);

    assertVerifierLoaded(result, '(e)');

    assert.ok(
      result.stderr.includes('[wiring-gap]'),
      `(e) stderr must contain [wiring-gap] for hook not in hooks.json; stderr=${result.stderr}`,
    );

    assert.ok(
      result.stderr.includes('hook:new-hook'),
      `(e) [wiring-gap] must include hook:new-hook; stderr=${result.stderr}`,
    );

    assert.notEqual(
      result.code,
      0,
      `(e) verifier must exit non-zero under --strict when hook gap exists; code=${result.code}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
