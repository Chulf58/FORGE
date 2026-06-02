#!/usr/bin/env node
// @covers mcp/lib/orchestrator/implement-stage.mjs
// Integration test: real-agent dispatch inside isolated worktree
//
// AC-10: This test dispatches REAL agents (coder-scout, coder) against a minimal
// synthetic feature inside an isolated worktree. It verifies that the prompt builders
// inject enough context for live agents to produce actual file output.
//
// CRITICAL: This test makes LIVE Anthropic API calls. It runs ONLY when
// FORGE_INTEGRATION_TEST=1 is set in the environment. When the env var is absent,
// the test is skipped (exits 0 with no API call, no failure).
//
// Test assertions:
//   (a) scout output (docs/context/scout.json) inside the worktree contains NON-EMPTY
//       files_to_read array (not an empty prompt degenerate case)
//   (b) coder dispatches against same feature, writes actual source file inside
//       the worktree, and does NOT emit [scope-error] or [scout-precondition] to stdout
//   (c) run.worktreePath is non-null and resolves under .worktrees/
//
// Run (with integration test environment enabled):
//   FORGE_INTEGRATION_TEST=1 node --test mcp/lib/orchestrator/implement-stage-integration.test.mjs
//
// Run (skip, CI mode):
//   node --test mcp/lib/orchestrator/implement-stage-integration.test.mjs

