#!/usr/bin/env node
'use strict';

// Test for gate-sync.js hook
// Run: node hooks/gate-sync-test.js

const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { execSync } = require('child_process');
const { spawn } = require('child_process');

// Make assertion failures FAIL the harness (exit non-zero). This file used bare
// console.assert (non-fatal), so a failed assertion printed "✗ FAIL" yet the process
// still exited 0 — a silent failure run-tests.mjs could not gate on (the gate-sync
// handoff-copy bug hid here for exactly this reason). Count failures; exit 1 at the end.
let __assertFailures = 0;
{
  const __origAssert = console.assert.bind(console);
  console.assert = (cond, ...args) => { if (!cond) __assertFailures++; __origAssert(cond, ...args); };
}

async function runHook(payload, projectDir) {
  // Spawn with cwd = projectDir so process.cwd() inside the hook matches
  // the project root. Claude Code sets each hook's working directory to the
  // project root — resolveProjectDir() validates this invariant.
  // Also inject cwd into the payload so the hook's resolveProjectDir() accepts it.
  const hookCwd = projectDir || join(__dirname, '..');
  const fullPayload = projectDir ? { ...payload, cwd: projectDir } : payload;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'gate-sync.js')], {
      cwd: hookCwd,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(__dirname, '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.write(JSON.stringify(fullPayload));
    child.stdin.end();
    child.on('close', (code) => resolve({ code, stderr: stderr.trim() }));
    child.on('error', reject);
  });
}

function makeRun(tmp, runId, status) {
  mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
  const now = '2026-04-12T00:00:00Z';
  writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({
    runs: [{
      runId, pipelineType: 'plan', feature: 'test feature',
      status, createdAt: now, updatedAt: now,
    }]
  }));
  writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), JSON.stringify({
    runId, sessionId: 'test', projectRoot: tmp,
    worktreePath: null, branchName: null,
    pipelineType: 'plan', feature: 'test feature',
    status, createdAt: now, updatedAt: now,
    currentStep: 'planner', gateState: null, agents: [],
    artifacts: { plan: null, handoff: null, scout: null },
  }));
}

