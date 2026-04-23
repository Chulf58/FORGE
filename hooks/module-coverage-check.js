'use strict';

// SessionStart hook — lightweight modules.json coverage check.
// Emits stderr notes when module paths are missing from disk or
// top-level project directories aren't covered by any module.
// Never blocks (exit 0 always). Skips worker sessions.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

const TODO_TAG = 'modules';
const TODO_ID_PREFIX = 'module-gap-';

// Directories that are never modules (infra, config, generated).
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.pipeline', '.worktrees', '.claude',
  '.claude-plugin', '.vscode', 'dist', 'build', 'coverage',
  'docs', '.mcp.json',
]);

function exitOk() { process.exit(0); }

async function main(rawInput) {
  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    exitOk();
    return;
  }

  // Skip worker sessions
  if (process.env.CLAUDE_CODE_TEAM_NAME) {
    exitOk();
    return;
  }

  const projectDir = resolveProjectDir(payload);
  const modulesPath = path.join(projectDir, '.pipeline', 'modules.json');

  let modules;
  try {
    const raw = fs.readFileSync(modulesPath, 'utf8');
    modules = JSON.parse(raw);
    if (!Array.isArray(modules) || modules.length === 0) {
      exitOk();
      return;
    }
  } catch (_) {
    exitOk();
    return;
  }

  const warnings = [];

  // Check 1: module paths that don't exist on disk
  for (const mod of modules) {
    if (!Array.isArray(mod.paths)) continue;
    for (const p of mod.paths) {
      const full = path.join(projectDir, p);
      if (!fs.existsSync(full)) {
        warnings.push('module "' + mod.id + '": path missing: ' + p);
      }
    }
  }

  // Check 2: top-level directories not covered by any module
  const allModulePaths = new Set();
  for (const mod of modules) {
    if (!Array.isArray(mod.paths)) continue;
    for (const p of mod.paths) {
      // Normalize: "hooks/" → "hooks", "mcp/lib/foo.js" → "mcp"
      const topLevel = p.split('/')[0].split('\\')[0];
      allModulePaths.add(topLevel);
    }
  }

  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (!allModulePaths.has(entry.name)) {
        warnings.push('directory "' + entry.name + '/" not covered by any module');
      }
    }
  } catch (_) {
    // Can't read project dir — skip silently
  }

  if (warnings.length === 0) {
    exitOk();
    return;
  }

  console.error('[forge-modules] ' + warnings.length + ' gap(s) in modules.json:');
  for (const w of warnings) {
    console.error('  · ' + w);
  }

  // Auto-add a TODO if one doesn't already exist for these gaps.
  const boardPath = path.join(projectDir, '.pipeline', 'board.json');
  try {
    let board;
    try {
      board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    } catch (_) {
      exitOk();
      return;
    }
    if (!Array.isArray(board.todos)) board.todos = [];

    const existingGapTodo = board.todos.find(
      t => !t.done && Array.isArray(t.tags) && t.tags.includes(TODO_TAG) && t.id.startsWith(TODO_ID_PREFIX)
    );

    if (!existingGapTodo) {
      const todoText = 'Update .pipeline/modules.json — ' + warnings.length +
        ' gap(s) detected: ' + warnings.join('; ');
      board.todos.push({
        id: TODO_ID_PREFIX + Date.now().toString(36),
        priority: 'low',
        text: todoText,
        title: 'Update modules.json coverage',
        summary: warnings.length + ' module gap(s): ' + warnings.slice(0, 3).join(', '),
        done: false,
        addedAt: Date.now(),
        tags: [TODO_TAG],
      });
      fs.writeFileSync(boardPath, JSON.stringify(board, null, 2) + '\n', 'utf8');
      console.error('[forge-modules] Added TODO to board for module gaps');
    }
  } catch (_) {
    // Board write failed — stderr warning is enough
  }

  exitOk();
}

let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, STDIN_TIMEOUT_MS);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
