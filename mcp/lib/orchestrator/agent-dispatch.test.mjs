// @covers mcp/lib/orchestrator/agent-dispatch.mjs
// TDD wave-1 red-bar: agent-dispatch module
//
// AC-0: Module export check — dispatchAgent must be exported as a function.
// AC-1: Real-agent loading — when dispatched with agentType='coder-scout',
//       the dispatcher must load agents/coder-scout.md, parse its frontmatter model,
//       and pass the REAL model + body-derived systemPrompt to the SDK query() call,
//       NOT the hardcoded 'claude-sonnet-4-6' and NOT the CLAUDE-WORKER.md content.
// AC-32: maxTurns propagation — when an agent's frontmatter declares maxTurns: N,
//        the dispatcher MUST pass maxTurns: N to the SDK query() call.
// AC-38: outcome classification — classifyOutcome() must categorize dispatch results
//        as 'completed' or 'uncertain' based on agent kind (writer vs readonly) and
//        output verification (mtime or completion signal). COMPLETION_SIGNAL pattern
//        must be pinned to prevent false positives on arbitrary prose output.
// AC-4: expectedArtifact canonical path — coder-scout artifact must resolve to
//       docs/context/scout.json (not .pipeline/context/scout.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let dispatchAgent;
let mod;
try {
  mod = await import('./agent-dispatch.mjs');
  dispatchAgent = mod.dispatchAgent;
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
    test('T0 — agent-dispatch.mjs must exist and export dispatchAgent', () => {
      assert.fail(
        'mcp/lib/orchestrator/agent-dispatch.mjs does not exist yet. ' +
        'Original error: ' + err.message
      );
    });
    process.exit(1);
  }
  throw err;
}

test('AC-0: dispatchAgent is exported as a function', () => {
  assert.equal(typeof dispatchAgent, 'function', 'dispatchAgent must be exported as a function');
});

// ──────────────────────────────────────────────────────────────────────────
// AC-1: Real-agent dispatch — loads agents/<type>.md and passes real values
// ──────────────────────────────────────────────────────────────────────────

