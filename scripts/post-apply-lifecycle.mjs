#!/usr/bin/env node
// Post-apply lifecycle cleanup — runs after documenter in the apply pipeline.
//
// Executes the five pure-I/O cleanup jobs that were previously embedded in
// agents/documenter.md Steps 6, 7, 8, and 8b.
//
// Usage:
//   node scripts/post-apply-lifecycle.mjs "<feature name>"
//
// Always exits 0. All progress logged to stderr.

import fs from 'node:fs';
import path from 'node:path';

const featureName = process.argv[2] || '';

// Resolve project root (cwd when invoked from skill)
const projectDir = process.cwd();

function log(msg) {
  process.stderr.write(`[lifecycle] ${msg}\n`);
}

// --- Job 1: Archive and wipe reviewer output ---------------------------------
function archiveReviewerOutput() {
  try {
    const reviewerOutputDir = path.join(projectDir, '.pipeline', 'context', 'reviewer-output');
    const archiveBase = path.join(projectDir, '.pipeline', 'review-archive');
    const ts = String(Date.now());
    const archiveDir = path.join(archiveBase, ts);

    let files;
    try {
      files = fs.readdirSync(reviewerOutputDir).filter((f) => f.endsWith('.md'));
    } catch {
      // reviewer-output dir absent — nothing to archive
      log('reviewer-output: dir absent, skipping');
      return;
    }

    if (files.length === 0) {
      log('reviewer-output: no .md files, skipping');
      return;
    }

    fs.mkdirSync(archiveDir, { recursive: true });
    let copied = 0;
    for (const file of files) {
      try {
        fs.copyFileSync(
          path.join(reviewerOutputDir, file),
          path.join(archiveDir, file),
        );
        copied++;
      } catch (err) {
        log(`reviewer-output: copy failed for ${file}: ${err.message}`);
      }
    }

    // Wipe originals
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(reviewerOutputDir, file));
      } catch (err) {
        log(`reviewer-output: delete failed for ${file}: ${err.message}`);
      }
    }

    // Prune archive: keep only last 20 timestamped dirs
    try {
      const dirs = fs.readdirSync(archiveBase)
        .filter((d) => /^\d+$/.test(d))
        .sort((a, b) => Number(a) - Number(b));
      const toRemove = dirs.slice(0, Math.max(0, dirs.length - 20));
      for (const d of toRemove) {
        fs.rmSync(path.join(archiveBase, d), { recursive: true, force: true });
      }
    } catch {
      // Prune failure is non-fatal
    }

    log(`reviewer-output: archived ${copied} file(s) to review-archive/${ts}`);
  } catch (err) {
    log(`reviewer-output: unexpected error: ${err.message}`);
  }
}

// --- Job 2: Delete inter-agent sidecar files ---------------------------------
function deleteSidecars() {
  try {
    const sidecars = [
      'docs/context/handoff.md',
      'docs/context/slice-brief.md',
      'docs/context/supervisor-brief.md',
      'docs/context/triage-dispatch.json',
      '.pipeline/context/researcher-status.json',
      'docs/context/coder-status.json',
      'docs/context/scout.json',
      'docs/context/run-metrics.json',
    ];
    let deleted = 0;
    for (const rel of sidecars) {
      const fullPath = path.join(projectDir, rel);
      try {
        fs.unlinkSync(fullPath);
        deleted++;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          log(`sidecars: failed to delete ${rel}: ${err.message}`);
        }
      }
    }
    log(`sidecars: deleted ${deleted} file(s)`);
  } catch (err) {
    log(`sidecars: unexpected error: ${err.message}`);
  }
}