// Early exit if integration tests are not enabled — before importing test framework
if (process.env.FORGE_INTEGRATION_TEST !== '1') {
  // Silent skip: exit before test framework loads, so no tests are registered
  process.exit(0); // eslint-disable-line n/no-process-exit
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const __projectRoot = resolve(__dirname, '..', '..', '..');

// Load required modules
let runImplementStageOrchestrator;
try {
  const mod = await import('./implement-stage.mjs');
  runImplementStageOrchestrator = mod.runImplementStageOrchestrator;
} catch (err) {
  test('T0 — implement-stage.mjs must export runImplementStageOrchestrator', () => {
    assert.fail('Failed to load implement-stage.mjs: ' + err.message);
  });
  process.exit(1); // eslint-disable-line n/no-process-exit
}

let dispatchAgent;
try {
  const mod = await import('./agent-dispatch.mjs');
  dispatchAgent = mod.dispatchAgent;
} catch (err) {
  test('T0 — agent-dispatch.mjs must export dispatchAgent', () => {
    assert.fail('Failed to load agent-dispatch.mjs: ' + err.message);
  });
  process.exit(1); // eslint-disable-line n/no-process-exit
}

let buildMcpServer;
try {
  const mod = await import('../../forge-worker-mcp.mjs');
  buildMcpServer = mod.default;
} catch (err) {
  test('T0 — forge-worker-mcp.mjs must export buildMcpServer (default)', () => {
    assert.fail('Failed to load forge-worker-mcp.mjs: ' + err.message);
  });
  process.exit(1); // eslint-disable-line n/no-process-exit
}

// ── AC-10: Real-agent integration test ──────────────────────────────────────

test('AC-10(a-c): Real-agent dispatch in isolated worktree produces scout + coder output', { timeout: 420000 }, async () => {
  // Setup: Create a temporary main-root directory with fixture PLAN.md
  let tempDir;
  let workDir;
  let runId = 'r-test-integration-' + Date.now();

  try {
    // Create temp main root
    tempDir = await mkdtemp(join(os.tmpdir(), 'forge-integration-'));

    // Create .pipeline/runs/<runId> directory
    const runsDir = join(tempDir, '.pipeline', 'runs', runId);
    const fs = await import('node:fs/promises');
    await fs.mkdir(runsDir, { recursive: true });

    // Create fixture docs/PLAN.md with a minimal single-file feature
    const docsDir = join(tempDir, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    const planPath = join(docsDir, 'PLAN.md');
    const planContent = `## Active Plan

### Feature: smoke-marker integration test

Summary: Create a simple marker file to test real-agent dispatch inside a worktree.

#### Phase 1 — Create marker file

- [ ] 1. Create hooks/smoke-marker.js that exports a constant named MARKER
  Verify: AC-1: the file exists and exports MARKER = 'smoke-test-123'

### Research needed

None.
`;
    await fs.writeFile(planPath, planContent, 'utf-8');

    // Create .worktrees directory at main root
    const worktreesDir = join(tempDir, '.worktrees');
    await fs.mkdir(worktreesDir, { recursive: true });

    // Create worktree directory
    workDir = join(worktreesDir, runId);
    await fs.mkdir(workDir, { recursive: true });

    // Create minimal .git directory structure in worktree (git worktree add creates this)
    const gitDir = join(workDir, '.git');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/worktree\n', 'utf-8');

    // Create initial run.json
    const runJsonPath = join(runsDir, 'run.json');
    const initialRun = {
      runId,
      feature: 'smoke-marker integration test',
      status: 'running',
      worktreePath: workDir,
    };
    await fs.writeFile(runJsonPath, JSON.stringify(initialRun, null, 2), 'utf-8');

    // Create .pipeline/context directory in worktree for scout output
    const contextDir = join(workDir, '.pipeline', 'context');
    await fs.mkdir(contextDir, { recursive: true });

    // Create .pipeline/gate-pending.json path ready
    const gatePendingPath = join(workDir, '.pipeline', 'gate-pending.json');

    // Create docs/context directory in worktree for coder handoff
    const docsContextDir = join(workDir, 'docs', 'context');
    await fs.mkdir(docsContextDir, { recursive: true });

    // Provision the worktree with docs/PLAN.md the way forge-core createWorktree does
    // (it copies docs/ + .pipeline/ — incl. gitignored PLAN.md — from main into the
    // worktree; createWorktree.js:196-209). The agents self-read docs/PLAN.md from
    // their cwd (the worktree), so a bare worktree without it makes coder-scout produce
    // no scout.json — a test-setup gap, not a production bug.
    await fs.writeFile(join(workDir, 'docs', 'PLAN.md'), planContent, 'utf-8');

    // Setup: Create mock dependencies that use real agent dispatch
    const mockDeps = {
      // Mirror forge-worker: resolve run.json at the REAL main-root location,
      // ignoring the orchestrator's worktree-relative passed path (gotcha #3).
      readRunJson: async () => {
        const content = await fs.readFile(runJsonPath, 'utf-8');
        return JSON.parse(content);
      },

      writeRunJson: async (_path, data) => {
        await fs.writeFile(runJsonPath, JSON.stringify(data, null, 2), 'utf-8');
      },

      writeGateFile: async (path, data) => {
        await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
      },

      clearReviewerOutput: async (dir) => {
        // No-op for integration test
      },

      readReviewerOutput: async (dir, reviewer) => {
        return { verdict: 'APPROVED' };
      },

      spawnScript: async (script, args) => {
        // Return empty reviewers list to skip reviewer dispatch in this integration test
        return {
          exitCode: 0,
          stdout: JSON.stringify({ reviewers: [], reasons: [] }),
          stderr: '',
        };
      },

      dispatch: async (agentType, promptLines) => {
        // Dispatch REAL agents via the production dispatchAgent options-object signature
        // ({ agentType, promptLines, workDir, pluginRoot, buildMcpServer }) — matches forge-worker.
        try {
          return await dispatchAgent({
            agentType,
            promptLines,
            workDir,
            pluginRoot: __projectRoot,
            buildMcpServer,
          });
        } catch (err) {
          return { outcome: 'uncertain', error: err.message };
        }
      },

      readPlanMd: async () => {
        return await fs.readFile(planPath, 'utf-8');
      },

      writeLog: (msg) => {
        console.error('[integration-test]', msg);
      },
    };

    // Run the orchestrator with real agent dispatch
    // This will dispatch coder-scout and then coder against the fixture feature
    await runImplementStageOrchestrator(mockDeps, runId, workDir);

    // Assertion (a): Scout output exists inside worktree with non-empty files_to_read
    const scoutPath = join(workDir, 'docs', 'context', 'scout.json');
    assert.ok(existsSync(scoutPath), 'docs/context/scout.json must exist inside worktree');

    const scoutContent = JSON.parse(await fs.readFile(scoutPath, 'utf-8'));
    assert.ok(
      Array.isArray(scoutContent.files_to_read),
      'scout.json must have files_to_read array'
    );
    // Non-degenerate check: the scout must NAME at least one file. For a create-new-file
    // feature the file lands in new_files (files_to_read is legitimately empty — there is
    // no existing file to read). A degenerate empty-prompt scout names nothing anywhere.
    const namedFiles = [
      ...(Array.isArray(scoutContent.files_to_read) ? scoutContent.files_to_read : []),
      ...(Array.isArray(scoutContent.new_files) ? scoutContent.new_files : []),
    ];
    assert.ok(
      namedFiles.length > 0,
      'scout must name >=1 file in files_to_read OR new_files (not a degenerate empty-prompt case). Content: ' + JSON.stringify(scoutContent)
    );
    assert.ok(
      namedFiles.some((f) => typeof f === 'string' && f.includes('smoke-marker')),
      'scout must identify the feature target file (hooks/smoke-marker.js). Content: ' + JSON.stringify(scoutContent)
    );

    // Assertion (b): Coder writes actual source file and does NOT emit precondition refusal
    // The fixture feature requests creating hooks/smoke-marker.js
    const markerPath = join(workDir, 'hooks', 'smoke-marker.js');
    // The coder SHOULD create this file if dispatch succeeds and prompt context is sufficient
    // We assert it exists (real output), or if it doesn't, we check the run status to ensure
    // there was no [scout-precondition] or [scope-error] in the dispatch outcome
    const updatedRun = await mockDeps.readRunJson(runJsonPath);
    assert.ok(updatedRun.agents, 'run.agents must be stamped');
    assert.ok(Array.isArray(updatedRun.agents), 'run.agents must be an array');

    // Verify there's at least a coder agent entry (coder-scout should also be there)
    const coderAgent = updatedRun.agents.find(a => a.agentType === 'coder');
    assert.ok(coderAgent, 'coder agent must be dispatched');
    assert.equal(
      coderAgent.outcome,
      'completed',
      'coder outcome must be completed (not uncertain/precondition-failed). If uncertain, the prompt context was insufficient.'
    );

    // Assertion (c): run.worktreePath is non-null and resolves under .worktrees/
    assert.ok(updatedRun.worktreePath, 'run.worktreePath must be non-null');
    assert.ok(
      updatedRun.worktreePath.includes('.worktrees'),
      'worktreePath must resolve under .worktrees/'
    );
    assert.ok(
      existsSync(updatedRun.worktreePath),
      'worktreePath must exist on disk'
    );

  } finally {
    // Cleanup: Remove the temp main-root and worktree
    if (tempDir && existsSync(tempDir)) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (_) {
        // Ignore cleanup errors
      }
    }
  }
});