// Helper: parse YAML frontmatter manually
function parseFrontmatter(markdownContent) {
  const match = markdownContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid frontmatter format');
  }
  const yamlText = match[1];
  const body = match[2];

  const fm = {};
  for (const line of yamlText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      fm[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { frontmatter: fm, body };
}

test('AC-1: dispatchAgent MUST load agents/<agentType>.md and use its model (RED BAR)', async () => {
  // RED-BAR TEST: This assertion will FAIL because the current code does NOT
  // load agents/<agentType>.md. When phase 2 implements the fix, this will PASS.
  //
  // The assertion checks that the source code pattern exists for loading the agent file.
  // Currently it does NOT, so the test FAILS.

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');

  // Check that the code loads agents/<agentType>.md
  // The fix MUST contain a pattern like: join(pluginRoot, 'agents', agentType) + '.md'
  const loadsAgentFile = sourceCode.includes("join(pluginRoot, 'agents'") ||
                         sourceCode.includes('agents/${agentType}') ||
                         sourceCode.includes("join(pluginRoot, 'agents', agentType");

  // This assertion will FAIL because the current code doesn't load agents/<agentType>.md
  assert.ok(
    loadsAgentFile,
    'AC-1 FAILING ASSERTION: dispatchAgent must load agents/<agentType>.md ' +
    '(currently it hardcodes the model and ignores agentType)'
  );
});

test('AC-1: dispatchAgent MUST extract model from agent frontmatter (RED BAR)', async () => {
  // RED-BAR TEST: This assertion will FAIL because the current code hardcodes the model.
  // When phase 2 implements the fix, it will PASS.

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');

  // Check that the code extracts model from parsed frontmatter
  // The fix MUST contain patterns like: parse YAML, extract .model, use it in query()
  const extractsModelFromFrontmatter = sourceCode.includes('frontmatter.model') ||
                                       sourceCode.includes('fm.model') ||
                                       sourceCode.includes('parseFrontmatter');

  // This assertion will FAIL because the current code doesn't parse frontmatter
  assert.ok(
    extractsModelFromFrontmatter,
    'AC-1 FAILING ASSERTION: dispatchAgent must parse agent frontmatter and extract model ' +
    '(currently it hardcodes "claude-sonnet-4-6")'
  );
});

test('AC-1: dispatchAgent MUST pass extracted model to query(), not hardcoded default (RED BAR)', async () => {
  // RED-BAR TEST: This assertion will FAIL because the current code passes hardcoded model.
  // When phase 2 implements the fix, it will PASS.

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');

  // Verify that the code DOES hardcode the model (the bug we're testing)
  const hardcodesModel = sourceCode.includes("model: 'claude-sonnet-4-6'");
  assert.ok(
    hardcodesModel,
    'Precondition: The bug exists — code currently hardcodes model'
  );

  // Check that the code does NOT use an extracted/dynamic model variable
  const usesDynamicModel = sourceCode.includes('model: realModel') ||
                          sourceCode.includes('model: extractedModel') ||
                          sourceCode.includes('model: agentModel') ||
                          sourceCode.includes('model: frontmatter.model') ||
                          sourceCode.includes('model:' + ' ' + 'modelFromAgent');

  // This assertion will FAIL because the code uses hardcoded model
  // When fixed, it will use a dynamically extracted model from the agent def
  assert.ok(
    usesDynamicModel,
    'AC-1 FAILING ASSERTION: query() must receive model extracted from agents/<agentType>.md, ' +
    'not the hardcoded "claude-sonnet-4-6" (currently receives hardcoded model)'
  );
});

test('AC-1: dispatchAgent extracts body from agent file (NOT a CLAUDE-WORKER.md path)', async () => {
  // Post-Phase-1 behavior assertion. The original Phase-1 red bar had a "precondition"
  // checking the source for `readFileSync(systemPromptPath` — that precondition was
  // satisfied by the bug and inverted by the fix; it's been removed (Task-9 cleanup)
  // since CLAUDE-WORKER.md is fully retired and the parameter is gone.

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');

  // Real assertion: the source extracts systemPrompt from the parsed agent body.
  const extractsSystemPromptFromBody = sourceCode.includes('agentBody') ||
                                       sourceCode.includes('agentContent') ||
                                       sourceCode.includes('systemPrompt:' + ' ' + 'body') ||
                                       sourceCode.includes('systemPrompt:' + ' ' + 'agentBody');

  assert.ok(
    extractsSystemPromptFromBody,
    'AC-1: query() systemPrompt must be extracted from agents/<agentType>.md body',
  );
});

test('AC-1: Fixture verification — agents/coder-scout.md has different model', async () => {
  // Verify test fixture is set up correctly for the red-bar assertion

  const pluginRoot = join(__dirname, '../../../');
  const agentPath = join(pluginRoot, 'agents', 'coder-scout.md');
  const agentContent = readFileSync(agentPath, 'utf8');
  const { frontmatter } = parseFrontmatter(agentContent);

  assert.strictEqual(
    frontmatter.model,
    'claude-haiku-4-5-20251001',
    'Fixture: coder-scout.md uses haiku model (different from hardcoded sonnet)'
  );
});

test('AC-1: Fixture verification — agents/coder-scout.md has non-empty body', async () => {
  // Verify test fixture is set up correctly for the red-bar assertion

  const pluginRoot = join(__dirname, '../../../');
  const agentPath = join(pluginRoot, 'agents', 'coder-scout.md');
  const agentContent = readFileSync(agentPath, 'utf8');
  const { body } = parseFrontmatter(agentContent);

  assert.ok(
    body.length > 100,
    'Fixture: coder-scout.md has substantial body content'
  );
});

// ──────────────────────────────────────────────────────────────────────────
// AC-32: maxTurns propagation — frontmatter maxTurns must reach SDK query()
// ──────────────────────────────────────────────────────────────────────────

test('AC-32: Fixture verification — agents/coder-scout.md declares a positive numeric maxTurns', async () => {
  // Verify the fixture agent declares maxTurns in its frontmatter. Value-agnostic
  // by design: the exact number is tuned over time (8→20 on 2026-05-29 to stop
  // truncation), and the propagation test below is what verifies the value reaches
  // query() — so pinning a specific number here only created a brittle break on
  // every retune. This still fails if coder-scout LOSES its maxTurns or it becomes
  // non-numeric.

  const pluginRoot = join(__dirname, '../../../');
  const agentPath = join(pluginRoot, 'agents', 'coder-scout.md');
  const agentContent = readFileSync(agentPath, 'utf8');
  const { frontmatter } = parseFrontmatter(agentContent);

  assert.ok(
    frontmatter.maxTurns !== undefined &&
      /^\d+$/.test(String(frontmatter.maxTurns)) &&
      Number(frontmatter.maxTurns) > 0,
    'Fixture: coder-scout.md frontmatter must declare a positive numeric maxTurns'
  );
});

test('AC-32: frontmatter maxTurns propagates into the SDK query() options', () => {
  // Behavioral check. Replaces the old brittle source-regex that matched a literal
  // `query({...})` inline object — it broke when the args were extracted into the
  // pure, testable buildQueryParams seam (and source-text regex was exactly the
  // false-confidence pattern: it asserted the code's SHAPE, not its behavior).
  assert.equal(
    typeof mod.buildQueryParams,
    'function',
    'agent-dispatch must export buildQueryParams (the SDK query() params builder)',
  );

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');
  // (a) Source still reads maxTurns from the parsed agent frontmatter (not hardcoded).
  assert.ok(
    /frontmatter\.maxTurns/.test(sourceCode),
    'agent-dispatch.mjs must read maxTurns from the parsed agent frontmatter',
  );
  // (b) dispatchAgent must feed the parsed value through buildQueryParams.
  assert.ok(
    /buildQueryParams\(\{[\s\S]*?agentMaxTurns/.test(sourceCode),
    'dispatchAgent must pass agentMaxTurns into buildQueryParams',
  );

  // (c) Behavior: a positive integer reaches options.maxTurns; absent/invalid is omitted
  //     so the SDK default still applies — never a hardcoded literal.
  const args = {
    prompt: 'p', agentModel: 'm', agentBody: 'b', workDir: '/w',
    pluginRoot: '/r', buildMcpServer: () => ({}),
  };
  assert.equal(
    mod.buildQueryParams({ ...args, agentMaxTurns: 20 }).options.maxTurns,
    20,
    'a positive frontmatter maxTurns must reach options.maxTurns',
  );
  assert.equal(
    'maxTurns' in mod.buildQueryParams({ ...args, agentMaxTurns: NaN }).options,
    false,
    'an absent/invalid maxTurns must be omitted so the SDK default applies',
  );
});

// ──────────────────────────────────────────────────────────────────────────
// AC-38: classifyOutcome & COMPLETION_SIGNAL pattern (outcome verification)
// ──────────────────────────────────────────────────────────────────────────

test('RED AC-38: classifyOutcome is exported as a function', () => {
  const classifyOutcome = mod.classifyOutcome;
  assert.equal(
    typeof classifyOutcome,
    'function',
    'AC-38 RED BAR: agent-dispatch.mjs must export classifyOutcome() (not found yet)'
  );
});

test('RED AC-38: COMPLETION_SIGNAL is exported as a RegExp', () => {
  const COMPLETION_SIGNAL = mod.COMPLETION_SIGNAL;
  assert.ok(
    COMPLETION_SIGNAL instanceof RegExp,
    'AC-38 RED BAR: agent-dispatch.mjs must export COMPLETION_SIGNAL as a RegExp (not found yet)'
  );
});

test('RED AC-38.1: classifyOutcome returns {outcome, reason} — writer + mtimeResult.ok=true', () => {
  const classifyOutcome = mod.classifyOutcome;
  const result = classifyOutcome({
    agentKind: 'writer',
    mtimeResult: { ok: true, reason: 'fresh: mtime >= since' },
    streamText: 'agent output',
    completionPattern: /\[verdict\]/i,
    error: null,
  });

  assert.ok(result, 'classifyOutcome must return an object');
  assert.equal(result.outcome, 'completed', 'writer with mtimeResult.ok=true must return outcome:completed');
  assert.ok(typeof result.reason === 'string' || result.reason === undefined,
    'reason field must be string or absent (not required for completed)');
});

test('RED AC-38.2: classifyOutcome returns {outcome, reason} — writer + mtimeResult.ok=false', () => {
  const classifyOutcome = mod.classifyOutcome;
  const result = classifyOutcome({
    agentKind: 'writer',
    mtimeResult: { ok: false, reason: 'file absent: /path/to/file' },
    streamText: 'agent output',
    completionPattern: /\[verdict\]/i,
    error: null,
  });

  assert.ok(result, 'classifyOutcome must return an object');
  assert.equal(result.outcome, 'uncertain', 'writer with mtimeResult.ok=false must return outcome:uncertain');
  assert.ok(result.reason && result.reason.length > 0,
    'uncertain outcome must include a non-empty reason');
  assert.ok(result.reason.includes('file absent') || result.reason.includes('mtime'),
    'reason for mtime-miss must surface the mtime reason');
});

test('RED AC-38.3: classifyOutcome returns {outcome, reason} — readonly + pattern match', () => {
  const classifyOutcome = mod.classifyOutcome;
  const streamText = 'The agent has completed its work.\n[completeness-ok]\nFinal verdict: all done.';
  const result = classifyOutcome({
    agentKind: 'readonly',
    mtimeResult: null,
    streamText: streamText,
    completionPattern: /\[completeness-ok\]/i,
    error: null,
  });

  assert.ok(result, 'classifyOutcome must return an object');
  assert.equal(result.outcome, 'completed',
    'readonly agent with matching completion pattern must return outcome:completed');
});

test('RED AC-38.4: classifyOutcome returns {outcome, reason} — readonly + no pattern match', () => {
  const classifyOutcome = mod.classifyOutcome;
  const streamText = 'The agent worked on the task but did not emit a completion signal.';
  const result = classifyOutcome({
    agentKind: 'readonly',
    mtimeResult: null,
    streamText: streamText,
    completionPattern: /\[completeness-ok\]/i,
    error: null,
  });

  assert.ok(result, 'classifyOutcome must return an object');
  assert.equal(result.outcome, 'uncertain',
    'readonly agent without matching completion pattern must return outcome:uncertain');
  assert.ok(result.reason && result.reason.length > 0,
    'uncertain outcome must include a non-empty reason');
  assert.ok(result.reason.toLowerCase().includes('no completion signal') ||
            result.reason.toLowerCase().includes('signal not found') ||
            result.reason.toLowerCase().includes('pattern'),
    'reason must indicate no completion signal was detected');
});

test('RED AC-38.5: classifyOutcome handles error (any agentKind) — returns uncertain + reason', () => {
  const classifyOutcome = mod.classifyOutcome;
  const testError = new Error('Stream error: connection lost');
  const result = classifyOutcome({
    agentKind: 'writer',
    mtimeResult: null,
    streamText: '',
    completionPattern: /\[verdict\]/i,
    error: testError,
  });

  assert.ok(result, 'classifyOutcome must return an object even with error');
  assert.equal(result.outcome, 'uncertain',
    'error present must return outcome:uncertain (never completed, never re-throw)');
  assert.ok(result.reason && result.reason.length > 0,
    'error outcome must include a non-empty reason');
  assert.ok(result.reason.includes('connection lost') || result.reason.toLowerCase().includes('error'),
    'reason must mention the error that occurred');
});

test('RED AC-38.6: COMPLETION_SIGNAL pattern — matches known good completion lines', () => {
  const COMPLETION_SIGNAL = mod.COMPLETION_SIGNAL;

  // The pattern MUST match at least one known-good completion line.
  // These are sentinel strings that readonly agents emit to signal completion:
  const knownGoodLines = [
    '[completeness-ok]',
    '[APPROVED]',
    '[verdict]',
    '[verdict-final]',
    '[reviewer-verdict]',
  ];

  const matches = knownGoodLines.filter(line => COMPLETION_SIGNAL.test(line));
  assert.ok(matches.length > 0,
    `AC-38 RED BAR: COMPLETION_SIGNAL pattern must match at least one known-good sentinel line. ` +
    `Pattern: ${COMPLETION_SIGNAL}. Tested: ${knownGoodLines.join(', ')}. Matched: ${matches.join(', ') || '(none)'}`);
});

test('RED AC-38.7: COMPLETION_SIGNAL pattern — does NOT match arbitrary prose', () => {
  const COMPLETION_SIGNAL = mod.COMPLETION_SIGNAL;

  // The pattern MUST NOT match arbitrary output lines to prevent false positives:
  const arbitraryProseLines = [
    'the coder finished editing the files',
    'the task is complete and all tests pass',
    'completed successfully with no errors',
    'the review found no issues',
    'approval is granted for merging',
    'this is some random text that mentions completion',
  ];

  const falsePositives = arbitraryProseLines.filter(line => COMPLETION_SIGNAL.test(line));
  assert.equal(falsePositives.length, 0,
    `AC-38 RED BAR: COMPLETION_SIGNAL pattern must NOT match arbitrary prose. ` +
    `Pattern: ${COMPLETION_SIGNAL}. False positives: ${falsePositives.join(', ')}`);
});

test('RED AC-38.8: classifyOutcome symmetry — pattern in stream vs pattern not in stream', () => {
  const classifyOutcome = mod.classifyOutcome;
  const pattern = /\[sentinel\]/i;

  // With pattern present
  const resultWithPattern = classifyOutcome({
    agentKind: 'readonly',
    mtimeResult: null,
    streamText: 'Work done. [sentinel] End of output.',
    completionPattern: pattern,
    error: null,
  });
  assert.equal(resultWithPattern.outcome, 'completed', 'should complete when pattern is found');

  // Without pattern
  const resultWithoutPattern = classifyOutcome({
    agentKind: 'readonly',
    mtimeResult: null,
    streamText: 'Work done. No sentinel. End of output.',
    completionPattern: pattern,
    error: null,
  });
  assert.equal(resultWithoutPattern.outcome, 'uncertain', 'should be uncertain when pattern is not found');
});

// ──────────────────────────────────────────────────────────────────────────
// AC-38 WIRING (RED BAR): dispatchAgent must delegate its outcome to
// classifyOutcome — the blind unconditional `return { outcome: 'completed' }`
// must be gone. Scoped to the dispatchAgent body (sliced AFTER the
// classifyOutcome definition, whose own returns must not count).
// ──────────────────────────────────────────────────────────────────────────
test('RED AC-38 wiring — dispatchAgent delegates to classifyOutcome and drops the blind return', () => {
  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');
  const declIdx = sourceCode.indexOf('export async function dispatchAgent');
  assert.notEqual(declIdx, -1, 'dispatchAgent must exist in agent-dispatch.mjs');
  const body = sourceCode.slice(declIdx);

  assert.ok(
    body.includes('classifyOutcome('),
    'AC-38 WIRING FAILING: dispatchAgent must call classifyOutcome(...) to drive its return — ' +
      'currently it returns a blind outcome without running verification.',
  );
  assert.ok(
    !/return\s*\{\s*outcome:\s*'completed'\s*\}/.test(body),
    "AC-38 WIRING FAILING: dispatchAgent must NOT keep an unconditional `return { outcome: 'completed' }` — " +
      'the verification result (via classifyOutcome) must determine the outcome.',
  );
});

// ──────────────────────────────────────────────────────────────────────────
// AC-4: expectedArtifact canonical path — coder-scout must map to docs/context/scout.json
// ──────────────────────────────────────────────────────────────────────────

test('RED AC-4: expectedArtifact is exported as a function', () => {
  const expectedArtifact = mod.expectedArtifact;
  assert.equal(
    typeof expectedArtifact,
    'function',
    'AC-4 RED BAR: agent-dispatch.mjs must export expectedArtifact() — currently it is module-private'
  );
});

test('RED AC-4: expectedArtifact("coder-scout") returns "docs/context/scout.json"', () => {
  const expectedArtifact = mod.expectedArtifact;

  // expectedArtifact must be callable; if it's undefined the previous test failed.
  // This assertion ensures the function exists and returns the correct canonical path.
  assert.ok(expectedArtifact, 'expectedArtifact must be a function (not undefined)');

  const result = expectedArtifact('coder-scout');
  assert.strictEqual(
    result,
    'docs/context/scout.json',
    'AC-4 FAILING: expectedArtifact("coder-scout") must return "docs/context/scout.json" ' +
    '(currently returns "' + result + '")'
  );
});
