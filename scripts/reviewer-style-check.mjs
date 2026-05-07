#!/usr/bin/env node
// Deterministic style reviewer — fast path for the reviewer-style agent.
//
// Scans added lines in git-diff.txt for style violations using regex patterns.
// Never emits BLOCK — only REVISE (warnings found) or APPROVED (no warnings).
//
// Usage:
//   node scripts/reviewer-style-check.mjs --root <path> [--output-dir <path>]
//
// Exit codes:
//   0 — valid reviewer verdict produced (JSON result on stdout)
//   1 — fallback needed (git-diff.txt missing, unreadable, or empty)

import fs from 'node:fs';
import path from 'node:path';

function log(msg) {
  process.stderr.write(`[reviewer-style-check] ${msg}\n`);
}

// --- Style check patterns ---------------------------------------------------

// Returns true if the file path looks like a test file.
function isTestFile(filePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) ||
    /\b(test|tests|__tests__|spec|specs)\b/.test(filePath);
}

// Parse unified diff into per-file chunks.
// Returns array of { filePath, addedLines } objects.
function parseDiff(diffContent) {
  const chunks = [];
  // Split on diff --git headers
  const fileSections = diffContent.split(/^diff --git /m);

  for (const section of fileSections) {
    if (!section.trim()) continue;

    // Extract file path from +++ b/<path> header
    const pathMatch = /^\+\+\+ b\/(.+)$/m.exec(section);
    if (!pathMatch) continue;

    const filePath = pathMatch[1].trim();

    // Extract added lines: lines starting with + but NOT +++
    const addedLines = [];
    const rawLines = section.split('\n');
    for (const rawLine of rawLines) {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        addedLines.push(rawLine.slice(1)); // strip the leading +
      }
    }

    chunks.push({ filePath, addedLines });
  }

  return chunks;
}

// Run all style checks against parsed diff chunks.
// Returns an array of warning objects { rule, match, context }.
function runStyleChecks(chunks) {
  const warnings = [];

  for (const { filePath, addedLines } of chunks) {
    if (addedLines.length === 0) continue;

    const isTest = isTestFile(filePath);
    const codeContent = addedLines.join('\n');

    for (let i = 0; i < addedLines.length; i++) {
      const line = addedLines[i];
      const lineNum = i + 1;

      // 1. console.log — skip in test files
      if (!isTest && /\bconsole\.log\s*\(/.test(line)) {
        warnings.push({
          rule: 'no-console-log',
          context: `${filePath} line ~${lineNum}`,
          match: line.trim().slice(0, 80),
        });
      }

      // 2. debugger statement
      if (/\bdebugger\b/.test(line)) {
        warnings.push({
          rule: 'no-debugger',
          context: `${filePath} line ~${lineNum}`,
          match: line.trim().slice(0, 80),
        });
      }

      // 3. TODO comments
      if (/\bTODO\b/.test(line)) {
        warnings.push({
          rule: 'no-todo',
          context: `${filePath} line ~${lineNum}`,
          match: line.trim().slice(0, 80),
        });
      }
    }

    // 4. Commented-out code blocks — detect 3+ consecutive comment lines
    //    that look like code (contain {, }, (, ), ;, =, etc.)
    const commentedCodeRe = /^\s*\/\/\s*.+[{};()=<>]/;
    let consecutiveCount = 0;
    for (let i = 0; i < addedLines.length; i++) {
      if (commentedCodeRe.test(addedLines[i])) {
        consecutiveCount++;
        if (consecutiveCount >= 3) {
          warnings.push({
            rule: 'no-commented-code',
            context: `${filePath} line ~${i - 1}`,
            match: addedLines[i].trim().slice(0, 80),
          });
          consecutiveCount = 0; // reset to avoid repeated warnings for same block
        }
      } else {
        consecutiveCount = 0;
      }
    }

    // 5. Empty catch blocks: catch(...) { } or catch(...) { // comment }
    const emptyCatchRe = /catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*)?\s*\}/g;
    let m;
    while ((m = emptyCatchRe.exec(codeContent)) !== null) {
      warnings.push({
        rule: 'no-empty-catch',
        context: filePath,
        match: m[0].replace(/\s+/g, ' ').slice(0, 80),
      });
    }

    // 6. TypeScript any type: : any or as any
    const anyTypeRe = /(?::\s*any\b|as\s+any\b)/g;
    while ((m = anyTypeRe.exec(codeContent)) !== null) {
      // Find which line this is on for context
      const before = codeContent.slice(0, m.index);
      const lineNum = (before.match(/\n/g) || []).length + 1;
      warnings.push({
        rule: 'no-any-type',
        context: `${filePath} line ~${lineNum}`,
        match: m[0].slice(0, 80),
      });
    }

    // 7. Mixed ES imports and CommonJS require in the same file block
    const hasEsImport = /^import\s+/m.test(codeContent);
    const hasRequire = /\brequire\s*\(/m.test(codeContent);
    if (hasEsImport && hasRequire) {
      warnings.push({
        rule: 'no-mixed-imports',
        context: filePath,
        match: 'mixed ES import and CommonJS require in same file',
      });
    }
  }

  return warnings;
}