async function test() {
  // Test 1: pending gate syncs running run to gate-pending
  console.log('\n--- Test 1: pending → gate-pending ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    makeRun(tmp, 'r-test1', 'running');

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate1', feature: 'test feature', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);
    const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test1', 'run.json'), 'utf-8'));
    console.log('Status:', run.status, '| Step:', run.currentStep);
    console.assert(run.status === 'gate-pending', 'Expected gate-pending, got ' + run.status);
    console.log(run.status === 'gate-pending' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 2: approved gate syncs gate-pending run to completed
  console.log('\n--- Test 2: approved → completed ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    makeRun(tmp, 'r-test2', 'gate-pending');

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate1', feature: 'test feature', status: 'approved',
      createdAt: '2026-04-12T01:00:00Z', approvedAt: '2026-04-12T02:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);
    const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test2', 'run.json'), 'utf-8'));
    console.log('Status:', run.status, '| Step:', run.currentStep);
    console.assert(run.status === 'completed', 'Expected completed, got ' + run.status);
    console.log(run.status === 'completed' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 3: non-gate file is ignored
  console.log('\n--- Test 3: non-gate file ignored ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    makeRun(tmp, 'r-test3', 'running');

    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: join(tmp, 'some-other-file.json').replace(/\\/g, '/') },
      session_id: 'test',
    }, tmp);

    const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-test3', 'run.json'), 'utf-8'));
    console.assert(run.status === 'running', 'Should still be running');
    console.log(run.status === 'running' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 4: pending gate with NO existing run → auto-creates a run
  console.log('\n--- Test 4: no run exists → auto-create on pending gate ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    // Create .pipeline/runs/ dir but NO runs
    mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [] }));

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate1', feature: 'auto-test feature', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-auto',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);

    // A run should now exist
    const index = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), 'utf-8'));
    console.log('Runs in index:', index.runs.length);
    console.assert(index.runs.length === 1, 'Should have 1 auto-created run');

    if (index.runs.length === 1) {
      const runId = index.runs[0].runId;
      const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), 'utf-8'));
      console.log('Auto-created run:', runId, '| status:', run.status, '| type:', run.pipelineType, '| feature:', run.feature);
      console.assert(run.status === 'gate-pending', 'Should be gate-pending');
      console.assert(run.pipelineType === 'plan', 'gate1 should infer plan');
      console.assert(run.feature === 'auto-test feature', 'Feature should match gate data');
      const ok = run.status === 'gate-pending' && run.pipelineType === 'plan';
      console.log(ok ? '✓ PASS' : '✗ FAIL');
    } else {
      console.log('✗ FAIL — no run created');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 5: gate2 pending with no run → auto-creates implement run
  console.log('\n--- Test 5: gate2 no run → auto-create implement ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    mkdirSync(join(tmp, '.pipeline', 'runs'), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({ runs: [] }));

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate2', feature: 'impl feature', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-auto2',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);
    const index = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), 'utf-8'));
    if (index.runs.length === 1) {
      const runId = index.runs[0].runId;
      const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), 'utf-8'));
      console.log('Auto-created:', runId, '| type:', run.pipelineType);
      console.assert(run.pipelineType === 'implement', 'gate2 should infer implement');
      console.log(run.pipelineType === 'implement' ? '✓ PASS' : '✗ FAIL');
    } else {
      console.log('✗ FAIL');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 6: stale run with DIFFERENT feature must NOT be matched — new run auto-created
  console.log('\n--- Test 6: stale run with wrong feature → auto-create new run ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    // Create a stale run for a DIFFERENT feature
    makeRun(tmp, 'r-stale', 'created');
    // The stale run has feature "test feature" (from makeRun)

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate1', feature: 'Footer with version number', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-stale',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);

    const index = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), 'utf-8'));
    console.log('Runs in index:', index.runs.length);
    console.assert(index.runs.length === 2, 'Should have 2 runs (stale + new)');

    // The stale run should be unchanged
    const staleRun = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-stale', 'run.json'), 'utf-8'));
    console.log('Stale run status:', staleRun.status);
    console.assert(staleRun.status === 'created', 'Stale run should still be created');

    // The new run should be gate-pending with the footer feature
    const newEntry = index.runs.find(r => r.runId !== 'r-stale');
    if (newEntry) {
      const newRun = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', newEntry.runId, 'run.json'), 'utf-8'));
      console.log('New run:', newEntry.runId, '| feature:', newRun.feature, '| status:', newRun.status);
      console.assert(newRun.status === 'gate-pending', 'New run should be gate-pending');
      console.assert(newRun.feature === 'Footer with version number', 'Feature should match gate');
      const ok = staleRun.status === 'created' && newRun.status === 'gate-pending';
      console.log(ok ? '✓ PASS' : '✗ FAIL');
    } else {
      console.log('✗ FAIL — no new run found');
    }
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 7: run with MATCHING feature IS correctly attached
  console.log('\n--- Test 7: run with matching feature → attach correctly ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));
    makeRun(tmp, 'r-match', 'running');
    // makeRun sets feature to "test feature"

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate1', feature: 'test feature', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-match',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);
    const index = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), 'utf-8'));
    console.log('Runs in index:', index.runs.length);
    console.assert(index.runs.length === 1, 'Should still have just 1 run');

    const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', 'r-match', 'run.json'), 'utf-8'));
    console.log('Run status:', run.status);
    console.assert(run.status === 'gate-pending', 'Matching run should be gate-pending');
    console.log(run.status === 'gate-pending' ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 8: gate2 pending with implement run (no worktree) → auto-creates worktree
  console.log('\n--- Test 8: gate2 pending + implement run → auto-create worktree ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));

    // Set up a real git repo so worktree creation works
    execSync('git init', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmp, stdio: 'pipe' });
    writeFileSync(join(tmp, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmp, stdio: 'pipe' });

    // Create an implement run with no worktree
    const runId = 'r-wt-test';
    const now = '2026-04-12T00:00:00Z';
    mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({
      runs: [{
        runId, pipelineType: 'implement', feature: 'worktree test',
        status: 'running', createdAt: now, updatedAt: now,
      }]
    }));
    writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), JSON.stringify({
      runId, sessionId: 'test', projectRoot: tmp,
      worktreePath: null, branchName: null,
      pipelineType: 'implement', feature: 'worktree test',
      status: 'running', createdAt: now, updatedAt: now,
      currentStep: 'coder', gateState: null, agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }));

    // Write handoff.md so it gets copied into the worktree
    mkdirSync(join(tmp, 'docs', 'context'), { recursive: true });
    writeFileSync(join(tmp, 'docs', 'context', 'handoff.md'), '# Handoff: worktree test\n');

    // Write gate2 pending
    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate2', feature: 'worktree test', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-wt',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);

    // Run should now have worktreePath set
    const run = JSON.parse(readFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), 'utf-8'));
    console.log('worktreePath:', run.worktreePath);
    console.log('branchName:', run.branchName);
    console.assert(run.worktreePath !== null, 'worktreePath should be set');
    console.assert(run.branchName === 'forge/' + runId, 'branchName should be forge/<runId>');

    // Worktree directory should exist on disk
    const wtExists = run.worktreePath && existsSync(run.worktreePath);
    console.log('Worktree dir exists:', wtExists);
    console.assert(wtExists, 'Worktree directory should exist');

    // Handoff.md should have been copied into the worktree
    const handoffCopied = run.worktreePath && existsSync(join(run.worktreePath, 'docs', 'context', 'handoff.md'));
    console.log('handoff.md copied to worktree:', handoffCopied);
    console.assert(handoffCopied, 'handoff.md should be in worktree');

    const ok = run.worktreePath !== null && wtExists && handoffCopied;
    console.log(ok ? '✓ PASS' : '✗ FAIL');

    // Cleanup: prune worktrees before removing temp dir
    try { execSync('git worktree prune', { cwd: tmp, stdio: 'pipe' }); } catch (_) {}
    rmSync(tmp, { recursive: true, force: true });
  }

  // Test 9: gate2 pending with implement run that ALREADY has worktree → no-op
  console.log('\n--- Test 9: gate2 pending + run with worktree → skip ---');
  {
    const tmp = mkdtempSync(join(tmpdir(), 'gs-test-'));

    // Set up git repo
    execSync('git init', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmp, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmp, stdio: 'pipe' });
    writeFileSync(join(tmp, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: tmp, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmp, stdio: 'pipe' });

    // Create run that already has a worktree path set
    const runId = 'r-wt-exists';
    const now = '2026-04-12T00:00:00Z';
    mkdirSync(join(tmp, '.pipeline', 'runs', runId), { recursive: true });
    writeFileSync(join(tmp, '.pipeline', 'runs', 'index.json'), JSON.stringify({
      runs: [{
        runId, pipelineType: 'implement', feature: 'existing wt',
        status: 'running', createdAt: now, updatedAt: now,
      }]
    }));
    writeFileSync(join(tmp, '.pipeline', 'runs', runId, 'run.json'), JSON.stringify({
      runId, sessionId: 'test', projectRoot: tmp,
      worktreePath: join(tmp, '.worktrees', runId), branchName: 'forge/' + runId,
      pipelineType: 'implement', feature: 'existing wt',
      status: 'running', createdAt: now, updatedAt: now,
      currentStep: 'coder', gateState: null, agents: [],
      artifacts: { plan: null, handoff: null, scout: null },
    }));

    const gatePath = join(tmp, '.pipeline', 'gate-pending.json');
    writeFileSync(gatePath, JSON.stringify({
      gate: 'gate2', feature: 'existing wt', status: 'pending', createdAt: '2026-04-12T01:00:00Z'
    }));

    const { code, stderr } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: gatePath.replace(/\\/g, '/') },
      session_id: 'test-wt-skip',
    }, tmp);

    console.log('Exit:', code, '| stderr:', stderr);

    // Should NOT see "Auto-created worktree" in stderr
    const autoCreated = stderr.includes('Auto-created worktree');
    console.log('Worktree auto-created:', autoCreated);
    console.assert(!autoCreated, 'Should NOT auto-create worktree when one already exists');
    console.log(!autoCreated ? '✓ PASS' : '✗ FAIL');
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\nAll tests complete.');
}

test()
  .then(() => {
    if (__assertFailures > 0) {
      console.error('\n' + __assertFailures + ' assertion(s) FAILED');
      process.exit(1);
    }
  })
  .catch(e => { console.error(e); process.exit(1); });
