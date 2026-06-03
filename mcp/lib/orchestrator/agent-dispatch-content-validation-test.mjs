#!/usr/bin/env node
// @covers mcp/lib/orchestrator/agent-dispatch.mjs
//
// R3 (research 2026-06-02, docs/RESEARCH/dispatcher-reliability-2026-06-02.md §R3):
// validate artifact CONTENT, not just existence. A present+fresh artifact can still
// be degenerate — scout.json with files_to_read:[] (the agent had no real task), an
// empty handoff.md, an empty reviewer verdict. Existence-only verification reports
// those as success (the exact false-positive documented in GENERAL.md). R3 gates the
// artifact-wins branch on content so a degenerate write is NOT 'completed'.
//
// Interaction with R1/R2 (deliberate): a degenerate artifact WITH a stream error →
// the stream error wins (retryable — a truncated write should retry). A degenerate
// artifact WITHOUT a stream error → content-invalid wins (NON-retryable — the agent
// ran to completion and produced junk; a blind re-run reproduces it → escalate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateArtifactContent,
  classifyOutcome,
  isRetryableStreamError,
} from './agent-dispatch.mjs';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-r3-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── validateArtifactContent: coder-scout / scout.json ─────────────────────
test('scout.json with a non-empty files_to_read is valid', () => {
  withTmp((dir) => {
    const p = join(dir, 'scout.json');
    writeFileSync(p, JSON.stringify({ files_to_read: ['src/a.ts', 'src/b.ts'] }));
    assert.equal(validateArtifactContent('coder-scout', p).ok, true);
  });
});

test('scout.json with an EMPTY files_to_read is degenerate (invalid)', () => {
  withTmp((dir) => {
    const p = join(dir, 'scout.json');
    writeFileSync(p, JSON.stringify({ files_to_read: [] }));
    const r = validateArtifactContent('coder-scout', p);
    assert.equal(r.ok, false);
    assert.match(r.reason, /files_to_read/);
    assert.equal(isRetryableStreamError(r.reason), false, 'content-invalid must be NON-retryable');
  });
});

test('scout.json that is not valid JSON is invalid', () => {
  withTmp((dir) => {
    const p = join(dir, 'scout.json');
    writeFileSync(p, 'not json {');
    assert.equal(validateArtifactContent('coder-scout', p).ok, false);
  });
});

test('scout.json that is absent is invalid', () => {
  withTmp((dir) => {
    assert.equal(validateArtifactContent('coder-scout', join(dir, 'nope.json')).ok, false);
  });
});

// ── validateArtifactContent: coder / handoff.md ───────────────────────────
test('handoff.md with a Files section is valid', () => {
  withTmp((dir) => {
    const p = join(dir, 'handoff.md');
    writeFileSync(p, '# Handoff\n\n## Files to modify\n\n- src/x.ts: changed the thing\n');
    assert.equal(validateArtifactContent('coder', p).ok, true);
  });
});

test('an empty handoff.md is degenerate (invalid)', () => {
  withTmp((dir) => {
    const p = join(dir, 'handoff.md');
    writeFileSync(p, '   \n  \n');
    const r = validateArtifactContent('coder', p);
    assert.equal(r.ok, false);
    assert.equal(isRetryableStreamError(r.reason), false);
  });
});

test('a handoff.md with no Files section is invalid', () => {
  withTmp((dir) => {
    const p = join(dir, 'handoff.md');
    writeFileSync(p, '# Handoff\n\nI looked at the code and thought about it.\n');
    assert.equal(validateArtifactContent('coder', p).ok, false);
  });
});

// ── validateArtifactContent: reviewers ────────────────────────────────────
test('a non-empty reviewer verdict is valid; an empty one is invalid', () => {
  withTmp((dir) => {
    const good = join(dir, 'reviewer-safety.md');
    writeFileSync(good, '[verdict] APPROVED — no injection risk found.\n');
    assert.equal(validateArtifactContent('reviewer-safety', good).ok, true);

    const bad = join(dir, 'reviewer-logic.md');
    writeFileSync(bad, '');
    assert.equal(validateArtifactContent('reviewer-logic', bad).ok, false);
  });
});

// ── validateArtifactContent: unknown type → passthrough (do not over-gate) ─
test('an unknown agent type passes content validation (no over-gating)', () => {
  withTmp((dir) => {
    const p = join(dir, 'whatever.txt');
    writeFileSync(p, '');
    assert.equal(validateArtifactContent('documenter', p).ok, true);
  });
});

// ── classifyOutcome wiring: content gate + R1/R2 interaction ───────────────
const FRESH = { ok: true };

test('classifyOutcome: writer fresh + content VALID → completed', () => {
  const r = classifyOutcome({ agentKind: 'writer', mtimeResult: FRESH, contentResult: { ok: true }, error: null });
  assert.equal(r.outcome, 'completed');
});

test('classifyOutcome: writer fresh + content INVALID + no error → uncertain, NON-retryable', () => {
  const r = classifyOutcome({
    agentKind: 'writer', mtimeResult: FRESH,
    contentResult: { ok: false, reason: 'artifact content invalid: scout.json files_to_read is empty' },
    error: null,
  });
  assert.equal(r.outcome, 'uncertain');
  assert.match(r.reason, /artifact content invalid/);
  assert.equal(isRetryableStreamError(r.reason), false, 'a completed-but-degenerate run must escalate, not loop');
});

test('classifyOutcome: writer fresh + content INVALID + stream error → stream error WINS (retryable)', () => {
  const r = classifyOutcome({
    agentKind: 'writer', mtimeResult: FRESH,
    contentResult: { ok: false, reason: 'artifact content invalid: handoff.md is empty' },
    error: new Error('stream result error: error_during_execution (aborted_streaming)'),
  });
  assert.equal(r.outcome, 'uncertain');
  assert.match(r.reason, /dispatch error/);
  assert.equal(isRetryableStreamError(r.reason), true, 'a truncated write (stream aborted mid-write) should retry');
});

test('classifyOutcome: writer fresh + content VALID + stream error → artifact-wins (completed)', () => {
  const r = classifyOutcome({
    agentKind: 'writer', mtimeResult: FRESH, contentResult: { ok: true },
    error: new Error('stream result error: error_during_execution'),
  });
  assert.equal(r.outcome, 'completed', 'a valid artifact survives a late stream abort (r-074b94ba)');
});

// ── dispatchAgent wiring ──────────────────────────────────────────────────
test('dispatchAgent computes contentResult and feeds it to classifyOutcome (R3 wiring)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join: pjoin } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(pjoin(here, 'agent-dispatch.mjs'), 'utf-8');
  // Match the CALL site in attemptDispatch (not the function definition
  // `validateArtifactContent(agentType, absPath)` nor the classifyOutcome destructure)
  // — dispatchAgent must call validateArtifactContent(agentType, join(workDir, artifact)).
  assert.ok(/validateArtifactContent\(agentType, join\(/.test(src),
    'dispatchAgent must call validateArtifactContent(agentType, join(workDir, artifact)) and thread the result into classifyOutcome');
});
