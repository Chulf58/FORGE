#!/usr/bin/env node
// @covers scripts/eval-agent-prompts.mjs
// Eval runner for FORGE agent prompt scenarios.
//
// Usage:
//   node scripts/eval-agent-prompts.mjs [--agent <name>]
//   node scripts/eval-agent-prompts.mjs --update-baseline
//   node scripts/eval-agent-prompts.mjs --compare-baseline
//   node scripts/eval-agent-prompts.mjs --scheduled
//
// Exit codes:
//   0 — success (no regressions in compare-baseline mode)
//   1 — validation error or regressions detected

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from '../evals/scenario-schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const evalsDir = join(projectRoot, 'evals', 'agent-prompts');
const baselinePath = join(projectRoot, 'evals', 'baseline.json');
const scheduledRunsDir = join(projectRoot, 'evals', 'scheduled-runs');

// ── Parse CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const agentFlag = (() => {
  const idx = args.indexOf('--agent');
  return idx !== -1 ? args[idx + 1] : null;
})();
const updateBaseline = args.includes('--update-baseline');
const compareBaseline = args.includes('--compare-baseline');
const scheduled = args.includes('--scheduled');

// ── Scenario discovery ────────────────────────────────────────────────────────
function listAgentDirs() {
  if (!existsSync(evalsDir)) return [];
  try {
    return readdirSync(evalsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { return []; }
}

function listScenarioFiles(agentDir) {
  try {
    return readdirSync(agentDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(agentDir, f));
  } catch { return []; }
}

// ── Stub oracle ───────────────────────────────────────────────────────────────
// First-ship oracle: a scenario PASSES if it has non-empty expected_signals or
// expected_artifacts (it is STRONG). Regressions are detected when STRONG
// scenarios are removed or degraded to WEAK. Improve oracle in a future iteration.
function scoreScenario(scenario) {
  const hasSignals = Array.isArray(scenario.expected_signals) && scenario.expected_signals.length > 0;
  const hasArtifacts = Array.isArray(scenario.expected_artifacts) && scenario.expected_artifacts.length > 0;
  return (hasSignals || hasArtifacts) ? 'pass' : 'fail';
}

// ── Load all scenarios ────────────────────────────────────────────────────────
function loadAllAgentResults(filterAgent) {
  const agentDirs = listAgentDirs();
  const filtered = filterAgent ? agentDirs.filter((d) => d === filterAgent) : agentDirs;
  const results = [];
  let hasValidationError = false;

  for (const agentName of filtered) {
    const agentPath = join(evalsDir, agentName);
    const scenarioFiles = listScenarioFiles(agentPath);
    const scenarioResults = [];

    for (const filePath of scenarioFiles) {
      let raw;
      try { raw = JSON.parse(readFileSync(filePath, 'utf-8')); }
      catch (err) {
        process.stderr.write(`[eval] failed to parse ${filePath}: ${err.message}\n`);
        hasValidationError = true;
        continue;
      }
      const validation = validateScenario(raw);
      if (!validation.ok) {
        process.stderr.write(`[eval] invalid scenario ${filePath}: ${validation.errors.join('; ')}\n`);
        hasValidationError = true;
        continue;
      }
      scenarioResults.push({ name: raw.name, result: scoreScenario(raw) });
    }
    results.push({ agent: agentName, scenarios: scenarioResults });
  }
  return { results, hasValidationError };
}

// ── --update-baseline ─────────────────────────────────────────────────────────
if (updateBaseline) {
  const { results, hasValidationError } = loadAllAgentResults(null);
  if (hasValidationError) {
    process.stderr.write('[eval] --update-baseline aborted: validation errors in scenario files\n');
    process.exit(1);
  }
  const agents = {};
  let totalScenarios = 0;
  for (const { agent, scenarios } of results) {
    const pass = scenarios.filter((s) => s.result === 'pass').length;
    const fail = scenarios.filter((s) => s.result === 'fail').length;
    agents[agent] = { pass, fail, total: scenarios.length };
    totalScenarios += scenarios.length;
  }
  const baseline = { updatedAt: new Date().toISOString(), agents };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  process.stdout.write(
    `[eval] baseline updated: ${results.length} agents, ${totalScenarios} total scenarios\n`,
  );
  process.exit(0);
}

// ── --compare-baseline ────────────────────────────────────────────────────────
if (compareBaseline) {
  if (!existsSync(baselinePath)) {
    process.stderr.write('[eval] --compare-baseline: no baseline.json found — run --update-baseline first\n');
    process.exit(1);
  }
  let baseline;
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')); }
  catch (err) {
    process.stderr.write('[eval] --compare-baseline: failed to read baseline.json: ' + err.message + '\n');
    process.exit(1);
  }
  const { results, hasValidationError } = loadAllAgentResults(null);
  if (hasValidationError) {
    process.stderr.write('[eval] --compare-baseline aborted: validation errors in scenario files\n');
    process.exit(1);
  }
  const regressions = [];
  const agentResults = {};
  for (const { agent, scenarios } of results) {
    const pass = scenarios.filter((s) => s.result === 'pass').length;
    const fail = scenarios.filter((s) => s.result === 'fail').length;
    agentResults[agent] = { pass, fail, total: scenarios.length };
    const baselineAgent = baseline.agents?.[agent];
    if (baselineAgent) {
      // A regression = current pass count < baseline pass count (delta only)
      if (pass < baselineAgent.pass) {
        const delta = baselineAgent.pass - pass;
        regressions.push({ agent, regressed: delta, baselinePass: baselineAgent.pass, currentPass: pass });
      }
    }
  }
  const output = { ranAt: new Date().toISOString(), regressions, agentResults };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (regressions.length > 0) {
    process.stderr.write(
      `[eval] --compare-baseline: ${regressions.length} regression(s) detected\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// ── --scheduled ───────────────────────────────────────────────────────────────
if (scheduled) {
  const { results } = loadAllAgentResults(null);
  mkdirSync(scheduledRunsDir, { recursive: true });
  const isoDate = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = join(scheduledRunsDir, isoDate + '.json');
  const agents = {};
  for (const { agent, scenarios } of results) {
    const pass = scenarios.filter((s) => s.result === 'pass').length;
    const fail = scenarios.filter((s) => s.result === 'fail').length;
    agents[agent] = { pass, fail, regressed: [] };
  }
  const report = { ranAt: new Date().toISOString(), agents };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  // Non-blocking — always exits 0
  process.exit(0);
}

// ── Default: run scenarios and emit JSON ──────────────────────────────────────
const { results, hasValidationError } = loadAllAgentResults(agentFlag);
if (hasValidationError) process.exit(1);
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
process.exit(0);