// --- Job 3: TESTING.md archival (>400 lines) ----------------------------------
function archiveTesting() {
  try {
    const testingPath = path.join(projectDir, 'docs', 'TESTING.md');
    const archivePath = path.join(projectDir, 'docs', 'archive', 'TESTING_HISTORY.md');

    let content;
    try {
      content = fs.readFileSync(testingPath, 'utf8');
    } catch {
      log('testing: TESTING.md absent, skipping');
      return;
    }

    const lines = content.split('\n');
    if (lines.length <= 400) {
      log('testing: under 400 lines, skipping archival');
      return;
    }

    // Ensure archive dir exists
    const archiveDir = path.join(projectDir, 'docs', 'archive');
    try {
      fs.mkdirSync(archiveDir, { recursive: true });
    } catch (err) {
      log(`testing: cannot create archive dir: ${err.message}`);
      return;
    }

    // Split: header block (before first ^## Test:) + entries
    const firstEntryIdx = lines.findIndex((l) => /^## Test:/.test(l));
    if (firstEntryIdx === -1) {
      log('testing: no ## Test: entries found, skipping');
      return;
    }

    const headerBlock = lines.slice(0, firstEntryIdx);

    // Split remaining into entries at each ^## Test: line
    const remaining = lines.slice(firstEntryIdx);
    const entries = [];
    let current = [];
    for (const line of remaining) {
      if (/^## Test:/.test(line) && current.length > 0) {
        entries.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) entries.push(current.join('\n'));

    if (entries.length <= 3) {
      log('testing: 3 or fewer entries, skipping archival');
      return;
    }

    const keepSet = entries.slice(-3);
    const archiveSet = entries.slice(0, entries.length - 3);

    // Write or append to TESTING_HISTORY.md
    const historyHeader = '# FORGE — Testing History\n\nTest entries archived from docs/TESTING.md when the file exceeds 400 lines.\n\n---\n';
    let historyContent;
    try {
      historyContent = fs.readFileSync(archivePath, 'utf8');
      // Append after the header separator
      const insertAt = historyContent.indexOf('\n---\n') + 5;
      historyContent = historyContent.slice(0, insertAt) + '\n' + archiveSet.join('\n') + historyContent.slice(insertAt);
    } catch {
      historyContent = historyHeader + '\n' + archiveSet.join('\n');
    }
    fs.writeFileSync(archivePath, historyContent, 'utf8');

    // Rewrite TESTING.md with header + keep set
    const newContent = headerBlock.join('\n') + '\n\n' + keepSet.join('\n');
    fs.writeFileSync(testingPath, newContent, 'utf8');

    log(`testing: archived ${archiveSet.length} entries, kept ${keepSet.length}`);
  } catch (err) {
    log(`testing: unexpected error: ${err.message}`);
  }
}

// --- Job 4: CHANGELOG.md archival (>200 lines) --------------------------------
function archiveChangelog() {
  try {
    const changelogPath = path.join(projectDir, 'docs', 'CHANGELOG.md');
    const archivePath = path.join(projectDir, 'docs', 'archive', 'CHANGELOG_HISTORY.md');

    let content;
    try {
      content = fs.readFileSync(changelogPath, 'utf8');
    } catch {
      log('changelog: CHANGELOG.md absent, skipping');
      return;
    }

    const lines = content.split('\n');
    if (lines.length <= 200) {
      log('changelog: under 200 lines, skipping archival');
      return;
    }

    // Ensure archive dir exists
    const archiveDir = path.join(projectDir, 'docs', 'archive');
    try {
      fs.mkdirSync(archiveDir, { recursive: true });
    } catch (err) {
      log(`changelog: cannot create archive dir: ${err.message}`);
      return;
    }

    // Split into entries at each ^## [ heading
    const firstEntryIdx = lines.findIndex((l) => /^## \[/.test(l));
    if (firstEntryIdx === -1) {
      log('changelog: no ## [ entries found, skipping');
      return;
    }

    const headerBlock = lines.slice(0, firstEntryIdx);
    const remaining = lines.slice(firstEntryIdx);
    const entries = [];
    let current = [];
    for (const line of remaining) {
      if (/^## \[/.test(line) && current.length > 0) {
        entries.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) entries.push(current.join('\n'));

    if (entries.length <= 5) {
      log('changelog: 5 or fewer entries, skipping archival');
      return;
    }

    const keepSet = entries.slice(-5);
    const archiveSet = entries.slice(0, entries.length - 5);

    // Write or append to CHANGELOG_HISTORY.md
    const historyHeader = '# FORGE — Changelog History\n\nChangelog entries archived from docs/CHANGELOG.md when the file exceeds 200 lines.\n\n---\n';
    let historyContent;
    try {
      historyContent = fs.readFileSync(archivePath, 'utf8');
      const insertAt = historyContent.indexOf('\n---\n') + 5;
      historyContent = historyContent.slice(0, insertAt) + '\n' + archiveSet.join('\n') + historyContent.slice(insertAt);
    } catch {
      historyContent = historyHeader + '\n' + archiveSet.join('\n');
    }
    fs.writeFileSync(archivePath, historyContent, 'utf8');

    // Rewrite CHANGELOG.md with header + keep set
    const newContent = headerBlock.join('\n') + '\n\n' + keepSet.join('\n');
    fs.writeFileSync(changelogPath, newContent, 'utf8');

    log(`changelog: archived ${archiveSet.length} entries, kept ${keepSet.length}`);
  } catch (err) {
    log(`changelog: unexpected error: ${err.message}`);
  }
}

// --- Job 5: RESEARCH file deletion -------------------------------------------
function deleteResearchFile() {
  try {
    if (!featureName) {
      log('research: no feature name provided, skipping');
      return;
    }

    const slug = featureName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const researchPath = path.join(projectDir, 'docs', 'RESEARCH', `${slug}.md`);

    try {
      fs.unlinkSync(researchPath);
      log(`research: deleted docs/RESEARCH/${slug}.md`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        log(`research: docs/RESEARCH/${slug}.md not found, skipping`);
      } else {
        log(`research: delete failed: ${err.message}`);
      }
    }
  } catch (err) {
    log(`research: unexpected error: ${err.message}`);
  }
}

// --- Job 6: Plan.md section removal ------------------------------------------
function removePlanSection() {
  try {
    if (!featureName) {
      log('plan-cleanup: no feature name provided, skipping');
      return;
    }

    const planPath = path.join(projectDir, 'docs', 'PLAN.md');
    let content;
    try {
      content = fs.readFileSync(planPath, 'utf8');
    } catch {
      log('plan-cleanup: docs/PLAN.md absent, skipping');
      return;
    }

    // Find the ### Feature: heading that includes the feature name.
    // Use indexOf/includes (not RegExp) to avoid regex injection from feature names.
    const lines = content.split('\n');
    let sectionStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('### Feature:') && lines[i].toLowerCase().includes(featureName.toLowerCase())) {
        sectionStart = i;
        break;
      }
    }

    if (sectionStart === -1) {
      log(`plan-cleanup: no matching "### Feature:" section found for "${featureName}", skipping`);
      return;
    }

    // Find end: next '---' separator line after the section start, or EOF.
    let sectionEnd = lines.length; // default: through EOF
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        sectionEnd = i + 1; // include the separator
        break;
      }
    }

    const before = lines.slice(0, sectionStart);
    const after = lines.slice(sectionEnd);

    // Trim trailing blank lines from `before` to avoid double-blank gaps
    while (before.length > 0 && before[before.length - 1].trim() === '') {
      before.pop();
    }
    // Trim vestigial --- separator (was between this and the removed last section)
    if (before.length > 0 && before[before.length - 1].trim() === '---') {
      before.pop();
      // Trim any additional trailing blanks above the removed separator
      while (before.length > 0 && before[before.length - 1].trim() === '') {
        before.pop();
      }
    }

    const newContent = (before.length > 0 ? before.join('\n') + '\n' : '') +
      (after.length > 0 ? (before.length > 0 ? '\n' : '') + after.join('\n') : '');

    try {
      fs.writeFileSync(planPath, newContent, 'utf8');
      log(`plan-cleanup: removed section for "${featureName}"`);
    } catch (err) {
      log(`plan-cleanup: write failed: ${err.message}`);
    }
  } catch (err) {
    log(`plan-cleanup: unexpected error: ${err.message}`);
  }
}

