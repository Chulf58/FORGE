import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync, rmSync, openSync, closeSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readForgeConfig, writeForgeConfig, resolvePluginDataDir } from "./lib/config-store.js";
import { readUsage, writeUsage, markQuotaExhausted, markModelQuotaExhausted, recordUsage } from "./lib/usage-store.js";
import { recommendModel } from "./lib/router.js";
import { callOpenAI } from "./lib/openai-adapter.js";
import { callGemini } from "./lib/gemini-adapter.js";
import { addModelToConfig, updateModelInConfig } from "./lib/model-validation.js";
import { createRun, getRun, listRuns, updateRun, createWorktree, removeWorktree, rebuildIndex, getRunActivePath, writeRunActive } from "../packages/forge-core/src/runs/index.js";
import { buildDashboardState } from "./lib/dashboard-state.js";
import { sanitizeFeatureName } from "./lib/sanitize.js";
import { searchConstraints, searchPatterns, appendSolutionDoc } from "./lib/knowledge-store.js";
import { workerLogPath, killPillPath } from "./lib/worker-paths.js";
import { sweepStalePids } from "./lib/worker-pids.js";

// -- Shared Zod schemas ------------------------------------------------------

// Run IDs are generated as "r-" followed by alphanumeric characters (e.g. r-d1afe1f3).
// Constraining at the Zod schema level means traversal/injection values are
// rejected at the MCP boundary before reaching any path.join or run lookup.
const runIdSchema = z.string().regex(
  /^r-[a-zA-Z0-9]+$/,
  'runId must match r-<alnum> format (e.g. r-a1b2c3d4)'
);

// forge_resume_run accepts bare suffix without the "r-" prefix (auto-added by handler).
// The constraint still blocks traversal and injection — only relaxes the prefix requirement.
const runIdOrBareSchema = z.string().regex(
  /^(r-)?[a-zA-Z0-9]+$/,
  'runId must be r-<alnum> or bare <alnum> suffix (e.g. r-a1b2c3d4 or a1b2c3d4)'
);

// -- Helpers -----------------------------------------------------------------

/**
 * Returns the MAIN project root, even when this MCP server is running inside
 * a worktree (e.g. spawned by a worker via mcp/forge-worker.mjs:307 with
 * cwd=worktree path).
 *
 * Why: all run-state operations (forge_update_run, forge_get_run,
 * forge_create_run, forge_advance_stage, etc.) operate on
 * <projectRoot>/.pipeline/runs/<runId>/run.json. That file MUST live in main's
 * .pipeline/, not worktree's, so the conductor and worker see the same state.
 * Without this resolution, worker writes go to <worktree>/.pipeline/runs/...
 * (because createWorktree's copyDirSync seeded the worktree with a snapshot of
 * .pipeline/) and main's stays stale — observed in r-61c6a00a where the worker
 * wrote gate-pending state to its worktree's run.json but the conductor read
 * main's empty one.
 *
 * Worktree-local needs (gate-pending.json, reset-pill) are handled by
 * runId-aware lookups (forge_check_gate uses run.worktreePath) or explicit
 * path helpers in mcp/lib/worker-paths.js — not by this resolver.
 *
 * The conductor's MCP server doesn't run inside a worktree, so the gitdir
 * check is a no-op for it and behavior is unchanged.
 */
function resolveProjectDir() {
  const cwdOrEnv = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const gitFile = join(cwdOrEnv, ".git");
  try {
    const content = readFileSync(gitFile, "utf8").trim();
    if (content.startsWith("gitdir:")) {
      const gitdir = content.replace("gitdir:", "").trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return resolve(match[1]);
      console.error("[forge-mcp] .git gitdir present but worktree pattern did not match: " + gitdir);
    }
  } catch (err) {
    if (err.code !== "EISDIR" && err.code !== "ENOENT") {
      console.error("[forge-mcp] .git read failed: " + err.message);
    }
  }
  return cwdOrEnv;
}

// Alias retained for callers that want to be explicit about wanting main's
// project root. Returns the same value as resolveProjectDir() now.
function resolveMainProjectDir() {
  return resolveProjectDir();
}

function readJsonSafe(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Atomic write via temp-file-rename to prevent partial reads by concurrent sessions.
function writeJsonSafe(filePath, data) {
  const tmp = filePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  renameSync(tmp, filePath);
}

function readCriteria(runDir) {
  const criteriaPath = join(runDir, 'criteria.json');
  try {
    return JSON.parse(readFileSync(criteriaPath, 'utf8'));
  } catch {
    return { criteria: [] };
  }
}

function writeCriteria(runDir, data) {
  const criteriaPath = join(runDir, 'criteria.json');
  writeJsonSafe(criteriaPath, data);
}

function errorResult(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}

function textResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function requirePipeline(projectDir) {
  const pipelineDir = join(projectDir, ".pipeline");
  if (!existsSync(pipelineDir)) {
    return { ok: false, result: errorResult("Project not initialized \u2014 run /forge:init first") };
  }
  return { ok: true, pipelineDir };
}

function hasGateApprovalToken(projectDir) {
  try {
    const tokenPath = join(projectDir, ".pipeline", "action-approved.json");
    const raw = readFileSync(tokenPath, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions) || !data.expiresAt) return false;
    const expiresAt = new Date(data.expiresAt);
    if (isNaN(expiresAt.getTime()) || expiresAt < new Date()) return false;
    return data.actions.includes("gate-approve");
  } catch (_) {
    return false;
  }
}

// Case-insensitive on Windows; absolute-path equality after slash normalization.
// Used by forge_resume_run to verify the run's projectRoot matches the current project.
function pathsEqual(a, b) {
  const A = resolve(a).replace(/\\/g, "/");
  const B = resolve(b).replace(/\\/g, "/");
  return process.platform === "win32" ? A.toLowerCase() === B.toLowerCase() : A === B;
}

// Returns the full path of the first worker-task-<runId>.json found under
// dir/.pipeline/, or null if none exists. Used by recursive-spawn guards.
function findWorkerTaskFile(dir) {
  const pipelineDir = join(dir, ".pipeline");
  try {
    const entries = readdirSync(pipelineDir);
    const match = entries.find((e) => /^worker-task-.+\.json$/.test(e));
    return match ? join(pipelineDir, match) : null;
  } catch {
    return null;
  }
}

// -- Server ------------------------------------------------------------------

const server = new McpServer({
  name: "forge-mcp-server",
  version: "1.0.0"
});

// -- Tool: forge_read_board --------------------------------------------------