// --- Feature name extraction ------------------------------------------------

// Derive feature identifier from first changed file path, or fallback.
function extractFeatureName(chunks) {
  if (chunks.length > 0 && chunks[0].filePath) {
    // Sanitize: strip control characters and injection-prone chars
    return chunks[0].filePath
      .replace(/["\\\`$\r\n]/g, '')
      .replace(/[\x00-\x1f]/g, '')
      .trim();
  }
  return 'unknown-feature';
}

// --- Markdown output builder ------------------------------------------------

function buildReviewerOutput(featureName, warnings, verdict) {
  const lines = [
    `# Reviewer: reviewer-style`,
    ``,
    `**Feature:** ${featureName}`,
    `**Verdict:** ${verdict}`,
    `**Warnings:** ${warnings.length}`,
    ``,
  ];

  if (warnings.length === 0) {
    lines.push('No style issues found.');
    lines.push('');
  } else {
    lines.push('## Style Warnings');
    lines.push('');
    for (const w of warnings) {
      lines.push(`- **[${w.rule}]** ${w.context}`);
      lines.push(`  \`${w.match}\``);
    }
    lines.push('');
  }

  lines.push('## Advisory');
  lines.push('');
  lines.push(
    'Checks NOT run by deterministic script (require LLM agent): ' +
    'CSS convention correctness, file naming convention adherence, ' +
    'user-facing error message readability.',
  );
  lines.push('');

  return lines.join('\n');
}

// --- Main -------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let outputDirOverride = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      root = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      outputDirOverride = path.resolve(args[i + 1]);
      i++;
    } else if (args[i].startsWith('--output-dir=')) {
      outputDirOverride = path.resolve(args[i].slice('--output-dir='.length));
    }
  }

  const diffPath = path.join(root, 'docs', 'context', 'git-diff.txt');

  let diffContent;
  try {
    diffContent = fs.readFileSync(diffPath, 'utf8');
  } catch (err) {
    const reason = `git-diff.txt missing or unreadable: ${err.message}`;
    log(`fallback: ${reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason }, null, 2) + '\n');
    process.exit(1);
  }

  if (!diffContent.trim()) {
    const reason = 'git-diff.txt is empty';
    log(`fallback: ${reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason }, null, 2) + '\n');
    process.exit(1);
  }

  const chunks = parseDiff(diffContent);

  if (chunks.length === 0) {
    const reason = 'no file chunks found in git-diff.txt';
    log(`fallback: ${reason}`);
    process.stdout.write(JSON.stringify({ ok: false, reason }, null, 2) + '\n');
    process.exit(1);
  }

  const featureName = extractFeatureName(chunks);
  const warnings = runStyleChecks(chunks);
  const verdict = warnings.length > 0 ? 'REVISE' : 'APPROVED';

  log(`feature: ${featureName}`);
  log(`warnings: ${warnings.length}`);

  const signal = `[reviewer-verdict] ${JSON.stringify({
    agent: 'reviewer-style',
    verdict,
    blockers: 0,
    warnings: warnings.length,
    feature: featureName,
    model: 'deterministic-script',
  })}`;

  log(signal);

  // Write reviewer output markdown
  const outputDir = outputDirOverride !== null
    ? outputDirOverride
    : path.join(root, 'docs', 'context', 'reviewer-output');
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'reviewer-style.md');
    fs.writeFileSync(outputPath, buildReviewerOutput(featureName, warnings, verdict), 'utf8');
    log(`wrote: ${outputPath}`);
  } catch (err) {
    log(`warning: could not write reviewer output: ${err.message}`);
    // Non-fatal — verdict is still valid
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    verdict: {
      verdict,
      blockers: 0,
      warnings: warnings.length,
      feature: featureName,
      signal,
    },
  }, null, 2) + '\n');
  process.exit(0);
}

main();
