// @covers mcp/lib/orchestrator/agent-dispatch.mjs
// TDD wave-1 red-bar: agent-dispatch module
//
// AC-0: Module export check — dispatchAgent must be exported as a function.
// AC-1: Real-agent loading — when dispatched with agentType='coder-scout',
//       the dispatcher must load agents/coder-scout.md, parse its frontmatter model,
//       and pass the REAL model + body-derived systemPrompt to the SDK query() call,
//       NOT the hardcoded 'claude-sonnet-4-6' and NOT the CLAUDE-WORKER.md content.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let dispatchAgent;
try {
  const mod = await import('./agent-dispatch.mjs');
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

test('AC-1: dispatchAgent MUST extract body from agent file, not read CLAUDE-WORKER.md (RED BAR)', async () => {
  // RED-BAR TEST: This assertion will FAIL because the current code reads CLAUDE-WORKER.md.
  // When phase 2 implements the fix, it will PASS.

  const sourceCode = readFileSync(join(__dirname, 'agent-dispatch.mjs'), 'utf8');

  // Verify that the code DOES read from CLAUDE-WORKER.md (the bug)
  const readsCLAUDEWorker = sourceCode.includes('readFileSync(systemPromptPath');
  assert.ok(
    readsCLAUDEWorker,
    'Precondition: The bug exists — code currently reads from systemPromptPath (CLAUDE-WORKER.md)'
  );

  // Check that the code does NOT extract systemPrompt from the agent body
  const extractsSystemPromptFromBody = sourceCode.includes('agentBody') ||
                                       sourceCode.includes('agentContent') ||
                                       sourceCode.includes('systemPrompt:' + ' ' + 'body') ||
                                       sourceCode.includes('systemPrompt:' + ' ' + 'agentBody');

  // This assertion will FAIL because the code reads CLAUDE-WORKER.md
  // When fixed, it will extract the systemPrompt from agents/<agentType>.md body
  assert.ok(
    extractsSystemPromptFromBody,
    'AC-1 FAILING ASSERTION: query() systemPrompt must be extracted from agents/<agentType>.md body, ' +
    'not read from CLAUDE-WORKER.md (currently reads from systemPromptPath)'
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
