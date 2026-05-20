// @covers mcp/lib/knowledge-store.js
// TDD guard: Tests for detectConflict function for detecting near-duplicate solutions and gotchas.
//
// Run: node --test mcp/lib/knowledge-store-conflict.test.mjs

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import detectConflict — will fail if not exported (that's the point of this red-bar test)
let detectConflict;
try {
  const mod = await import('./knowledge-store.js');
  detectConflict = mod.detectConflict;
} catch (err) {
  // Module load failed or export doesn't exist — we'll assert on detectConflict being undefined
  detectConflict = undefined;
}

function makeProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ks-conflict-test-'));
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'gotchas'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'solutions', 'index.json'), '[]', 'utf8');
  writeFileSync(join(dir, 'docs', 'gotchas', 'GENERAL.md'), '', 'utf8');
  return dir;
}

// Test 1: detectConflict must be a function
test('detectConflict is exported as a function', () => {
  assert.strictEqual(
    typeof detectConflict,
    'function',
    'detectConflict not exported from knowledge-store.js — implement the function first',
  );
});

// Test 2: Solution conflict fires when ≥50% incoming-denominator keyword overlap
test('solution conflict fires when keyword overlap >= 50% (incoming denominator)', () => {
  const projectDir = makeProjectDir();
  try {
    // Set up index with an existing solution that shares keywords
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Worker gate-poll timeout race',
      file: 'docs/solutions/worker-gate-poll-timeout-race.md',
      tags: ['worker', 'race'],
      keywords: ['worker', 'gate', 'poll', 'timeout', 'race'],
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // incoming title: "Worker gate timeout" → tokens: ["worker", "gate", "timeout"]
    // overlap with existing keywords: ["worker", "gate", "timeout"] = 3 matches
    // ratio: 3 / 3 = 1.0 >= 0.5 → conflict
    const result = detectConflict(projectDir, {
      type: 'solution',
      title: 'Worker gate timeout',
      tags: [],
    });

    assert.ok(result, 'expected conflict to be detected');
    assert.strictEqual(result.slug, 'worker-gate-poll-timeout-race', 'conflict should return existing entry slug');
    assert.strictEqual(result.title, 'Worker gate-poll timeout race', 'conflict should return existing entry title');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 3: Solution conflict fires when ≥2 tags match
test('solution conflict fires when >= 2 tags match', () => {
  const projectDir = makeProjectDir();
  try {
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Test solution with many tags',
      file: 'docs/solutions/test-solution.md',
      tags: ['worker', 'race', 'gate'],
      keywords: ['test'],
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // incoming title: "Test thing"
    // incoming tags: ["worker", "race"] (2 tags match existing entry)
    const result = detectConflict(projectDir, {
      type: 'solution',
      title: 'Test thing',
      tags: ['worker', 'race'],
    });

    assert.ok(result, 'expected conflict when 2+ tags match');
    assert.strictEqual(result.slug, 'test-solution', 'conflict should return first matching entry');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 4: Solution returns null when keyword overlap below threshold
test('solution returns null when keyword overlap < 50%', () => {
  const projectDir = makeProjectDir();
  try {
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Database connection pooling',
      file: 'docs/solutions/database-pooling.md',
      tags: ['database'],
      keywords: ['database', 'connection', 'pool'],
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // incoming title: "Worker timeout" → tokens: ["worker", "timeout"]
    // overlap: 0 matches (no overlap with keywords: database, connection, pool)
    // ratio: 0 / 2 = 0.0 < 0.5 → no conflict
    const result = detectConflict(projectDir, {
      type: 'solution',
      title: 'Worker timeout',
      tags: [],
    });

    assert.strictEqual(result, null, 'expected no conflict when overlap < 50%');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 5: Gotcha conflict fires when >= 2 title key terms AND >= ceil(0.4*N) match
test('gotcha conflict fires when >= 2 key terms match and >= ceil(0.4*N) threshold met', () => {
  const projectDir = makeProjectDir();
  try {
    const generalPath = join(projectDir, 'docs', 'gotchas', 'GENERAL.md');
    const generalContent = `
## Worker gate-poll timeout race

When a prior stage's worker exits after setting a gate (orphan PID), and the new worker
spawns, the sweep runs and sees the orphan, marking the run failed before the new worker
can register. This is a known race condition.

Some more content about gates and workers.
`;
    writeFileSync(generalPath, generalContent, 'utf8');

    // incoming title: "Worker gate-poll timeout" → key terms: ["worker", "gate", "poll", "timeout"]
    // N = 4 key terms
    // ceil(0.4 * 4) = ceil(1.6) = 2
    // matches in GENERAL.md (case-insensitive substring): "worker" (yes), "gate" (yes), "poll" (yes), "timeout" (yes)
    // We have 4 matches >= 2 threshold, and 4 >= 2 key terms → conflict
    const result = detectConflict(projectDir, {
      type: 'gotcha',
      title: 'Worker gate-poll timeout',
      tags: [],
    });

    assert.ok(result, 'expected gotcha conflict');
    assert.strictEqual(result.slug, 'Worker gate-poll timeout race', 'should return section heading');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 6: Gotcha returns null when no match
test('gotcha returns null when no key term matches', () => {
  const projectDir = makeProjectDir();
  try {
    const generalPath = join(projectDir, 'docs', 'gotchas', 'GENERAL.md');
    const generalContent = `
## Database connection pooling

Best practices for connection pooling in SQL systems.
`;
    writeFileSync(generalPath, generalContent, 'utf8');

    // incoming title: "Worker timeout" → key terms: ["worker", "timeout"]
    // matches in GENERAL.md: 0 (database/connection/pooling content doesn't contain "worker" or "timeout")
    // → no conflict
    const result = detectConflict(projectDir, {
      type: 'gotcha',
      title: 'Worker timeout',
      tags: [],
    });

    assert.strictEqual(result, null, 'expected no gotcha conflict when terms don\'t match');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 7: Incoming empty keywords → no conflict (fail-open)
test('incoming empty keywords return null (fail-open)', () => {
  const projectDir = makeProjectDir();
  try {
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Test solution',
      file: 'docs/solutions/test-solution.md',
      tags: ['worker'],
      keywords: ['worker', 'gate', 'poll'],
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // incoming title: "x" (single-char, < 4, so no tokens extracted)
    // incoming keywords are empty → fail-open → no conflict
    const result = detectConflict(projectDir, {
      type: 'solution',
      title: 'x',
      tags: [],
    });

    assert.strictEqual(result, null, 'expected no conflict when incoming keywords empty');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

// Test 8: Existing entry empty keywords → no conflict (fail-open)
test('existing entry empty keywords return null (fail-open)', () => {
  const projectDir = makeProjectDir();
  try {
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Test solution',
      file: 'docs/solutions/test-solution.md',
      tags: [],
      keywords: [],  // Empty keywords
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // incoming title: "Worker gate timeout" → tokens: ["worker", "gate", "timeout"]
    // existing entry has empty keywords array → 0 overlap / 3 = 0.0 < 0.5 → no conflict
    const result = detectConflict(projectDir, {
      type: 'solution',
      title: 'Worker gate timeout',
      tags: [],
    });

    assert.strictEqual(result, null, 'expected no conflict when existing keywords empty');
  } finally {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});
