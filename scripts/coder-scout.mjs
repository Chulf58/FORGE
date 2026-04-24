#!/usr/bin/env node
// Deterministic coder-scout — replaces the coder-scout agent for the common case.
//
// Reads docs/PLAN.md, extracts backtick file paths from active [ ] task lines,
// checks existence, applies priority trimming to 5 files, and writes
// docs/context/scout.json.
//
// Usage:
//   node scripts/coder-scout.mjs [--root <path>]
//
// Exit codes:
//   0 — scout.json written successfully (JSON result on stdout)
//   1 — fallback needed (missing plan, no extractable paths, write failure)

import fs from 'node:fs';
import path from 'node:path';

function log(msg) {
  process.stderr.write(`[coder-scout] ${msg}\n`);
}

// --- Helpers ----------------------------------------------------------------

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
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

// --- Plan parsing -----------------------------------------------------------

function extractActiveFeatureSection(planContent) {
  const lines = planContent.split('\n');
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
  return lines.slice(featureStart, featureEnd);
}

function extractActiveTasks(sectionLines) {
  const tasks = [];
  for (const line of sectionLines) {
    if (/^- \[ \]/.test(line)) {
      tasks.push(line);
    }
  }
  return tasks;
}

// --- Candidate extraction ---------------------------------------------------

const BACKTICK_PATH_RE = /`([^`]+\.[a-zA-Z]{1,10})`/g;
const ACTION_VERB_RE = /\b(add|modify|update|create|extend|remove|delete|rename|move|extract|refactor|bump|wire|insert|replace)\b/i;
const FUNCTION_RE = /\b(?:function|method|handler|component|export)\s+`?(\w+)`?/gi;
const NAMED_SYMBOL_RE = /`(\w+(?:\.\w+)?)\(\)`|`(\w+)`\s+(?:function|method|handler)/gi;

function extractCandidates(taskLines) {
  const candidates = new Map();

  for (const line of taskLines) {
    const paths = [];
    let match;

    BACKTICK_PATH_RE.lastIndex = 0;
    while ((match = BACKTICK_PATH_RE.exec(line)) !== null) {
      const p = match[1];
      if (p.includes('/') || p.includes('\\')) {
        paths.push(p.replace(/\\/g, '/'));
      }
    }

    const actionMatch = ACTION_VERB_RE.exec(line);
    const action = actionMatch ? actionMatch[1].toLowerCase() : 'modify';

    const functions = [];
    for (const re of [FUNCTION_RE, NAMED_SYMBOL_RE]) {
      re.lastIndex = 0;
      while ((match = re.exec(line)) !== null) {
        const name = match[1] || match[2];
        if (name && !paths.some(p => p.includes(name))) {
          functions.push(name);
        }
      }
    }

    for (const p of paths) {
      if (!candidates.has(p)) {
        candidates.set(p, { path: p, action, functions: [], isNew: false });
      }
      const entry = candidates.get(p);
      if (action === 'create') entry.isNew = true;
      for (const fn of functions) {
        if (!entry.functions.includes(fn)) {
          entry.functions.push(fn);
        }
      }
    }
  }

  return Array.from(candidates.values());
}

// --- Existence resolution ---------------------------------------------------

function resolveCandidates(root, candidates) {
  const resolved = [];

  for (const c of candidates) {
    const fullPath = path.join(root, c.path);

    if (c.isNew) {
      resolved.push({ ...c, exists: false });
      continue;
    }

    if (fileExists(fullPath)) {
      resolved.push({ ...c, exists: true });
    } else if (dirExists(fullPath)) {
      resolved.push({ ...c, exists: true });
    }
  }

  return resolved;
}

// --- Priority ranking and trimming ------------------------------------------

const BOUNDARY_DIRS = ['hooks', 'agents', 'commands', 'skills', 'mcp', 'bin'];

function priorityScore(candidate) {
  let score = 0;
  if (candidate.functions.length > 0) score += 10;
  const topDir = candidate.path.split('/')[0];
  if (BOUNDARY_DIRS.includes(topDir)) score += 5;
  return score;
}

function trimToLimit(resolved, limit) {
  const existing = resolved.filter(c => c.exists && !c.isNew);
  const newFiles = resolved.filter(c => c.isNew);

  if (existing.length <= limit) {
    return { filesToRead: existing, trimmed: [], newFiles };
  }

  existing.sort((a, b) => priorityScore(b) - priorityScore(a));
  const kept = existing.slice(0, limit);
  const trimmed = existing.slice(limit);

  return { filesToRead: kept, trimmed, newFiles };
}

// --- Hook event extraction --------------------------------------------------

const KNOWN_HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse',
  'UserPromptSubmit', 'Stop', 'PostCompact', 'FileChanged',
  'SubagentStart', 'SubagentStop',
]);

const QUOTED_TOKEN_RE = /['"`](\/?\w[\w:-]*)['"`]/g;

function extractHookEvents(taskLines) {
  const seen = new Set();
  const events = [];

  for (const line of taskLines) {
    QUOTED_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = QUOTED_TOKEN_RE.exec(line)) !== null) {
      const token = match[1];
      if (seen.has(token)) continue;

      if (KNOWN_HOOK_EVENTS.has(token) ||
          /^\/forge:[a-z0-9-]+$/.test(token) ||
          /^forge:[a-z0-9-]+$/.test(token)) {
        seen.add(token);
        events.push(token);
      }
    }
  }

  return events;
}

