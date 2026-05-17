#!/usr/bin/env node
// @covers mcp/server.js (tool registration completeness gate)
//
// Asserts that the thin-shell mcp/server.js registers all 39 tools by name
// via the 6 domain modules. Mirrors the AC-8 oracle from Phase 6 of the
// server.js split refactor.
//
// Run: node mcp/server-registration-test.mjs
// Auto-discovered by scripts/run-tests.mjs via the *-test.mjs suffix.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, 'server.js');

// The 39 expected tool names — must match what the 6 domain modules register.
// Source of truth: each domain module's `register(server, shared)` body.
const EXPECTED_TOOLS = [
  // board.js — 9 tools
  'forge_read_board',
  'forge_add_todo',
  'forge_update_task',
  'forge_add_note',
  'forge_read_notes',
  'forge_delete_note',
  'forge_read_project',
  'forge_update_config',
  'forge_set_blocked_by',
  // run-gate.js — 3 tools
  'forge_get_active_run',
  'forge_check_gate',
  'forge_set_gate',
  // modules.js — 2 tools
  'forge_read_modules',
  'forge_assign_module',
  // model-mgmt.js — 8 tools
  'forge_get_model_recommendation',
  'forge_call_external',
  'forge_read_usage',
  'forge_reset_usage',
  'forge_update_agent_model',
  'forge_add_model',
  'forge_update_model',
  'forge_list_models',
  // run-lifecycle.js — 11 tools
  'forge_create_run',
  'forge_get_run',
  'forge_list_runs',
  'forge_update_run',
  'forge_classify_risk',
  'forge_create_worktree',
  'forge_escalate',
  'forge_resume_run',
  'forge_advance_stage',
  'forge_dashboard_state',
  'forge_kill_worker',
  // knowledge.js — 6 tools
  'forge_get_constraints',
  'forge_get_patterns',
  'forge_add_learning',
  'forge_read_criteria',
  'forge_write_criteria',
  'forge_get_linked',
];

function fail(msg) {
  console.error('[server-registration-test] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

function seed(projectDir) {
  // Minimal pipeline state so the MCP server starts cleanly.
  mkdirSync(join(projectDir, 'docs'), { recursive: true });
  writeFileSync(join(projectDir, 'docs', 'PLAN.md'), '# PLAN\n\n## Active Plan\n');
  mkdirSync(join(projectDir, '.pipeline', 'runs'), { recursive: true });
}

async function main() {
  const projectDir = mkdtempSync(join(tmpdir(), 'forge-reg-test-'));
  seed(projectDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    cwd: projectDir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'forge-registration-test', version: '0.0.0' }, { capabilities: {} });

  let failure = null;

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const actualNames = (result.tools || []).map(t => t.name).sort();
    const expectedNames = [...EXPECTED_TOOLS].sort();

    // Check 1: count matches
    if (actualNames.length !== expectedNames.length) {
      failure = 'tool count mismatch: expected ' + expectedNames.length +
        ', got ' + actualNames.length +
        '\n  Missing: ' + expectedNames.filter(n => !actualNames.includes(n)).join(', ') +
        '\n  Extra:   ' + actualNames.filter(n => !expectedNames.includes(n)).join(', ');
    }

    // Check 2: every expected name is present
    if (!failure) {
      const missing = expectedNames.filter(n => !actualNames.includes(n));
      if (missing.length > 0) {
        failure = 'missing tools: ' + missing.join(', ');
      }
    }

    // Check 3: no unexpected tools registered
    if (!failure) {
      const extra = actualNames.filter(n => !expectedNames.includes(n));
      if (extra.length > 0) {
        failure = 'unexpected tools registered: ' + extra.join(', ');
      }
    }

    if (!failure) {
      console.error('[server-registration-test] PASS — all ' + expectedNames.length + ' tools registered');
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
  console.error('[server-registration-test] unexpected throw:', err);
  process.exit(1);
});
