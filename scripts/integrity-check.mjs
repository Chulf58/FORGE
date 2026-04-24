#!/usr/bin/env node
// Deterministic pipeline integrity checks — replaces the integrity-checker agent.
//
// Runs 11 checks against a project root and outputs a JSON object with findings.
// Each finding carries the exact [todo] signal string the agent would have emitted.
//
// Usage:
//   node scripts/integrity-check.mjs [--root <path>]
//
// Exit codes:
//   0 — checks ran successfully (findings may be empty or non-empty)
//   1 — script cannot run (missing root, unrecoverable error)

import fs from 'node:fs';
import path from 'node:path';

function log(msg) {
  process.stderr.write(`[integrity] ${msg}\n`);
}

// --- Helpers ----------------------------------------------------------------

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function countLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return -1;
  }
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function listDir(dirPath, ext) {
  try {
    return fs.readdirSync(dirPath).filter(f => f.endsWith(ext));
  } catch {
    return [];
  }
}

function hasFileRecursive(root, ext, maxDepth) {
  if (maxDepth < 0) return false;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(ext)) return true;
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      if (hasFileRecursive(path.join(root, entry.name), ext, maxDepth - 1)) return true;
    }
  }
  return false;
}

function finding(check, severity, title, note) {
  return {
    check,
    severity,
    title,
    note,
    signal: `[todo] ${severity}: ${title} — ${note}`,
  };
}

// --- Checks -----------------------------------------------------------------

function check1_boardValidity(root) {
  const fp = path.join(root, '.pipeline', 'board.json');
  if (!fileExists(fp)) {
    return [finding(1, 'HIGH', 'board.json missing', 'pipeline task board cannot be read')];
  }
  if (readJsonSafe(fp) === null) {
    return [finding(1, 'HIGH', 'board.json malformed JSON', 'pipeline task board cannot be read')];
  }
  return [];
}

function check2_staleHandoff(root) {
  const fp = path.join(root, 'docs', 'context', 'handoff.md');
  const content = readFileSafe(fp);
  if (content === null) return [];
  const lines = content.split('\n');
  if (lines.some(l => l.startsWith('# Handoff:'))) {
    return [finding(2, 'MEDIUM', 'handoff.md exists', 'may be stale from an abandoned pipeline run; review or delete if no run is active')];
  }
  return [];
}

function check3_orphanedPlanTasks(root, boardData) {
  const fp = path.join(root, 'docs', 'PLAN.md');
  const content = readFileSafe(fp);
  if (content === null) {
    return [finding(3, 'HIGH', 'PLAN.md missing', 'no pipeline plan found')];
  }

  const lines = content.split('\n');
  let featureStart = -1;
  let featureEnd = lines.length;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^### Feature:/.test(lines[i])) {
      const section = lines.slice(i, featureEnd);
      if (section.some(l => /^- \[ \]/.test(l))) {
        featureStart = i;
        break;
      }
      featureEnd = i;
    }
  }

  if (featureStart === -1) return [];

  const section = lines.slice(featureStart, featureEnd);
  const unchecked = section.filter(l => /^- \[ \]/.test(l)).length;
  if (unchecked === 0) return [];

  const planned = boardData?.planned;
  if (!Array.isArray(planned) || planned.length === 0) {
    return [finding(3, 'MEDIUM', `PLAN.md has ${unchecked} unchecked tasks with no matching planned item on the board`, 'tasks may be orphaned')];
  }
  return [];
}

function check4_unresolvedTests(root) {
  const fp = path.join(root, 'docs', 'TESTING.md');
  const content = readFileSafe(fp);
  if (content === null) return [];
  const unchecked = content.split('\n').filter(l => /^- \[ \]/.test(l)).length;
  if (unchecked > 0) {
    return [finding(4, 'MEDIUM', `TESTING.md has ${unchecked} unresolved test items`, 'review and resolve or archive')];
  }
  return [];
}

