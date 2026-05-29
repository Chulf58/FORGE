// @covers mcp/server.js (knowledge tool handlers: forge_get_constraints, forge_get_patterns,
//         forge_add_learning, forge_read_criteria, forge_write_criteria)
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  runIdSchema,
  resolveProjectDir,
  readJsonSafe,
  writeJsonSafe,
  readCriteria,
  writeCriteria,
  errorResult,
  textResult,
  requirePipeline,
} from './shared.js';
import { searchConstraints, searchPatterns, appendSolutionDoc, detectConflict, appendEvidence } from '../../lib/knowledge-store.js';
import { getRun } from '../../../packages/forge-core/src/runs/index.js';

// -- Local helper (mirrors board.js; no cross-module import) -------------------

const TODO_PREFIX_RE = /^(\[?[A-Z]+\]?):\s*/;
const MAX_TITLE_LEN = 36;

function generateTodoTitleAndSummary(text) {
  if (!text || typeof text !== 'string') return { title: '', summary: '' };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: '', summary: '' };

  const firstLine = lines[0];
  const stripped = firstLine.replace(TODO_PREFIX_RE, '');

  let title;
  const periodIdx = stripped.indexOf('. ');
  const colonIdx = stripped.indexOf(': ');
  const dashIdx = stripped.indexOf(' — ');
  const breaks = [periodIdx, colonIdx, dashIdx].filter(i => i > 0 && i <= MAX_TITLE_LEN);
  const bestBreak = breaks.length > 0 ? Math.min(...breaks) : -1;

  if (bestBreak > 0) {
    title = stripped.slice(0, bestBreak);
  } else if (stripped.length <= MAX_TITLE_LEN) {
    title = stripped;
  } else {
    const cutPoint = stripped.lastIndexOf(' ', MAX_TITLE_LEN);
    title = cutPoint > 10 ? stripped.slice(0, cutPoint) : stripped.slice(0, MAX_TITLE_LEN);
  }

  const allText = lines.join(' ');
  const body = allText.replace(TODO_PREFIX_RE, '');

  // Find the next full sentence boundary after the title ends
  const titleEnd = body.indexOf(title.trim());
  const skipTo = titleEnd >= 0 ? titleEnd + title.trim().length : 0;
  const afterTitle = body.slice(skipTo);
  // Jump to the next sentence start — skip partial words/punctuation
  const nextSentence = afterTitle.match(/[.!?]\s+(.*)/s);
  const rest = nextSentence ? nextSentence[1].trim() : afterTitle.replace(/^[^a-zA-Z]*/, '').trim();

  if (!rest) return { title: title.trim(), summary: '' };

  const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  let summary = '';
  for (const s of sentences) {
    const trimmed = s.trim();
    const candidate = summary ? summary + ' ' + trimmed : trimmed;
    if (summary && candidate.length > 160) break;
    summary = candidate;
    if (summary.length >= 80) break;
  }
  if (!summary) summary = rest.slice(0, 160);

  return { title: title.trim(), summary: summary.trim() };
}

// -- Register ------------------------------------------------------------------

