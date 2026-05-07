#!/usr/bin/env node
'use strict';

// Test for apply-context-inject.js hook
// Run: node hooks/apply-context-inject-test.js

const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn, execSync } = require('child_process');

// Track assertion failures. `console.assert` does NOT exit non-zero in Node,
// so the shared script-style runner (scripts/run-tests.mjs) cannot trust it
// as a pass/fail signal. This local `assert` increments a failure counter
// and logs each violation; the counter is checked at end-of-run and drives
// process.exit(1) when any assertion failed. We keep going past a failure
// on purpose so one run surfaces every violation, not just the first.
let __failures = 0;
function assert(cond, msg) {
  if (!cond) {
    __failures++;
    console.error('  ASSERTION FAILED: ' + msg);
  }
}

async function runHook(payload, projectDir) {
  // Spawn with cwd = projectDir (or payload.cwd, or forge-plugin root).
  // Claude Code sets each hook's working directory to the project root, so
  // process.cwd() inside the hook equals payload.cwd — the security check
  // resolveProjectDir() validates exactly this invariant.
  const hookCwd = projectDir || payload.cwd || join(__dirname, '..');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, '..', 'hooks', 'apply-context-inject.js')], {
      cwd: hookCwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(__dirname, '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function makeImplementRun(tmp, runId, worktreePath, branchName) {
  const now = '2026-04-12T12:00:00Z';
  mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
  writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), JSON.stringify({
    runId, sessionId: 'test', projectRoot: tmp,
    worktreePath, branchName,
    pipelineType: 'implement', feature: 'test feature',
    status: 'completed', createdAt: now, updatedAt: now,
    currentStep: 'gate2-approved', gateState: null, agents: [],
    artifacts: { plan: null, handoff: null, scout: null },
  }));
  return { runId, pipelineType: 'implement', feature: 'test feature', status: 'completed', createdAt: now, updatedAt: now };
}

async function test() {
  // Test 1: documenter gets worktree context injected
  console.log('\n--- Test 1: documenter + worktree run → context injected ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));

    // Create a worktree directory (simulated — no real git worktree needed for this test)
    const wtPath = join(tmp, '.worktrees', 'r-wt1');
    mkdirSync(join(wtPath, 'docs', 'context'), { recursive: true });
    writeFileSync(join(wtPath, 'docs', 'context', 'handoff.md'), '# Handoff\n');

    // Create the implement run pointing to the worktree
    const entry = makeImplementRun(tmp, 'r-wt1', wtPath, 'forge/r-wt1');
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [entry] }));

    const { code, stdout, stderr } = await runHook({
      agent_type: 'documenter',
      agent_id: 'test-doc-0',
      cwd: tmp,
    });

    console.log('Exit:', code);
    console.log('stderr:', stderr);

    // Parse stdout for additionalContext
    let context = null;
    try {
      const parsed = JSON.parse(stdout);
      context = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    } catch (_) {}

    console.log('Context injected:', context !== null);
    assert(context !== null, 'Should have additionalContext');

    if (context) {
      const hasWorktreePath = context.includes(wtPath.replace(/\\/g, '\\'));
      const hasBranch = context.includes('forge/r-wt1');
      const hasHandoff = context.includes('handoff.md');
      console.log('Contains worktree path:', hasWorktreePath);
      console.log('Contains branch:', hasBranch);
      console.log('Contains handoff reference:', hasHandoff);
      assert(hasWorktreePath || context.includes('r-wt1'), 'Should mention worktree path');
      assert(hasBranch, 'Should mention branch');
      assert(hasHandoff, 'Should mention handoff');
    }

    const ok = context !== null && stderr.includes('Injected worktree context');
    console.log(ok ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 2: documenter also gets worktree context
  console.log('\n--- Test 2: documenter + worktree run → context injected ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));
    const wtPath = join(tmp, '.worktrees', 'r-wt2');
    mkdirSync(join(wtPath, 'docs', 'context'), { recursive: true });
    writeFileSync(join(wtPath, 'docs', 'context', 'handoff.md'), '# Handoff\n');

    const entry = makeImplementRun(tmp, 'r-wt2', wtPath, 'forge/r-wt2');
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [entry] }));

    const { code, stdout, stderr } = await runHook({
      agent_type: 'documenter',
      agent_id: 'test-doc-1',
      cwd: tmp,
    });

    let context = null;
    try {
      const parsed = JSON.parse(stdout);
      context = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext;
    } catch (_) {}

    console.log('Context injected:', context !== null);
    assert(context !== null, 'Documenter should also get worktree context');
    console.log(stderr.includes('Injected worktree context for documenter') ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 3: non-apply agent (e.g. coder) → no context injected
  console.log('\n--- Test 3: coder agent → no context injected ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));
    const wtPath = join(tmp, '.worktrees', 'r-wt3');
    mkdirSync(wtPath, { recursive: true });

    const entry = makeImplementRun(tmp, 'r-wt3', wtPath, 'forge/r-wt3');
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [entry] }));

    const { stdout } = await runHook({
      agent_type: 'coder',
      agent_id: 'test-coder-1',
      cwd: tmp,
    });

    console.log('stdout:', stdout || '(empty)');
    assert(stdout === '', 'Coder should not get worktree context');
    console.log(stdout === '' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 4: no implement run → no context injected
  console.log('\n--- Test 4: no implement run → no context ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));
    mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [] }));

    const { stdout, stderr } = await runHook({
      agent_type: 'documenter',
      agent_id: 'test-doc-2',
      cwd: tmp,
    });

    console.log('stderr:', stderr);
    assert(stdout === '', 'No context when no runs exist');
    assert(stderr.includes('No worktree-backed implement run'), 'Should log fallback');
    console.log(stdout === '' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 5: worktree path set but directory deleted → no context
  console.log('\n--- Test 5: worktree path set but dir missing → no context ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));
    const wtPath = join(tmp, '.worktrees', 'r-gone');
    // Do NOT create the worktree directory — it's been cleaned up

    const entry = makeImplementRun(tmp, 'r-gone', wtPath, 'forge/r-gone');
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [entry] }));

    const { stdout, stderr } = await runHook({
      agent_type: 'documenter',
      agent_id: 'test-doc-3',
      cwd: tmp,
    });

    console.log('stderr:', stderr);
    assert(stdout === '', 'No context when worktree dir missing');
    assert(stderr.includes('missing on disk'), 'Should log missing worktree');
    console.log(stdout === '' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 6: implement run WITHOUT worktree → no context
  console.log('\n--- Test 6: implement run without worktree → no context ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'aci-test-'));
    const entry = makeImplementRun(tmp, 'r-no-wt', null, null);
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [entry] }));

    const { stdout, stderr } = await runHook({
      agent_type: 'documenter',
      agent_id: 'test-doc-4',
      cwd: tmp,
    });

    console.log('stderr:', stderr);
    assert(stdout === '', 'No context when run has no worktree');
    console.log(stdout === '' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\nAll tests complete.');
  if (__failures > 0) {
    console.error(__failures + ' assertion(s) failed.');
    process.exit(1);
  }
}

test().catch(e => { console.error(e); process.exit(1); });