server.registerTool(
  "forge_read_board",
  {
    title: "FORGE Read Board",
    description: "Returns tasks from the board's todos array, optionally filtered and field-projected. Reads todos only (not the planned array). Use `filter` for the newer/ergonomic path with array-aware priority/tag matching; legacy `status`/`priority`/`tags`/`blocked` fields remain for backward compatibility but are superseded when `filter` is present. Use `fields` to slim each item to a subset of top-level keys.",
    inputSchema: z.object({
      status: z.enum(["open", "done", "all"]).default("open").describe("Filter by task status (legacy — prefer `filter.done`). Ignored when `filter` is present."),
      priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority, single value (legacy — prefer `filter.priority`, which also accepts arrays). Ignored when `filter` is present."),
      tags: z.array(z.string()).optional().describe("Filter by tags, AND-logic (legacy — prefer `filter.tag`, which uses match-any). Ignored when `filter` is present."),
      blocked: z.enum(["blocked", "unblocked", "all"]).default("all").describe("Filter by blocked state (legacy). Ignored when `filter` is present."),
      filter: z.object({
        done: z.boolean().optional().describe("Exact boolean match on todo.done."),
        priority: z.union([
          z.enum(["high", "medium", "low"]),
          z.array(z.enum(["high", "medium", "low"]))
        ]).optional().describe("Match priority — single value or any-of array."),
        tag: z.union([z.string(), z.array(z.string())]).optional().describe("Tag match — single or array, any-of semantics (matches if the todo has at least one of the listed tags).")
      }).strict().optional().describe("Structured filter object. Supersedes legacy `status`/`priority`/`tags`/`blocked` when present. Applies `done` → `priority` → `tag`, AND-combined."),
      fields: z.array(z.string()).optional().describe("Top-level keys to include per returned TODO. Omit for full objects. Keys not present on an item are silently dropped for that item.")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async ({ status, priority, tags, blocked, filter, fields }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

      let items = read.data.todos || [];

      if (filter) {
        // New path — apply filter.done → filter.priority → filter.tag, AND-combined.
        // Supersedes legacy flat fields so users on the new path get predictable
        // behaviour regardless of the default `status="open"` legacy filter.
        if (typeof filter.done === "boolean") {
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
        if (status === "open") {
          items = items.filter(item => !item.done);
        } else if (status === "done") {
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
        if (blocked === "blocked") {
          items = items.filter(item => (item.blockedBy || []).length > 0);
        } else if (blocked === "unblocked") {
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
      return errorResult("Failed to read board: " + err.message);
    }
  }
);

// -- Tool: forge_add_todo ----------------------------------------------------

const TODO_PREFIX_RE = /^(\[?[A-Z]+\]?):\s*/;
const MAX_TITLE_LEN = 36;

function generateTodoTitleAndSummary(text) {
  if (!text || typeof text !== "string") return { title: "", summary: "" };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { title: "", summary: "" };

  const firstLine = lines[0];
  const stripped = firstLine.replace(TODO_PREFIX_RE, "");

  let title;
  const periodIdx = stripped.indexOf(". ");
  const colonIdx = stripped.indexOf(": ");
  const dashIdx = stripped.indexOf(" — ");
  const breaks = [periodIdx, colonIdx, dashIdx].filter(i => i > 0 && i <= MAX_TITLE_LEN);
  const bestBreak = breaks.length > 0 ? Math.min(...breaks) : -1;

  if (bestBreak > 0) {
    title = stripped.slice(0, bestBreak);
  } else if (stripped.length <= MAX_TITLE_LEN) {
    title = stripped;
  } else {
    const cutPoint = stripped.lastIndexOf(" ", MAX_TITLE_LEN);
    title = cutPoint > 10 ? stripped.slice(0, cutPoint) : stripped.slice(0, MAX_TITLE_LEN);
  }

  const allText = lines.join(" ");
  const body = allText.replace(TODO_PREFIX_RE, "");

  // Find the next full sentence boundary after the title ends
  const titleEnd = body.indexOf(title.trim());
  const skipTo = titleEnd >= 0 ? titleEnd + title.trim().length : 0;
  const afterTitle = body.slice(skipTo);
  // Jump to the next sentence start — skip partial words/punctuation
  const nextSentence = afterTitle.match(/[.!?]\s+(.*)/s);
  const rest = nextSentence ? nextSentence[1].trim() : afterTitle.replace(/^[^a-zA-Z]*/, "").trim();

  if (!rest) return { title: title.trim(), summary: "" };

  const sentences = rest.split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  let summary = "";
  for (const s of sentences) {
    const trimmed = s.trim();
    const candidate = summary ? summary + " " + trimmed : trimmed;
    if (summary && candidate.length > 160) break;
    summary = candidate;
    if (summary.length >= 80) break;
  }
  if (!summary) summary = rest.slice(0, 160);

  return { title: title.trim(), summary: summary.trim() };
}

server.registerTool(
  "forge_add_todo",
  {
    title: "FORGE Add TODO",
    description: "Adds a new task to the pipeline board",
    inputSchema: z.object({
      text: z.string().describe("Task description"),
      priority: z.enum(["high", "medium", "low"]).default("medium").describe("Task priority"),
      tags: z.array(z.string()).default([]).describe("Task tags")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  async ({ text, priority, tags }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

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
        tags
      };

      board.todos.push(task);
      writeJsonSafe(boardPath, board);

      return textResult(task);
    } catch (err) {
      return errorResult("Failed to add task: " + err.message);
    }
  }
);

// -- Tool: forge_update_task -------------------------------------------------

server.registerTool(
  "forge_update_task",
  {
    title: "FORGE Update Task",
    description: "Updates an existing task on the pipeline board",
    inputSchema: z.object({
      id: z.string().min(1).max(36).describe("Task ID to update"),
      done: z.boolean().optional().describe("Mark done/undone"),
      text: z.string().optional().describe("New task text"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("New priority")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ id, done, text, priority }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

      const board = read.data;
      const todos = board.todos || [];
      const planned = board.planned || [];
      const task = todos.find(t => t.id === id) || planned.find(t => t.id === id);

      if (!task) {
        return errorResult("Task not found: " + id);
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
      return errorResult("Failed to update task: " + err.message);
    }
  }
);

// -- Tool: forge_add_note ----------------------------------------------------

server.registerTool(
  "forge_add_note",
  {
    title: "FORGE Add Note",
    description: "Adds a knowledge note to the notes board — for capturing information, not action items",
    inputSchema: z.object({
      text: z.string().describe("Note content"),
      tags: z.array(z.string()).default([]).describe("Tags for categorisation (e.g. 'salesforce', 'integration')")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  async ({ text, tags }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const notesPath = join(check.pipelineDir, "notes.json");
      const read = readJsonSafe(notesPath);
      const store = read.ok ? read.data : { notes: [] };
      if (!store.notes) store.notes = [];

      const note = {
        id: "n-" + randomUUID().slice(0, 8),
        text,
        tags,
        addedAt: new Date().toISOString()
      };

      store.notes.push(note);
      writeJsonSafe(notesPath, store);

      return textResult(note);
    } catch (err) {
      return errorResult("Failed to add note: " + err.message);
    }
  }
);

// -- Tool: forge_read_notes --------------------------------------------------

server.registerTool(
  "forge_read_notes",
  {
    title: "FORGE Read Notes",
    description: "Returns knowledge notes, optionally filtered by tag or search term",
    inputSchema: z.object({
      tag: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by tag — single or array, any-of semantics"),
      search: z.string().optional().describe("Case-insensitive substring match on note text")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async ({ tag, search }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const notesPath = join(check.pipelineDir, "notes.json");
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
      return errorResult("Failed to read notes: " + err.message);
    }
  }
);

// -- Tool: forge_delete_note -------------------------------------------------

server.registerTool(
  "forge_delete_note",
  {
    title: "FORGE Delete Note",
    description: "Deletes a note by ID",
    inputSchema: z.object({
      id: z.string().describe("Note ID to delete")
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
  },
  async ({ id }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const notesPath = join(check.pipelineDir, "notes.json");
      const read = readJsonSafe(notesPath);
      if (!read.ok) return errorResult("Failed to read notes: " + read.error);

      const store = read.data;
      const before = (store.notes || []).length;
      store.notes = (store.notes || []).filter(n => n.id !== id);

      if (store.notes.length === before) {
        return errorResult("Note not found: " + id);
      }

      writeJsonSafe(notesPath, store);
      return textResult({ deleted: id });
    } catch (err) {
      return errorResult("Failed to delete note: " + err.message);
    }
  }
);

// -- Tool: forge_read_project ------------------------------------------------

server.registerTool(
  "forge_read_project",
  {
    title: "FORGE Read Project",
    description: "Returns the project configuration",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const configPath = join(check.pipelineDir, "project.json");
      const read = readJsonSafe(configPath);
      if (!read.ok) return errorResult("Failed to read project.json: " + read.error);

      return textResult(read.data);
    } catch (err) {
      return errorResult("Failed to read project.json: " + err.message);
    }
  }
);

// -- Tool: forge_update_config -----------------------------------------------

const ALLOWED_CONFIG_KEYS = ["techStacks", "techStackLabels", "description", "testCommand", "gitIntegration"];

server.registerTool(
  "forge_update_config",
  {
    title: "FORGE Update Config",
    description: "Updates a project configuration field",
    inputSchema: z.object({
      key: z.string().describe("Field name to update"),
      value: z.any().describe("New value")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ key, value }) => {
    try {
      if (!ALLOWED_CONFIG_KEYS.includes(key)) {
        return errorResult("Unknown config key: " + key + ". Allowed: " + ALLOWED_CONFIG_KEYS.join(", "));
      }

      // Per-key type validation
      const STRING_KEYS = ["description", "testCommand"];
      const ARRAY_KEYS = ["techStacks", "techStackLabels"];
      if (STRING_KEYS.includes(key) && typeof value !== "string") {
        return errorResult("Invalid type for " + key + ": expected string, got " + typeof value);
      }
      if (ARRAY_KEYS.includes(key) && !Array.isArray(value)) {
        return errorResult("Invalid type for " + key + ": expected array, got " + typeof value);
      }

      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const configPath = join(check.pipelineDir, "project.json");
      const read = readJsonSafe(configPath);
      if (!read.ok) return errorResult("Failed to read project.json: " + read.error);

      const config = read.data;
      config[key] = value;
      writeJsonSafe(configPath, config);

      return textResult(config);
    } catch (err) {
      return errorResult("Failed to update config: " + err.message);
    }
  }
);

// -- Tool: forge_get_active_run ----------------------------------------------

server.registerTool(
  "forge_get_active_run",
  {
    title: "FORGE Get Active Run",
    description: "Returns the current active pipeline run state, or null if no run is active. When runId is provided, returns that run's per-run active file directly.",
    inputSchema: z.object({
      runId: runIdSchema.optional().describe("When provided, reads that run's per-run active file (.pipeline/runs/<runId>/run-active.json) and returns it directly."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async ({ runId } = {}) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // When runId provided: read per-run file directly, no fallback to singleton.
      if (runId) {
        let perRunPath;
        try {
          perRunPath = getRunActivePath(projectDir, runId);
        } catch (pathErr) {
          return errorResult("Invalid runId: " + pathErr.message);
        }
        if (!existsSync(perRunPath)) {
          return textResult(null);
        }
        const read = readJsonSafe(perRunPath);
        if (!read.ok) return errorResult("Failed to read per-run active file: " + read.error);
        return textResult(read.data);
      }

      // No runId: read singleton to discover currentRunId, then prefer per-run file.
      const singletonPath = join(check.pipelineDir, "run-active.json");
      if (!existsSync(singletonPath)) {
        return textResult(null);
      }

      const singletonRead = readJsonSafe(singletonPath);
      if (!singletonRead.ok) return errorResult("Failed to read run-active.json: " + singletonRead.error);

      const singletonData = singletonRead.data;
      const currentRunId = singletonData && typeof singletonData.runId === 'string' ? singletonData.runId : null;

      // If we have a valid runId from the singleton, prefer the per-run file when present.
      if (currentRunId) {
        try {
          const perRunPath = getRunActivePath(projectDir, currentRunId);
          if (existsSync(perRunPath)) {
            const perRunRead = readJsonSafe(perRunPath);
            if (perRunRead.ok) return textResult(perRunRead.data);
          }
        } catch (_) {
          // Invalid runId stored in singleton — fall through to singleton data
        }
      }

      // Fall back to singleton data (per-run file absent or runId missing/invalid).
      return textResult(singletonData);
    } catch (err) {
      return errorResult("Failed to read active run: " + err.message);
    }
  }
);

// -- Tool: forge_check_gate --------------------------------------------------

server.registerTool(
  "forge_check_gate",
  {
    title: "FORGE Check Gate",
    description: "Returns the current pending gate state (gate1 or gate2), or null if no gate is pending. Pass runId to target a specific run's gate file instead of the shared main-root file.",
    inputSchema: z.object({
      runId: runIdSchema.optional().describe("Target a specific run's gate file. When omitted, returns the main-root gate (legacy behavior)."),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async ({ runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // When runId is provided, look up that run's gate file directly —
      // avoids the singleton race where parallel runs overwrite each other.
      if (runId) {
        const targetRun = getRun(projectDir, runId);
        if (targetRun && targetRun.worktreePath) {
          const wtGatePath = join(targetRun.worktreePath, '.pipeline', 'gate-pending.json');
          if (existsSync(wtGatePath)) {
            const wtRead = readJsonSafe(wtGatePath);
            if (wtRead.ok) return textResult(wtRead.data);
          }
        }
        // Fall back to main-root file filtered by runId
        const mainGatePath = join(check.pipelineDir, "gate-pending.json");
        if (existsSync(mainGatePath)) {
          const read = readJsonSafe(mainGatePath);
          if (read.ok && read.data && read.data.runId === runId) return textResult(read.data);
        }
        return textResult(null);
      }

      // Legacy path: no runId — read main-root gate file
      const mainGatePath = join(check.pipelineDir, "gate-pending.json");
      let mainGate = null;
      if (existsSync(mainGatePath)) {
        const read = readJsonSafe(mainGatePath);
        if (read.ok) mainGate = read.data;
      }

      // Check worktree-backed runs for a gate file the main root may not have.
      // Workers write gate-pending.json to their worktree path; forge_set_gate
      // dual-writes but direct writes bypass it entirely.
      let worktreeGate = null;
      try {
        let candidates = listRuns(projectDir, { status: 'gate-pending' });
        if (!candidates.length) {
          // Also check running runs — gate may have just been written
          candidates = listRuns(projectDir, {}).filter(
            r => r.status === 'running'
          );
        }
        const sorted = candidates.sort(
          (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')
        );
        // Only check the first few to avoid performance issues on large run sets
        const limit = Math.min(sorted.length, 5);
        for (let i = 0; i < limit; i++) {
          const run = getRun(projectDir, sorted[i].runId);
          if (run && run.worktreePath) {
            const wtGatePath = join(run.worktreePath, '.pipeline', 'gate-pending.json');
            if (existsSync(wtGatePath)) {
              const wtRead = readJsonSafe(wtGatePath);
              if (wtRead.ok) {
                worktreeGate = wtRead.data;
                break;
              }
            }
          }
        }
      } catch (_) {
        // Run lookup failure — proceed with mainGate only
      }

      // Prefer worktree gate when main root is empty or stale
      const result = worktreeGate || mainGate;
      return textResult(result);
    } catch (err) {
      return errorResult("Failed to check gate: " + err.message);
    }
  }
);

// -- Tool: forge_set_gate ----------------------------------------------------
// Compatibility wrapper: writes gate-pending.json AND syncs the run registry.
// This ensures run state stays truthful even when the model uses the legacy gate
// tool instead of calling forge_update_run directly.

server.registerTool(
  "forge_set_gate",
  {
    title: "FORGE Set Gate",
    description: "Creates or updates a pending gate (gate1, gate2, or commit). Also syncs run registry automatically.",
    inputSchema: z.object({
      gate: z.enum(["gate1", "gate2", "commit"]).describe("Which gate"),
      feature: z.string().describe("Feature name"),
      status: z.enum(["pending", "approved"]).default("pending").describe("Gate status"),
      runId: runIdSchema.optional().describe("Run ID this gate belongs to. If omitted, the tool resolves it by status."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ gate, feature, status, runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // Gate self-approval guard: "approved" requires a valid approval token
      if (status === "approved") {
        if (!hasGateApprovalToken(projectDir)) {
          return errorResult(
            "FORGE: Gate approval requires explicit user authorization. " +
            "The user must invoke /forge:approve or include 'approve' in their message " +
            "before gate status can be set to 'approved'. " +
            "This prevents model self-approval of pipeline gates."
          );
        }
      }

      const now = new Date().toISOString();
      // gatePath resolved after runId is determined (worktree-aware — see below)

      // On approval, preserve the original pending gate's createdAt AND runId.
      // Read the main-root gate file first for the preserved fields.
      let originalCreatedAt = now;
      let resolvedRunId = runId || null;
      if (status === "approved") {
        const existing = readJsonSafe(join(check.pipelineDir, "gate-pending.json"));
        if (existing.ok && existing.data) {
          if (existing.data.createdAt) originalCreatedAt = existing.data.createdAt;
          if (!resolvedRunId && existing.data.runId) resolvedRunId = existing.data.runId;
        }
      }

      // If no explicit runId, resolve by status (same heuristic as before, kept
      // as fallback so the field is populated even when callers don't pass it).
      if (!resolvedRunId) {
        const candidates = status === "approved"
          ? listRuns(projectDir, { status: "gate-pending" })
          : listRuns(projectDir, {}).filter(r => r.status === "running" || r.status === "created");
        const best = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (best) resolvedRunId = best.runId;
      }

      // Worktree-aware gate path resolution: for worktree-backed runs
      // (implement/debug/refactor), the worker polls
      // <worktreePath>/.pipeline/gate-pending.json. Default to main project root.
      // Gate path components are assembled via path.join from known bases only —
      // no user-controlled strings reach the filesystem call.
      let gatePath = join(check.pipelineDir, "gate-pending.json");
      if (resolvedRunId) {
        try {
          const targetRun = getRun(projectDir, resolvedRunId);
          if (targetRun && targetRun.worktreePath) {
            const wtPipelineDir = join(targetRun.worktreePath, '.pipeline');
            if (existsSync(wtPipelineDir)) {
              gatePath = join(wtPipelineDir, 'gate-pending.json');
            }
          }
        } catch (_) {
          // Fall back to project root — never block the gate operation on run lookup failure
        }
      }

      const data = { gate, feature, status, createdAt: originalCreatedAt };
      if (resolvedRunId) data.runId = resolvedRunId;
      if (status === "approved") {
        data.approvedAt = now;
      }

      // Write to the authoritative location (worktree or main root)
      writeJsonSafe(gatePath, data);

      // Also write a copy to main project root so forge_check_gate always finds
      // the gate regardless of whether a worktree is involved. No-op when
      // gatePath is already the main root path.
      const mainGatePath = join(check.pipelineDir, "gate-pending.json");
      if (gatePath !== mainGatePath) {
        writeJsonSafe(mainGatePath, data);
      }

      // Consume the approval token after successful gate approval to prevent
      // replay attacks — one user "approve" authorizes exactly one gate.
      if (status === "approved") {
        try { unlinkSync(join(check.pipelineDir, "action-approved.json")); } catch (_) { /* already gone */ }
      }

      // --- Run registry sync (best-effort — never blocks the gate operation) ---
      // Uses resolvedRunId (from explicit input, preserved gate file, or fallback)
      // as the deterministic pointer to the target run.
      try {
        if (status === "pending" && resolvedRunId) {
          updateRun(projectDir, resolvedRunId, {
            status: "gate-pending",
            gateState: { gate, status: "pending", feature, createdAt: now, approvedAt: null },
          });
        } else if (status === "approved" && resolvedRunId) {
          // Preserve the gate's original pending createdAt from the run's gateState if present
          const existingRun = getRun(projectDir, resolvedRunId);
          const gateCreatedAt = (existingRun && existingRun.gateState && existingRun.gateState.createdAt)
            || originalCreatedAt;
          updateRun(projectDir, resolvedRunId, {
            gateState: { gate, status: "approved", feature, createdAt: gateCreatedAt, approvedAt: now },
          });
        }
      } catch (_syncErr) {
        // Run registry sync is best-effort — log but don't fail the gate operation
        console.error("[forge_set_gate] run registry sync failed: " + _syncErr.message);
      }

      // Clear gate-pending.json after a commit gate is approved — the file has
      // served its purpose once the run registry is updated to "completed".
      // gate1/gate2 approvals are intentionally NOT cleared here because the
      // approve skill (Step 2) and the apply skill (Step 1a) re-read the file
      // to resolve the runId and verify the gate before spawning the next stage.
      // Only the commit gate is terminal — nothing reads the file afterwards.
      if (status === "approved" && gate === "commit") {
        try { unlinkSync(gatePath); } catch (_) { /* already gone */ }
        // Also clear the main-root copy when a worktree-backed path was the primary.
        if (gatePath !== mainGatePath) {
          try { unlinkSync(mainGatePath); } catch (_) { /* already gone */ }
        }
      }

      return textResult(data);
    } catch (err) {
      return errorResult("Failed to set gate: " + err.message);
    }
  }
);

// -- Tool: forge_read_modules ------------------------------------------------

server.registerTool(
  "forge_read_modules",
  {
    title: "FORGE Read Modules",
    description: "Returns the module registry — all functional modules with their capabilities",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const modulesPath = join(check.pipelineDir, "modules.json");
      if (!existsSync(modulesPath)) {
        return textResult([]);
      }

      const read = readJsonSafe(modulesPath);
      if (!read.ok) return errorResult("Failed to read modules.json: " + read.error);

      return textResult(read.data);
    } catch (err) {
      return errorResult("Failed to read modules: " + err.message);
    }
  }
);

// -- Tool: forge_assign_module -----------------------------------------------

server.registerTool(
  "forge_assign_module",
  {
    title: "FORGE Assign Module",
    description: "Assigns a task to a module by setting the module field on a board task",
    inputSchema: z.object({
      taskId: z.string().describe("Task ID to assign"),
      moduleId: z.string().describe("Module ID to assign to")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ taskId, moduleId }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // Verify module exists
      const modulesPath = join(check.pipelineDir, "modules.json");
      if (existsSync(modulesPath)) {
        const modRead = readJsonSafe(modulesPath);
        if (modRead.ok) {
          const modules = Array.isArray(modRead.data) ? modRead.data : [];
          const found = modules.find(m => m.id === moduleId);
          if (!found) {
            return errorResult("Module not found: " + moduleId);
          }
        }
      }

      // Find and update task
      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

      const board = read.data;
      const allTasks = [...(board.todos || []), ...(board.planned || [])];
      const task = allTasks.find(t => t.id === taskId);

      if (!task) {
        return errorResult("Task not found: " + taskId);
      }

      task.module = moduleId;
      writeJsonSafe(boardPath, board);

      return textResult(task);
    } catch (err) {
      return errorResult("Failed to assign module: " + err.message);
    }
  }
);

// -- Tool: forge_get_model_recommendation ------------------------------------

server.registerTool(
  "forge_get_model_recommendation",
  {
    title: "FORGE Get Model Recommendation",
    description: "Returns the recommended model for a given agent based on capability match, cost tier, and provider availability.",
    inputSchema: z.object({
      agentName: z.string().describe("Agent name (e.g. 'coder', 'reviewer-safety')"),
      budgetMode: z.enum(["economy", "standard", "performance"]).default("standard").describe("Budget mode — economy prefers low-cost models, performance prefers high-capability models"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ agentName, budgetMode }) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config } = readForgeConfig(pluginDataDir, projectDir);
      const usage = readUsage(projectDir);
      const recommendation = recommendModel(agentName, config, usage, { budgetMode });

      // Record this recommendation in the session dispatch log so the
      // routing-enforcement PreToolUse hook can authorize a matching Agent
      // spawn. Only record successful recommendations — errors do not grant
      // any downstream authorization. Best-effort: log write failures must
      // not break the tool call itself.
      if (recommendation.source !== "error" && recommendation.modelId) {
        try { appendDispatchLogEntry(projectDir, agentName, recommendation); } catch (_) { /* best-effort */ }
      }

      return textResult(recommendation);
    } catch (err) {
      return errorResult("forge_get_model_recommendation failed: " + err.message);
    }
  },
);

// Session dispatch log — consumed by hooks/routing-enforcement.js.
// Shape: { entries: [{ agentName, ts, modelId, providerId }] }
// Capped at 200 entries; entries older than 30 minutes are pruned on write.
const DISPATCH_LOG_RELATIVE = ".pipeline/session-dispatch-log.json";
const DISPATCH_LOG_MAX_ENTRIES = 200;
const DISPATCH_LOG_PRUNE_MS = 30 * 60 * 1000;

function appendDispatchLogEntry(projectDir, agentName, recommendation) {
  const logPath = join(projectDir, DISPATCH_LOG_RELATIVE);
  let data = { entries: [] };
  try {
    if (existsSync(logPath)) {
      const raw = readFileSync(logPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) data = parsed;
    }
  } catch (_) {
    data = { entries: [] };
  }

  const now = Date.now();
  // Prune stale entries before appending — keep the log bounded.
  const fresh = data.entries.filter(e =>
    e && typeof e.ts === "number" && now - e.ts <= DISPATCH_LOG_PRUNE_MS && e.ts <= now
  );
  fresh.push({
    agentName,
    ts: now,
    modelId: recommendation.modelId,
    providerId: recommendation.providerId,
  });

  // Cap total size to prevent unbounded growth if recommendations are called
  // very rapidly; the newest entries are the ones that matter.
  const capped = fresh.slice(-DISPATCH_LOG_MAX_ENTRIES);
  writeJsonSafe(logPath, { entries: capped });
}

// -- Tool: forge_call_external -----------------------------------------------

server.registerTool(
  "forge_call_external",
  {
    title: "FORGE Call External Provider",
    description: "Sends a prompt to an external provider (e.g. OpenAI Codex). For Anthropic models, use agent frontmatter instead — this tool is only for providers that cannot be expressed as a Claude Code subagent model.",
    inputSchema: z.object({
      providerId: z.string().describe("Provider ID from forge-config.json (e.g. 'openai')"),
      modelId: z.string().describe("Model ID to call (e.g. 'codex-mini-latest')"),
      prompt: z.string().describe("Prompt text to send"),
      maxTokens: z.number().optional().describe("Max output tokens (default: 4096)"),
      reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional().describe("Reasoning effort level for models that support it (e.g. gpt-5.4). Ignored by providers that do not support it."),
      agentName: z.string().optional().describe("Agent name for automatic rerouting on transient failure (e.g. 'supervisor'). When provided, a 503-exhausted call re-runs model selection with the failed model excluded and retries the next cheapest valid model."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ providerId, modelId, prompt, maxTokens, reasoningEffort, agentName }) => {
    // Prompt size limit — prevents exfiltration of large file contents
    const MAX_PROMPT_CHARS = 100_000;
    if (prompt.length > MAX_PROMPT_CHARS) {
      return errorResult("Prompt exceeds " + MAX_PROMPT_CHARS + " character limit (" + prompt.length + " chars). Trim the prompt.");
    }

    // Maximum number of model reroutes on transient 503 — prevents infinite loops
    const MAX_REROUTES = 3;

    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config } = readForgeConfig(pluginDataDir, projectDir);
      const usage = readUsage(projectDir);

      // Mutable call state — updated on reroute (runtime-only, never persisted)
      let currentProviderId = providerId;
      let currentModelId = modelId;
      const excludeModels = [];

      for (let attempt = 0; attempt <= MAX_REROUTES; attempt++) {
        // Find and validate provider
        const provider = (config.providers || []).find(p => p.id === currentProviderId);
        if (!provider || !provider.enabled) {
          return errorResult("Provider not found or disabled: " + currentProviderId);
        }

        // Validate modelId is in the catalog for this provider
        const modelInCatalog = (config.models || []).find(m => m.id === currentModelId && m.providerId === currentProviderId);
        if (!modelInCatalog) {
          return errorResult("Model \"" + currentModelId + "\" not found in catalog for provider \"" + currentProviderId + "\"");
        }

        // Resolve API key — reject undefined and empty string
        const apiKey = process.env[provider.envVar];
        if (!apiKey) {
          return errorResult("API key env var not set or empty: " + provider.envVar);
        }

        let result;
        try {
          if (provider.type === "openai") {
            result = await callOpenAI(prompt, currentModelId, apiKey, { maxTokens, reasoningEffort });
          } else if (provider.type === "gemini") {
            result = await callGemini(prompt, currentModelId, apiKey, { maxTokens });
          } else {
            return errorResult("Provider type not supported: " + provider.type);
          }
        } catch (callErr) {
          const msg = callErr.message || "";
          // Use structured adapter metadata for reroute decisions — avoids brittle string matching.
          // Adapters set err.transient = true on 503 (service overloaded, bounded retries exhausted).
          const isTransient = callErr.transient === true;
          // Split quota classification so one exhausted model does not poison every other
          // model from the same provider:
          //   401 (auth/billing) — applies to the whole provider (bad key, disabled billing)
          //   429 / "quota" string — per-model rate or quota failure; mark only this model
          // Detect auth errors by the exact prefix produced by sanitizeErrorMessage —
          // "OpenAI API error 401: ..." or "OpenAI API error 403: ...". Using the
          // prefix avoids false positives from response body content that happens
          // to contain "401" or "403" as data.
          const isAuthError = msg.startsWith("OpenAI API error 401") || msg.startsWith("OpenAI API error 403");
          const isQuotaError = msg.includes("429") || msg.toLowerCase().includes("quota");

          if (isAuthError) {
            // Auth errors (401 invalid key, 403 forbidden) are NOT quota exhaustion.
            // Return immediately with a descriptive message — do NOT mark provider exhausted.
            return errorResult(
              "API key invalid, expired, or forbidden for provider \"" + currentProviderId +
              "\" (" + msg + "): check the API key configured in the provider's envVar."
            );
          } else if (isQuotaError) {
            try { markModelQuotaExhausted(projectDir, currentProviderId, currentModelId); } catch (_) { /* best-effort */ }
          }

          // On transient 503 after adapter retries exhausted: reroute if agentName provided
          if (isTransient && agentName && attempt < MAX_REROUTES) {
            excludeModels.push(currentModelId);
            const next = recommendModel(agentName, config, usage, { excludeModels });
            if (next.source === "error" || !next.modelId) {
              return errorResult(
                "External call failed (all candidates exhausted after transient failures): " + msg
              );
            }
            currentProviderId = next.providerId;
            currentModelId = next.modelId;
            continue; // retry with next cheapest valid model
          }

          return errorResult("External call failed: " + msg);
        }

        // Success — record usage and return
        if (config.quotaTracking) {
          try {
            recordUsage(projectDir, currentProviderId, result.inputTokens + result.outputTokens, currentModelId);
          } catch (_) { /* best-effort */ }
        }

        return textResult({
          text: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
      }

      // Unreachable — loop always returns or continues, but satisfies linters
      return errorResult("forge_call_external: reroute limit exceeded");
    } catch (err) {
      return errorResult("forge_call_external failed: " + err.message);
    }
  },
);

// -- Tool: forge_read_usage --------------------------------------------------

server.registerTool(
  "forge_read_usage",
  {
    title: "FORGE Read Usage",
    description: "Returns the current provider usage state from .pipeline/usage.json",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const usage = readUsage(projectDir);
      return textResult(usage);
    } catch (err) {
      return errorResult("forge_read_usage failed: " + err.message);
    }
  },
);

// -- Tool: forge_reset_usage -------------------------------------------------

server.registerTool(
  "forge_reset_usage",
  {
    title: "FORGE Reset Usage",
    description: "Resets provider usage counters. Resets all providers if providerId is omitted.",
    inputSchema: z.object({
      providerId: z.string().optional().describe("Reset a specific provider, or all if omitted"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ providerId }) => {
    try {
      const projectDir = resolveProjectDir();
      const usage = readUsage(projectDir);
      if (!usage.providers) usage.providers = {};

      // Rate-limit resets to prevent infinite retry loops
      if (usage.updatedAt) {
        const lastUpdate = new Date(usage.updatedAt);
        const elapsed = Date.now() - lastUpdate.getTime();
        if (elapsed < 60_000) {
          return errorResult("Usage was reset less than 60 seconds ago. Wait before retrying.");
        }
      }

      const resetAt = new Date().toISOString();

      // Clears provider-level AND any per-model quotaExhausted flags so users
      // can recover from a per-model exhaustion without having to hand-edit
      // usage.json.
      function resetProviderEntry(id) {
        const entry = usage.providers[id];
        entry.requestCount = 0;
        entry.tokenCount = 0;
        entry.quotaExhausted = false;
        entry.lastUsed = null;
        entry.resetAt = resetAt;
        if (entry.models) {
          for (const mId of Object.keys(entry.models)) {
            entry.models[mId].quotaExhausted = false;
          }
        }
      }

      if (providerId) {
        // Reset only the specified provider (create zeroed entry if not yet tracked)
        if (!usage.providers[providerId]) {
          usage.providers[providerId] = {
            requestCount: 0,
            tokenCount: 0,
            lastUsed: null,
            quotaExhausted: false,
            resetAt,
          };
        } else {
          resetProviderEntry(providerId);
        }
      } else {
        // Reset all known providers
        for (const id of Object.keys(usage.providers)) {
          resetProviderEntry(id);
        }
      }

      usage.updatedAt = resetAt;
      writeUsage(projectDir, usage);
      return textResult(usage);
    } catch (err) {
      return errorResult("forge_reset_usage failed: " + err.message);
    }
  },
);

// -- Tool: forge_update_agent_model ------------------------------------------

server.registerTool(
  "forge_update_agent_model",
  {
    title: "FORGE Update Agent Model",
    description: "Updates the preferred or fallback model for a named agent in forge-config.json",
    inputSchema: z.object({
      agentName: z.string().describe("Agent name (must exist in agentModelMap)"),
      preferred: z.string().optional().describe("New preferred model ID"),
      fallback: z.string().optional().describe("New fallback model ID"),
      requiredCapabilities: z.array(z.string()).optional().describe("Required capability tags"),
      allowedVendors: z.array(z.string()).optional().describe("Restrict routing to these provider IDs only (e.g. ['anthropic'])"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ agentName, preferred, fallback, requiredCapabilities, allowedVendors }) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

      if (!config.agentModelMap || !config.agentModelMap[agentName]) {
        return errorResult("Agent not in agentModelMap: " + agentName);
      }

      // Reviewer agents must stay on Anthropic — block vendor redirection
      const LOCKED_VENDOR_AGENTS = [
        'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
        'reviewer-style', 'reviewer-performance', 'reviewer-triage',
      ];
      if (allowedVendors !== undefined && LOCKED_VENDOR_AGENTS.includes(agentName)) {
        if (!allowedVendors.includes('anthropic')) {
          return errorResult(
            "Reviewer agents must include 'anthropic' in allowedVendors. " +
            "Routing reviewers to non-Anthropic providers is not allowed."
          );
        }
      }

      // Apply provided fields in-place
      const entry = config.agentModelMap[agentName];
      if (preferred !== undefined) entry.preferred = preferred;
      if (fallback !== undefined) entry.fallback = fallback;
      if (requiredCapabilities !== undefined) entry.requiredCapabilities = requiredCapabilities;
      if (allowedVendors !== undefined) entry.allowedVendors = allowedVendors;

      writeForgeConfig(configPath, config);
      return textResult(config.agentModelMap[agentName]);
    } catch (err) {
      return errorResult("forge_update_agent_model failed: " + err.message);
    }
  },
);

// -- Tool: forge_add_model ---------------------------------------------------

server.registerTool(
  "forge_add_model",
  {
    title: "FORGE Add Model",
    description: "Adds a new model to the catalog in forge-config.json. Validates capabilities against a fixed allowlist (reasoning, code, analysis, fast, agentic, long-context), rejects duplicate IDs, verifies providerId exists, and enforces numeric pricing shape. Prevents typos and invalid entries from silently breaking routing.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Unique model ID (e.g. 'claude-haiku-4-5-20251001')"),
      providerId: z.string().min(1).describe("Provider ID — must match an existing provider in config.providers"),
      capabilities: z.array(z.string()).min(1).describe("Capability tags from the allowlist: reasoning, code, analysis, fast, agentic, long-context"),
      costTier: z.enum(["free", "low", "medium", "high"]).describe("Coarse cost bucket"),
      pricing: z.object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cached: z.number().nonnegative(),
      }).describe("Per-1M-token pricing in USD"),
      contextWindow: z.number().int().positive().optional().describe("Max context window in tokens"),
      reasoningTier: z.enum(["haiku", "sonnet", "opus"]).optional().describe("Descriptive tier label (metadata only)"),
      notes: z.string().optional().describe("Human-readable notes"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (params) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

      const result = addModelToConfig(config, params);
      if (!result.ok) {
        return errorResult("forge_add_model: " + result.error);
      }

      writeForgeConfig(configPath, config);
      return textResult(result.entry);
    } catch (err) {
      return errorResult("forge_add_model failed: " + err.message);
    }
  },
);

// -- Tool: forge_update_model ------------------------------------------------

server.registerTool(
  "forge_update_model",
  {
    title: "FORGE Update Model",
    description: "Updates fields on an existing model catalog entry. Only touched fields are revalidated and replaced; untouched fields are preserved. The model id itself cannot be changed. Use forge_add_model for new entries.",
    inputSchema: z.object({
      id: z.string().min(1).describe("Model ID to update (must exist in catalog)"),
      providerId: z.string().min(1).optional().describe("New providerId (must match an existing provider)"),
      capabilities: z.array(z.string()).min(1).optional().describe("New capability set — replaces previous; must come from the allowlist"),
      costTier: z.enum(["free", "low", "medium", "high"]).optional(),
      pricing: z.object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cached: z.number().nonnegative(),
      }).optional().describe("New pricing — replaces previous"),
      contextWindow: z.number().int().positive().optional(),
      reasoningTier: z.enum(["haiku", "sonnet", "opus"]).optional(),
      notes: z.string().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (params) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

      const result = updateModelInConfig(config, params);
      if (!result.ok) {
        return errorResult("forge_update_model: " + result.error);
      }

      writeForgeConfig(configPath, config);
      return textResult(result.entry);
    } catch (err) {
      return errorResult("forge_update_model failed: " + err.message);
    }
  },
);

// -- Tool: forge_list_models -------------------------------------------------

server.registerTool(
  "forge_list_models",
  {
    title: "FORGE List Models",
    description: "Returns the model catalog from forge-config.json, optionally filtered by provider or capability",
    inputSchema: z.object({
      providerId: z.string().optional().describe("Filter by provider ID"),
      capability: z.string().optional().describe("Filter by required capability tag"),
      availableOnly: z.boolean().default(false).describe("If true, exclude models whose provider OR the model itself has quotaExhausted: true"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ providerId, capability, availableOnly }) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config } = readForgeConfig(pluginDataDir, projectDir);
      const usage = readUsage(projectDir);

      let models = config.models || [];

      // Filter by provider
      if (providerId) {
        models = models.filter(m => m.providerId === providerId);
      }

      // Filter by capability tag
      if (capability) {
        models = models.filter(m => (m.capabilities || []).includes(capability));
      }

      // Filter by availability — excludes a model if EITHER the provider is
      // marked exhausted (auth/billing-wide) OR this specific model is marked
      // exhausted (per-model quota). Backward compatible with old-format
      // usage.json that only carries provider-level flags.
      if (availableOnly) {
        models = models.filter(m => {
          const providerUsage = usage.providers?.[m.providerId];
          if (providerUsage?.quotaExhausted) return false;
          if (providerUsage?.models?.[m.id]?.quotaExhausted === true) return false;
          return true;
        });
      }

      return textResult(models);
    } catch (err) {
      return errorResult("forge_list_models failed: " + err.message);
    }
  },
);

// -- Tool: forge_set_blocked_by ----------------------------------------------

server.registerTool(
  "forge_set_blocked_by",
  {
    title: "FORGE Set Blocked By",
    description: "Sets or clears the blockedBy array on a board task. Pass task IDs that block this task, or an empty array to unblock.",
    inputSchema: z.object({
      id: z.string().min(1).max(36).describe("Task ID to update"),
      blockedBy: z.array(z.string()).describe("Array of task IDs that block this task (empty array to clear)")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ id, blockedBy }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

      const board = read.data;
      const allTasks = [...(board.todos || []), ...(board.planned || [])];
      const task = allTasks.find(t => t.id === id);

      if (!task) {
        return errorResult("Task not found: " + id);
      }

      // Validate that all blockedBy IDs exist
      for (const blockerId of blockedBy) {
        if (!allTasks.find(t => t.id === blockerId)) {
          return errorResult("Blocker task not found: " + blockerId);
        }
      }

      task.blockedBy = blockedBy;
      writeJsonSafe(boardPath, board);

      return textResult(task);
    } catch (err) {
      return errorResult("forge_set_blocked_by failed: " + err.message);
    }
  },
);

// -- Run pruning -------------------------------------------------------------

const MAX_TERMINAL_RUNS = 10;
const PRUNE_STATUSES = new Set(["completed", "failed", "discarded"]);

function pruneTerminalRuns(projectDir) {
  try {
    const all = listRuns(projectDir);
    const terminal = all
      .filter(e => PRUNE_STATUSES.has(e.status))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    if (terminal.length <= MAX_TERMINAL_RUNS) return;

    const toPrune = terminal.slice(MAX_TERMINAL_RUNS);
    const runsBase = join(projectDir, ".pipeline", "runs");

    for (const entry of toPrune) {
      // Clean up the git worktree first, before deleting the run directory.
      // The run.json (which holds worktreePath) lives inside the run dir —
      // we must read it before rmSync obliterates it.
      try {
        const run = getRun(projectDir, entry.runId);
        if (run) {
          removeWorktree(projectDir, entry.runId, run.worktreePath || null);
        }
      } catch (_) {}

      const dir = join(runsBase, entry.runId);
      try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }

    rebuildIndex(projectDir);
    console.error("[forge] pruned " + toPrune.length + " old runs, kept " + MAX_TERMINAL_RUNS);
  } catch (err) {
    console.error("[forge] prune failed: " + err.message);
  }
}

// -- Tool: forge_create_run --------------------------------------------------

server.registerTool(
  "forge_create_run",
  {
    title: "FORGE Create Run",
    description: "Creates a new pipeline run. Returns the full run object with a generated runId. When spawnWorker is true, also opens a new terminal tab with an autonomous Claude Code worker session — use this in conductor sessions instead of the Agent tool.",
    inputSchema: z.object({
      sessionId: z.string().describe("Claude session ID"),
      pipelineType: z.string().describe("Pipeline type: plan, implement, apply, debug, refactor, research, explore, ideate"),
      feature: z.string().default("").describe("Feature name or description"),
      spawnWorker: z.boolean().default(false).describe("Spawn an autonomous Claude Code worker in a new terminal tab"),
      useWorktree: z.boolean().default(false).describe("Create an isolated git worktree for the worker (only used when spawnWorker is true)"),
      parentRunId: runIdSchema.optional().describe("Run ID of the originating run, for chained pipelines (e.g. plan → implement)"),
      stages: z.record(z.string(), z.object({
        agents: z.array(z.enum([
          'planner', 'researcher', 'gotcha-checker', 'coder', 'coder-scout',
          'debug', 'refactor', 'completeness-checker', 'implementation-architect',
          'documenter', 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
          'reviewer-style', 'reviewer-performance',
        ])).default([]),
        status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
      })).nullable().optional().describe("Initial stage map — keys are stage names, values are per-stage objects with agents array and status"),
      classificationId: z.string().nullable().optional().describe("Risk classification ID from forge_classify_risk"),
      reviewerOverrides: z.array(z.string()).optional().describe("Explicit reviewer list overriding classification-derived reviewers. Valid values: 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic', 'reviewer-style', 'reviewer-performance'"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ sessionId, pipelineType, feature, spawnWorker, useWorktree, parentRunId, stages, classificationId, reviewerOverrides }) => {
    try {
      const projectDir = resolveProjectDir();
      // Sanitize feature name at ingestion — strips shell-injection chars before
      // the value is stored in run.json or returned to skills for git/PR usage.
      const safeFeature = sanitizeFeatureName(feature);

      // Validate that a plan exists before allowing an implement run.
      // Debug and refactor pipelines have their own entry points and do not require a plan.
      if (pipelineType === "implement") {
        let planFound = false;
        try {
          const planRuns = listRuns(projectDir, { pipelineType: "plan" });
          planFound = planRuns.some((entry) => {
            try {
              const planRun = getRun(projectDir, entry.runId);
              return planRun?.gateState?.gate === "gate1" && planRun?.gateState?.status === "approved";
            } catch (_) {
              return false;
            }
          });
        } catch (_) {
          // listRuns failure — fall through to PLAN.md check
        }
        if (!planFound) {
          planFound = existsSync(join(projectDir, "docs", "PLAN.md"));
        }
        if (!planFound) {
          return errorResult("implement pipeline requires a completed plan (gate1 approved) or docs/PLAN.md. Run /forge:plan first.");
        }
      }

      // Guard: prevent duplicate apply when source worker is still alive.
      // After gate2 approval, the existing worker resumes and handles apply
      // (documenter, lifecycle, commit gate). /forge:apply is manual recovery
      // only — block if the source worker should still be alive.
      if (pipelineType === "apply") {
        const gatePendingRuns = listRuns(projectDir, { status: "gate-pending" });
        const aliveSource = gatePendingRuns.find(entry => {
          try {
            const r = getRun(projectDir, entry.runId);
            return r && !r.failureReason
              && r.gateState?.gate === "gate2"
              && r.gateState?.status === "approved";
          } catch (_) { return false; }
        });
        if (aliveSource) {
          return errorResult(
            "Apply blocked: source run " + aliveSource.runId + " has gate2 approved and should be resuming automatically. "
            + "Wait for the commit gate. Only use /forge:apply if the worker is confirmed dead (status: failed/discarded)."
          );
        }
      }

      const run = createRun({ projectRoot: projectDir, sessionId, pipelineType, feature: safeFeature, parentRunId: parentRunId ?? null, stages: stages ?? null, classificationId: classificationId ?? null, reviewerOverrides: reviewerOverrides ?? [] });
      // Immediately mark as running — the model reliably calls forge_create_run
      // but skips the follow-up forge_update_run to set status: "running".
      const started = updateRun(projectDir, run.runId, { status: "running" });

      // Initialize run-active.json — the lightweight pipeline marker read by
      // workflow-guard.js (needs startedAt), forge-status.js (needs startedAt +
      // mode), and ctx-stop.js / subagent hooks (need agents array).
      // Overwrite any stale marker from a previous run — each forge_create_run
      // starts a new pipeline, and run-active.json tracks exactly one.
      const runActiveData = {
        startedAt: Date.now(),
        runId: started.runId,
        pipelineType,
        feature: safeFeature,
        agents: [],
      };
      if (started.stages != null) {
        runActiveData.stages = started.stages;
      }

      // For apply runs: resolve the exact worktree from the approved gate2 run.
      // Canonical identity is run.feature (not gate-pending.json.feature, which
      // may drift from skill-side paraphrasing). We find the most recent implement
      // run whose own gateState shows gate2 approved, and use ITS run.feature as
      // the authoritative feature for downstream use.
      if (pipelineType === "apply") {
        try {
          const implRuns = listRuns(projectDir, { pipelineType: "implement" })
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          for (const entry of implRuns) {
            const impl = getRun(projectDir, entry.runId);
            if (!impl || !impl.worktreePath) continue;
            if (!existsSync(impl.worktreePath)) continue;
            // Require gate2 approved on the run's own gateState — this is canonical.
            if (!impl.gateState) continue;
            if (impl.gateState.gate !== "gate2") continue;
            if (impl.gateState.status !== "approved") continue;
            // Match found — this is the implement run whose gate2 was approved
            // most recently and has a valid worktree on disk.
            runActiveData.worktreePath = impl.worktreePath;
            break;
          }
        } catch (_) {
          // Best-effort — if resolution fails, apply runs without worktree isolation
        }
      }

      const runActivePath = join(projectDir, ".pipeline", "run-active.json");
      writeJsonSafe(runActivePath, runActiveData);

      // Write per-run active file alongside singleton (AC-3).
      try {
        writeRunActive(projectDir, started.runId, runActiveData);
      } catch (perRunErr) {
        console.error("[forge_create_run] per-run active write failed (non-fatal): " + perRunErr.message);
      }

      pruneTerminalRuns(projectDir);

      if (!spawnWorker) return textResult(started);

      // Guard: prevent recursive spawning — if this MCP server is running inside
      // a worker process, never spawn another worker. The worker's MCP server is
      // started by mcp/forge-worker.mjs with FORGE_WORKER_SESSION='1' in its env;
      // the conductor's MCP server does not have this var, so its guard never fires.
      // Env-var check is race-free vs. the previous file-system check, which was
      // observed to false-positive when sibling workers' worker-task-<runId>.json
      // files were still on disk before their SessionStart hook consumed them.
      if (process.env.FORGE_WORKER_SESSION === '1') {
        console.error("[forge_create_run] FORGE_WORKER_SESSION is set — skipping spawn (already inside a worker)");
        return textResult(started);
      }

      // Sweep stale PID files before collision guard so zombie "running" entries
      // do not falsely block new spawns.
      const mainProjectDir = resolveMainProjectDir();
      const sweepResult = sweepStalePids(mainProjectDir);
      if (sweepResult.swept > 0) {
        console.error('[forge_create_run] sweepStalePids swept ' + sweepResult.swept + ' stale PID(s), alive=' + sweepResult.alive + ', errors=' + sweepResult.errors);
      }

      // Guard: prevent worker collision (AC-11) — narrowed to true conflicts.
      //
      // The new run's intent at this point is captured by `useWorktree`:
      //   - useWorktree === true  → createWorktree() will assign unique paths
      //                             (`.worktrees/<runId>/` and `forge/<runId>`),
      //                             so worktree/branch collisions are impossible.
      //   - useWorktree === false → main-root slot; collides only with other
      //                             main-root running runs in the same project.
      //
      // Predicate (block when ANY existing running run b matches a):
      //   (a.worktreePath && a.worktreePath === b.worktreePath) ||
      //   (a.branchName   && a.branchName   === b.branchName)   ||
      //   (a.worktreePath === null && b.worktreePath === null && a.projectRoot === b.projectRoot)
      const runningRuns = listRuns(projectDir, { status: "running" }).filter(r => r.runId !== started.runId);
      if (!useWorktree) {
        // New run will use the main-root slot — block only main-root runs in the same project.
        const conflicts = runningRuns.filter(b => b.worktreePath == null && b.projectRoot === projectDir);
        if (conflicts.length > 0) {
          const conflicting = conflicts.map(r => r.runId).join(", ");
          return errorResult(
            "Worker collision blocked: run(s) " + conflicting + " already running in the same main-root slot. Wait for them to finish or mark them failed/discarded before spawning a new worker in the main project root.",
          );
        }
      }
      // useWorktree === true: createWorktree assigns unique worktreePath/branchName per runId — no collision possible.

      // --- Worker spawning (headless) ---
      let workDir = projectDir;
      if (useWorktree) {
        const wtRun = createWorktree(projectDir, started.runId);
        workDir = wtRun.worktreePath;
      }

      const taskDir = join(workDir, ".pipeline");
      if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
      const taskFilePath = join(taskDir, "worker-task-" + started.runId + ".json");
      writeFileSync(
        taskFilePath,
        JSON.stringify({ runId: started.runId, feature: safeFeature, pipelineType, createdAt: new Date().toISOString() }, null, 2) + "\n",
        "utf-8",
      );

      const workerScriptPath = join(dirname(fileURLToPath(import.meta.url)), 'forge-worker.mjs');
      const workerName = "worker-" + started.runId;
      const logFile = workerLogPath(projectDir, started.runId);
      const logDir = join(projectDir, ".pipeline", "worker-logs");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const logFd = openSync(logFile, "a");
      let child;
      try {
        child = nodeSpawn(process.execPath, [workerScriptPath], {
          cwd: workDir,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", logFd, logFd],
        });
        const pidDir = join(projectDir, ".pipeline", "worker-pids");
        mkdirSync(pidDir, { recursive: true });
        const pidFile = join(pidDir, started.runId + ".json");
        writeJsonSafe(pidFile, { runId: started.runId, pid: child.pid, startedAt: new Date().toISOString() });
        child.on("error", (err) => {
          console.error("[forge_create_run] worker spawn failed: " + err.message);
          try { unlinkSync(taskFilePath); } catch (_) {}
          try { unlinkSync(pidFile); } catch (_) {}
          // Mark run as failed so conductor can see the spawn failure
          try {
            const runFilePath = join(projectDir, ".pipeline", "runs", started.runId, "run.json");
            const raw = readFileSync(runFilePath, "utf-8");
            const runData = JSON.parse(raw);
            if (runData.status === "running") {
              runData.status = "failed";
              runData.failureReason = "worker spawn error: " + err.message;
              runData.updatedAt = new Date().toISOString();
              writeJsonSafe(runFilePath, runData);
            }
          } catch (updateErr) {
            console.error("[forge_create_run] error handler failed to update run status: " + updateErr.message);
          }
        });
        child.on("exit", (code) => {
          try { closeSync(logFd); } catch (_) {}
          try { unlinkSync(pidFile); } catch (_) {}
          try {
            const runFilePath = join(projectDir, ".pipeline", "runs", started.runId, "run.json");
            const raw = readFileSync(runFilePath, "utf-8");
            const runData = JSON.parse(raw);
            if (runData.status === "running") {
              runData.status = "failed";
              runData.failureReason = "worker process exited with code " + code;
              runData.updatedAt = new Date().toISOString();
              writeJsonSafe(runFilePath, runData);
            }
          } catch (exitErr) {
            console.error("[forge_create_run] exit handler failed to update run status: " + exitErr.message);
          }
        });
        child.unref();
      } catch (spawnErr) {
        try { closeSync(logFd); } catch (_) {}
        throw spawnErr;
      }

      return textResult({
        ...started,
        workerSpawned: true,
        workerName,
        workDir,
        useWorktree,
        logFile,
        message: "Worker spawned headlessly: " + safeFeature,
      });
    } catch (err) {
      return errorResult("forge_create_run failed: " + err.message);
    }
  },
);

// -- Tool: forge_get_run -----------------------------------------------------

server.registerTool(
  "forge_get_run",
  {
    title: "FORGE Get Run",
    description: "Returns a single run by ID, or null if not found.",
    inputSchema: z.object({
      runId: runIdSchema.describe("Run ID (e.g. r-a1b2c3d4)"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const run = getRun(projectDir, runId);
      return textResult(run);
    } catch (err) {
      return errorResult("forge_get_run failed: " + err.message);
    }
  },
);

// -- Tool: forge_list_runs ---------------------------------------------------

server.registerTool(
  "forge_list_runs",
  {
    title: "FORGE List Runs",
    description: "Lists runs from the index, optionally filtered and field-projected. Use `filter` for the newer/ergonomic path with array-aware status/pipelineType matching; legacy flat `status`/`pipelineType` fields remain for backward compatibility but are superseded when `filter` is present. Use `fields` to slim each item to a subset of top-level keys; requesting a key not on the lightweight index entry triggers a full hydration via getRun.",
    inputSchema: z.object({
      status: z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]).optional().describe("Filter by run status (legacy — prefer `filter.status`, which accepts arrays). Ignored when `filter` is present."),
      pipelineType: z.string().optional().describe("Filter by pipeline type (legacy — prefer `filter.pipelineType`, which accepts arrays). Ignored when `filter` is present."),
      filter: z.object({
        status: z.union([
          z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]),
          z.array(z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]))
        ]).optional().describe("Match status — single value or any-of array."),
        pipelineType: z.union([
          z.string(),
          z.array(z.string())
        ]).optional().describe("Match pipeline type — single value or any-of array."),
      }).strict().optional().describe("Structured filter object. Supersedes legacy `status`/`pipelineType` when present. Applies `status` → `pipelineType`, AND-combined."),
      fields: z.array(z.string()).optional().describe("Top-level keys to include per returned run. Omit for full objects (index-entry shape by default; full hydrated shape when `fields` requests a non-index key). Keys not present on an item are silently dropped for that item.")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ status, pipelineType, filter, fields }) => {
    try {
      const projectDir = resolveProjectDir();

      // Index entries carry only these keys (per RunIndexEntry schema in
      // packages/forge-core/src/runs/schemas.js). Anything else requires a
      // full hydration via getRun.
      const INDEX_KEYS = new Set(["runId", "pipelineType", "feature", "status", "createdAt", "updatedAt"]);

      let entries;

      if (filter) {
        // New path — pull all entries, then apply status → pipelineType in order.
        // Supersedes legacy flat status/pipelineType so users on the new path get
        // predictable behaviour with full array-matching support.
        entries = listRuns(projectDir, {});

        if (filter.status !== undefined) {
          const allowed = Array.isArray(filter.status) ? filter.status : [filter.status];
          entries = entries.filter(e => allowed.includes(e.status));
        }
        if (filter.pipelineType !== undefined) {
          const allowed = Array.isArray(filter.pipelineType) ? filter.pipelineType : [filter.pipelineType];
          entries = entries.filter(e => allowed.includes(e.pipelineType));
        }
      } else {
        // Legacy path — preserved verbatim for backward compatibility.
        entries = listRuns(projectDir, { status, pipelineType });
      }

      // Field projection (orthogonal — runs after whichever filter path applied).
      // If fields requests any key not on the lightweight index entry, hydrate the
      // remaining entries so the projection has the requested data to project from.
      if (fields && fields.length > 0) {
        const needsHydration = fields.some(k => !INDEX_KEYS.has(k));
        if (needsHydration) {
          entries = entries.map(e => {
            // Already-hydrated entries (e.g. from a prior pass) will have non-index keys.
            const alreadyHydrated = Object.keys(e).some(k => !INDEX_KEYS.has(k));
            if (alreadyHydrated) return e;
            try {
              const full = getRun(projectDir, e.runId);
              return full || e;
            } catch (_) {
              return e;
            }
          });
        }
        // Silent key-drop is intentional: requesting a key an item doesn't have
        // is not an error, it just gets omitted from that item.
        entries = entries.map(item => {
          const projected = {};
          for (const key of fields) {
            if (Object.prototype.hasOwnProperty.call(item, key)) {
              projected[key] = item[key];
            }
          }
          return projected;
        });
      }

      // Opportunistic pruning — also runs on list, not just create
      pruneTerminalRuns(projectDir);

      return textResult(entries);
    } catch (err) {
      return errorResult("forge_list_runs failed: " + err.message);
    }
  },
);

// -- Tool: forge_update_run --------------------------------------------------

server.registerTool(
  "forge_update_run",
  {
    title: "FORGE Update Run",
    description: "Patches a run with new field values. Automatically sets updatedAt and syncs the index.",
    inputSchema: z.object({
      runId: runIdSchema.describe("Run ID to update"),
      status: z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]).optional().describe("New status"),
      worktreePath: z.string().optional().describe("Worktree path if assigned"),
      branchName: z.string().optional().describe("Branch name if assigned"),
      gateState: z.object({
        gate: z.enum(["gate1", "gate2", "commit"]),
        status: z.enum(["pending", "approved", "discarded"]),
        feature: z.string(),
        createdAt: z.string(),
        approvedAt: z.string().nullable().default(null),
      }).optional().describe("Gate state update"),
      acknowledged: z.boolean().optional().describe("Mark research run as acknowledged (findings discussed). Clears the observer card."),
      failureReason: z.string().optional().describe("Why the run failed — set when status is 'failed'"),
      stages: z.record(z.string(), z.object({
        agents: z.array(z.enum([
          'planner', 'researcher', 'gotcha-checker', 'coder', 'coder-scout',
          'debug', 'refactor', 'completeness-checker', 'implementation-architect',
          'documenter', 'reviewer-safety', 'reviewer-boundary', 'reviewer-logic',
          'reviewer-style', 'reviewer-performance',
        ])).default([]),
        status: z.enum(['pending', 'running', 'completed', 'skipped']).default('pending'),
      })).optional().describe("Stage entries to merge into the run's stages map — existing keys are preserved; new keys are added; provided keys are overwritten; completed/skipped stages cannot have status rolled back"),
      agents: z.array(z.object({
        agentId: z.string(),
        agentType: z.string().nullable().default(null),
        startedAt: z.number(),
        completedAt: z.number().nullable().default(null),
        durationMs: z.number().nullable().default(null),
        outcome: z.string().nullable().default(null),
      })).optional().describe("Agent dispatch records to merge into the run's agents array — entries are merged by agentId (upsert: insert if absent, last-write-wins on collision); existing records whose agentId is not in the payload are preserved; a null/absent stored agents array is initialised from this value"),
      phases: z.array(z.object({
        index: z.number().int().describe("Phase index (0-based)"),
        label: z.string().describe("Phase label from plan heading"),
        status: z.enum(["pending", "running", "completed", "skipped", "blocked"]).describe("Phase execution status"),
        committedAt: z.string().nullable().default(null).describe("ISO timestamp of worktree commit, or null"),
        reviewerVerdict: z.enum(["approved", "revise", "blocked"]).nullable().default(null).describe("Final reviewer verdict for this phase"),
      })).optional().describe("Phase entries to merge into the run phases array — entries are merged by index field (last-write-wins on collision); null stored phases are initialised from this value"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ runId, ...patch }) => {
    try {
      const projectDir = resolveProjectDir();
      // Strip undefined values so the core function only sees actual changes
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));

      // Stages merge: spread existing stages first so incoming entries overlay
      // without discarding unrelated keys. A null existing stages is treated as
      // an empty object — the first patch initialises the map.
      // Forward-only guard: status may not roll back from completed/skipped.
      if (cleanPatch.stages !== undefined) {
        const existingRun = getRun(projectDir, runId);
        const existingStages = (existingRun && existingRun.stages) ? existingRun.stages : {};
        const terminalStatuses = new Set(['completed', 'skipped']);
        const mergedStages = { ...existingStages };
        for (const [key, incoming] of Object.entries(cleanPatch.stages)) {
          const existing = existingStages[key];
          if (existing && terminalStatuses.has(existing.status) && incoming.status && incoming.status !== existing.status) {
            console.error(`[forge_update_run] WARN: backward stage transition blocked for "${key}": ${existing.status} -> ${incoming.status}`);
            // Merge agents but preserve terminal status
            mergedStages[key] = { ...existing, ...incoming, status: existing.status };
          } else {
            mergedStages[key] = { ...existing, ...incoming };
          }
        }
        cleanPatch.stages = mergedStages;
      }

      // Phases merge: incoming phase entries are merged by index field.
      // last-write-wins on index collision. A null stored phases array is
      // initialised from the incoming value. No forward-only guard — phases
      // can transition freely during the per-phase execution loop.
      if (cleanPatch.phases !== undefined) {
        const existingRunForPhases = getRun(projectDir, runId);
        const existingPhases = (existingRunForPhases && existingRunForPhases.phases) ? existingRunForPhases.phases : [];
        // Build a map from index -> entry for existing entries
        const phaseMap = new Map();
        for (const entry of existingPhases) {
          phaseMap.set(entry.index, entry);
        }
        // Merge incoming entries by index (last-write-wins)
        for (const entry of cleanPatch.phases) {
          const existing = phaseMap.get(entry.index);
          phaseMap.set(entry.index, existing ? { ...existing, ...entry } : entry);
        }
        // Reconstruct sorted array from map
        cleanPatch.phases = Array.from(phaseMap.values()).sort((a, b) => a.index - b.index);
      }

      // Agents merge: incoming agent records are merged by agentId (upsert).
      // Last-write-wins on agentId collision. A null/absent existing agents
      // array is initialised from the incoming value. Records with agentIds
      // not in the incoming payload are preserved unchanged. Insertion order
      // is preserved: existing records keep their position; new records
      // append. Mirrors the stages and phases merge patterns above.
      if (cleanPatch.agents !== undefined) {
        const existingRunForAgents = getRun(projectDir, runId);
        const existingAgents = (existingRunForAgents && Array.isArray(existingRunForAgents.agents)) ? existingRunForAgents.agents : [];
        const agentMap = new Map();
        for (const entry of existingAgents) {
          agentMap.set(entry.agentId, entry);
        }
        for (const entry of cleanPatch.agents) {
          const existing = agentMap.get(entry.agentId);
          agentMap.set(entry.agentId, existing ? { ...existing, ...entry } : entry);
        }
        cleanPatch.agents = Array.from(agentMap.values());
      }

      // Gate-pending status guard: block transitions out of gate-pending to
      // completed/running without a gate approval token. The model cannot skip
      // gates by calling forge_update_run({ status: 'completed' }) directly.
      // forge_set_gate calls updateRun() core function directly, bypassing this
      // handler, so this guard does not interfere with legitimate approvals.
      // Exception: if the gate is already approved, user consent is proven —
      // allow the transition to completed (commit+merge follow-up).
      if (cleanPatch.status && cleanPatch.status !== 'failed' && cleanPatch.status !== 'discarded') {
        const existing = getRun(projectDir, runId);
        if (existing && existing.status === 'gate-pending') {
          const gateAlreadyApproved = existing.gateState && existing.gateState.status === 'approved';
          if (!hasGateApprovalToken(projectDir) && !gateAlreadyApproved) {
            return errorResult(
              "FORGE: Cannot transition run from gate-pending to '" + cleanPatch.status +
              "' without user approval. Use /forge:approve or /forge:discard."
            );
          }
        }
      }

      // Worktree path containment: worktreePath must resolve under .worktrees/
      if (cleanPatch.worktreePath) {
        const normalizedWt = resolve(cleanPatch.worktreePath).replace(/\\/g, '/').toLowerCase();
        const expectedBase = resolve(join(projectDir, '.worktrees')).replace(/\\/g, '/').toLowerCase();
        if (!normalizedWt.startsWith(expectedBase + '/') && normalizedWt !== expectedBase) {
          return errorResult("FORGE: worktreePath must be under the project's .worktrees/ directory.");
        }
      }

      // Canonical feature preservation: if the caller provides gateState,
      // override gateState.feature with the stored run.feature. The run's
      // feature (set at forge_create_run) is the authoritative identity —
      // skill prompts that pass a paraphrased name must not drift it.
      if (cleanPatch.gateState) {
        const existing = getRun(projectDir, runId);
        if (existing && existing.feature) {
          cleanPatch.gateState = {
            ...cleanPatch.gateState,
            feature: existing.feature,
          };
        }
      }

      // Auto-null gateState when transitioning to a terminal status.
      // Prevents stale "Action needed" cards in the observer.
      const TERMINAL_STATUSES = new Set(["completed", "failed", "discarded"]);
      if (cleanPatch.status && TERMINAL_STATUSES.has(cleanPatch.status)) {
        cleanPatch.gateState = null;
      }

      const run = updateRun(projectDir, runId, cleanPatch);
      const mainDir = resolveMainProjectDir();

      // Write completion signal when a research or ideate run finishes
      const REVIEWABLE_TYPES = new Set(["research", "ideate"]);
      if (cleanPatch.status === "completed" && REVIEWABLE_TYPES.has(run.pipelineType)) {
        const doneDir = join(mainDir, ".pipeline", "worker-done");
        if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
        const doneFile = join(doneDir, runId + ".json");
        const signal = {
          runId, feature: run.feature || "", pipelineType: run.pipelineType,
          completedAt: new Date().toISOString(),
        };
        writeFileSync(doneFile, JSON.stringify(signal, null, 2) + "\n", "utf8");
      }

      // Clean up completion signal when research is acknowledged
      if (cleanPatch.acknowledged) {
        const doneFile = join(mainDir, ".pipeline", "worker-done", runId + ".json");
        try { unlinkSync(doneFile); } catch (_) {}
      }

      // Clean up heartbeat file when run reaches a terminal status.
      if (cleanPatch.status && TERMINAL_STATUSES.has(cleanPatch.status)) {
        const hbFile = join(mainDir, ".pipeline", "heartbeats", runId + ".json");
        try { unlinkSync(hbFile); } catch (_) {}
      }

      return textResult(run);
    } catch (err) {
      return errorResult("forge_update_run failed: " + err.message);
    }
  },
);

// -- Tool: forge_classify_risk -----------------------------------------------

// In-process cache of classification results — keyed by classificationId.
// Survives the lifetime of the MCP server process; not persisted to disk.
// No TTL — entries are small (< 1 KB each). Cap at 500 entries: when the limit
// is reached the oldest entry is evicted before inserting the new one. This
// prevents unbounded growth in long-running MCP server processes.
const classificationCache = new Map();

// Risk classification constants.
// Source of truth: scripts/lean-risk-classify.mjs. Inlined per plan decision (Wave 3 consolidates).
const RISK_PATH_PATTERNS = [
  { pattern: /child_process|spawn|exec/i, rule: 'shell' },
  { pattern: /\.env|credentials|secrets?|auth/i, rule: 'auth' },
  { pattern: /hooks\//i, rule: 'hook' },
  { pattern: /mcp\//i, rule: 'mcp' },
  { pattern: /\/scripts\//i, rule: 'script' },
  { pattern: /schema|contract/i, rule: 'schema' },
  { pattern: /worktree|merge|apply/i, rule: 'merge' },
  { pattern: /server\.|router\.|fetch|http/i, rule: 'network' },
];

const RISK_CONTENT_PATTERNS = [
  { pattern: /child_process|execFile|spawnSync/i, rule: 'shell' },
  { pattern: /writeFile|unlink|rmSync|rmdir/i, rule: 'fs-write' },
  { pattern: /password|secret|token|apiKey|credentials/i, rule: 'auth' },
  { pattern: /process\.env/i, rule: 'env' },
  { pattern: /fetch\(|http\.request|axios/i, rule: 'network' },
  { pattern: /registerTool|server\.tool/i, rule: 'mcp' },
  { pattern: /z\.object|z\.string|RunIndex|RunIndexEntry/i, rule: 'schema' },
  { pattern: /worktreePath|branchName|merge\(/i, rule: 'merge' },
];

const RULE_TO_REVIEWERS = {
  shell:     ['reviewer-safety'],
  'fs-write': ['reviewer-safety'],
  auth:      ['reviewer-safety'],
  env:       ['reviewer-safety'],
  hook:      ['reviewer-safety', 'reviewer-boundary'],
  mcp:       ['reviewer-safety', 'reviewer-boundary'],
  script:    ['reviewer-safety', 'reviewer-boundary'],
  schema:    ['reviewer-boundary'],
  merge:     ['reviewer-safety', 'reviewer-boundary'],
  network:   ['reviewer-safety', 'reviewer-boundary'],
};

server.registerTool(
  'forge_classify_risk',
  {
    title: 'FORGE Classify Risk',
    description: 'Classifies the risk surface of a planned change. Returns a classificationId, advisories, suggested reviewers, and suggested agents. Use before forge_create_run to pre-populate classificationId and reviewerOverrides.',
    inputSchema: z.object({
      feature: z.string().describe('Feature name or short description of the change'),
      filePaths: z.array(z.string()).describe('List of files that will be created or modified'),
      content: z.string().optional().describe('Optional handoff or patch content to scan for risk patterns'),
      forceReview: z.boolean().optional().default(false).describe('Force high risk level and all 5 reviewers regardless of pattern matches'),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ feature, filePaths, content, forceReview }) => {
    try {
      const classificationId = 'cls-' + randomBytes(3).toString('hex');

      if (forceReview) {
        const result = {
          classificationId,
          riskLevel: 'high',
          planStageReview: true,
          advisories: ['forceReview: all reviewers required'],
          reviewers: ['reviewer-safety', 'reviewer-boundary', 'reviewer-logic', 'reviewer-style', 'reviewer-performance'],
          suggestedAgents: ['completeness-checker', 'implementation-architect'],
        };
        if (classificationCache.size >= 500) classificationCache.delete(classificationCache.keys().next().value);
        classificationCache.set(classificationId, result);
        return textResult(result);
      }

      const triggeredRules = new Set();
      const advisories = [];

      // Scan file paths
      for (const fp of filePaths) {
        for (const { pattern, rule } of RISK_PATH_PATTERNS) {
          if (pattern.test(fp)) {
            triggeredRules.add(rule);
            advisories.push('path:' + rule + ' (' + fp + ')');
          }
        }
      }

      // Scan content if provided
      if (content) {
        for (const { pattern, rule } of RISK_CONTENT_PATTERNS) {
          if (pattern.test(content)) {
            triggeredRules.add(rule);
            advisories.push('content:' + rule);
          }
        }
      }

      // Collect unique reviewers from triggered rules
      const reviewerSet = new Set();
      for (const rule of triggeredRules) {
        const mapped = RULE_TO_REVIEWERS[rule];
        if (mapped) {
          for (const r of mapped) reviewerSet.add(r);
        }
      }

      // Derive risk level: high if safety or boundary triggered, medium if any rule, low otherwise
      let riskLevel = 'low';
      if (reviewerSet.has('reviewer-safety') || reviewerSet.has('reviewer-boundary')) {
        riskLevel = 'high';
      } else if (triggeredRules.size > 0) {
        riskLevel = 'medium';
      }

      const reviewers = Array.from(reviewerSet);
      const suggestedAgents = [];
      if (filePaths.length > 5) suggestedAgents.push('completeness-checker');
      if (riskLevel === 'high') suggestedAgents.push('implementation-architect');

      const result = {
        classificationId,
        riskLevel,
        planStageReview: riskLevel === 'high',
        advisories,
        reviewers,
        suggestedAgents,
      };
      if (classificationCache.size >= 500) classificationCache.delete(classificationCache.keys().next().value);
      classificationCache.set(classificationId, result);
      return textResult(result);
    } catch (err) {
      return errorResult('forge_classify_risk failed: ' + err.message);
    }
  },
);

// -- Tool: forge_create_worktree ---------------------------------------------

server.registerTool(
  "forge_create_worktree",
  {
    title: "FORGE Create Worktree",
    description: "Creates a FORGE-managed git worktree for an existing run. The worktree is at .worktrees/<runId>/ with branch forge/<runId>. Persists worktreePath and branchName onto the run.",
    inputSchema: z.object({
      runId: runIdSchema.describe("Run ID to create a worktree for"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const run = createWorktree(projectDir, runId);
      return textResult(run);
    } catch (err) {
      return errorResult("forge_create_worktree failed: " + err.message);
    }
  },
);

// -- Tool: forge_escalate ----------------------------------------------------

server.registerTool(
  "forge_escalate",
  {
    title: "FORGE Escalate",
    description: "Signal that a worker is stuck or needs attention. Writes an escalation file to the MAIN project's .pipeline/escalations/ (not the worktree's) so the Observer TUI surfaces it. Use when hitting unexpected blockers, errors, or questions that can't be resolved autonomously.",
    inputSchema: z.object({
      runId: runIdSchema.describe("Run ID to escalate"),
      type: z.enum(["blocker", "error", "question"]).describe("Type of escalation"),
      message: z.string().min(1).max(500).describe("Short description of what went wrong or what's needed"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ runId, type, message }) => {
    try {
      const projectDir = resolveMainProjectDir();
      const escDir = join(projectDir, ".pipeline", "escalations");
      if (!existsSync(escDir)) mkdirSync(escDir, { recursive: true });
      const escFile = join(escDir, runId + ".json");
      const tmpFile = escFile + ".tmp";
      const data = { runId, type, message, createdAt: new Date().toISOString() };
      writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", "utf8");
      renameSync(tmpFile, escFile);
      return textResult("Escalation filed for " + runId + ": " + type + " — " + message);
    } catch (err) {
      return errorResult("forge_escalate failed: " + err.message);
    }
  },
);

// -- Tool: forge_resume_run --------------------------------------------------
//
// Restores steering context for a paused or in-progress run. Does NOT mutate
// the run's status, gateState, or agents — resume only updates
// run-active.json so the current Claude conversation is pointed at this run,
// and returns the structured state the future /forge:resume skill needs to
// render its output. Refuses cleanly on terminal status, unknown runId, wrong
// project, or missing bound worktree. See docs/RESEARCH/ + handoff for the
// approved contract.

server.registerTool(
  "forge_resume_run",
  {
    title: "FORGE Resume Run",
    description: "Re-enters a paused or in-progress run by runId. Restores .pipeline/run-active.json steering pointer; does not progress the run autonomously and does not invoke any pipeline skill.",
    inputSchema: z.object({
      runId: runIdOrBareSchema.describe("Run ID to resume (e.g. r-a1b2c3d4). The 'r-' prefix is added if missing."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // Normalize runId — accept both "r-abc" and "abc"
      const normalizedId = runId.startsWith("r-") ? runId : ("r-" + runId);

      // Precondition 1: run exists in registry
      const run = getRun(projectDir, normalizedId);
      if (!run) {
        return errorResult("Run " + normalizedId + " not found in registry");
      }

      // Precondition 2: status is non-terminal
      const RESUMABLE = new Set(["running", "gate-pending", "created"]);
      if (!RESUMABLE.has(run.status)) {
        return errorResult(
          "Run " + normalizedId + " is " + run.status + "; resume only supports running, gate-pending, or created"
        );
      }

      // Precondition 3: projectRoot matches current project
      if (run.projectRoot && !pathsEqual(run.projectRoot, projectDir)) {
        return errorResult(
          "Run " + normalizedId + " belongs to project " + run.projectRoot +
          "; current project is " + projectDir
        );
      }

      // Precondition 4: bound worktree, if any, must exist on disk
      if (run.worktreePath && !existsSync(run.worktreePath)) {
        return errorResult(
          "Run " + normalizedId + "'s worktree at " + run.worktreePath +
          " no longer exists. Restore the worktree directory or discard the run."
        );
      }

      // Report-only recovery primitive: read the previous run-active.json's
      // `currentUnit` BEFORE overwriting. If it is non-null, the prior session
      // ended while a FORGE agent was in flight (SubagentStop never fired).
      // We surface this to the skill as a stale-lock signal; the new
      // run-active.json starts with a clean slate (no in-flight marker).
      //
      // Truthfulness: if the prior marker belongs to a run that is already
      // terminal (completed / failed / discarded), the marker is stale-by-
      // finish rather than stale-by-crash — suppress it so /forge:resume
      // doesn't render a misleading notice. Mirrors the SessionStart cleanup
      // in hooks/ctx-session-start.js. Defensive: if the referenced run can't
      // be verified (no prior runId / registry miss / throw), keep the marker.
      const TERMINAL_STATUSES = new Set(["completed", "failed", "discarded"]);
      const runActivePath = join(check.pipelineDir, "run-active.json");
      let staleUnit = null;
      try {
        const priorRaw = readFileSync(runActivePath, "utf8");
        const prior = JSON.parse(priorRaw);
        if (prior && prior.currentUnit && typeof prior.currentUnit === "object") {
          staleUnit = prior.currentUnit;
          const priorRunId = typeof prior.runId === "string" ? prior.runId : null;
          if (priorRunId) {
            try {
              const priorRun = getRun(projectDir, priorRunId);
              if (priorRun && TERMINAL_STATUSES.has(priorRun.status)) {
                staleUnit = null;
              }
            } catch (_) {
              // Registry lookup failed — keep the marker (defensive).
            }
          }
        }
      } catch (_) {
        // Absent / unreadable / unparseable — no stale signal, not an error.
        staleUnit = null;
      }

      // Success effect: overwrite run-active.json steering pointer.
      // We do NOT mutate run.status, gateState, or agents — those are
      // owned by the pipeline skills; resume only restores the per-session pointer.
      const runActiveData = {
        startedAt: Date.now(),
        runId: run.runId,
        pipelineType: run.pipelineType,
        feature: run.feature,
        agents: [],
      };
      if (run.worktreePath) runActiveData.worktreePath = run.worktreePath;
      if (run.stages != null) {
        runActiveData.stages = run.stages;
      }

      try {
        writeJsonSafe(runActivePath, runActiveData);
      } catch (writeErr) {
        return errorResult(
          "Failed to update run-active.json: " + writeErr.message + ". Run-active state was not modified."
        );
      }

      // Write per-run active file alongside singleton (AC-4).
      // Non-fatal: stale-unit suppression logic above is unchanged regardless.
      try {
        writeRunActive(projectDir, run.runId, runActiveData);
      } catch (perRunErr) {
        console.error("[forge_resume_run] per-run active write failed (non-fatal): " + perRunErr.message);
      }

      // Return structured fields for the future /forge:resume skill to render.
      return textResult({
        runId: run.runId,
        pipelineType: run.pipelineType,
        feature: run.feature,
        status: run.status,
        gateState: run.gateState || null,
        worktreePath: run.worktreePath || null,
        branchName: run.branchName || null,
        currentUnit: staleUnit,
      });
    } catch (err) {
      return errorResult("forge_resume_run failed: " + err.message);
    }
  },
);

// -- Tool: forge_advance_stage -----------------------------------------------
//
// Advances a run to a named pipeline stage: validates the run is non-terminal,
// verifies no other stage is currently running, marks the target stage as
// "running", then spawns a headless forge-worker.mjs in the run's working dir.
// Models on forge_create_run (spawn block) and forge_resume_run (validation).

server.registerTool(
  "forge_advance_stage",
  {
    title: "FORGE Advance Stage",
    description: "Advances a run to the named pipeline stage. Validates the run is non-terminal and no other stage is currently running, marks the target stage as 'running', then spawns a headless forge-worker.mjs worker.",
    inputSchema: z.object({
      runId: runIdSchema.describe("Run ID (e.g. r-a1b2c3d4)"),
      targetStage: z.string().min(1).describe("Stage name to advance to (e.g. 'implement', 'review')"),
      agents: z.array(z.string()).optional().describe("Agent list to store in stages[targetStage].agents. When omitted, defaults to []."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ runId, targetStage, agents }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      // Validate run exists
      const run = getRun(projectDir, runId);
      if (!run) {
        return errorResult("Run " + runId + " not found in registry");
      }

      // Validate run is non-terminal
      const TERMINAL_STATUSES = new Set(["completed", "failed", "discarded"]);
      if (TERMINAL_STATUSES.has(run.status)) {
        return errorResult(
          "Run " + runId + " is " + run.status + "; cannot advance a terminal run",
        );
      }

      // Validate no other stage is currently running
      const stages = run.stages || {};
      const runningStage = Object.entries(stages).find(
        ([name, s]) => s.status === "running" && name !== targetStage,
      );
      if (runningStage) {
        return errorResult(
          "Stage `" + runningStage[0] + "` is still running — complete it before advancing",
        );
      }

      // Mark target stage as running
      const stagesPatch = {
        ...stages,
        [targetStage]: { status: "running", agents: Array.isArray(agents) ? agents : [] },
      };
      const updatedRun = updateRun(projectDir, runId, { stages: stagesPatch, status: "running" });

      // Refresh run-active.json stages so subagent hooks see the updated allowlist.
      // Note: forge_update_run does not touch run-active.json by design; only
      // forge_create_run, forge_resume_run, and forge_advance_stage do. If the
      // conductor calls forge_update_run({ stages: ... }) mid-run to add a reviewer
      // agent, run-active.json won't reflect it until next resume — the allowlist
      // warning may fire spuriously for that agent. Acceptable limitation.
      // Fail-open: if run-active.json is absent or belongs to a different run, skip.
      const runActivePath = join(projectDir, ".pipeline", "run-active.json");
      try {
        const rawActive = readFileSync(runActivePath, "utf8");
        const activeData = JSON.parse(rawActive);
        if (activeData && activeData.runId === runId) {
          activeData.stages = updatedRun.stages ?? null;
          writeJsonSafe(runActivePath, activeData);
        }
      } catch (_) {
        // run-active.json absent or belongs to a different run — skip silently
      }

      // Update per-run active file stages alongside singleton (AC-5).
      // Fail-open: if per-run file is absent, skip silently.
      try {
        const perRunActivePath = getRunActivePath(projectDir, runId);
        const rawPerRun = readFileSync(perRunActivePath, "utf8");
        const perRunData = JSON.parse(rawPerRun);
        if (perRunData && typeof perRunData === 'object') {
          perRunData.stages = updatedRun.stages ?? null;
          writeRunActive(projectDir, runId, perRunData);
        }
      } catch (_) {
        // Per-run active file absent or unreadable — skip silently (fail-open)
      }

      // Guard: prevent recursive spawning inside a worker process. Env-var check
      // (set by mcp/forge-worker.mjs when spawning the worker's MCP server) is
      // race-free vs. the previous file-system check; see forge_create_run for
      // the full rationale.
      if (process.env.FORGE_WORKER_SESSION === '1') {
        console.error("[forge_advance_stage] FORGE_WORKER_SESSION is set — skipping spawn (already inside a worker)");
        return textResult({ runId, targetStage, workerSpawned: false, logFile: null });
      }

      // Sweep stale PID files before collision guard so zombie "running" entries
      // do not falsely block this advance path.
      const mainProjectDirAdv = resolveMainProjectDir();
      const sweepResultAdv = sweepStalePids(mainProjectDirAdv);
      if (sweepResultAdv.swept > 0) {
        console.error('[forge_advance_stage] sweepStalePids swept ' + sweepResultAdv.swept + ' stale PID(s), alive=' + sweepResultAdv.alive + ', errors=' + sweepResultAdv.errors);
      }

      // Guard: prevent worker collision (AC-11) — narrowed to true conflicts.
      //
      // At this point `run` has its final worktreePath/branchName. Apply the
      // predicate against other running runs:
      //   (a.worktreePath && a.worktreePath === b.worktreePath) ||
      //   (a.branchName   && a.branchName   === b.branchName)   ||
      //   (a.worktreePath === null && b.worktreePath === null && a.projectRoot === b.projectRoot)
      const runningForCollision = listRuns(projectDir, { status: "running" }).filter(r => r.runId !== runId);
      const collidingRuns = runningForCollision.filter((b) => {
        if (run.worktreePath && run.worktreePath === b.worktreePath) return true;
        if (run.branchName && run.branchName === b.branchName) return true;
        if (run.worktreePath == null && b.worktreePath == null && run.projectRoot === b.projectRoot) return true;
        return false;
      });
      if (collidingRuns.length > 0) {
        const conflicting = collidingRuns.map(r => r.runId).join(", ");
        return errorResult(
          "Worker collision blocked: run(s) " + conflicting + " conflict with this run's worktree, branch, or main-root slot. Wait for them to finish or mark them failed/discarded before advancing.",
        );
      }

      // Write worker-task-<runId>.json in the run's working directory
      const workDir = run.worktreePath || projectDir;
      const taskDir = join(workDir, ".pipeline");
      if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true });
      const safeFeature = sanitizeFeatureName(run.feature || "");
      const taskFilePath = join(taskDir, "worker-task-" + runId + ".json");
      writeFileSync(
        taskFilePath,
        JSON.stringify(
          { runId, feature: safeFeature, pipelineType: targetStage, originalPipelineType: run.pipelineType, targetStage, createdAt: new Date().toISOString() },
          null,
          2,
        ) + "\n",
        "utf-8",
      );

      // Spawn forge-worker.mjs headlessly (same pattern as forge_create_run)
      const workerScriptPath = join(dirname(fileURLToPath(import.meta.url)), "forge-worker.mjs");
      const logFile = workerLogPath(projectDir, runId);
      const logDir = join(projectDir, ".pipeline", "worker-logs");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const logFd = openSync(logFile, "a");
      let child;
      try {
        child = nodeSpawn(process.execPath, [workerScriptPath], {
          cwd: workDir,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["ignore", logFd, logFd],
        });
        child.on("error", (err) => {
          console.error("[forge_advance_stage] worker spawn failed: " + err.message);
          try { unlinkSync(taskFilePath); } catch (_) {}
          // Mark run as failed so conductor can see the spawn failure
          try {
            const runFilePath = join(projectDir, ".pipeline", "runs", runId, "run.json");
            const raw = readFileSync(runFilePath, "utf-8");
            const runData = JSON.parse(raw);
            if (runData.status === "running") {
              runData.status = "failed";
              runData.failureReason = "worker spawn error (advance_stage): " + err.message;
              runData.updatedAt = new Date().toISOString();
              writeJsonSafe(runFilePath, runData);
            }
          } catch (updateErr) {
            console.error("[forge_advance_stage] error handler failed to update run status: " + updateErr.message);
          }
        });
        child.on("exit", (code) => {
          try { closeSync(logFd); } catch (_) {}
          if (code !== 0 && code !== null) {
            try {
              const runFilePath = join(projectDir, ".pipeline", "runs", runId, "run.json");
              const raw = readFileSync(runFilePath, "utf-8");
              const runData = JSON.parse(raw);
              if (runData.status === "running") {
                runData.status = "failed";
                runData.failureReason = "worker process exited with code " + code + " (advance_stage)";
                runData.updatedAt = new Date().toISOString();
                writeJsonSafe(runFilePath, runData);
              }
            } catch (exitErr) {
              console.error("[forge_advance_stage] exit handler failed to update run status: " + exitErr.message);
            }
          }
        });
        child.unref();
      } catch (spawnErr) {
        try { closeSync(logFd); } catch (_) {}
        throw spawnErr;
      }

      return textResult({ runId, targetStage, workerSpawned: true, logFile });
    } catch (err) {
      return errorResult("forge_advance_stage failed: " + err.message);
    }
  },
);

// -- Tool: forge_dashboard_state ---------------------------------------------
//
// Read-only control-plane snapshot. Returns a compact registry-backed summary
// of active runs, pending gates, recent completed runs, and board counts so
// future UI surfaces (skill, TUI, tiny HTTP sidecar) can share one stable
// data contract. Intentionally stops at the contract layer — no server, no
// WebSocket, no file watcher, no background-worker assumptions.
//
// The state-building logic lives in mcp/lib/dashboard-state.js so the local
// HTTP sidecar at scripts/dashboard-server.mjs can reuse the exact same code.

server.registerTool(
  "forge_dashboard_state",
  {
    title: "FORGE Dashboard State",
    description:
      "Read-only control-plane snapshot: active runs, pending gates, recent completed runs, and board summary. Backed by the existing registry and board files — no new persisted state, no background worker, no file watcher. Future UI surfaces consume this single shape.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;
      return textResult(await buildDashboardState(projectDir));
    } catch (err) {
      return errorResult("forge_dashboard_state failed: " + err.message);
    }
  },
);

// -- Tool: forge_get_constraints --------------------------------------------

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

// -- Tool: forge_get_patterns -----------------------------------------------

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

// -- Tool: forge_add_learning -----------------------------------------------

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

// -- Tool: forge_kill_worker -------------------------------------------------

server.registerTool(
  'forge_kill_worker',
  {
    title: 'FORGE Kill Worker',
    description:
      'Request graceful shutdown of a running worker. Writes a poison-pill sentinel file that the worker detects within 1 s and uses to stop itself, then optionally sends SIGTERM if the PID sidecar exists. The worker updates run status to "discarded" on pill detection — do not update run status here.',
    inputSchema: z.object({
      runId: runIdSchema.describe('Run ID of the worker to kill.'),
    }),
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async ({ runId }) => {
    try {
      const projectDir = resolveProjectDir();

      // (a) Write poison-pill sentinel file
      const pillPath = killPillPath(projectDir, runId);
      mkdirSync(join(projectDir, '.pipeline', 'worker-kill'), { recursive: true });
      // Overwrite silently if it already exists (idempotent)
      writeFileSync(pillPath, '', 'utf-8');

      // (b) Send SIGTERM if PID sidecar exists and contains a valid numeric PID
      let pidSignaled = false;
      let pid = null;
      const pidFile = join(projectDir, '.pipeline', 'worker-pids', runId + '.json');
      if (existsSync(pidFile)) {
        try {
          const pidData = JSON.parse(readFileSync(pidFile, 'utf-8'));
          if (typeof pidData.pid === 'number' && Number.isFinite(pidData.pid)) {
            pid = pidData.pid;
            try {
              process.kill(pid, 'SIGTERM');
              pidSignaled = true;
            } catch (killErr) {
              // fail-open: process may have already exited; log but do not throw
              console.error('[forge_kill_worker] SIGTERM failed for pid ' + pid + ': ' + killErr.message);
            }
          }
        } catch (readErr) {
          // fail-open: PID sidecar unreadable — pill file is sufficient
          console.error('[forge_kill_worker] failed to read PID sidecar: ' + readErr.message);
        }
      }

      return textResult({ ok: true, poisonPillWritten: true, pidSignaled, pid });
    } catch (err) {
      return errorResult('forge_kill_worker failed: ' + err.message);
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

// -- Connect -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