export function register(server, _shared) {
  // -- Tool: forge_get_constraints ---------------------------------------------
  server.registerTool(
    'forge_get_constraints',
    {
      title: 'FORGE Get Constraints',
      description:
        'Search docs/gotchas/ for sections matching a keyword. Returns at most 5 matching h2/h3 sections (heading + body). Returns empty array when no matches. Use to look up project-specific gotchas and rules before writing code.',
      inputSchema: z.object({
        keyword: z.string().min(1).describe('Keyword to search for (case-insensitive) in section headings and bodies.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ keyword }) => {
      try {
        const projectDir = resolveProjectDir();
        const results = searchConstraints(projectDir, keyword);
        return textResult(results);
      } catch (err) {
        return errorResult('forge_get_constraints failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_get_patterns ------------------------------------------------
  server.registerTool(
    'forge_get_patterns',
    {
      title: 'FORGE Get Patterns',
      description:
        'Search docs/solutions/index.json for past solution patterns matching a keyword and/or tags. Returns at most 5 matches with title, file path, and a summary (first text paragraph, ≤200 chars). At least one of keyword or tags must be provided.',
      inputSchema: z
        .object({
          keyword: z.string().optional().describe('Keyword to match against entry titles and keywords (case-insensitive).'),
          tags: z.array(z.string()).optional().describe('Tags to match against entry tags (any-of semantics).'),
        })
        .refine(
          (v) => !!(v.keyword || (v.tags && v.tags.length > 0)),
          { message: 'keyword or tags required' },
        ),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ keyword, tags }) => {
      try {
        const projectDir = resolveProjectDir();
        const results = searchPatterns(projectDir, keyword, tags);
        return textResult(results);
      } catch (err) {
        return errorResult('forge_get_patterns failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_add_learning ------------------------------------------------
  server.registerTool(
    'forge_add_learning',
    {
      title: 'FORGE Add Learning',
      description:
        'Persist a new gotcha or solution to the knowledge store. For type "gotcha": appends a new section to docs/gotchas/GENERAL.md. For type "solution": writes a new .md file under docs/solutions/ and updates docs/solutions/index.json.',
      inputSchema: z.object({
        type: z.enum(['gotcha', 'solution']).describe('Learning type: "gotcha" appends to GENERAL.md; "solution" creates a new solution doc and updates index.'),
        title: z.string().min(1).describe('Section heading for gotcha, or document title for solution.'),
        content: z.string().min(1).describe('Body content. For gotcha: markdown prose. For solution: full document body (without frontmatter).'),
        tags: z.array(z.string()).describe('Tags for indexing and future search.'),
        trigger: z.string().min(1).describe('The condition under which this learning applies (e.g. "When deploying to prod"). Required.'),
        sourceEvidence: z.string().min(1).describe('Provenance string — where this was observed (e.g. "run r-XXXX", "GENERAL.md line 47"). Required.'),
        sourceNotes: z.array(z.string()).optional().describe('Optional note IDs from .pipeline/notes.json that this learning entry was derived from. Each ID must exist; dead links are rejected.'),
        mergeEvidenceOnConflict: z.boolean().optional().describe('When true, on conflict-detect the new sourceEvidence is merged into the existing entry instead of returning a conflict signal.'),
        forceNew: z.boolean().optional().describe('When true, bypass conflict-detect entirely and write the new entry even if a near-duplicate is flagged. Use to force a distinct entry after reviewing a (possibly false-positive) conflict.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ type, title, content, tags, trigger, sourceEvidence, sourceNotes, mergeEvidenceOnConflict, forceNew }) => {
      try {
        const projectDir = resolveProjectDir();

        // Sanitize all user-supplied strings before any write
        // title: strip newlines to prevent heading injection
        const safeTitle = title.replace(/[\r\n]/g, ' ').trim();
        // content: strip only control characters (preserve newlines for multi-paragraph)
        // eslint-disable-next-line no-control-regex
        const safeContent = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        // tags: strip newlines from each item
        const safeTags = Array.isArray(tags)
          ? tags.map((t) => String(t).replace(/[\r\n]/g, ' ').trim())
          : [];

        // Quality gate — reject structurally incomplete payloads before any write.
        // Sanitize rejectedContent and sourceEvidence here (not caller-side) so
        // neither can carry unescaped control characters downstream.
        if (!trigger || typeof trigger !== 'string') {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({
              error: 'forge_add_learning: missing required field: trigger',
              rejectedContent: safeContent,
            }) }],
          };
        }
        if (!sourceEvidence || typeof sourceEvidence !== 'string') {
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({
              error: 'forge_add_learning: missing required field: sourceEvidence',
              rejectedContent: safeContent,
            }) }],
          };
        }
        // eslint-disable-next-line no-control-regex
        const safeSourceEvidence = sourceEvidence.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Validate sourceNotes against .pipeline/notes.json when provided
        const check = requirePipeline(projectDir);
        if (sourceNotes && sourceNotes.length > 0) {
          if (!check.ok) {
            return errorResult('forge_add_learning: cannot validate sourceNotes — pipeline not initialised');
          }
          const notesPath = join(check.pipelineDir, 'notes.json');
          const notesRead = readJsonSafe(notesPath);
          const existingNotes = (notesRead.ok && Array.isArray(notesRead.data.notes)) ? notesRead.data.notes : [];
          const validIds = new Set(existingNotes.map(n => n.id));
          for (const noteId of sourceNotes) {
            if (!validIds.has(noteId)) {
              return errorResult('forge_add_learning: unknown sourceNote ID "' + noteId + '" — not found in .pipeline/notes.json');
            }
          }
        }

        if (type === 'gotcha') {
          if (!forceNew) {
            const conflictGotcha = detectConflict(projectDir, { type: 'gotcha', title: safeTitle, tags: safeTags });
            if (conflictGotcha !== null) {
              if (mergeEvidenceOnConflict) {
                const merged = appendEvidence(projectDir, { type: 'gotcha', title: conflictGotcha.title, sourceEvidence: safeSourceEvidence });
                if (merged && merged.merged === true) {
                  return textResult({ merged: true, slug: conflictGotcha.slug, title: conflictGotcha.title });
                }
                // Merge was requested but could not be completed — surface the failure explicitly
                return textResult({ conflict: true, mergeFailed: true, slug: conflictGotcha.slug, title: conflictGotcha.title, rejectedContent: safeContent });
              }
              // Non-lossy: return rejected content + escape-hatch hint so nothing is silently dropped
              return textResult({ conflict: true, slug: conflictGotcha.slug, title: conflictGotcha.title, rejectedContent: safeContent, hint: 'If this is a false-positive conflict, re-call with forceNew:true to write it as a distinct entry.' });
            }
          }

          const generalMdPath = join(projectDir, 'docs', 'gotchas', 'GENERAL.md');
          let existing = '';
          try {
            existing = readFileSync(generalMdPath, 'utf8');
          } catch (err) {
            return errorResult('forge_add_learning: failed to read GENERAL.md — ' + err.message);
          }

          const appendSection = `\n\n## ${safeTitle}\n\n${safeContent}\n`;
          const updated = existing + appendSection;

          const tmpPath = generalMdPath + '.tmp.' + process.pid;
          try {
            writeFileSync(tmpPath, updated, 'utf8');
            renameSync(tmpPath, generalMdPath);
          } catch (err) {
            return errorResult('forge_add_learning: failed to write GENERAL.md — ' + err.message);
          }

          // Cross-write: also index as a solution doc so forge_get_patterns can find gotchas by keyword/tag
          try {
            appendSolutionDoc(projectDir, {
              title: safeTitle,
              content: safeContent,
              tags: ['gotcha', ...safeTags],
            });
          } catch (_) {
            // Non-fatal — GENERAL.md is the primary store
          }

          const lineCount = updated.split('\n').length;
          const messages = [`Gotcha "${safeTitle}" appended to docs/gotchas/GENERAL.md and indexed in docs/solutions/.`];
          if (lineCount > 200) {
            messages.push(
              `⚠ GENERAL.md is now ${lineCount} lines (threshold: 200). Consider splitting topic sections into docs/gotchas/<topic>.md (retrieval-backed) or trimming stale entries via /forge:refresh.`,
            );
          }
          return { content: [{ type: 'text', text: messages.join('\n') }] };
        }

        if (type === 'solution') {
          if (!forceNew) {
            const conflictSolution = detectConflict(projectDir, { type: 'solution', title: safeTitle, tags: safeTags });
            if (conflictSolution !== null) {
              if (mergeEvidenceOnConflict) {
                // solution-merge is not supported by appendEvidence — surface explicitly rather than silently ignoring
                return textResult({ conflict: true, mergeFailed: true, slug: conflictSolution.slug, title: conflictSolution.title, rejectedContent: safeContent });
              }
              // Non-lossy: return rejected content + escape-hatch hint
              return textResult({ conflict: true, slug: conflictSolution.slug, title: conflictSolution.title, rejectedContent: safeContent, hint: 'If this is a false-positive conflict, re-call with forceNew:true to write it as a distinct entry.' });
            }
          }

          let result;
          try {
            result = appendSolutionDoc(projectDir, {
              title: safeTitle,
              content: safeContent,
              tags: safeTags,
            });
          } catch (err) {
            // appendSolutionDoc throws when index update fails (orphaned doc)
            return errorResult('forge_add_learning: ' + err.message);
          }

          // Derive slug from file path for reciprocal write
          const slug = result.file.replace('docs/solutions/', '').replace('.md', '');

          // Write reciprocal knowledgeRefs on each referenced note when sourceNotes provided
          if (sourceNotes && sourceNotes.length > 0 && check.ok) {
            const notesPath = join(check.pipelineDir, 'notes.json');
            const notesRead = readJsonSafe(notesPath);
            if (notesRead.ok && Array.isArray(notesRead.data.notes)) {
              const notesStore = notesRead.data;
              let dirty = false;
              for (const note of notesStore.notes) {
                if (sourceNotes.includes(note.id)) {
                  if (!Array.isArray(note.knowledgeRefs)) note.knowledgeRefs = [];
                  if (!note.knowledgeRefs.includes(slug)) {
                    note.knowledgeRefs.push(slug);
                    dirty = true;
                  }
                }
              }
              if (dirty) {
                writeJsonSafe(notesPath, notesStore);
              }
            }
          }

          return textResult({ file: result.file, slug, title: safeTitle });
        }

        // Should never reach here — Zod enum guards type
        return errorResult('forge_add_learning: unknown type');
      } catch (err) {
        return errorResult('forge_add_learning failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_get_linked --------------------------------------------------
  server.registerTool(
    'forge_get_linked',
    {
      title: 'FORGE Get Linked',
      description:
        'Returns entries linked to the given item on the opposite side of the knowledge ↔ notes link. For kind="note": given a note ID, returns solution index entries whose sourceNotes include that ID. For kind="knowledge": given a solution slug, returns notes whose knowledgeRefs include that slug.',
      inputSchema: z.object({
        kind: z.enum(['note', 'knowledge']).describe('"note" to look up linked knowledge entries for a note; "knowledge" to look up linked notes for a solution slug.'),
        id: z.string().min(1).describe('The note ID (e.g. "n-abc12345") when kind="note", or the solution slug (e.g. "my-solution") when kind="knowledge".'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ kind, id }) => {
      try {
        const projectDir = resolveProjectDir();

        if (kind === 'note') {
          // Return solution index entries whose sourceNotes include this note ID
          const indexPath = join(projectDir, 'docs', 'solutions', 'index.json');
          const indexRead = readJsonSafe(indexPath);
          if (!indexRead.ok || !Array.isArray(indexRead.data)) return textResult([]);
          const linked = indexRead.data.filter(
            e => Array.isArray(e.sourceNotes) && e.sourceNotes.includes(id),
          );
          return textResult(linked);
        }

        if (kind === 'knowledge') {
          // Return notes whose knowledgeRefs include this slug
          const check = requirePipeline(projectDir);
          if (!check.ok) return textResult([]);
          const notesPath = join(check.pipelineDir, 'notes.json');
          const notesRead = readJsonSafe(notesPath);
          if (!notesRead.ok || !Array.isArray(notesRead.data.notes)) return textResult([]);
          const linked = notesRead.data.notes.filter(
            n => Array.isArray(n.knowledgeRefs) && n.knowledgeRefs.includes(id),
          );
          return textResult(linked);
        }

        // Zod enum guards kind — should never reach here
        return errorResult('forge_get_linked: unknown kind');
      } catch (err) {
        return errorResult('forge_get_linked failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_read_criteria -----------------------------------------------
  server.registerTool(
    'forge_read_criteria',
    {
      title: 'FORGE Read Criteria',
      description: 'Returns the per-criterion acceptance tracking data for a run. Returns an empty criteria array if the file does not exist yet.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID (e.g. r-a1b2c3d4)'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId }) => {
      try {
        if (!runId) return errorResult('runId is required');
        const projectDir = resolveProjectDir();
        const runDirectory = join(projectDir, '.pipeline', 'runs', runId);
        if (!existsSync(runDirectory)) {
          return errorResult('Run not found: ' + runId);
        }
        const data = readCriteria(runDirectory);
        return textResult({ criteria: data.criteria });
      } catch (err) {
        return errorResult('forge_read_criteria failed: ' + err.message);
      }
    },
  );

  // -- Tool: forge_write_criteria ----------------------------------------------
  server.registerTool(
    'forge_write_criteria',
    {
      title: 'FORGE Write Criteria',
      description: 'Writes per-criterion acceptance tracking data for a run. Overwrites the full criteria array.',
      inputSchema: z.object({
        runId: runIdSchema.describe('Run ID (e.g. r-a1b2c3d4)'),
        criteria: z.array(z.object({
          id: z.string(),
          task: z.string().optional(),
          text: z.string(),
          status: z.string(),
          reviewer: z.string().optional(),
          reason: z.string().optional(),
        })).describe('Full criteria array to persist'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ runId, criteria }) => {
      try {
        if (!runId) return errorResult('runId is required');
        const projectDir = resolveProjectDir();
        const runDirectory = join(projectDir, '.pipeline', 'runs', runId);
        if (!existsSync(runDirectory)) {
          return errorResult('Run not found: ' + runId);
        }
        writeCriteria(runDirectory, { criteria });

        // Create board TODOs for deferred criteria (task 8)
        const deferred = criteria.filter(c => c.status === 'deferred');
        if (deferred.length > 0) {
          const check = requirePipeline(projectDir);
          if (check.ok) {
            const boardPath = join(check.pipelineDir, 'board.json');
            const boardRead = readJsonSafe(boardPath);
            if (boardRead.ok) {
              const board = boardRead.data;
              if (!board.todos) board.todos = [];

              // Resolve feature name from run registry for TODO text
              let featureName = '';
              try {
                const run = getRun(projectDir, runId);
                if (run && run.feature) featureName = run.feature;
              } catch (_) {
                // feature name is optional — continue without it
              }

              let added = 0;
              for (const c of deferred) {
                const todoText = featureName
                  ? `[deferred ${c.id}] ${c.text} (feature: ${featureName})`
                  : `[deferred ${c.id}] ${c.text}`;

                // Duplicate detection: skip if a TODO with same AC-ID tag already exists
                const alreadyExists = board.todos.some(t =>
                  Array.isArray(t.tags) && t.tags.includes('deferred-criterion') &&
                  t.text && t.text.includes(`[deferred ${c.id}]`)
                );
                if (alreadyExists) continue;

                const { title, summary } = generateTodoTitleAndSummary(todoText);
                board.todos.push({
                  id: randomUUID().slice(0, 8),
                  priority: 'medium',
                  text: todoText,
                  title,
                  summary,
                  done: false,
                  addedAt: Date.now(),
                  tags: ['deferred-criterion'],
                });
                added++;
              }

              if (added > 0) {
                writeJsonSafe(boardPath, board);
              }
            }
          }
        }

        return textResult({ ok: true, written: criteria.length });
      } catch (err) {
        return errorResult('forge_write_criteria failed: ' + err.message);
      }
    },
  );
}
