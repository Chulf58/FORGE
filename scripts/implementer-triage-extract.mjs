#!/usr/bin/env node
// Deterministic implementer triage — extracts per-task briefs for parallel
// implementer dispatch.
//
// Reads docs/PLAN.md and docs/context/handoff.md, extracts wave-annotated tasks,
// matches each to its handoff file-path section, includes dependency context and
// gotchas, and writes individual brief files to docs/context/triage-briefs/.
//
// Usage:
//   node scripts/implementer-triage-extract.mjs [--root <path>]
//
// Exit codes:
//   0 — triage briefs written (JSON result on stdout); also exit 0 with noWaves
//       when no wave-annotated tasks exist
//   1 — fallback needed (missing files, ambiguous matching, malformed plan)

import fs from 'node:fs';
import path from 'node:path';

function log(msg) {
  process.stderr.write(`implementer-triage: ${msg}\n`);
}

// --- Helpers ----------------------------------------------------------------

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
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
  let featureName = 'unknown';

  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^### Feature:/.test(lines[i])) {
      const section = lines.slice(i, featureEnd);
      if (section.some(l => /^- \[ \]/.test(l))) {
        featureStart = i;
        featureName = lines[i].replace(/^### Feature:\s*/, '').trim();
        break;
      }
      featureEnd = i;
    }
  }

  if (featureStart === -1) return { lines: [], featureName };
  return { lines: lines.slice(featureStart, featureEnd), featureName };
}

function parseAllTasks(sectionLines) {
  const tasks = [];
  const TASK_RE = /^- \[([ x])\]\s+(\d+)\.\s+(.*)/;
  const WAVE_RE = /\(wave:\s*(\d+)\)/;
  const FILE_RE = /`([^`]+\.[a-zA-Z]{1,10})`/;

  const taskLineIndices = [];
  for (let i = 0; i < sectionLines.length; i++) {
    if (/^- \[/.test(sectionLines[i])) {
      taskLineIndices.push(i);
    }
  }

  for (let t = 0; t < taskLineIndices.length; t++) {
    const idx = taskLineIndices[t];
    const nextIdx = t + 1 < taskLineIndices.length
      ? taskLineIndices[t + 1]
      : sectionLines.length;
    const line = sectionLines[idx];
    const match = TASK_RE.exec(line);
    if (!match) continue;

    const checked = match[1] === 'x';
    const taskId = parseInt(match[2], 10);
    const waveMatch = WAVE_RE.exec(line);
    const fileMatch = FILE_RE.exec(line);

    let intent = '';
    let depends = [];
    let verify = '';

    for (let j = idx + 1; j < nextIdx; j++) {
      if (/^- \[/.test(sectionLines[j])) break;
      const trimmed = sectionLines[j].trim();
      if (trimmed.startsWith('Intent:')) {
        intent = trimmed.replace(/^Intent:\s*/, '');
      } else if (trimmed.startsWith('Depends:')) {
        depends = trimmed.replace(/^Depends:\s*/, '')
          .split(/[,\s]+/)
          .map(Number)
          .filter(n => !isNaN(n) && n > 0);
      } else if (trimmed.startsWith('Verify:')) {
        verify = trimmed.replace(/^Verify:\s*/, '');
      }
    }

    tasks.push({
      id: taskId,
      checked,
      titleLine: line,
      targetFile: fileMatch ? fileMatch[1].replace(/\\/g, '/') : null,
      wave: waveMatch ? parseInt(waveMatch[1], 10) : null,
      intent,
      depends,
      verify,
    });
  }

  return tasks;
}

// --- Handoff parsing --------------------------------------------------------

function parseHandoffSections(handoffContent) {
  const lines = handoffContent.split('\n');
  const sections = new Map();
  let sharedChanges = null;
  let currentFile = null;
  let currentContent = [];
  let inFileSection = false;

  function saveCurrentFile() {
    if (currentFile) {
      sections.set(currentFile, currentContent.join('\n'));
      currentFile = null;
      currentContent = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^## Files to (modify|create)/.test(line)) {
      saveCurrentFile();
      inFileSection = true;
      continue;
    }

    if (/^## Shared changes/i.test(line)) {
      saveCurrentFile();
      inFileSection = false;
      const sharedLines = [];
      let j = i + 1;
      while (j < lines.length && !/^## /.test(lines[j])) {
        sharedLines.push(lines[j]);
        j++;
      }
      sharedChanges = sharedLines.join('\n').trim();
      i = j - 1;
      continue;
    }

    if (/^## /.test(line)) {
      saveCurrentFile();
      inFileSection = false;
      continue;
    }

    if (inFileSection) {
      const fileHeadingMatch = /^### `([^`]+)`/.exec(line);
      if (fileHeadingMatch) {
        saveCurrentFile();
        currentFile = fileHeadingMatch[1].replace(/\\/g, '/');
        currentContent = [line];
        continue;
      }
    }

    if (currentFile) {
      currentContent.push(line);
    }
  }

  saveCurrentFile();
  return { sections, sharedChanges };
}

