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
import { searchConstraints, searchPatterns, appendSolutionDoc } from '../../lib/knowledge-store.js';
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
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ type, title, content, tags }) => {
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

        if (type === 'gotcha') {
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
              `⚠ GENERAL.md is now ${lineCount} lines (threshold: 200). Consider promoting some gotchas to FORGE-REFERENCE.md.`,
            );
          }
          return { content: [{ type: 'text', text: messages.join('\n') }] };
        }

        if (type === 'solution') {
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
          return { content: [{ type: 'text', text: `Solution "${safeTitle}" written to ${result.file} and index updated.` }] };
        }

        // Should never reach here — Zod enum guards type
        return errorResult('forge_add_learning: unknown type');
      } catch (err) {
        return errorResult('forge_add_learning failed: ' + err.message);
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