// --- Job 7: Board cleanup ----------------------------------------------------
function cleanupBoard() {
  try {
    if (!featureName || featureName.length <= 3) {
      log('board-cleanup: feature name absent or too short (<=3 chars), skipping');
      return;
    }

    const boardPath = path.join(projectDir, '.pipeline', 'board.json');
    let board;
    try {
      board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    } catch {
      log('board-cleanup: board.json absent or unreadable, skipping');
      return;
    }

    let changed = false;
    const now = new Date().toISOString();
    // Compute once — used in every iteration below to avoid per-item allocation.
    const featureLower = featureName.toLowerCase();

    // Remove planned[] items whose text contains featureName (case-insensitive)
    if (Array.isArray(board.planned)) {
      const before = board.planned.length;
      board.planned = board.planned.filter(
        (item) => !(typeof item.text === 'string' && item.text.toLowerCase().includes(featureLower)),
      );
      if (board.planned.length !== before) {
        log(`board-cleanup: removed ${before - board.planned.length} item(s) from planned[]`);
        changed = true;
      }
    }

    // Mark todos[] items done whose text contains featureName (case-insensitive)
    if (Array.isArray(board.todos)) {
      for (const item of board.todos) {
        if (typeof item.text === 'string' && item.text.toLowerCase().includes(featureLower) && !item.done) {
          item.done = true;
          item.doneAt = now;
          changed = true;
        }
      }
    }

    if (!changed) {
      log(`board-cleanup: no matching items found for "${featureName}"`);
      return;
    }

    try {
      fs.writeFileSync(boardPath, JSON.stringify(board, null, 2), 'utf8');
      log(`board-cleanup: board.json updated for "${featureName}"`);
    } catch (err) {
      log(`board-cleanup: write failed: ${err.message}`);
    }
  } catch (err) {
    log(`board-cleanup: unexpected error: ${err.message}`);
  }
}

