import { z } from 'zod';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  resolveProjectDir,
  readJsonSafe,
  writeJsonSafe,
  errorResult,
  textResult,
  requirePipeline,
} from './shared.js';

export function register(server, _shared) {

  // -- Tool: forge_read_modules ------------------------------------------------

  server.registerTool(
    'forge_read_modules',
    {
      title: 'FORGE Read Modules',
      description: 'Returns the module registry — all functional modules with their capabilities',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        const modulesPath = join(check.pipelineDir, 'modules.json');
        if (!existsSync(modulesPath)) {
          return textResult([]);
        }

        const read = readJsonSafe(modulesPath);
        if (!read.ok) return errorResult('Failed to read modules.json: ' + read.error);

        return textResult(read.data);
      } catch (err) {
        return errorResult('Failed to read modules: ' + err.message);
      }
    },
  );

  // -- Tool: forge_assign_module -----------------------------------------------

  server.registerTool(
    'forge_assign_module',
    {
      title: 'FORGE Assign Module',
      description: 'Assigns a task to a module by setting the module field on a board task',
      inputSchema: z.object({
        taskId: z.string().describe('Task ID to assign'),
        moduleId: z.string().describe('Module ID to assign to'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ taskId, moduleId }) => {
      try {
        const projectDir = resolveProjectDir();
        const check = requirePipeline(projectDir);
        if (!check.ok) return check.result;

        // Verify module exists
        const modulesPath = join(check.pipelineDir, 'modules.json');
        if (existsSync(modulesPath)) {
          const modRead = readJsonSafe(modulesPath);
          if (modRead.ok) {
            const modules = Array.isArray(modRead.data) ? modRead.data : [];
            const found = modules.find(m => m.id === moduleId);
            if (!found) {
              return errorResult('Module not found: ' + moduleId);
            }
          }
        }

        // Find and update task
        const boardPath = join(check.pipelineDir, 'board.json');
        const read = readJsonSafe(boardPath);
        if (!read.ok) return errorResult('Failed to read board: ' + read.error);

        const board = read.data;
        const allTasks = [...(board.todos || []), ...(board.planned || [])];
        const task = allTasks.find(t => t.id === taskId);

        if (!task) {
          return errorResult('Task not found: ' + taskId);
        }

        task.module = moduleId;
        writeJsonSafe(boardPath, board);

        return textResult(task);
      } catch (err) {
        return errorResult('Failed to assign module: ' + err.message);
      }
    },
  );

}
