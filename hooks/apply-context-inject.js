'use strict';

// apply-context-inject.js — SubagentStart hook for apply-phase agents
//
// When the implementer or documenter agent starts, this hook resolves the
// most recent implement run that has a worktree. If found and the worktree
// directory exists on disk, it injects additionalContext telling the agent
// to work in the worktree path instead of the main project directory.
//
// This is the "apply consumes the correct worktree" enforcement point.
// It fires structurally via SubagentStart — no model cooperation needed.
//
// Best-effort: never blocks the subagent, never exits non-zero.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveProjectDir, resolvePluginRoot, stripAnsi, STDIN_TIMEOUT_SHORT } = require('./hook-utils');

const STDIN_TIMEOUT_MS = STDIN_TIMEOUT_SHORT;

// Apply-phase agents that should receive worktree context
const APPLY_AGENTS = new Set(['implementer', 'documenter']);

function exitOk() { process.exit(0); }

async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const agentType = payload.agent_type || null;

  // Only act on apply-phase agents
  if (!agentType || !APPLY_AGENTS.has(agentType)) { exitOk(); return; }

  const projectDir = resolveProjectDir(payload);

  // Import run registry functions (ESM modules loaded dynamically)
  let listRuns, getRun;
  try {
    const pluginRoot = resolvePluginRoot();
    const coreIndex = path.join(pluginRoot, 'packages', 'forge-core', 'src', 'runs', 'index.js');
    const coreMod = await import('file:///' + coreIndex.replace(/\\/g, '/'));
    listRuns = coreMod.listRuns;
    getRun = coreMod.getRun;
  } catch (err) {
    console.error('[apply-context] Failed to load core module: ' + err.message);
    exitOk();
    return;
  }

  // Find the most recent implement run with a worktree
  try {
    const candidates = listRuns(projectDir, { pipelineType: 'implement' })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    let targetRun = null;
    for (const entry of candidates) {
      const run = getRun(projectDir, entry.runId);
      if (run && run.worktreePath) {
        // Verify the worktree directory still exists on disk
        if (fs.existsSync(run.worktreePath)) {
          targetRun = run;
          break;
        } else {
          console.error('[apply-context] Worktree path missing on disk: ' + run.worktreePath);
        }
      }
    }

    if (!targetRun) {
      // No worktree-backed implement run found — the implementer/documenter
      // will work in the main project directory as before. This is the
      // fallback for SPRINT/DIRECT modes or when no worktree was created.
      console.error('[apply-context] No worktree-backed implement run found — using main project');
      exitOk();
      return;
    }

    // Build the worktree context message
    const wtPath = targetRun.worktreePath;
    const handoffPath = path.join(wtPath, 'docs', 'context', 'handoff.md');
    const feature = targetRun.feature || 'unknown';

    const context = [
      'FORGE WORKTREE CONTEXT',
      '═══════════════════════',
      '',
      'This apply phase is backed by run ' + targetRun.runId + ' (feature: ' + feature + ').',
      'Worktree: ' + wtPath,
      'Branch: ' + (targetRun.branchName || 'unknown'),
      '',
      'CRITICAL — all file operations must target the worktree:',
      '',
      '• Read the handoff from: ' + handoffPath,
      '• All source file reads and edits must use the worktree path.',
      '  Example: to edit src/main.js → ' + path.join(wtPath, 'src', 'main.js'),
      '• Do NOT read or edit source files in the main project directory.',
      '• docs/ and .pipeline/ files in the worktree are the correct copies.',
      '',
      'The worktree is on branch ' + (targetRun.branchName || 'forge/' + targetRun.runId) + '.',
      'After apply completes, changes will be merged back to the main branch.',
    ].join('\n');

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: context,
      },
    }) + '\n');

    console.error('[apply-context] Injected worktree context for ' + stripAnsi(agentType) + ' → ' + stripAnsi(wtPath));

  } catch (err) {
    console.error('[apply-context] Failed to resolve worktree: ' + err.message);
    // Non-fatal — agent proceeds without worktree context
  }

  exitOk();
}

// -- Stdin reader with timeout guard -----------------------------------------
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
