// @covers mcp/lib/tools/board.js + mcp/lib/tools/knowledge.js (bidirectional linking)
// Tests for the knowledge-link feature: knowledgeRefs on notes, sourceNotes on learning,
// reciprocal mirroring, and forge_get_linked discovery.
//
// This test harness covers all 6 AC scenarios:
//   1. link-via-add-note: note with knowledgeRefs gains link
//   2. link-via-add-learning: learning with sourceNotes gains link
//   3. reciprocal mirror: both sides exist after either add
//   4. link discovery via forge_get_linked
//   5. back-compat for unlinked entries
//   6. dead-link rejection
//
// Run: node mcp/knowledge-link-test.mjs
// Auto-discovered by scripts/run-tests.mjs via *-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname = <worktreeRoot>/mcp; one level up = worktree root
const mainPluginRoot = resolve(__dirname, '..');
// Point at this worktree's mcp/server.js so changes under test are exercised
const SERVER_PATH = resolve(__dirname, 'server.js');

function fail(msg) {
  console.error('[knowledge-link-test] FAIL: ' + msg);
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
  // Seed docs structure
  mkdirSync(join(projectDir, 'docs', 'gotchas'), { recursive: true });
  writeFileSync(
    join(projectDir, 'docs', 'gotchas', 'GENERAL.md'),
    '# GENERAL\n\n## Hook scripts\n\nUse stderr for user-visible messages.\n',
  );
  mkdirSync(join(projectDir, 'docs', 'solutions'), { recursive: true });
  writeFileSync(
    join(projectDir, 'docs', 'solutions', 'index.json'),
    JSON.stringify([]),
  );
  mkdirSync(join(projectDir, '.pipeline'), { recursive: true });
  writeFileSync(
    join(projectDir, '.pipeline', 'board.json'),
    JSON.stringify({ todos: [], planned: [] }),
  );
  writeFileSync(
    join(projectDir, '.pipeline', 'notes.json'),
    JSON.stringify({ notes: [] }),
  );
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-link-test-'));
  seed(projectDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, NODE_PATH: resolve(mainPluginRoot, 'mcp/node_modules') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-knowledge-link-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;
  const testResults = [];

  function recordTest(label, passed) {
    testResults.push({ label, passed });
    const status = passed ? 'PASS' : 'FAIL';
    console.error(`[knowledge-link-test] ${label}: ${status}`);
  }

  try {
    await client.connect(transport);

    // ──────────────────────────────────────────────────────────────────────────
    // Setup: Create a solution doc that notes can link to
    // ──────────────────────────────────────────────────────────────────────────
    const solutionResult = parseToolResult(
      await callTool(client, 'forge_add_learning', {
        type: 'solution',
        title: 'Test Solution Pattern',
        content: 'This is a test solution for linking validation.',
        tags: ['test', 'pattern'],
        trigger: 'When testing knowledge link validation',
        sourceEvidence: 'knowledge-link-test.mjs setup',
      }),
    );
    console.error('[knowledge-link-test] Setup: created solution doc');

    // The slug is derived from title: "Test Solution Pattern" → "test-solution-pattern"
    const expectedSlug = 'test-solution-pattern';

    // ──────────────────────────────────────────────────────────────────────────
    // AC-1: link-via-add-note
    // WHEN a note is added with knowledgeRefs pointing to an existing solution slug,
    // THEN the note object returned should include knowledgeRefs array
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        const noteResult = parseToolResult(
          await callTool(client, 'forge_add_note', {
            text: 'Note linked to solution',
            tags: ['linked'],
            knowledgeRefs: [expectedSlug],
          }),
        );

        // Verify the returned note has knowledgeRefs
        if (!Array.isArray(noteResult.knowledgeRefs)) {
          failure = 'link-via-add-note: returned note missing knowledgeRefs array';
          recordTest('link-via-add-note', false);
        } else if (!noteResult.knowledgeRefs.includes(expectedSlug)) {
          failure = 'link-via-add-note: returned note.knowledgeRefs does not contain slug';
          recordTest('link-via-add-note', false);
        } else {
          recordTest('link-via-add-note', true);
        }
      } catch (err) {
        failure = 'link-via-add-note: ' + (err && err.message);
        recordTest('link-via-add-note', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-2: dead-link rejection via add-note
    // WHEN a note is added with knowledgeRefs containing a slug that does NOT exist
    // in docs/solutions/index.json, THEN the tool returns isError: true
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        const deadLinkResult = await callTool(client, 'forge_add_note', {
          text: 'Note with dead link',
          tags: [],
          knowledgeRefs: ['nonexistent-slug'],
        });

        if (!deadLinkResult.isError) {
          failure = 'dead-link rejection via add-note: expected isError: true';
          recordTest('dead-link rejection via add-note', false);
        } else {
          recordTest('dead-link rejection via add-note', true);
        }
      } catch (err) {
        failure = 'dead-link rejection via add-note: ' + (err && err.message);
        recordTest('dead-link rejection via add-note', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-3: dead-link rejection via add-learning
    // WHEN a learning entry is added with sourceNotes containing a note ID
    // that does NOT exist in .pipeline/notes.json, THEN the tool returns isError: true
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        const deadLinkLearning = await callTool(client, 'forge_add_learning', {
          type: 'solution',
          title: 'Solution with dead note link',
          content: 'This solution references a note that does not exist.',
          tags: ['test'],
          sourceNotes: ['n-nonexistent'],
          trigger: 'When testing dead note link rejection',
          sourceEvidence: 'knowledge-link-test.mjs AC-3',
        });

        if (!deadLinkLearning.isError) {
          failure = 'dead-link rejection via add-learning: expected isError: true';
          recordTest('dead-link rejection via add-learning', false);
        } else {
          recordTest('dead-link rejection via add-learning', true);
        }
      } catch (err) {
        failure = 'dead-link rejection via add-learning: ' + (err && err.message);
        recordTest('dead-link rejection via add-learning', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-4: reciprocal mirror from add-note
    // WHEN a note with knowledgeRefs is added, THEN the solution index entry
    // should gain a sourceNotes array containing the new note's ID
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        // Add a note with knowledgeRefs
        const linkedNote = parseToolResult(
          await callTool(client, 'forge_add_note', {
            text: 'Another note linked to solution',
            tags: [],
            knowledgeRefs: [expectedSlug],
          }),
        );
        const noteId = linkedNote.id;

        // Read the index to verify reciprocal link
        const indexContent = readFileSync(
          join(projectDir, 'docs', 'solutions', 'index.json'),
          'utf8'
        );
        const indexData = JSON.parse(indexContent);
        const solutionEntry = indexData.find(e => {
          const slug = e.file.replace('docs/solutions/', '').replace('.md', '');
          return slug === expectedSlug;
        });

        if (!solutionEntry) {
          failure = 'reciprocal mirror from add-note: solution entry not found in index';
          recordTest('reciprocal mirror from add-note', false);
        } else if (!Array.isArray(solutionEntry.sourceNotes)) {
          failure = 'reciprocal mirror from add-note: solution entry missing sourceNotes array';
          recordTest('reciprocal mirror from add-note', false);
        } else if (!solutionEntry.sourceNotes.includes(noteId)) {
          failure = 'reciprocal mirror from add-note: sourceNotes does not contain note ID';
          recordTest('reciprocal mirror from add-note', false);
        } else {
          recordTest('reciprocal mirror from add-note', true);
        }
      } catch (err) {
        failure = 'reciprocal mirror from add-note: ' + (err && err.message);
        recordTest('reciprocal mirror from add-note', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-5: reciprocal mirror from add-learning
    // WHEN a learning entry with sourceNotes is added, THEN the referenced note
    // should gain a knowledgeRefs array containing the new solution's slug
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        // First, add a note to reference
        const noteForBackref = parseToolResult(
          await callTool(client, 'forge_add_note', {
            text: 'Note to be referenced by learning',
            tags: [],
          }),
        );
        const noteId = noteForBackref.id;

        // Now add a learning entry with sourceNotes pointing to that note
        const learningWithSourceNotes = parseToolResult(
          await callTool(client, 'forge_add_learning', {
            type: 'solution',
            title: 'Solution referenced by note',
            content: 'This solution references the note above.',
            tags: ['test'],
            sourceNotes: [noteId],
            trigger: 'When testing reciprocal note-to-knowledge links',
            sourceEvidence: 'knowledge-link-test.mjs AC-5',
          }),
        );

        // Derive the slug from the title (same logic as appendSolutionDoc)
        const learningSlug = 'solution-referenced-by-note';

        // Read the note from .pipeline/notes.json to verify reciprocal link
        const notesContent = readFileSync(
          join(projectDir, '.pipeline', 'notes.json'),
          'utf8'
        );
        const notesData = JSON.parse(notesContent);
        const updatedNote = notesData.notes.find(n => n.id === noteId);

        if (!updatedNote) {
          failure = 'reciprocal mirror from add-learning: note not found';
          recordTest('reciprocal mirror from add-learning', false);
        } else if (!Array.isArray(updatedNote.knowledgeRefs)) {
          failure = 'reciprocal mirror from add-learning: note missing knowledgeRefs array';
          recordTest('reciprocal mirror from add-learning', false);
        } else if (!updatedNote.knowledgeRefs.includes(learningSlug)) {
          failure = 'reciprocal mirror from add-learning: knowledgeRefs does not contain slug';
          recordTest('reciprocal mirror from add-learning', false);
        } else {
          recordTest('reciprocal mirror from add-learning', true);
        }
      } catch (err) {
        failure = 'reciprocal mirror from add-learning: ' + (err && err.message);
        recordTest('reciprocal mirror from add-learning', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-6: link discovery via forge_get_linked (note side)
    // WHEN forge_get_linked is called with kind="note" and a note ID that has
    // knowledgeRefs, THEN it returns the matching knowledge entries
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        // Get a note with knowledgeRefs
        const allNotes = parseToolResult(
          await callTool(client, 'forge_read_notes', {})
        );
        const linkedNote = allNotes.find(n => Array.isArray(n.knowledgeRefs) && n.knowledgeRefs.length > 0);

        if (!linkedNote) {
          failure = 'link discovery via forge_get_linked (note side): no linked note found in setup';
          recordTest('link discovery via forge_get_linked (note side)', false);
        } else {
          // Call forge_get_linked
          const linkedResult = await callTool(client, 'forge_get_linked', {
            kind: 'note',
            id: linkedNote.id,
          });

          if (linkedResult.isError) {
            failure = 'link discovery via forge_get_linked (note side): tool returned error';
            recordTest('link discovery via forge_get_linked (note side)', false);
          } else {
            const linkedEntries = parseToolResult(linkedResult);
            if (!Array.isArray(linkedEntries)) {
              failure = 'link discovery via forge_get_linked (note side): expected array result';
              recordTest('link discovery via forge_get_linked (note side)', false);
            } else if (linkedEntries.length === 0) {
              failure = 'link discovery via forge_get_linked (note side): returned empty array';
              recordTest('link discovery via forge_get_linked (note side)', false);
            } else {
              // Verify the returned entries match the knowledgeRefs
              const returnedSlugs = linkedEntries.map(e => {
                const slug = e.file.replace('docs/solutions/', '').replace('.md', '');
                return slug;
              });
              const allMatch = linkedNote.knowledgeRefs.every(ref => returnedSlugs.includes(ref));
              if (!allMatch) {
                failure = 'link discovery via forge_get_linked (note side): returned entries do not match knowledgeRefs';
                recordTest('link discovery via forge_get_linked (note side)', false);
              } else {
                recordTest('link discovery via forge_get_linked (note side)', true);
              }
            }
          }
        }
      } catch (err) {
        failure = 'link discovery via forge_get_linked (note side): ' + (err && err.message);
        recordTest('link discovery via forge_get_linked (note side)', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-6b: link discovery via forge_get_linked (knowledge side)
    // WHEN forge_get_linked is called with kind="knowledge" and a solution slug
    // that has sourceNotes, THEN it returns the matching note objects
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        // Read the index to find a solution with sourceNotes
        const indexContent = readFileSync(
          join(projectDir, 'docs', 'solutions', 'index.json'),
          'utf8'
        );
        const indexData = JSON.parse(indexContent);
        const linkedSolution = indexData.find(e => Array.isArray(e.sourceNotes) && e.sourceNotes.length > 0);

        if (!linkedSolution) {
          failure = 'link discovery via forge_get_linked (knowledge side): no linked solution found in setup';
          recordTest('link discovery via forge_get_linked (knowledge side)', false);
        } else {
          const solutionSlug = linkedSolution.file.replace('docs/solutions/', '').replace('.md', '');

          // Call forge_get_linked
          const linkedResult = await callTool(client, 'forge_get_linked', {
            kind: 'knowledge',
            id: solutionSlug,
          });

          if (linkedResult.isError) {
            failure = 'link discovery via forge_get_linked (knowledge side): tool returned error';
            recordTest('link discovery via forge_get_linked (knowledge side)', false);
          } else {
            const linkedNotes = parseToolResult(linkedResult);
            if (!Array.isArray(linkedNotes)) {
              failure = 'link discovery via forge_get_linked (knowledge side): expected array result';
              recordTest('link discovery via forge_get_linked (knowledge side)', false);
            } else if (linkedNotes.length === 0) {
              failure = 'link discovery via forge_get_linked (knowledge side): returned empty array';
              recordTest('link discovery via forge_get_linked (knowledge side)', false);
            } else {
              // Verify the returned notes have IDs matching sourceNotes
              const returnedIds = linkedNotes.map(n => n.id);
              const allMatch = linkedSolution.sourceNotes.every(noteId => returnedIds.includes(noteId));
              if (!allMatch) {
                failure = 'link discovery via forge_get_linked (knowledge side): returned notes do not match sourceNotes';
                recordTest('link discovery via forge_get_linked (knowledge side)', false);
              } else {
                recordTest('link discovery via forge_get_linked (knowledge side)', true);
              }
            }
          }
        }
      } catch (err) {
        failure = 'link discovery via forge_get_linked (knowledge side): ' + (err && err.message);
        recordTest('link discovery via forge_get_linked (knowledge side)', false);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // AC-7: back-compat for unlinked entries
    // WHEN forge_read_notes and forge_get_patterns are called against entries
    // without link fields, THEN they return the entries with no error and
    // without injected link fields
    // ──────────────────────────────────────────────────────────────────────────
    if (!failure) {
      try {
        // Add a note without knowledgeRefs
        const plainNote = parseToolResult(
          await callTool(client, 'forge_add_note', {
            text: 'Plain note without links',
            tags: [],
          }),
        );

        // Read all notes
        const allNotes = parseToolResult(
          await callTool(client, 'forge_read_notes', {})
        );

        // Find the plain note and check it doesn't have knowledgeRefs injected
        const retrieved = allNotes.find(n => n.id === plainNote.id);
        if (!retrieved) {
          failure = 'back-compat for unlinked entries: note not found in read results';
          recordTest('back-compat for unlinked entries', false);
        } else if (retrieved.hasOwnProperty('knowledgeRefs') && retrieved.knowledgeRefs !== undefined) {
          // If the field exists, it should be undefined or absent (not an empty array injected)
          if (Array.isArray(retrieved.knowledgeRefs) && retrieved.knowledgeRefs.length === 0) {
            failure = 'back-compat for unlinked entries: empty knowledgeRefs array was injected';
            recordTest('back-compat for unlinked entries', false);
          } else {
            recordTest('back-compat for unlinked entries', true);
          }
        } else {
          // Field is absent — this is the expected back-compat behavior
          recordTest('back-compat for unlinked entries', true);
        }
      } catch (err) {
        failure = 'back-compat for unlinked entries: ' + (err && err.message);
        recordTest('back-compat for unlinked entries', false);
      }
    }

    // Summary
    if (!failure) {
      console.error('[knowledge-link-test] All tests completed');
      const passed = testResults.filter(t => t.passed).length;
      const total = testResults.length;
      console.error(`[knowledge-link-test] ${passed}/${total} tests passed`);

      // Check if any failed
      const failedTests = testResults.filter(t => !t.passed);
      if (failedTests.length > 0) {
        failure = failedTests.map(t => t.label).join('; ') + ' — expected to FAIL (implementation not yet done)';
      }
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
  console.error('[knowledge-link-test] unexpected throw:', err);
  process.exit(1);
});