function check5_agentShadowing(root) {
  const scaffoldAgents = [
    'planner.md', 'researcher.md', 'gotcha-checker.md', 'coder.md',
    'reviewer.md', 'reviewer-safety.md', 'reviewer-logic.md',
    'reviewer-style.md', 'reviewer-performance.md', 'reviewer-triage.md',
    'implementer.md', 'tester.md', 'documenter.md', 'debug.md',
    'refactor.md', 'architect.md', 'integrity-checker.md',
  ];
  const agentDir = path.join(root, '.claude', 'agents');
  const files = listDir(agentDir, '.md');
  const issues = [];
  for (const file of files) {
    if (scaffoldAgents.includes(file)) {
      issues.push(finding(5, 'LOW', `custom agent shadows scaffold agent ${file}`, 'review for intentional overrides'));
    }
  }
  return issues;
}

function check6_unregisteredStacks(root) {
  const project = readJsonSafe(path.join(root, '.pipeline', 'project.json'));
  if (!project) return [];

  const stacks = (project.techStacks || []).map(s => s.toLowerCase());
  const issues = [];

  if (hasFileRecursive(root, '.csproj', 5)) {
    if (!stacks.some(s => s.includes('csharp') || s.includes('c#') || s.includes('dotnet') || s.includes('.net'))) {
      issues.push(finding(6, 'LOW', 'detected .csproj files but stack not registered in project.json', 'consider adding via Project Overview'));
    }
  }

  if (hasFileRecursive(root, '.flow', 5)) {
    if (!stacks.some(s => s.includes('power-automate') || s.includes('power automate'))) {
      issues.push(finding(6, 'LOW', 'detected .flow files but stack not registered in project.json', 'consider adding via Project Overview'));
    }
  }

  return issues;
}

function check7_missingArchive(root) {
  const testingPath = path.join(root, 'docs', 'TESTING.md');
  const lineCount = countLines(testingPath);
  if (lineCount < 0 || lineCount <= 400) return [];

  if (!dirExists(path.join(root, 'docs', 'archive'))) {
    return [finding(7, 'MEDIUM', 'docs/archive/ missing', 'TESTING.md exceeds 400 lines but documenter cannot archive old entries; create docs/archive/ to enable archival')];
  }
  return [];
}

function check8_staleRunActive(root) {
  const fp = path.join(root, '.pipeline', 'run-active.json');
  const data = readJsonSafe(fp);
  if (!data) return [];

  const mode = data.mode || data.pipelineType || 'unknown';
  const startedAt = data.startedAt ? new Date(data.startedAt).toISOString() : 'unknown';

  if (typeof mode === 'string' && mode.startsWith('apply')) {
    return [finding(8, 'HIGH', 'stale run-active.json found', `mode: ${mode}, started: ${startedAt}. An interrupted apply pipeline may have left source files in a partially modified state.`)];
  }
  return [finding(8, 'MEDIUM', 'stale run-active.json found', `mode: ${mode}, started: ${startedAt}. A prior pipeline run may have been interrupted; delete this file if safe.`)];
}

function check9_requiredHooks(root) {
  const hooksDir = path.join(root, '.claude', 'hooks');
  const issues = [];

  if (!fileExists(path.join(hooksDir, 'ctx-pre-tool.js'))) {
    issues.push(finding(9, 'HIGH', 'required hook ctx-pre-tool.js missing', 'install from FORGE templates. Without it: agent role write-path enforcement is disabled — any agent can write any file'));
  }
  if (!fileExists(path.join(hooksDir, 'ctx-post-tool.js'))) {
    issues.push(finding(9, 'HIGH', 'required hook ctx-post-tool.js missing', 'install from FORGE templates. Without it: tool-call audit log is not written and CONTEXT-CHECKPOINT recovery will not fire'));
  }
  return issues;
}

