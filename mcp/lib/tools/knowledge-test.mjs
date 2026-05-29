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
        trigger: 'When testing gotcha persistence',
        sourceEvidence: 'knowledge-test.mjs test 3',
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

    // ── Test 4: forge_add_learning (solution) writes verifiedAt to index entry ──
    if (!failure) {
      await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Test verifiedAt solution',
        content: 'Regression guard body.',
        tags: ['test'],
        trigger: 'When testing solution verifiedAt',
        sourceEvidence: 'knowledge-test.mjs test 4',
      });
      const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      const indexRaw = readFileSync(join(projectDir, 'docs', 'solutions', 'index.json'), 'utf8');
      const entries = JSON.parse(indexRaw);
      const entry = entries.find(e => e.title === 'Test verifiedAt solution');
      if (!entry) {
        failure = 'forge_add_learning solution: entry not found in index';
      } else if (!('verifiedAt' in entry)) {
        failure = 'forge_add_learning solution: index entry missing verifiedAt field';
      } else if (!ISO_8601_RE.test(entry.verifiedAt)) {
        failure = 'forge_add_learning solution: verifiedAt does not match ISO 8601 pattern: ' + entry.verifiedAt;
      } else {
        console.error('[knowledge-test] test 4 PASS — forge_add_learning solution entry has verifiedAt');
      }
    }

    // ── Test 5: forge_read_criteria returns empty array for unknown run ──
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
        console.error('[knowledge-test] test 5 PASS — forge_read_criteria returns empty array');
      }
    }

    // ── Test 6: forge_write_criteria then forge_read_criteria round-trips ──
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
          console.error('[knowledge-test] test 6 PASS — forge_write_criteria/read round-trip');
        }
      }
    }

    // ── Test 7: forge_write_criteria with deferred creates board TODO ──
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
        console.error('[knowledge-test] test 7 PASS — deferred criterion creates board TODO');
      }
    }

    // ── Test 8: mergeEvidenceOnConflict appends evidence into the EXISTING entry ──
    // seed() wrote a "## Hook scripts" section; a learning whose title overlaps it is
    // detected as a conflict. With mergeEvidenceOnConflict:true the new sourceEvidence must
    // be merged INTO that existing section (no content dropped, no duplicate heading).
    if (!failure) {
      const mergeRes = await callTool(client, 'forge_add_learning', {
        type: 'gotcha',
        title: 'Hook scripts stderr usage',
        content: 'Always use stderr for user-visible hook messages.',
        tags: ['hooks'],
        trigger: 'When writing a hook',
        sourceEvidence: 'run r-MERGE-XYZ',
        mergeEvidenceOnConflict: true,
      });
      const generalMd = readFileSync(join(projectDir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
      const headingCount = (generalMd.match(/^## Hook scripts$/gm) || []).length;
      if (mergeRes.isError) {
        failure = 'test 8 merge: tool returned isError — ' + JSON.stringify(mergeRes.content);
      } else if (!generalMd.includes('run r-MERGE-XYZ')) {
        failure = 'test 8 merge: new evidence was not appended into the existing section';
      } else if (!generalMd.includes('Use stderr for user-visible messages.')) {
        failure = 'test 8 merge: existing section content was dropped';
      } else if (headingCount !== 1) {
        failure = 'test 8 merge: duplicate "## Hook scripts" heading (expected 1, got ' + headingCount + ')';
      } else {
        console.error('[knowledge-test] test 8 PASS — mergeEvidenceOnConflict merged evidence');
      }
    }

    // ── Gate block: forge_add_learning must reject incomplete payloads ──
    // This block runs independently of the preceding tests.
    // It tests that forge_add_learning rejects payloads missing required fields.
    // The CURRENT implementation does NOT validate these fields, so the assertions
    // will fail (expected behavior for phase 1 red bar).
    let gateFailure = null;
    try {
      // Gate test 1: missing trigger field
      const gateTest1 = await callTool(client, 'forge_add_learning', {
        type: 'gotcha',
        title: 'Gate test — missing trigger',
        content: 'body',
        tags: [],
        sourceEvidence: 'run r-test',
        // note: trigger field intentionally omitted
      });
      if (!gateTest1.isError) {
        gateFailure = 'gate test 1: missing trigger field — expected isError=true, got isError=' + gateTest1.isError;
      }

      // Gate test 2: missing sourceEvidence field
      if (!gateFailure) {
        const gateTest2 = await callTool(client, 'forge_add_learning', {
          type: 'gotcha',
          title: 'Gate test — missing sourceEvidence',
          content: 'body',
          tags: [],
          trigger: 'When X happens',
          // note: sourceEvidence field intentionally omitted
        });
        if (!gateTest2.isError) {
          gateFailure = 'gate test 2: missing sourceEvidence field — expected isError=true, got isError=' + gateTest2.isError;
        }
      }

      // Gate test 3: missing type field
      if (!gateFailure) {
        const gateTest3 = await callTool(client, 'forge_add_learning', {
          title: 'Gate test — missing type',
          content: 'body',
          tags: [],
          trigger: 'When X happens',
          sourceEvidence: 'run r-test',
          // note: type field intentionally omitted
        });
        if (!gateTest3.isError) {
          gateFailure = 'gate test 3: missing type field — expected isError=true, got isError=' + gateTest3.isError;
        }
      }

      if (gateFailure) {
        console.error('[knowledge-test] gate: FAIL');
        process.exit(1);
      } else {
        console.error('[knowledge-test] gate: PASS');
      }
    } catch (gateErr) {
      console.error('[knowledge-test] gate: FAIL');
      console.error('Gate error: ' + (gateErr && gateErr.message || String(gateErr)));
      process.exit(1);
    }

    // ── Test 9: mergeEvidenceOnConflict on solution type surfaces mergeFailed (F) ──
    // solution-merge is not supported by appendEvidence → must return mergeFailed:true and
    // rejectedContent, NOT silently fall through to a bare {conflict:true}.
    if (!failure) {
      // Seed a solution with tags that produce >= 50% keyword overlap with the conflict call below.
      // "Worker gate poll timeout" → keywords: ['worker', 'gate', 'poll', 'timeout'] (4 terms).
      // Conflict call uses same title → intersection 4/4 = 1.0 >= 0.5 → detectConflict fires.
      await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Worker gate poll timeout',
        content: 'Body about worker gate poll timeout.',
        tags: ['worker', 'gate', 'poll', 'timeout'],
        trigger: 'When testing merge-failed signal',
        sourceEvidence: 'knowledge-test.mjs test 9 seed',
      });
      // Now call with the same title + mergeEvidenceOnConflict:true (solution-merge is unsupported)
      const mergeFailRes = await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Worker gate poll timeout',
        content: 'Conflicting body that should not be silently dropped.',
        tags: ['worker', 'gate', 'poll', 'timeout'],
        trigger: 'When testing merge-failed signal',
        sourceEvidence: 'knowledge-test.mjs test 9 conflict',
        mergeEvidenceOnConflict: true,
      });
      if (mergeFailRes.isError) {
        failure = 'test 9: unexpected isError from merge-failed signal';
      } else {
        let parsed;
        try {
          const textBlock = (mergeFailRes.content || []).find(c => c.type === 'text');
          parsed = textBlock ? JSON.parse(textBlock.text) : null;
        } catch (e) {
          failure = 'test 9: failed to parse tool result JSON: ' + e.message;
        }
        if (!failure) {
          if (!parsed || parsed.mergeFailed !== true) {
            failure = 'test 9: expected mergeFailed:true in response, got: ' + JSON.stringify(parsed);
          } else if (!('rejectedContent' in parsed)) {
            failure = 'test 9: expected rejectedContent field in response, got: ' + JSON.stringify(parsed);
          } else {
            console.error('[knowledge-test] test 9 PASS — mergeEvidenceOnConflict solution returns mergeFailed:true');
          }
        }
      }
    }

    // ── Test 10: forceNew:true bypasses conflict-detect and writes a distinct entry ──
    // "Hook scripts exit codes" overlaps the seeded "## Hook scripts" heading (would conflict);
    // forceNew:true must write it anyway (escape hatch for false-positive conflicts, bug 1a57df4e).
    if (!failure) {
      const forceRes = await callTool(client, 'forge_add_learning', {
        type: 'gotcha',
        title: 'Hook scripts exit codes',
        content: 'Hooks must exit 0 on success, 2 to block.',
        tags: ['hooks'],
        trigger: 'When writing a hook exit path',
        sourceEvidence: 'knowledge-test.mjs test 10',
        forceNew: true,
      });
      if (forceRes.isError) {
        failure = 'test 10 forceNew: unexpected isError — ' + JSON.stringify(forceRes.content);
      } else {
        const generalMd = readFileSync(join(projectDir, 'docs', 'gotchas', 'GENERAL.md'), 'utf8');
        if (!generalMd.includes('## Hook scripts exit codes')) {
          failure = 'test 10 forceNew: distinct section not written despite forceNew:true';
        } else {
          console.error('[knowledge-test] test 10 PASS — forceNew bypasses conflict-detect');
        }
      }
    }

    // ── Test 11: a plain conflict (no merge, no forceNew) returns rejectedContent (non-lossy) ──
    if (!failure) {
      const plainRes = await callTool(client, 'forge_add_learning', {
        type: 'gotcha',
        title: 'Hook scripts logging',
        content: 'UNIQUE-REJECTED-BODY-12345',
        tags: ['hooks'],
        trigger: 'When logging from a hook',
        sourceEvidence: 'knowledge-test.mjs test 11',
      });
      let parsed = null;
      try {
        const tb = (plainRes.content || []).find(c => c.type === 'text');
        parsed = tb ? JSON.parse(tb.text) : null;
      } catch (_) { /* parsed stays null */ }
      if (!parsed || parsed.conflict !== true) {
        failure = 'test 11: expected conflict:true, got ' + JSON.stringify(parsed);
      } else if (parsed.rejectedContent !== 'UNIQUE-REJECTED-BODY-12345') {
        failure = 'test 11: plain conflict must return rejectedContent (non-lossy), got ' + JSON.stringify(parsed);
      } else {
        console.error('[knowledge-test] test 11 PASS — plain conflict returns rejectedContent');
      }
    }

    // ── Test 12: forceNew:true also bypasses conflict for solutions (symmetry with gotcha) ──
    // "Worker gate poll timeout" solution exists (seeded in test 9) → would conflict.
    if (!failure) {
      const solForce = await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Worker gate poll timeout',
        content: 'A distinct solution forced past the conflict.',
        tags: ['worker', 'gate', 'poll', 'timeout'],
        trigger: 'When forcing a distinct solution',
        sourceEvidence: 'knowledge-test.mjs test 12',
        forceNew: true,
      });
      let parsed = null;
      try { const tb = (solForce.content || []).find(c => c.type === 'text'); parsed = tb ? JSON.parse(tb.text) : null; } catch (_) { /* non-JSON success message is fine */ }
      if (parsed && parsed.conflict === true) {
        failure = 'test 12 forceNew(solution): expected write, got conflict — ' + JSON.stringify(parsed);
      } else {
        console.error('[knowledge-test] test 12 PASS — forceNew bypasses conflict for solutions');
      }
    }

    // ── Test 13: plain solution conflict (no merge, no forceNew) returns rejectedContent ──
    if (!failure) {
      const solPlain = await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Worker gate poll timeout',
        content: 'SOLUTION-REJECTED-BODY-67890',
        tags: ['worker', 'gate', 'poll', 'timeout'],
        trigger: 'When testing solution plain-conflict',
        sourceEvidence: 'knowledge-test.mjs test 13',
      });
      let parsed = null;
      try { const tb = (solPlain.content || []).find(c => c.type === 'text'); parsed = tb ? JSON.parse(tb.text) : null; } catch (_) { /* parsed stays null */ }
      if (!parsed || parsed.conflict !== true) {
        failure = 'test 13: expected conflict:true, got ' + JSON.stringify(parsed);
      } else if (parsed.rejectedContent !== 'SOLUTION-REJECTED-BODY-67890') {
        failure = 'test 13: solution plain conflict must return rejectedContent (non-lossy), got ' + JSON.stringify(parsed);
      } else {
        console.error('[knowledge-test] test 13 PASS — solution plain conflict returns rejectedContent');
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
