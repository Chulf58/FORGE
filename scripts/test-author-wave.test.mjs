#!/usr/bin/env node
// Tests for wave-split mechanics: test-author dispatch before coder, red-phase abort, coder prompt signal.
//
// Covers:
//   T1 — Wave-split step ordering: SKILL.md Phase Execution Loop has 'test-author' before 'coder'
//   T2 — Red-phase abort: redPhaseAbort({ exitCode: 0, testFile }) returns { aborted: true, reason: /passed without implementation/ }
//   T3 — Coder prompt signal: SKILL.md contains [test-author-output: .pipeline/context/test-author-output.json] and NOT 'test-author transcript'
//
// Run: node --test scripts/test-author-wave.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_MD_PATH = join(import.meta.dirname, '..', 'skills', 'implement', 'SKILL.md');

// Read SKILL.md once and reuse for all tests.
const skillMdText = readFileSync(SKILL_MD_PATH, 'utf8');

test('T1 — wave-split step ordering: test-author appears before coder in Phase Execution Loop', () => {
  // Extract the Phase Execution Loop section from SKILL.md.
  const loopStart = skillMdText.indexOf('### Phase Execution Loop');
  assert.ok(loopStart !== -1, 'Phase Execution Loop section not found in SKILL.md');

  // Find the end of this section (next ### heading or ## heading).
  const afterLoop = skillMdText.indexOf('\n## ', loopStart + 1);
  const loopSection = afterLoop !== -1
    ? skillMdText.slice(loopStart, afterLoop)
    : skillMdText.slice(loopStart);

  const testAuthorIdx = loopSection.indexOf('test-author');
  const coderIdx = loopSection.indexOf('coder');

  assert.ok(testAuthorIdx !== -1, 'literal token "test-author" not found in Phase Execution Loop section');
  assert.ok(coderIdx !== -1, 'literal token "coder" not found in Phase Execution Loop section');
  assert.ok(
    testAuthorIdx < coderIdx,
    `Expected "test-author" (index ${testAuthorIdx}) to appear before "coder" (index ${coderIdx}) in Phase Execution Loop`,
  );
});

test('T2 — red-phase abort: redPhaseAbort fires when test exits 0 without source changes', async () => {
  let mod;
  try {
    mod = await import('./wave-split.mjs');
  } catch (err) {
    // Module does not exist yet — assert its absence as a visible failure.
    assert.strictEqual(
      typeof mod,
      'object',
      `scripts/wave-split.mjs does not exist yet — import failed: ${err.message}`,
    );
    return;
  }

  // Module exists — assert the exported helper is a function.
  assert.strictEqual(
    typeof mod.redPhaseAbort,
    'function',
    'redPhaseAbort must be exported from scripts/wave-split.mjs',
  );

  const result = mod.redPhaseAbort({ exitCode: 0, testFile: 'scripts/some-test.mjs' });

  assert.strictEqual(result.aborted, true, 'aborted must be true when exitCode is 0');
  assert.ok(
    /passed without implementation/.test(result.reason),
    `reason must match /passed without implementation/, got: ${result.reason}`,
  );
});

test('T3 — coder prompt signal present and no test-author transcript leakage in SKILL.md', () => {
  const signalToken = '[test-author-output: .pipeline/context/test-author-output.json]';
  const leakagePhrase = 'test-author transcript';

  assert.ok(
    skillMdText.includes(signalToken),
    `SKILL.md must contain the literal token: ${signalToken}`,
  );

  assert.ok(
    !skillMdText.includes(leakagePhrase),
    `SKILL.md must NOT contain the phrase: "${leakagePhrase}"`,
  );
});
