import { z } from 'zod';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  resolveProjectDir,
  readJsonSafe,
  writeJsonSafe,
  errorResult,
  textResult,
  requirePipeline,
} from './shared.js';

// -- Helpers (board-domain) ---------------------------------------------------

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

const ALLOWED_CONFIG_KEYS = ['techStacks', 'techStackLabels', 'description', 'testCommand', 'gitIntegration'];

// -- Register function --------------------------------------------------------

/**
 * Registers all 9 board/task/note/config tools on the given MCP server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} _shared - Unused; present for uniform register(server, shared) contract.
 */
export function register(server, _shared) {

  // -- Tool: forge_read_board --------------------------------------------------

  server.registerTool(
    'forge_read_board',
    {
      title: 'FORGE Read Board',
      description: 'Returns tasks from the board\'s todos array, optionally filtered and field-projected. Reads todos only (not the planned array). Use `filter` for the newer/ergonomic path with array-aware priority/tag matching; legacy `status`/`priority`/`tags`/`blocked` fields remain for backward compatibility but are superseded when `filter` is present. Use `fields` to slim each item to a subset of top-level keys.',
      inputSchema: z.object({
        status: z.enum(['open', 'done', 'all']).default('open').describe('Filter by task status (legacy — prefer `filter.done`). Ignored when `filter` is present.'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('Filter by priority, single value (legacy — prefer `filter.priority`, which also accepts arrays). Ignored when `filter` is present.'),
        tags: z.array(z.string()).optional().describe('Filter by tags, AND-logic (legacy — prefer `filter.tag`, which uses match-any). Ignored when `filter` is present.'),
        blocked: z.enum(['blocked', 'unblocked', 'all']).default('all').describe('Filter by blocked state (legacy). Ignored when `filter` is present.'),
        filter: z.object({
          done: z.boolean().optional().describe('Exact boolean match on todo.done.'),
          priority: z.union([
            z.enum(['high', 'medium', 'low']),
            z.array(z.enum(['high', 'medium', 'low'])),
          ]).optional().describe('Match priority — single value or any-of array.'),
          tag: z.union([z.string(), z.array(z.string())]).optional().describe('Tag match — single or array, any-of semantics (matches if the todo has at least one of the listed tags).'),
        }).strict().optional().describe('Structured filter object. Supersedes legacy `status`/`priority`/`tags`/`blocked` when present. Applies `done` → `priority` → `tag`, AND-combined.'),
        fields: z.array(z.string()).optional().describe('Top-level keys to include per returned TODO. Omit for full objects. Keys not present on an item are silently dropped for that item.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ status, priority, tags, blocked, filter, fields }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const boardPath = join(check.pipelineDir, 'board.json');
        const read = readJsonSafe(boardPath);
        if (!read.ok) return errorResult('Failed to read board: ' + read.error);

        let items = read.data.todos || [];

        if (filter) {
          // New path — apply filter.done → filter.priority → filter.tag, AND-combined.
          // Supersedes legacy flat fields so users on the new path get predictable
          // behaviour regardless of the default `status="open"` legacy filter.
          if (typeof filter.done === 'boolean') {
            items = items.filter(item => Boolean(item.done) === filter.done);
          }
          if (filter.priority !== undefined) {
            const allowed = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
            items = items.filter(item => allowed.includes(item.priority));
          }
          if (filter.tag !== undefined) {
            const allowed = Array.isArray(filter.tag) ? filter.tag : [filter.tag];
            items = items.filter(item => {
              const itemTags = item.tags || [];
              return allowed.some(t => itemTags.includes(t));
            });
          }
        } else {
          // Legacy path — preserved verbatim for backward compatibility.
          if (status === 'open') {
            items = items.filter(item => !item.done);
          } else if (status === 'done') {
            items = items.filter(item => item.done);
          }
          if (priority) {
            items = items.filter(item => item.priority === priority);
          }
          if (tags && tags.length > 0) {
            items = items.filter(item => {
              const itemTags = item.tags || [];
              return tags.every(t => itemTags.includes(t));
            });
          }
          if (blocked === 'blocked') {
            items = items.filter(item => (item.blockedBy || []).length > 0);
          } else if (blocked === 'unblocked') {
            items = items.filter(item => (item.blockedBy || []).length === 0);
          }
        }

        // Field projection (orthogonal — runs after whichever filter path applied).
        // Silent key-drop is intentional: requesting a key an item doesn't have
        // is not an error, it just gets omitted from that item.
        if (fields && fields.length > 0) {
          items = items.map(item => {
            const projected = {};
            for (const key of fields) {
              if (Object.prototype.hasOwnProperty.call(item, key)) {
                projected[key] = item[key];
              }
            }
            return projected;
          });
        }

        return textResult(items);
      } catch (err) {
        return errorResult('Failed to read board: ' + err.message);
      }
    }
  );

  // -- Tool: forge_add_todo ----------------------------------------------------

  server.registerTool(
    'forge_add_todo',
    {
      title: 'FORGE Add TODO',
      description: 'Adds a new task to the pipeline board',
      inputSchema: z.object({
        text: z.string().describe('Task description'),
        priority: z.enum(['high', 'medium', 'low']).default('medium').describe('Task priority'),
        tags: z.array(z.string()).default([]).describe('Task tags'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ text, priority, tags }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const boardPath = join(check.pipelineDir, 'board.json');
        const read = readJsonSafe(boardPath);
        if (!read.ok) return errorResult('Failed to read board: ' + read.error);

        const board = read.data;
        if (!board.todos) board.todos = [];

        const { title, summary } = generateTodoTitleAndSummary(text);

        const task = {
          id: randomUUID().slice(0, 8),
          priority,
          text,
          title,
          summary,
          done: false,
          addedAt: Date.now(),
          tags,
        };

        board.todos.push(task);
        writeJsonSafe(boardPath, board);

        return textResult(task);
      } catch (err) {
        return errorResult('Failed to add task: ' + err.message);
      }
    }
  );

  // -- Tool: forge_update_task -------------------------------------------------

  server.registerTool(
    'forge_update_task',
    {
      title: 'FORGE Update Task',
      description: 'Updates an existing task on the pipeline board',
      inputSchema: z.object({
        id: z.string().min(1).max(36).describe('Task ID to update'),
        done: z.boolean().optional().describe('Mark done/undone'),
        text: z.string().optional().describe('New task text'),
        priority: z.enum(['high', 'medium', 'low']).optional().describe('New priority'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, done, text, priority }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const boardPath = join(check.pipelineDir, 'board.json');
        const read = readJsonSafe(boardPath);
        if (!read.ok) return errorResult('Failed to read board: ' + read.error);

        const board = read.data;
        const todos = board.todos || [];
        const planned = board.planned || [];
        const task = todos.find(t => t.id === id) || planned.find(t => t.id === id);

        if (!task) {
          return errorResult('Task not found: ' + id);
        }

        // Mark done — stamp the task in-place so completion history
        // and doneAt are preserved on the board.
        if (done === true && !task.done) {
          task.done = true;
          task.doneAt = new Date().toISOString();
          writeJsonSafe(boardPath, board);
          const remaining = (board.todos || []).filter(t => !t.done);
          const nextTask = remaining.length > 0 ? remaining[0] : null;
          return textResult({
            ...task,
            nextPending: nextTask ? { id: nextTask.id, title: nextTask.title, text: nextTask.text, priority: nextTask.priority } : null,
            pendingCount: remaining.length,
          });
        }

        if (done === false) {
          task.done = false;
          delete task.doneAt;
        }

        // Apply text (regenerate title/summary)
        if (text !== undefined) {
          task.text = text;
          const gen = generateTodoTitleAndSummary(text);
          task.title = gen.title;
          task.summary = gen.summary;
        }

        // Apply priority
        if (priority !== undefined) {
          task.priority = priority;
        }

        writeJsonSafe(boardPath, board);

        return textResult(task);
      } catch (err) {
        return errorResult('Failed to update task: ' + err.message);
      }
    }
  );

  // -- Tool: forge_add_note ----------------------------------------------------

  server.registerTool(
    'forge_add_note',
    {
      title: 'FORGE Add Note',
      description: 'Adds a knowledge note to the notes board — for capturing information, not action items',
      inputSchema: z.object({
        text: z.string().describe('Note content'),
        tags: z.array(z.string()).default([]).describe('Tags for categorisation (e.g. \'salesforce\', \'integration\')'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ text, tags }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const notesPath = join(check.pipelineDir, 'notes.json');
        const read = readJsonSafe(notesPath);
        const store = read.ok ? read.data : { notes: [] };
        if (!store.notes) store.notes = [];

        const note = {
          id: 'n-' + randomUUID().slice(0, 8),
          text,
          tags,
          addedAt: new Date().toISOString(),
        };

        store.notes.push(note);
        writeJsonSafe(notesPath, store);

        return textResult(note);
      } catch (err) {
        return errorResult('Failed to add note: ' + err.message);
      }
    }
  );

  // -- Tool: forge_read_notes --------------------------------------------------

  server.registerTool(
    'forge_read_notes',
    {
      title: 'FORGE Read Notes',
      description: 'Returns knowledge notes, optionally filtered by tag or search term',
      inputSchema: z.object({
        tag: z.union([z.string(), z.array(z.string())]).optional().describe('Filter by tag — single or array, any-of semantics'),
        search: z.string().optional().describe('Case-insensitive substring match on note text'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ tag, search }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const notesPath = join(check.pipelineDir, 'notes.json');
        const read = readJsonSafe(notesPath);
        if (!read.ok) return textResult([]);

        let items = read.data.notes || [];

        if (tag !== undefined) {
          const allowed = Array.isArray(tag) ? tag : [tag];
          items = items.filter(item => {
            const itemTags = item.tags || [];
            return allowed.some(t => itemTags.includes(t));
          });
        }

        if (search !== undefined) {
          const lower = search.toLowerCase();
          items = items.filter(item => item.text.toLowerCase().includes(lower));
        }

        return textResult(items);
      } catch (err) {
        return errorResult('Failed to read notes: ' + err.message);
      }
    }
  );

  // -- Tool: forge_delete_note -------------------------------------------------

  server.registerTool(
    'forge_delete_note',
    {
      title: 'FORGE Delete Note',
      description: 'Deletes a note by ID',
      inputSchema: z.object({
        id: z.string().describe('Note ID to delete'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const notesPath = join(check.pipelineDir, 'notes.json');
        const read = readJsonSafe(notesPath);
        if (!read.ok) return errorResult('Failed to read notes: ' + read.error);

        const store = read.data;
        const before = (store.notes || []).length;
        store.notes = (store.notes || []).filter(n => n.id !== id);

        if (store.notes.length === before) {
          return errorResult('Note not found: ' + id);
        }

        writeJsonSafe(notesPath, store);
        return textResult({ deleted: id });
      } catch (err) {
        return errorResult('Failed to delete note: ' + err.message);
      }
    }
  );

  // -- Tool: forge_read_project ------------------------------------------------

  server.registerTool(
    'forge_read_project',
    {
      title: 'FORGE Read Project',
      description: 'Returns the project configuration',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const configPath = join(check.pipelineDir, 'project.json');
        const read = readJsonSafe(configPath);
        if (!read.ok) return errorResult('Failed to read project.json: ' + read.error);

        return textResult(read.data);
      } catch (err) {
        return errorResult('Failed to read project.json: ' + err.message);
      }
    }
  );

  // -- Tool: forge_update_config -----------------------------------------------

  server.registerTool(
    'forge_update_config',
    {
      title: 'FORGE Update Config',
      description: 'Updates a project configuration field',
      inputSchema: z.object({
        key: z.string().describe('Field name to update'),
        value: z.any().describe('New value'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ key, value }) => {
      try {
        if (!ALLOWED_CONFIG_KEYS.includes(key)) {
          return errorResult('Unknown config key: ' + key + '. Allowed: ' + ALLOWED_CONFIG_KEYS.join(', '));
        }

        // Per-key type validation
        const STRING_KEYS = ['description', 'testCommand'];
        const ARRAY_KEYS = ['techStacks', 'techStackLabels'];
        if (STRING_KEYS.includes(key) && typeof value !== 'string') {
          return errorResult('Invalid type for ' + key + ': expected string, got ' + typeof value);
        }
        if (ARRAY_KEYS.includes(key) && !Array.isArray(value)) {
          return errorResult('Invalid type for ' + key + ': expected array, got ' + typeof value);
        }

        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const configPath = join(check.pipelineDir, 'project.json');
        const read = readJsonSafe(configPath);
        if (!read.ok) return errorResult('Failed to read project.json: ' + read.error);

        const config = read.data;
        config[key] = value;
        writeJsonSafe(configPath, config);

        return textResult(config);
      } catch (err) {
        return errorResult('Failed to update config: ' + err.message);
      }
    }
  );

  // -- Tool: forge_set_blocked_by ----------------------------------------------

  server.registerTool(
    'forge_set_blocked_by',
    {
      title: 'FORGE Set Blocked By',
      description: 'Sets or clears the blockedBy array on a board task. Pass task IDs that block this task, or an empty array to unblock.',
      inputSchema: z.object({
        id: z.string().min(1).max(36).describe('Task ID to update'),
        blockedBy: z.array(z.string()).describe('Array of task IDs that block this task (empty array to clear)'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, blockedBy }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const boardPath = join(check.pipelineDir, 'board.json');
        const read = readJsonSafe(boardPath);
        if (!read.ok) return errorResult('Failed to read board: ' + read.error);

        const board = read.data;
        const allTasks = [...(board.todos || []), ...(board.planned || [])];
        const task = allTasks.find(t => t.id === id);

        if (!task) {
          return errorResult('Task not found: ' + id);
        }

        // Validate that all blockedBy IDs exist
        for (const blockerId of blockedBy) {
          if (!allTasks.find(t => t.id === blockerId)) {
            return errorResult('Blocker task not found: ' + blockerId);
          }
        }

        task.blockedBy = blockedBy;
        writeJsonSafe(boardPath, board);

        return textResult(task);
      } catch (err) {
        return errorResult('forge_set_blocked_by failed: ' + err.message);
      }
    }
  );
}