// --- Gotcha extraction ------------------------------------------------------

function parseGotchaSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentHeading = null;
  let currentLines = [];

  for (const line of lines) {
    if (/^## /.test(line)) {
      if (currentHeading) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
        });
      }
      currentHeading = line.replace(/^## /, '').trim();
      currentLines = [];
    } else if (currentHeading) {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

const DIR_TO_GOTCHA_KEYWORDS = {
  hooks: ['hook'],
  agents: ['agent', 'frontmatter'],
  mcp: ['mcp'],
  commands: ['command'],
  skills: ['command'],
  scripts: ['platform'],
  bin: ['platform'],
};

function findRelevantGotchas(targetFile, gotchaSections) {
  if (gotchaSections.length === 0) return '';
  const dir = targetFile.split('/')[0];
  const keywords = DIR_TO_GOTCHA_KEYWORDS[dir];
  if (!keywords) return '';

  const matched = [];
  for (const section of gotchaSections) {
    const headingLower = section.heading.toLowerCase();
    if (keywords.some(kw => headingLower.includes(kw))) {
      matched.push(`## ${section.heading}\n${section.content}`);
    }
  }

  if (matched.length === 0) return '';
  const allLines = matched.join('\n\n').split('\n');
  return allLines.slice(0, 10).join('\n');
}

// --- Dependency resolution --------------------------------------------------

function buildDependencyContext(task, allTasks, handoffSections) {
  const depContext = [];

  if (task.depends.length > 0) {
    for (const depId of task.depends) {
      const depTask = allTasks.find(t => t.id === depId);
      if (!depTask) continue;
      const depHandoff = depTask.targetFile
        ? (handoffSections.get(depTask.targetFile) || null)
        : null;
      depContext.push({
        taskId: depId,
        titleLine: depTask.titleLine,
        intent: depTask.intent,
        handoffExcerpt: depHandoff,
      });
    }
  } else if (task.wave > 1) {
    const thisHandoff = task.targetFile
      ? (handoffSections.get(task.targetFile) || '')
      : '';
    for (const other of allTasks) {
      if (other.wave !== null && other.wave < task.wave &&
          other.targetFile && thisHandoff.includes(other.targetFile)) {
        const otherHandoff = handoffSections.get(other.targetFile) || null;
        depContext.push({
          taskId: other.id,
          titleLine: other.titleLine,
          intent: other.intent,
          handoffExcerpt: otherHandoff,
        });
      }
    }
  }

  return depContext;
}

// --- Shared changes relevance -----------------------------------------------

const UNIVERSAL_SHARED_RE = /\b(all\s+(modified\s+)?files|every\s+file|each\s+file|across\s+all)\b/i;

function sharedChangesAffectsFile(sharedChanges, targetFile) {
  if (!sharedChanges) return false;
  if (sharedChanges.includes(targetFile)) return true;
  const dir = targetFile.split('/')[0];
  if (dir && sharedChanges.includes(dir + '/')) return true;
  if (UNIVERSAL_SHARED_RE.test(sharedChanges)) return true;
  return false;
}

// --- Brief construction -----------------------------------------------------

function buildTaskBrief(task, waveSeq, handoffContent, sharedChanges, depContext, gotchaLines) {
  const lines = [];
  lines.push(`[task-brief-for: wave-${task.wave}-task-${waveSeq}]`);
  lines.push(`Task: ${task.titleLine}`);

  if (task.depends.length > 0) {
    lines.push(`Depends: ${task.depends.join(', ')}`);
  }

  lines.push(`Intent: ${task.intent}`);
  lines.push(`Verify: ${task.verify}`);
  lines.push(`Target file: ${task.targetFile}`);
  lines.push(`Wave: ${task.wave}`);
  lines.push('');

  lines.push('Handoff section:');
  lines.push(handoffContent);

  if (sharedChangesAffectsFile(sharedChanges, task.targetFile)) {
    lines.push('');
    lines.push('## Shared changes');
    lines.push(sharedChanges);
  }

  for (const dep of depContext) {
    lines.push('');
    lines.push(`Dependency context (task ${dep.taskId}):`);
    lines.push(`Task: ${dep.titleLine}`);
    lines.push(`Intent: ${dep.intent}`);
    if (dep.handoffExcerpt) {
      lines.push('Relevant handoff excerpt:');
      lines.push(dep.handoffExcerpt);
    }
  }

  if (gotchaLines) {
    lines.push('');
    lines.push('Gotcha context:');
    lines.push(gotchaLines);
  }

  lines.push('[/task-brief-for]');
  return lines.join('\n');
}

// --- Main export ------------------------------------------------------------

export function runImplementerTriageExtract(root) {
  const planPath = path.join(root, 'docs', 'PLAN.md');
  const planContent = readFileSafe(planPath);

  if (planContent === null) {
    return { ok: false, reason: 'PLAN.md missing or unreadable' };
  }

  const { lines: sectionLines, featureName } = extractActiveFeatureSection(planContent);
  if (sectionLines.length === 0) {
    return { ok: false, reason: 'no active feature section with unchecked tasks' };
  }

  const allTasks = parseAllTasks(sectionLines);
  const waveTasks = allTasks.filter(t => !t.checked && t.wave !== null);

  if (waveTasks.length === 0) {
    return { ok: true, briefs: [], waves: [], noWaves: true, briefCount: 0 };
  }

  for (const task of waveTasks) {
    if (!task.targetFile) {
      return {
        ok: false,
        reason: `task ${task.id} has no extractable file path — fallback to agent`,
      };
    }
    if (!task.intent) {
      return {
        ok: false,
        reason: `task ${task.id} missing Intent line — fallback to agent`,
      };
    }
    if (!task.verify) {
      return {
        ok: false,
        reason: `task ${task.id} missing Verify line — fallback to agent`,
      };
    }
  }

  const handoffPath = path.join(root, 'docs', 'context', 'handoff.md');
  const handoffRaw = readFileSafe(handoffPath);

  if (handoffRaw === null) {
    return { ok: false, reason: 'handoff.md missing or unreadable' };
  }

  const { sections: handoffSections, sharedChanges } = parseHandoffSections(handoffRaw);

  for (const task of waveTasks) {
    if (!handoffSections.has(task.targetFile)) {
      return {
        ok: false,
        reason: `task ${task.id} target file "${task.targetFile}" has no matching handoff section — fallback to agent`,
      };
    }
  }

  const skillsPath = path.join(root, 'docs', 'gotchas', 'SKILLS.md');
  const skillsContent = readFileSafe(skillsPath);
  if (skillsContent) {
    const hasTriageSection = /^## Implementer-Triage/m.test(skillsContent);
    if (hasTriageSection) {
      return {
        ok: false,
        reason: 'SKILLS.md has ## Implementer-Triage section — semantic mapping requires agent fallback',
      };
    }
  }

  const generalPath = path.join(root, 'docs', 'gotchas', 'GENERAL.md');
  const generalContent = readFileSafe(generalPath);
  const gotchaSections = generalContent ? parseGotchaSections(generalContent) : [];

  const waveMap = new Map();
  for (const task of waveTasks) {
    if (!waveMap.has(task.wave)) waveMap.set(task.wave, []);
    waveMap.get(task.wave).push(task);
  }
  for (const tasks of waveMap.values()) {
    tasks.sort((a, b) => a.id - b.id);
  }
  const sortedWaves = Array.from(waveMap.keys()).sort((a, b) => a - b);

  const briefs = [];
  const briefDir = path.join(root, 'docs', 'context', 'triage-briefs');

  for (const waveNum of sortedWaves) {
    const tasks = waveMap.get(waveNum);
    for (let seq = 0; seq < tasks.length; seq++) {
      const task = tasks[seq];
      const waveSeq = seq + 1;

      const sectionContent = handoffSections.get(task.targetFile);
      const depContext = buildDependencyContext(task, allTasks, handoffSections);
      const gotchaLines = findRelevantGotchas(task.targetFile, gotchaSections);

      const brief = buildTaskBrief(
        task, waveSeq, sectionContent, sharedChanges, depContext, gotchaLines,
      );

      const briefRelPath = `docs/context/triage-briefs/wave-${waveNum}-task-${waveSeq}.md`;

      briefs.push({
        wave: waveNum,
        taskSeq: waveSeq,
        taskId: task.id,
        targetFile: task.targetFile,
        briefPath: briefRelPath,
        content: brief,
      });
    }
  }

  try {
    fs.mkdirSync(briefDir, { recursive: true });
    for (const brief of briefs) {
      const fullPath = path.join(root, brief.briefPath);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(path.resolve(root))) {
        return { ok: false, reason: `path traversal detected: ${brief.briefPath}` };
      }
      fs.writeFileSync(fullPath, brief.content + '\n', 'utf8');
    }
  } catch (err) {
    return { ok: false, reason: `failed to write triage briefs: ${err.message}` };
  }

  return {
    ok: true,
    briefs: briefs.map(b => ({
      wave: b.wave,
      taskSeq: b.taskSeq,
      taskId: b.taskId,
      targetFile: b.targetFile,
      briefPath: b.briefPath,
    })),
    waves: sortedWaves,
    briefCount: briefs.length,
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

  const result = runImplementerTriageExtract(root);

  if (!result.ok) {
    log(`fallback: ${result.reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason: result.reason }, null, 2) + '\n');
    process.exit(1);
  }

  if (result.noWaves) {
    log('no wave-annotated tasks — orchestrator runs implementer sequentially');
  } else {
    log(`wrote ${result.briefCount} brief(s) across ${result.waves.length} wave(s)`);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    briefs: result.briefs,
    waves: result.waves,
    noWaves: result.noWaves || false,
    briefCount: result.briefCount,
  }, null, 2) + '\n');
  process.exit(0);
}

main();
