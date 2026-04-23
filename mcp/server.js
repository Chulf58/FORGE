import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readForgeConfig, writeForgeConfig, resolvePluginDataDir } from "./lib/config-store.js";
import { readUsage, writeUsage, markQuotaExhausted, markModelQuotaExhausted, recordUsage } from "./lib/usage-store.js";
import { recommendModel } from "./lib/router.js";
import { callOpenAI } from "./lib/openai-adapter.js";
import { callGemini } from "./lib/gemini-adapter.js";
import { addModelToConfig, updateModelInConfig } from "./lib/model-validation.js";
import { createRun, getRun, listRuns, updateRun, createWorktree, rebuildIndex } from "../packages/forge-core/src/runs/index.js";
import { buildDashboardState } from "./lib/dashboard-state.js";
import { sanitizeFeatureName } from "./lib/sanitize.js";

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

function resolveProjectDir() {
  return resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function resolveMainProjectDir() {
  const projectDir = resolveProjectDir();
  const gitFile = join(projectDir, ".git");
  try {
    const content = readFileSync(gitFile, "utf8").trim();
    if (content.startsWith("gitdir:")) {
      const gitdir = content.replace("gitdir:", "").trim();
      const match = gitdir.match(/(.+)[/\\]\.git[/\\]worktrees[/\\]/);
      if (match) return resolve(match[1]);
    }
  } catch (_) {}
  return projectDir;
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

// -- Mode-hardening validation ------------------------------------------------
// Prevents SPRINT from being used on tasks whose pipeline type or feature
// description implies risk-surface work that needs reviewer coverage.
// Enforced at both forge_create_run and forge_resume_run.
// Note: SUPERVISED mode (direct edits by conductor) doesn't create runs at all,
// so it never reaches this validation.

const RISK_KEYWORDS = /\b(hook|hooks|mcp|security|auth|crypto|secret|credential|token|spawn|child_process|migration|schema|contract|network|fetch|http|inject|xss|csrf|permission|guard|enforcement|worktree|merge)\b/i;

function validateModeForRisk(pipelineType, mode, feature) {
  if (mode !== 'SPRINT') return null;

  // SPRINT: blocked for source-mutating pipelines when feature description
  // contains risk-surface keywords. plan/apply don't produce unreviewed mutations.
  const SOURCE_MUTATING = new Set(['implement', 'debug', 'refactor']);
  if (mode === 'SPRINT' && SOURCE_MUTATING.has(pipelineType) && feature && RISK_KEYWORDS.test(feature)) {
    const match = feature.match(RISK_KEYWORDS);
    return (
      'FORGE: Mode SPRINT is not allowed when the feature description indicates ' +
      'risk-surface work (matched: "' + (match ? match[0] : '') + '"). ' +
      'SPRINT skips all reviewers. Use LEAN or higher for this task.'
    );
  }

  return null;
}

// Case-insensitive on Windows; absolute-path equality after slash normalization.
// Used by forge_resume_run to verify the run's projectRoot matches the current project.
function pathsEqual(a, b) {
  const A = resolve(a).replace(/\\/g, "/");
  const B = resolve(b).replace(/\\/g, "/");
  return process.platform === "win32" ? A.toLowerCase() === B.toLowerCase() : A === B;
}

import { stageLabelFor } from "./lib/stage-labels.js";

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
      id: z.string().describe("Task ID to update"),
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
      const task = todos.find(t => t.id === id);

      if (!task) {
        return errorResult("Task not found: " + id);
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

      // Mark done — remove from board (git history preserves it)
      if (done === true && !task.done) {
        board.todos = todos.filter(t => t.id !== id);
        writeJsonSafe(boardPath, board);
        return textResult({ ...task, done: true, doneAt: Date.now(), removed: true });
      } else if (done === false) {
        task.done = false;
        delete task.doneAt;
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

const ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand", "gitIntegration"];

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
      const STRING_KEYS = ["pipelineMode", "description", "testCommand"];
      const ARRAY_KEYS = ["techStacks", "techStackLabels"];
      if (STRING_KEYS.includes(key) && typeof value !== "string") {
        return errorResult("Invalid type for " + key + ": expected string, got " + typeof value);
      }
      if (ARRAY_KEYS.includes(key) && !Array.isArray(value)) {
        return errorResult("Invalid type for " + key + ": expected array, got " + typeof value);
      }

      // Enum validation for pipelineMode
      if (key === "pipelineMode") {
        const VALID_MODES = ["SPRINT", "LEAN", "STANDARD", "FULL"];
        if (!VALID_MODES.includes(value)) {
          return errorResult("Invalid pipelineMode: '" + value + "'. Must be one of: " + VALID_MODES.join(", "));
        }
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
    description: "Returns the current active pipeline run state, or null if no run is active",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const runPath = join(check.pipelineDir, "run-active.json");
      if (!existsSync(runPath)) {
        return textResult(null);
      }

      const read = readJsonSafe(runPath);
      if (!read.ok) return errorResult("Failed to read run-active.json: " + read.error);

      return textResult(read.data);
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
    description: "Returns the current pending gate state (gate1 or gate2), or null if no gate is pending",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async () => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const gatePath = join(check.pipelineDir, "gate-pending.json");
      if (!existsSync(gatePath)) {
        return textResult(null);
      }

      const read = readJsonSafe(gatePath);
      if (!read.ok) return errorResult("Failed to read gate-pending.json: " + read.error);

      return textResult(read.data);
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
    description: "Creates or updates a pending gate (gate1 or gate2). Also syncs run registry automatically.",
    inputSchema: z.object({
      gate: z.enum(["gate1", "gate2"]).describe("Which gate"),
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
      // from the user's current turn (written by approval-token.js when the
      // user says "approve" or invokes /forge:approve).
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
      const gatePath = join(check.pipelineDir, "gate-pending.json");

      // On approval, preserve the original pending gate's createdAt AND runId.
      // Read the existing gate file first — if it has a createdAt/runId from the
      // pending write, carry them forward. Fall back to now / resolved only if missing.
      let originalCreatedAt = now;
      let resolvedRunId = runId || null;
      if (status === "approved") {
        const existing = readJsonSafe(gatePath);
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

      const data = { gate, feature, status, createdAt: originalCreatedAt };
      if (resolvedRunId) data.runId = resolvedRunId;
      if (status === "approved") {
        data.approvedAt = now;
      }

      writeJsonSafe(gatePath, data);

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
            currentStep: gate,
            gateState: { gate, status: "pending", feature, createdAt: now, approvedAt: null },
          });
        } else if (status === "approved" && resolvedRunId) {
          // Preserve the gate's original pending createdAt from the run's gateState if present
          const existingRun = getRun(projectDir, resolvedRunId);
          const gateCreatedAt = (existingRun && existingRun.gateState && existingRun.gateState.createdAt)
            || originalCreatedAt;
          updateRun(projectDir, resolvedRunId, {
            status: "completed",
            currentStep: gate + "-approved",
            gateState: { gate, status: "approved", feature, createdAt: gateCreatedAt, approvedAt: now },
          });
        }
      } catch (_syncErr) {
        // Run registry sync is best-effort — log but don't fail the gate operation
        console.error("[forge_set_gate] run registry sync failed: " + _syncErr.message);
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
  writeFileSync(logPath, JSON.stringify({ entries: capped }, null, 2) + "\n", "utf-8");
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
      id: z.string().describe("Task ID to update"),
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
    description: "Creates a new pipeline run. Returns the full run object with a generated runId.",
    inputSchema: z.object({
      sessionId: z.string().describe("Claude session ID"),
      pipelineType: z.enum(["plan", "implement", "apply", "debug", "refactor", "research"]).describe("Pipeline type"),
      mode: z.enum(["SPRINT", "LEAN", "STANDARD", "FULL"]).describe("Pipeline mode"),
      feature: z.string().default("").describe("Feature name or description"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ sessionId, pipelineType, mode, feature }) => {
    try {
      const projectDir = resolveProjectDir();
      // Sanitize feature name at ingestion — strips shell-injection chars before
      // the value is stored in run.json or returned to skills for git/PR usage.
      const safeFeature = sanitizeFeatureName(feature);

      // Mode-hardening: block under-scoped modes for risky work
      const modeError = validateModeForRisk(pipelineType, mode, safeFeature);
      if (modeError) return errorResult(modeError);

      const run = createRun({ projectRoot: projectDir, sessionId, pipelineType, mode, feature: safeFeature });
      // Immediately mark as running — the model reliably calls forge_create_run
      // but skips the follow-up forge_update_run to set status: "running".
      const started = updateRun(projectDir, run.runId, { status: "running", currentStep: "started" });

      // Initialize run-active.json — the lightweight pipeline marker read by
      // workflow-guard.js (needs startedAt), forge-status.js (needs startedAt +
      // mode), and ctx-stop.js / subagent hooks (need agents array).
      // Overwrite any stale marker from a previous run — each forge_create_run
      // starts a new pipeline, and run-active.json tracks exactly one.
      const runActiveData = {
        startedAt: Date.now(),
        runId: started.runId,
        pipelineType,
        mode,
        feature: safeFeature,
        agents: [],
      };

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

      pruneTerminalRuns(projectDir);

      return textResult(started);
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
    description: "Lists runs from the index, optionally filtered and field-projected. Use `filter` for the newer/ergonomic path with array-aware status/pipelineType/mode matching; legacy flat `status`/`pipelineType` fields remain for backward compatibility but are superseded when `filter` is present. Use `fields` to slim each item to a subset of top-level keys; requesting a key not on the lightweight index entry triggers a full hydration via getRun.",
    inputSchema: z.object({
      status: z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]).optional().describe("Filter by run status (legacy — prefer `filter.status`, which accepts arrays). Ignored when `filter` is present."),
      pipelineType: z.enum(["plan", "implement", "apply", "debug", "refactor"]).optional().describe("Filter by pipeline type (legacy — prefer `filter.pipelineType`, which accepts arrays). Ignored when `filter` is present."),
      filter: z.object({
        status: z.union([
          z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]),
          z.array(z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]))
        ]).optional().describe("Match status — single value or any-of array."),
        pipelineType: z.union([
          z.enum(["plan", "implement", "apply", "debug", "refactor"]),
          z.array(z.enum(["plan", "implement", "apply", "debug", "refactor"]))
        ]).optional().describe("Match pipeline type — single value or any-of array."),
        mode: z.union([
          z.enum(["SPRINT", "LEAN", "STANDARD", "FULL"]),
          z.array(z.enum(["SPRINT", "LEAN", "STANDARD", "FULL"]))
        ]).optional().describe("Match pipeline mode — single value or any-of array. NOTE: mode is not on lightweight index entries, so this filter forces hydration of each candidate via getRun.")
      }).strict().optional().describe("Structured filter object. Supersedes legacy `status`/`pipelineType` when present. Applies `status` → `pipelineType` → `mode`, AND-combined."),
      fields: z.array(z.string()).optional().describe("Top-level keys to include per returned run. Omit for full objects (index-entry shape by default; full hydrated shape when `filter.mode` is used or when `fields` requests a non-index key). Keys not present on an item are silently dropped for that item.")
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
        // New path — pull all entries, then apply status → pipelineType → mode in order.
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
        if (filter.mode !== undefined) {
          // Mode lives on the full Run schema, not the lightweight index entry,
          // so we must hydrate every remaining candidate to evaluate it.
          // Hydrated runs replace the index-entry shape from this point on.
          const allowed = Array.isArray(filter.mode) ? filter.mode : [filter.mode];
          const hydrated = [];
          for (const e of entries) {
            try {
              const full = getRun(projectDir, e.runId);
              if (full && allowed.includes(full.mode)) {
                hydrated.push(full);
              }
            } catch (_) {
              // Skip unhydratable runs (corrupt run.json, missing dir, etc.).
            }
          }
          entries = hydrated;
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
            // Already-hydrated entries from filter.mode path will have non-index keys.
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
      currentStep: z.string().optional().describe("Current pipeline step (e.g. 'planner', 'gate1')"),
      worktreePath: z.string().optional().describe("Worktree path if assigned"),
      branchName: z.string().optional().describe("Branch name if assigned"),
      gateState: z.object({
        gate: z.enum(["gate1", "gate2"]),
        status: z.enum(["pending", "approved", "discarded"]),
        feature: z.string(),
        createdAt: z.string(),
        approvedAt: z.string().nullable().default(null),
      }).optional().describe("Gate state update"),
      acknowledged: z.boolean().optional().describe("Mark research run as acknowledged (findings discussed). Clears the observer card."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ runId, ...patch }) => {
    try {
      const projectDir = resolveProjectDir();
      // Strip undefined values so the core function only sees actual changes
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));

      // Gate-pending status guard: block transitions out of gate-pending to
      // completed/running without a gate approval token. The model cannot skip
      // gates by calling forge_update_run({ status: 'completed' }) directly.
      // forge_set_gate (which has its own token check) calls updateRun() core
      // function directly, so this guard does not interfere with legitimate approvals.
      if (cleanPatch.status && cleanPatch.status !== 'failed' && cleanPatch.status !== 'discarded') {
        const existing = getRun(projectDir, runId);
        if (existing && existing.status === 'gate-pending') {
          if (!hasGateApprovalToken(projectDir)) {
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

      const run = updateRun(projectDir, runId, cleanPatch);
      const mainDir = resolveMainProjectDir();

      // Write completion signal when a research run finishes
      if (cleanPatch.status === "completed" && run.pipelineType === "research") {
        const doneDir = join(mainDir, ".pipeline", "worker-done");
        if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
        const doneFile = join(doneDir, runId + ".json");
        const signal = {
          runId, feature: run.feature || "", pipelineType: "research",
          completedAt: new Date().toISOString(),
        };
        writeFileSync(doneFile, JSON.stringify(signal, null, 2) + "\n", "utf8");
      }

      // Clean up completion signal when research is acknowledged
      if (cleanPatch.acknowledged) {
        const doneFile = join(mainDir, ".pipeline", "worker-done", runId + ".json");
        try { unlinkSync(doneFile); } catch (_) {}
      }

      return textResult(run);
    } catch (err) {
      return errorResult("forge_update_run failed: " + err.message);
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
// the run's status, currentStep, gateState, or agents — resume only updates
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

      // Precondition 5: mode floor — reject resume if the run's mode would be
      // blocked by validateModeForRisk (same check as forge_create_run).
      const modeError = validateModeForRisk(run.pipelineType, run.mode, run.feature);
      if (modeError) {
        return errorResult(
          modeError + " Run " + normalizedId + " was created with mode " + run.mode +
          " which is now below the enforcement floor. Discard this run and create a new one with LEAN or higher."
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
      // We do NOT mutate run.status, currentStep, gateState, or agents — those are
      // owned by the pipeline skills; resume only restores the per-session pointer.
      const runActiveData = {
        startedAt: Date.now(),
        runId: run.runId,
        pipelineType: run.pipelineType,
        mode: run.mode,
        feature: run.feature,
        agents: [],
      };
      if (run.worktreePath) runActiveData.worktreePath = run.worktreePath;

      try {
        writeJsonSafe(runActivePath, runActiveData);
      } catch (writeErr) {
        return errorResult(
          "Failed to update run-active.json: " + writeErr.message + ". Run-active state was not modified."
        );
      }

      // Return structured fields for the future /forge:resume skill to render.
      return textResult({
        runId: run.runId,
        pipelineType: run.pipelineType,
        mode: run.mode,
        feature: run.feature,
        status: run.status,
        currentStep: run.currentStep || null,
        stageLabel: stageLabelFor(run.pipelineType, run.currentStep),
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
      return textResult(buildDashboardState(projectDir));
    } catch (err) {
      return errorResult("forge_dashboard_state failed: " + err.message);
    }
  },
);

// -- Connect -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
