#!/usr/bin/env node
// @covers hooks/session-end.js
// Tests for the CHANGELOG-fragment freshness guard added to session-end.js.
//
// AC-5 (amended): WHEN hooks/session-end.js runs after a documenter wrote only
// a fragment (not docs/CHANGELOG.md), the hook does NOT emit a stale-CHANGELOG
// warning. Stdout is parseable JSON (or empty per existing contract). Stderr
// DOES contain the warning when no fragment exists AND docs/CHANGELOG.md is
// stale (regression — pre-existing behavior preserved).
//
// Run: node --test hooks/session-end.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, 'session-end.js');
const STALE_AGE_MS = 90 * 60 * 1000; // 90 minutes ago (well past the 60-min threshold)
const FRESH_AGE_MS = 2 * 60 * 1000;  // 2 minutes ago (within the 5-min fragment freshness window)

/**
 * Create a minimal project directory structure with a completed coder run.
 * Returns { projectDir, runId }.
 */
function makeProject() {
  const tmp = mkdtempSync(join(tmpdir(), 'session-end-test-'));
  const runId = 'r-testse1';

  // .pipeline/runs/<runId>/run.json — non-terminal status so findActiveRun returns it
  mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), JSON.stringify({
    runId, status: 'running',
  }), 'utf8');

  // run-active.json — with a completed coder (sourceAgentRan = true)
  writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run-active.json'), JSON.stringify({
    runId,
    agents: [
      { agent_type: 'forge:coder', completedAt: Date.now() - 5000 },
    ],
  }), 'utf8');

  // project.json — sessionEndReminder enabled (default)
  writeFileSync(join(tmp, '.pipeline', 'project.json'), JSON.stringify({
    sessionEndReminder: true,
  }), 'utf8');

  // docs/context/handoff.md — fresh (not stale)
  mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'context', 'handoff.md'), '# Handoff: test', 'utf8');

  return { projectDir: tmp, runId };
}

/**
 * Make a file's mtime appear old (stale) by backdating it.
 */
function makeStale(filePath) {
  const oldTime = new Date(Date.now() - STALE_AGE_MS);
  utimesSync(filePath, oldTime, oldTime);
}

/**
 * Make a file's mtime appear fresh (recent).
 */
function makeFresh(filePath) {
  const freshTime = new Date(Date.now() - FRESH_AGE_MS);
  utimesSync(filePath, freshTime, freshTime);
}

/**
 * Run the session-end hook in a given project dir.
 * Returns { exitCode, stderr, stdout }.
 */
function runHook(projectDir) {
  const payload = JSON.stringify({ cwd: projectDir });
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: payload,
    cwd: projectDir,
    encoding: 'utf8',
    timeout: 5000,
  });
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr || '',
    stdout: result.stdout || '',
  };
}

// ---------------------------------------------------------------------------
// T1 — Fresh fragment suppresses stale-CHANGELOG warning (RED BAR)
// This test FAILS before the guard is added to session-end.js.
// ---------------------------------------------------------------------------
test('T1 — fresh fragment suppresses stale-CHANGELOG warning', () => {
  const { projectDir, runId } = makeProject();
  try {
    // CHANGELOG.md is stale (> 60 min old)
    writeFileSync(join(projectDir, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## Old entry', 'utf8');
    makeStale(join(projectDir, 'docs', 'CHANGELOG.md'));

    // Fragment is fresh (< 5 min old)
    writeFileSync(
      join(projectDir, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md'),
      '## [2026-05-16] New Feature\n\n- new bullet',
      'utf8',
    );
    makeFresh(join(projectDir, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md'));

    const { exitCode, stderr } = runHook(projectDir);

    assert.equal(exitCode, 0, `hook must exit 0, got ${exitCode}. stderr: ${stderr}`);
    assert.ok(
      !(/CHANGELOG.*stale|stale.*CHANGELOG/i.test(stderr)),
      `stderr must NOT contain stale-CHANGELOG warning when fresh fragment exists.\nstderr: ${stderr}`,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T2 — No fragment + stale CHANGELOG → warning is emitted (regression)
// This test should PASS even before the guard (existing behavior preserved).
// ---------------------------------------------------------------------------
test('T2 — no fragment and stale CHANGELOG emits the stale warning', () => {
  const { projectDir } = makeProject();
  try {
    // CHANGELOG.md is stale
    writeFileSync(join(projectDir, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## Old entry', 'utf8');
    makeStale(join(projectDir, 'docs', 'CHANGELOG.md'));

    // No fragment file created — missing runs/<runId>/CHANGELOG-fragment.md

    const { exitCode, stderr } = runHook(projectDir);

    assert.equal(exitCode, 0, `hook must exit 0 in all paths. got ${exitCode}. stderr: ${stderr}`);
    assert.ok(
      /stale/i.test(stderr),
      `stderr must contain stale warning when no fragment and CHANGELOG is stale.\nstderr: ${stderr}`,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T3 — Stale fragment (> 5 min) does NOT suppress warning
// This test should PASS after the guard is added.
// ---------------------------------------------------------------------------
test('T3 — stale fragment (> 5 min) does not suppress stale-CHANGELOG warning', () => {
  const { projectDir, runId } = makeProject();
  try {
    // CHANGELOG.md is stale
    writeFileSync(join(projectDir, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## Old entry', 'utf8');
    makeStale(join(projectDir, 'docs', 'CHANGELOG.md'));

    // Fragment is STALE (> 5 min old — well outside the freshness window)
    writeFileSync(
      join(projectDir, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md'),
      '## [2026-05-16] New Feature\n\n- new bullet',
      'utf8',
    );
    const staleFragmentTime = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    utimesSync(
      join(projectDir, '.pipeline', 'runs', runId, 'CHANGELOG-fragment.md'),
      staleFragmentTime,
      staleFragmentTime,
    );

    const { exitCode, stderr } = runHook(projectDir);

    assert.equal(exitCode, 0, `hook must exit 0. got ${exitCode}. stderr: ${stderr}`);
    assert.ok(
      /stale/i.test(stderr),
      `stderr must contain stale warning when fragment is > 5 min old.\nstderr: ${stderr}`,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
