'use strict';
// @covers hooks/ctx-stop.js
// Task 23 red bar — inline-capture Stop hook.
//
// The advisory Stop hook must ALSO queue an inline-capture marker when a session produced
// substantive inline work (deterministic trigger: a fresh, substantive docs/context/handoff.md),
// so a learning can later be extracted through the forge_add_learning quality gate. It must keep
// its never-block contract: exit 0 always; stdout is JSON-only (additionalContext) or empty.
//
// Run: node hooks/ctx-stop-inline-capture-test.js
//
// RED BAR: until ctx-stop.js writes .pipeline/inline-capture-pending.json under the trigger
// condition, the positive case below fails (marker absent).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOK = path.join(__dirname, 'ctx-stop.js');

function fail(msg) {
  console.error('[ctx-stop-inline-capture-test] FAIL: ' + msg);
  process.exit(1);
}

function runHook(projectDir) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: projectDir }),
    encoding: 'utf8',
  });
  return res;
}

function assertStdoutJsonOrEmpty(res, label) {
  const out = (res.stdout || '').trim();
  if (out.length === 0) return;
  try {
    JSON.parse(out);
  } catch (_) {
    fail(label + ': stdout must be empty or valid JSON, got: ' + out.slice(0, 200));
  }
}

function mkProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-stop-cap-'));
}

// ── Case 1: substantive inline work (fresh handoff) → capture marker queued ──
(function positiveCase() {
  const dir = mkProject();
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'context'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', 'context', 'handoff.md'),
      '# Handoff\n\n' + 'Substantive inline work was performed this session. '.repeat(8),
      'utf8',
    );

    const res = runHook(dir);
    if (res.status !== 0) fail('positive: hook must exit 0 (never block), got ' + res.status);
    assertStdoutJsonOrEmpty(res, 'positive');

    const markerPath = path.join(dir, '.pipeline', 'inline-capture-pending.json');
    if (!fs.existsSync(markerPath)) {
      fail('positive: expected inline-capture marker at .pipeline/inline-capture-pending.json');
    }
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (!marker || typeof marker !== 'object') fail('positive: marker must be a JSON object');
    if (!marker.requestedAt || !marker.source) {
      fail('positive: marker must carry at least { requestedAt, source }');
    }
    console.error('[ctx-stop-inline-capture-test] case 1 PASS — capture marker queued');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

// ── Case 2: no substantive work → no marker, still exit 0, advisory unaffected ──
(function negativeCase() {
  const dir = mkProject();
  try {
    const res = runHook(dir);
    if (res.status !== 0) fail('negative: hook must exit 0, got ' + res.status);
    assertStdoutJsonOrEmpty(res, 'negative');
    const markerPath = path.join(dir, '.pipeline', 'inline-capture-pending.json');
    if (fs.existsSync(markerPath)) {
      fail('negative: marker must NOT be written when there is no substantive inline work');
    }
    console.error('[ctx-stop-inline-capture-test] case 2 PASS — no marker without work');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

// ── Case 3: marker already queued → idempotent, no crash, still exit 0 ──
(function idempotentCase() {
  const dir = mkProject();
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'context'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs', 'context', 'handoff.md'),
      '# Handoff\n\n' + 'More substantive inline work content here for size. '.repeat(8),
      'utf8',
    );
    fs.mkdirSync(path.join(dir, '.pipeline'), { recursive: true });
    const markerPath = path.join(dir, '.pipeline', 'inline-capture-pending.json');
    const pre = JSON.stringify({ requestedAt: '2026-01-01T00:00:00.000Z', source: 'pre-existing' });
    fs.writeFileSync(markerPath, pre, 'utf8');

    const res = runHook(dir);
    if (res.status !== 0) fail('idempotent: hook must exit 0, got ' + res.status);
    assertStdoutJsonOrEmpty(res, 'idempotent');
    // Pre-existing marker must not be clobbered (idempotent queue).
    const after = fs.readFileSync(markerPath, 'utf8');
    if (!after.includes('pre-existing')) {
      fail('idempotent: pre-existing marker must not be overwritten');
    }
    console.error('[ctx-stop-inline-capture-test] case 3 PASS — idempotent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.error('[ctx-stop-inline-capture-test] PASS');
process.exit(0);
