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
    const reviewerOutputDir = path.join(projectDir, 'docs', 'context', 'reviewer-output');
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
      'docs/context/triage-dispatch.json',
      'docs/context/researcher-status.json',
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

// --- Main --------------------------------------------------------------------
function main() {
  log(`starting for feature: "${featureName}"`);

  archiveReviewerOutput();
  deleteSidecars();
  archiveTesting();
  archiveChangelog();
  deleteResearchFile();

  log('done');
  process.exit(0);
}

main();