// --- Job 8: Module touch logging ---------------------------------------------
function logModulesTouched() {
  try {
    const coderStatusPath = path.join(projectDir, 'docs', 'context', 'coder-status.json');
    let coderStatus;
    try {
      coderStatus = JSON.parse(fs.readFileSync(coderStatusPath, 'utf8'));
    } catch {
      log('module-touch: coder-status.json absent or unreadable, skipping');
      return;
    }

    const modulesPath = path.join(projectDir, '.pipeline', 'modules.json');
    let modulesData;
    try {
      modulesData = JSON.parse(fs.readFileSync(modulesPath, 'utf8'));
    } catch {
      log('module-touch: modules.json absent or unreadable, skipping');
      return;
    }

    const touchedFiles = [
      ...(Array.isArray(coderStatus.filesTouched) ? coderStatus.filesTouched : []),
      ...(Array.isArray(coderStatus.filesCreated) ? coderStatus.filesCreated : []),
    ];

    if (touchedFiles.length === 0) {
      log('module-touch: no files in coder-status.json, skipping');
      return;
    }

    // modules.json can be an array of module objects or an object keyed by id.
    // Normalise to array of { id, path } entries.
    let modules = [];
    if (Array.isArray(modulesData)) {
      modules = modulesData;
    } else if (modulesData && typeof modulesData === 'object') {
      modules = Object.entries(modulesData).map(([id, val]) => ({
        id,
        path: typeof val === 'string' ? val : val.path || '',
      }));
    }

    for (const file of touchedFiles) {
      const normalizedFile = file.replace(/\\/g, '/');
      const matched = modules
        .filter((m) => {
          const mPath = (m.path || '').replace(/\\/g, '/');
          return mPath && normalizedFile.includes(mPath);
        })
        .map((m) => m.id);

      if (matched.length > 0) {
        process.stderr.write(`[lifecycle] module-touch: ${file} -> [${matched.join(', ')}]\n`);
      } else {
        process.stderr.write(`[lifecycle] module-touch: ${file} -> (no module match)\n`);
      }
    }
  } catch (err) {
    log(`module-touch: unexpected error: ${err.message}`);
  }
}

// --- Main --------------------------------------------------------------------
function main() {
  log(`starting for feature: "${featureName}"`);

  archiveReviewerOutput();
  deleteSidecars();
  archiveTesting();
  archiveChangelog();
  deleteResearchFile();
  removePlanSection();
  cleanupBoard();
  logModulesTouched();

  log('done');
  process.exit(0);
}

main();