// --- Scout JSON construction ------------------------------------------------

function buildScoutJson(filesToRead, trimmedFiles, newFiles, hookEvents) {
  const functionsToModify = {};
  for (const f of filesToRead) {
    if (f.functions.length > 0) {
      functionsToModify[f.path] = f.functions;
    }
  }

  const result = {
    files_to_read: filesToRead.map(f => f.path),
    functions_to_modify: functionsToModify,
    new_files: newFiles.map(f => f.path),
    hook_events: hookEvents,
  };

  if (trimmedFiles.length > 0) {
    result.trimmed_files = trimmedFiles.map(f => f.path);
  }

  return result;
}

// --- Main export ------------------------------------------------------------

export function runCoderScout(root) {
  const planPath = path.join(root, 'docs', 'PLAN.md');
  const planContent = readFileSafe(planPath);

  if (planContent === null) {
    return { ok: false, reason: 'PLAN.md missing or unreadable', scout: null };
  }

  const featureSection = extractActiveFeatureSection(planContent);
  if (featureSection.length === 0) {
    return { ok: false, reason: 'no active feature section with unchecked tasks', scout: null };
  }

  const taskLines = extractActiveTasks(featureSection);
  if (taskLines.length === 0) {
    return { ok: false, reason: 'no unchecked task lines found', scout: null };
  }

  const candidates = extractCandidates(taskLines);
  if (candidates.length === 0) {
    return { ok: false, reason: 'no backtick file paths found in task lines — fallback to agent', scout: null };
  }

  const resolved = resolveCandidates(root, candidates);
  const existingCount = resolved.filter(c => c.exists).length;
  const newCount = resolved.filter(c => c.isNew).length;

  if (existingCount === 0 && newCount === 0) {
    return { ok: false, reason: 'no referenced paths exist on disk and no new files — fallback to agent', scout: null };
  }

  const { filesToRead, trimmed, newFiles } = trimToLimit(resolved, 5);
  const hookEvents = extractHookEvents(taskLines);
  const scout = buildScoutJson(filesToRead, trimmed, newFiles, hookEvents);

  const scoutDir = path.join(root, 'docs', 'context');
  const scoutPath = path.join(scoutDir, 'scout.json');

  try {
    fs.mkdirSync(scoutDir, { recursive: true });
    fs.writeFileSync(scoutPath, JSON.stringify(scout, null, 2) + '\n', 'utf8');
  } catch (err) {
    return { ok: false, reason: `failed to write scout.json: ${err.message}`, scout: null };
  }

  return {
    ok: true,
    reason: null,
    scout,
    signal: `[scout] files=${scout.files_to_read.length} new=${scout.new_files.length}`,
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

  log(`scanning: ${root}`);

  const result = runCoderScout(root);

  if (!result.ok) {
    log(`fallback: ${result.reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason: result.reason }, null, 2) + '\n');
    process.exit(1);
  }

  log(`wrote scout.json — ${result.signal}`);
  process.stdout.write(JSON.stringify({
    ok: true,
    scout: result.scout,
    signal: result.signal,
  }, null, 2) + '\n');
  process.exit(0);
}

main();