function check10_staleSkills(root) {
  const issues = [];
  const today = new Date();
  const STALE_DAYS = 90;
  const generatedRe = /\(generated:\s*(\d{4}-\d{2}-\d{2})\)/;

  // Part A — legacy SKILLS.md
  const skillsContent = readFileSafe(path.join(root, 'docs', 'gotchas', 'SKILLS.md'));
  if (skillsContent) {
    for (const line of skillsContent.split('\n')) {
      if (!line.startsWith('### ')) continue;
      const match = generatedRe.exec(line);
      if (!match) continue;
      const genDate = new Date(match[1]);
      const daysDiff = Math.floor((today - genDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > STALE_DAYS) {
        const stackName = line.replace(/^###\s*/, '').replace(generatedRe, '').trim();
        issues.push(finding(10, 'LOW', `skills section "${stackName}" was generated ${daysDiff} days ago`, 'platform knowledge may be stale; re-run skills-generator or update manually'));
      }
    }
  }

  // Part B — per-capability files
  const skillsDir = path.join(root, 'docs', 'gotchas', 'skills');
  const skillFiles = listDir(skillsDir, '.md');
  for (const file of skillFiles) {
    const content = readFileSafe(path.join(skillsDir, file));
    if (!content) continue;
    const firstHeading = content.split('\n').find(l => l.startsWith('# '));
    if (!firstHeading) continue;
    const match = generatedRe.exec(firstHeading);
    if (!match) continue;
    const genDate = new Date(match[1]);
    const daysDiff = Math.floor((today - genDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > STALE_DAYS) {
      const capId = file.replace(/\.md$/, '');
      issues.push(finding(10, 'LOW', `capability skills file "${capId}" was generated ${daysDiff} days ago`, 're-run skills-generator or update manually'));
    }
  }

  return issues;
}

function check11_modulesIntegrity(root) {
  const fp = path.join(root, '.pipeline', 'modules.json');
  const data = readJsonSafe(fp);
  if (!data) {
    return [finding(11, 'HIGH', 'modules.json missing', 'run architect to generate')];
  }

  const modules = Array.isArray(data) ? data : data.modules || [];
  if (!Array.isArray(modules)) return [];

  const moduleIds = new Set(modules.map(m => m.id || m.name));
  const issues = [];

  for (const mod of modules) {
    const name = mod.id || mod.name || 'unnamed';

    // (b) Stale paths
    const paths = mod.paths || [];
    for (const p of paths) {
      const fullPath = path.join(root, p);
      if (!fileExists(fullPath) && !dirExists(fullPath)) {
        issues.push(finding(11, 'MEDIUM', `module "${name}" references missing path: ${p}`, 'path may have been moved or deleted'));
      }
    }

    // (c) Broken dependency graph
    for (const dep of (mod.dependsOn || [])) {
      if (!moduleIds.has(dep)) {
        issues.push(finding(11, 'MEDIUM', `module "${name}" references unknown module: ${dep}`, 'dependency graph is broken'));
      }
    }
    for (const user of (mod.usedBy || [])) {
      if (!moduleIds.has(user)) {
        issues.push(finding(11, 'MEDIUM', `module "${name}" references unknown module: ${user}`, 'usedBy graph is broken'));
      }
    }

    // (d) Missing description
    if (!mod.description || mod.description.trim() === '') {
      issues.push(finding(11, 'LOW', `module "${name}" has no description`, 'add a description for documentation'));
    }
  }

  return issues;
}

// --- Main execution ---------------------------------------------------------

export function runIntegrityChecks(root) {
  const boardData = readJsonSafe(path.join(root, '.pipeline', 'board.json'));

  const issues = [
    ...check1_boardValidity(root),
    ...check2_staleHandoff(root),
    ...check3_orphanedPlanTasks(root, boardData),
    ...check4_unresolvedTests(root),
    ...check5_agentShadowing(root),
    ...check6_unregisteredStacks(root),
    ...check7_missingArchive(root),
    ...check8_staleRunActive(root),
    ...check9_requiredHooks(root),
    ...check10_staleSkills(root),
    ...check11_modulesIntegrity(root),
  ];

  return {
    issues,
    issueCount: issues.length,
    summary: issues.length === 0
      ? 'Integrity check complete — no issues found'
      : `Integrity check complete — ${issues.length} issue(s) found`,
  };
}

// --- CLI wrapper ------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[i + 1]);
      i++;
    }
  }

  if (!dirExists(root)) {
    log(`error: root directory does not exist: ${root}`);
    process.exit(1);
  }

  log(`checking: ${root}`);

  const result = runIntegrityChecks(root);

  for (const issue of result.issues) {
    log(`${issue.severity}: ${issue.title}`);
  }
  log(result.summary);

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}

main();
