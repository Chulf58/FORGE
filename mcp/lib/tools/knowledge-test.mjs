// @covers mcp/lib/tools/knowledge.js
// Tests for the knowledge domain tool registration (forge_get_constraints,
// forge_get_patterns, forge_add_learning, forge_read_criteria, forge_write_criteria).
//
// Run: node mcp/lib/tools/knowledge-test.mjs
// Auto-discovered by scripts/run-tests.mjs via *-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Point at the top-level server.js (two levels up from mcp/lib/tools/)
const SERVER_PATH = resolve(__dirname, '..', '..', 'server.js');

function fail(msg) {
  console.error('[knowledge-test] FAIL: ' + msg);
  process.exit(1);
}

function callTool(client, name, args) {
  return client.callTool({ name, arguments: args });
}

function parseToolResult(result) {
  if (result.isError) {
    throw new Error('tool returned isError=true: ' + JSON.stringify(result.content));
  }
  const block = (result.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no text content in tool result');
  return JSON.parse(block.text);
}

function seed(projectDir) {
  mkdirSync(join(projectDir, 'docs', 'gotchas'), { recursive: true });
  writeFileSync(
    join(projectDir, 'docs', 'gotchas', 'GENERAL.md'),
    '# GENERAL\n\n## Hook scripts\n\nUse stderr for user-visible messages.\n',
  );
  mkdirSync(join(projectDir, 'docs', 'solutions'), { recursive: true });
  writeFileSync(
    join(projectDir, 'docs', 'solutions', 'index.json'),
    JSON.stringify({ entries: [] }),
  );
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({ todos: [], planned: [] }),
  );
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-knowledge-test-'));
  seed(projectDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-knowledge-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);

    // ── Test 1: forge_get_constraints returns results for a known keyword ──
    const constraintResult = parseToolResult(
      await callTool(client, 'forge_get_constraints', { keyword: 'Hook' }),
    );
    if (!Array.isArray(constraintResult)) {
      failure = 'forge_get_constraints: expected array, got ' + typeof constraintResult;
    } else if (constraintResult.length === 0) {
      failure = 'forge_get_constraints: expected at least one result for keyword "Hook"';
    } else {
      console.error('[knowledge-test] test 1 PASS — forge_get_constraints returned results');
    }

    // ── Test 2: forge_get_patterns returns empty for unknown keyword ──
    if (!failure) {
      const patternResult = parseToolResult(
        await callTool(client, 'forge_get_patterns', { keyword: 'zzz-no-match-xyzzy' }),
      );
      if (!Array.isArray(patternResult)) {
        failure = 'forge_get_patterns: expected array result';
      } else {
        console.error('[knowledge-test] test 2 PASS — forge_get_patterns returned array for unknown keyword');
      }
    }

    // ── Test 3: forge_add_learning (gotcha) appends to GENERAL.md ──
    if (!failure) {
      const addResult = await callTool(client, 'forge_add_learning', {
        type: 'gotcha',
        title: 'Test gotcha section',
        content: 'This is a test gotcha body.',
        tags: ['test'],
      });
      const textBlock = (addResult.content || []).find(c => c.type === 'text');
      if (!textBlock || !textBlock.text.includes('Test gotcha section')) {
        failure = 'forge_add_learning gotcha: unexpected response: ' + JSON.stringify(addResult.content);
      } else {
        const generalMd = readFileSync(join(projectDir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
        if (!generalMd.includes('Test gotcha section')) {
          failure = 'forge_add_learning gotcha: GENERAL.md not updated';
        } else {
          console.error('[knowledge-test] test 3 PASS — forge_add_learning wrote gotcha to GENERAL.md');
        }
      }
    }

    // ── Test 4: forge_read_criteria returns empty array for unknown run ──
    if (!failure) {
      // Create the run directory manually so it exists
      const runDir = join(projectDir, '.pipeline', 'runs', 'r-testrun1');
      mkdirSync(runDir, { recursive: true });
      const criteriaResult = parseToolResult(
        await callTool(client, 'forge_read_criteria', { runId: 'r-testrun1' }),
      );
      if (!criteriaResult.criteria || !Array.isArray(criteriaResult.criteria)) {
        failure = 'forge_read_criteria: expected { criteria: [] }, got ' + JSON.stringify(criteriaResult);
      } else if (criteriaResult.criteria.length !== 0) {
        failure = 'forge_read_criteria: expected empty array for new run dir';
      } else {
        console.error('[knowledge-test] test 4 PASS — forge_read_criteria returns empty array');
      }
    }

    // ── Test 5: forge_write_criteria then forge_read_criteria round-trips ──
    if (!failure) {
      const toWrite = [
        { id: 'AC-1', text: 'First criterion', status: 'accepted' },
        { id: 'AC-2', text: 'Second criterion', status: 'pending' },
      ];
      const writeResult = parseToolResult(
        await callTool(client, 'forge_write_criteria', { runId: 'r-testrun1', criteria: toWrite }),
      );
      if (!writeResult.ok || writeResult.written !== 2) {
        failure = 'forge_write_criteria: expected { ok: true, written: 2 }, got ' + JSON.stringify(writeResult);
      } else {
        const readBack = parseToolResult(
          await callTool(client, 'forge_read_criteria', { runId: 'r-testrun1' }),
        );
        if (readBack.criteria.length !== 2 || readBack.criteria[0].id !== 'AC-1') {
          failure = 'forge_write_criteria round-trip: mismatch — ' + JSON.stringify(readBack);
        } else {
          console.error('[knowledge-test] test 5 PASS — forge_write_criteria/read round-trip');
        }
      }
    }

    // ── Test 6: forge_write_criteria with deferred creates board TODO ──
    if (!failure) {
      const deferredCriteria = [
        { id: 'AC-3', text: 'Deferred acceptance check', status: 'deferred' },
      ];
      await callTool(client, 'forge_write_criteria', { runId: 'r-testrun1', criteria: deferredCriteria });
      const board = JSON.parse(readFileSync(join(projectDir, '.pipeline', 'board.json'), 'utf8'));
      const deferredTodo = board.todos.find(t =>
        Array.isArray(t.tags) && t.tags.includes('deferred-criterion'),
      );
      if (!deferredTodo) {
        failure = 'forge_write_criteria: deferred criterion did not create board TODO';
      } else if (!deferredTodo.text.includes('[deferred AC-3]')) {
        failure = 'forge_write_criteria: board TODO text missing deferred AC-3 marker';
      } else {
        console.error('[knowledge-test] test 6 PASS — deferred criterion creates board TODO');
      }
    }

    if (!failure) {
      console.error('[knowledge-test] PASS');
    }

  } catch (err) {
    failure = 'test harness error: ' + (err && err.stack || String(err));
  } finally {
    try { await client.close(); } catch (_) {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch (_) {}
  }

  if (failure) fail(failure);
  process.exit(0);
}

main().catch((err) => {
  console.error('[knowledge-test] unexpected throw:', err);
  process.exit(1);
});
