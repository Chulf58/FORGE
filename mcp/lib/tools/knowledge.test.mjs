// @covers mcp/lib/tools/knowledge.js
// TDD guard shim — ensures a failing test exists before knowledge.js is modified.
// The authoritative integration tests are in mcp/knowledge-link-test.mjs.
//
// Run: node --test mcp/lib/tools/knowledge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('forge_get_linked is registered on the MCP server', async () => {
  const modulePath = pathToFileURL(resolve(__dirname, 'knowledge.js')).href;
  const mod = await import(modulePath);

  // Build a minimal server stub that records registered tool names
  const registeredTools = [];
  const stubServer = {
    registerTool: (name, _schema, _handler) => {
      registeredTools.push(name);
    },
  };

  mod.register(stubServer, {});

  assert.ok(
    registeredTools.includes('forge_get_linked'),
    'forge_get_linked not registered — implement the tool first',
  );
});

// ---------------------------------------------------------------------------
// Conflict-detect integration tests (red bar — handler not yet updated)
// These tests call the actual forge_add_learning handler with pre-populated
// near-duplicate data and assert that conflict detection fires.
// They FAIL before the handler calls detectConflict.
// ---------------------------------------------------------------------------

function makeConflictProjectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-conflict-test-'));
  mkdirSync(join(dir, 'docs', 'solutions'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'gotchas'), { recursive: true });
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

async function getAddLearningHandler() {
  const modulePath = pathToFileURL(resolve(__dirname, 'knowledge.js')).href;
  const mod = await import(modulePath);
  const handlers = {};
  const stubServer = {
    registerTool: (name, _schema, handler) => {
      handlers[name] = handler;
    },
  };
  mod.register(stubServer, {});
  return handlers['forge_add_learning'];
}

test('forge_add_learning returns conflict signal for type "solution" when near-duplicate exists', async () => {
  const projectDir = makeConflictProjectDir();
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR;
  try {
    // Pre-populate index.json with an entry that overlaps the incoming title
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    const existingEntry = {
      title: 'Worker gate-poll timeout race',
      file: 'docs/solutions/worker-gate-poll-timeout-race.md',
      tags: ['worker', 'race', 'forge'],
      keywords: ['worker', 'gate', 'poll', 'timeout', 'race'],
      verifiedAt: new Date().toISOString(),
    };
    writeFileSync(indexPath, JSON.stringify([existingEntry], null, 2), 'utf8');

    // Inject project dir so resolveProjectDir() returns our temp dir
    process.env.CLAUDE_PROJECT_DIR = projectDir;

    const handler = await getAddLearningHandler();

    // Call with a title that overlaps >= 50% keywords: "worker gate timeout race"
    // incoming tokens (len>=4): ['worker', 'gate', 'timeout', 'race'] — 4 tokens
    // intersection with existing: ['worker', 'gate', 'timeout', 'race'] — 4/4 = 100% >= 50%
    const result = await handler({
      type: 'solution',
      title: 'Worker gate timeout race',
      content: 'Some content about the same thing.',
      tags: ['worker', 'race'],
    });

    // The handler should return a conflict signal — NOT write a new doc
    assert.ok(Array.isArray(result.content), 'result.content must be array');
    assert.strictEqual(result.content[0].type, 'text', 'content[0].type must be "text"');
    assert.ok(typeof result.content[0].text === 'string', 'content[0].text must be string');

    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.conflict, true, 'conflict must be true — handler did not call detectConflict or return conflict signal');
    assert.ok(parsed.slug, 'slug must be present in conflict response');
    assert.ok(parsed.title, 'title must be present in conflict response');
    assert.ok(!result.isError, 'conflict response must not have isError: true — must be MCP-valid textResult');
  } finally {
    if (origProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = origProjectDir;
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('forge_add_learning returns conflict signal for type "gotcha" when near-duplicate exists', async () => {
  const projectDir = makeConflictProjectDir();
  const origProjectDir = process.env.CLAUDE_PROJECT_DIR;
  try {
    // Pre-populate GENERAL.md with a section whose terms overlap the incoming title
    const generalPath = join(projectDir, 'docs', 'gotchas', 'GENERAL.md');
    const generalContent = `## Worker gate-poll timeout race

When a prior stage worker exits after setting the gate, an orphan PID remains.
The sweep runs after status flips to running, detecting the orphan and marking the run
failed before the new worker registers its own PID.
`;
    writeFileSync(generalPath, generalContent, 'utf8');

    // Also create empty solutions index (gotcha cross-writes to it)
    const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
    writeFileSync(indexPath, '[]', 'utf8');

    // Inject project dir so resolveProjectDir() returns our temp dir
    process.env.CLAUDE_PROJECT_DIR = projectDir;

    const handler = await getAddLearningHandler();

    // Call with a title that overlaps GENERAL.md section:
    // incoming tokens (len>=4): ['worker', 'gate', 'poll', 'timeout'] — N=4
    // ceil(0.4*4) = 2; need >= 2 matching terms
    // 'worker', 'gate', 'poll', 'timeout' all appear in the section heading/body
    const result = await handler({
      type: 'gotcha',
      title: 'Worker gate poll timeout',
      content: 'Same issue described again.',
      tags: ['worker', 'gate'],
    });

    // The handler should return a conflict signal — NOT append to GENERAL.md
    assert.ok(Array.isArray(result.content), 'result.content must be array');
    assert.strictEqual(result.content[0].type, 'text', 'content[0].type must be "text"');
    assert.ok(typeof result.content[0].text === 'string', 'content[0].text must be string');

    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.conflict, true, 'conflict must be true — handler did not call detectConflict or return conflict signal');
    assert.ok(parsed.slug, 'slug must be present in conflict response');
    assert.ok(parsed.title, 'title must be present in conflict response');
    assert.ok(!result.isError, 'conflict response must not have isError: true — must be MCP-valid textResult');
  } finally {
    if (origProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = origProjectDir;
    }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }
});
