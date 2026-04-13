import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readForgeConfig, writeForgeConfig, resolvePluginDataDir } from "./lib/config-store.js";
import { readUsage, writeUsage, markQuotaExhausted, recordUsage } from "./lib/usage-store.js";
import { recommendModel } from "./lib/router.js";
import { callOpenAI } from "./lib/openai-adapter.js";
import { createRun, getRun, listRuns, updateRun, createWorktree } from "../packages/forge-core/src/runs/index.js";

// -- Helpers -----------------------------------------------------------------

function resolveProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function readJsonSafe(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// WARNING: No file locking. Concurrent MCP tool calls writing to the same file
// (e.g. parallel reviewers calling forge_add_todo) can cause last-write-wins data loss.
// Acceptable for single-session use. If multi-session support is added, implement
// file locking or move to a lightweight DB.
function writeJsonSafe(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
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

// Case-insensitive on Windows; absolute-path equality after slash normalization.
// Used by forge_resume_run to verify the run's projectRoot matches the current project.
function pathsEqual(a, b) {
  const A = resolve(a).replace(/\\/g, "/");
  const B = resolve(b).replace(/\\/g, "/");
  return process.platform === "win32" ? A.toLowerCase() === B.toLowerCase() : A === B;
}

// Pipeline currentStep -> human-readable stage label.
// DUPLICATED from bin/forge-status.js PIPELINE_STAGES — keep in sync. The duplication
// is intentional: bin/forge-status.js is CommonJS and not importable from this ESM
// module, and a shared extraction was deferred until a second consumer needed it.
// forge_resume_run is the second consumer; if a third arrives, extract to mcp/lib/.
const PIPELINE_STAGE_LABELS = {
  plan: {
    "started": "starting", "brainstormer-decision": "brainstorming",
    "planner": "planner", "researcher": "researcher", "gotcha-checker": "gotcha-check",
    "reviewer-triage": "reviewers", "reviewer": "reviewers", "gate1": "gate1",
  },
  implement: {
    "started": "starting", "setup": "setup",
    "implementation-architect": "scoping slice", "coder-scout": "scout", "coder": "coder",
    "completeness-checker": "completeness",
    "reviewer-triage": "reviewers", "reviewer": "reviewers", "gate2": "gate2",
  },
  apply: {
    "started": "starting", "setup": "setup",
    "implementer-triage": "triage", "implementer": "implementer",
    "testing": "tests", "documenter": "documenter",
    "worktree-commit": "wt-commit", "merge-back": "merge-back", "done": "done",
  },
  debug: {
    "started": "starting", "debug": "tracing",
    "reviewer-triage": "reviewers", "reviewer": "reviewers", "gate2": "gate2",
  },
  refactor: {
    "started": "starting", "refactor": "analyzing",
    "reviewer-triage": "reviewers", "reviewer": "reviewers", "gate2": "gate2",
  },
};

function stageLabelFor(pipelineType, currentStep) {
  if (!currentStep) return null;
  const map = PIPELINE_STAGE_LABELS[pipelineType];
  if (!map) return currentStep;
  return map[currentStep] || currentStep;
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
    description: "Returns tasks from the board's todos array, optionally filtered. Reads todos only (not the planned array).",
    inputSchema: z.object({
      status: z.enum(["open", "done", "all"]).default("open").describe("Filter by task status"),
      priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
      tags: z.array(z.string()).optional().describe("Filter by tags (AND logic)"),
      blocked: z.enum(["blocked", "unblocked", "all"]).default("all").describe("Filter by blocked state")
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  },
  async ({ status, priority, tags, blocked }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

      const boardPath = join(check.pipelineDir, "board.json");
      const read = readJsonSafe(boardPath);
      if (!read.ok) return errorResult("Failed to read board: " + read.error);

      let items = read.data.todos || [];

      // Filter by status
      if (status === "open") {
        items = items.filter(item => !item.done);
      } else if (status === "done") {
        items = items.filter(item => item.done);
      }
      // "all" — no filter

      // Filter by priority
      if (priority) {
        items = items.filter(item => item.priority === priority);
      }

      // Filter by tags (AND logic)
      if (tags && tags.length > 0) {
        items = items.filter(item => {
          const itemTags = item.tags || [];
          return tags.every(t => itemTags.includes(t));
        });
      }

      // Filter by blocked state
      if (blocked === "blocked") {
        items = items.filter(item => {
          const deps = item.blockedBy || [];
          return deps.length > 0;
        });
      } else if (blocked === "unblocked") {
        items = items.filter(item => {
          const deps = item.blockedBy || [];
          return deps.length === 0;
        });
      }

      return textResult(items);
    } catch (err) {
      return errorResult("Failed to read board: " + err.message);
    }
  }
);

// -- Tool: forge_add_todo ----------------------------------------------------

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

      const task = {
        id: randomUUID().slice(0, 8),
        priority,
        text,
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

      // Apply done with guards
      if (done === true && !task.done) {
        task.done = true;
        task.doneAt = Date.now();
      } else if (done === false) {
        task.done = false;
        delete task.doneAt;
      }

      // Apply text
      if (text !== undefined) {
        task.text = text;
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

const ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand"];

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
      runId: z.string().optional().describe("Run ID this gate belongs to. If omitted, the tool resolves it by status."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
  },
  async ({ gate, feature, status, runId }) => {
    try {
      const projectDir = resolveProjectDir();
      const check = requirePipeline(projectDir);
      if (!check.ok) return check.result;

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
      return textResult(recommendation);
    } catch (err) {
      return errorResult("forge_get_model_recommendation failed: " + err.message);
    }
  },
);

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
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ providerId, modelId, prompt, maxTokens }) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config } = readForgeConfig(pluginDataDir, projectDir);

      // Find and validate provider
      const provider = (config.providers || []).find(p => p.id === providerId);
      if (!provider || !provider.enabled) {
        return errorResult("Provider not found or disabled: " + providerId);
      }

      // Resolve API key — reject undefined and empty string
      const apiKey = process.env[provider.envVar];
      if (!apiKey) {
        return errorResult("API key env var not set or empty: " + provider.envVar);
      }

      // Only openai type is supported in this adapter
      if (provider.type !== "openai") {
        return errorResult("Provider type not supported: " + provider.type);
      }

      let result;
      try {
        result = await callOpenAI(prompt, modelId, apiKey, { maxTokens });
      } catch (callErr) {
        // Mark quota exhausted on 401, 429, or quota errors before surfacing
        const msg = callErr.message || "";
        if (msg.includes("401") || msg.includes("429") || msg.toLowerCase().includes("quota")) {
          try { markQuotaExhausted(projectDir, providerId); } catch (_) { /* best-effort */ }
        }
        return errorResult("External call failed: " + callErr.message);
      }

      // Record usage if quota tracking is enabled
      if (config.quotaTracking) {
        try {
          recordUsage(projectDir, providerId, result.inputTokens + result.outputTokens);
        } catch (_) { /* best-effort — do not fail the call on tracking errors */ }
      }

      return textResult({
        text: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
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

      const resetAt = new Date().toISOString();

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
          usage.providers[providerId].requestCount = 0;
          usage.providers[providerId].tokenCount = 0;
          usage.providers[providerId].quotaExhausted = false;
          usage.providers[providerId].lastUsed = null;
          usage.providers[providerId].resetAt = resetAt;
        }
      } else {
        // Reset all known providers
        for (const id of Object.keys(usage.providers)) {
          usage.providers[id].requestCount = 0;
          usage.providers[id].tokenCount = 0;
          usage.providers[id].quotaExhausted = false;
          usage.providers[id].lastUsed = null;
          usage.providers[id].resetAt = resetAt;
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
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ agentName, preferred, fallback, requiredCapabilities }) => {
    try {
      const projectDir = resolveProjectDir();
      const pluginDataDir = resolvePluginDataDir();
      const { config, configPath } = readForgeConfig(pluginDataDir, projectDir);

      if (!config.agentModelMap || !config.agentModelMap[agentName]) {
        return errorResult("Agent not in agentModelMap: " + agentName);
      }

      // Apply provided fields in-place
      const entry = config.agentModelMap[agentName];
      if (preferred !== undefined) entry.preferred = preferred;
      if (fallback !== undefined) entry.fallback = fallback;
      if (requiredCapabilities !== undefined) entry.requiredCapabilities = requiredCapabilities;

      writeForgeConfig(configPath, config);
      return textResult(config.agentModelMap[agentName]);
    } catch (err) {
      return errorResult("forge_update_agent_model failed: " + err.message);
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
      availableOnly: z.boolean().default(false).describe("If true, exclude models whose provider has quotaExhausted: true"),
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

      // Filter by availability (exclude exhausted-provider models)
      if (availableOnly) {
        models = models.filter(m => {
          const exhausted = usage.providers?.[m.providerId]?.quotaExhausted ?? false;
          return !exhausted;
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

// -- Tool: forge_create_run --------------------------------------------------

server.registerTool(
  "forge_create_run",
  {
    title: "FORGE Create Run",
    description: "Creates a new pipeline run. Returns the full run object with a generated runId.",
    inputSchema: z.object({
      sessionId: z.string().describe("Claude session ID"),
      pipelineType: z.enum(["plan", "implement", "apply", "debug", "refactor"]).describe("Pipeline type"),
      mode: z.enum(["TRIVIAL", "SPRINT", "LEAN", "STANDARD", "FULL"]).describe("Pipeline mode"),
      feature: z.string().default("").describe("Feature name or description"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ sessionId, pipelineType, mode, feature }) => {
    try {
      const projectDir = resolveProjectDir();
      const run = createRun({ projectRoot: projectDir, sessionId, pipelineType, mode, feature });
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
        feature,
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
      runId: z.string().describe("Run ID (e.g. r-a1b2c3d4)"),
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
    description: "Lists all runs from the index, optionally filtered by status or pipeline type.",
    inputSchema: z.object({
      status: z.enum(["created", "running", "gate-pending", "completed", "failed", "discarded"]).optional().describe("Filter by run status"),
      pipelineType: z.enum(["plan", "implement", "apply", "debug", "refactor"]).optional().describe("Filter by pipeline type"),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async ({ status, pipelineType }) => {
    try {
      const projectDir = resolveProjectDir();
      const runs = listRuns(projectDir, { status, pipelineType });
      return textResult(runs);
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
      runId: z.string().describe("Run ID to update"),
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
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ runId, ...patch }) => {
    try {
      const projectDir = resolveProjectDir();
      // Strip undefined values so the core function only sees actual changes
      const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));

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
      runId: z.string().describe("Run ID to create a worktree for"),
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
      runId: z.string().describe("Run ID to resume (e.g. r-a1b2c3d4). The 'r-' prefix is added if missing."),
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

      const runActivePath = join(check.pipelineDir, "run-active.json");
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
      });
    } catch (err) {
      return errorResult("forge_resume_run failed: " + err.message);
    }
  },
);

// -- Connect -----------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
