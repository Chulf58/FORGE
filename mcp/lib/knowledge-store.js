// knowledge-store.js — Data-layer helpers for the forge_knowledge MCP tools.
//
// Three named exports:
//   searchConstraints(projectDir, keyword)   — search docs/gotchas/ sections
//   searchPatterns(projectDir, keyword, tags) — search docs/solutions/index.json
//   appendSolutionDoc(projectDir, { title, content, tags }) — write + index a new solution
//
// All file reads are try/catch fail-open. All writes use atomic temp-file-rename.
// Never console.log() — would corrupt JSON-RPC if imported by server.js.

import { readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const INDEX_PATH = 'docs/solutions/index.json';
const GOTCHAS_REL = 'docs/gotchas';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Atomically write content to targetPath via a temp file.
 * @param {string} targetPath
 * @param {string} content
 */
function atomicWrite(targetPath, content) {
  const tmpPath = `${targetPath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, targetPath);
}

/**
 * Parse a markdown file into sections split by h2/h3 headings.
 * Each section: { heading, content, file }
 * A section starts at the heading line and ends before the next h2/h3 or EOF.
 * @param {string} text
 * @param {string} filePath  — included in returned objects
 * @returns {{ heading: string, content: string, file: string }[]}
 */
function parseSections(text, filePath) {
  const lines = text.split('\n');
  const sections = [];
  let currentHeading = null;
  let currentLines = [];

  const isHeading = (line) => /^#{2,3} /.test(line);

  for (const line of lines) {
    if (isHeading(line)) {
      if (currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
          file: filePath,
        });
      }
      currentHeading = line.replace(/^#{2,3} /, '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Push the final section (content after last heading, or entire file if no headings)
  if (currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
      file: filePath,
    });
  }

  return sections;
}

/**
 * Read all .md files in a directory (non-recursive, flat).
 * Returns array of { path, text } objects. Skips unreadable files silently.
 * @param {string} dirPath
 * @returns {{ path: string, text: string }[]}
 */
function readMdFiles(dirPath) {
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(dirPath, entry.name);
    try {
      const text = readFileSync(filePath, 'utf8');
      results.push({ path: filePath, text });
    } catch {
      // fail-open: skip unreadable files
    }
  }
  return results;
}

/**
 * Extract first non-empty, non-heading text block from markdown, up to maxLen chars.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function extractSummary(text, maxLen) {
  const lines = text.split('\n');
  const bodyLines = [];
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let lineIndex = 0;

  // Skip YAML frontmatter
  if (lines[0] && lines[0].trim() === '---') {
    inFrontmatter = true;
    lineIndex = 1;
  }

  for (; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (inFrontmatter) {
      if (line.trim() === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }
    // Skip heading lines
    if (/^#{1,6} /.test(line)) continue;
    // Skip empty lines until we have content
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (bodyLines.length > 0) break; // end of first paragraph
      continue;
    }
    bodyLines.push(trimmed);
  }

  void frontmatterClosed; // used implicitly via loop control

  const summary = bodyLines.join(' ').trim();
  if (summary.length <= maxLen) return summary;
  return summary.slice(0, maxLen) + '…';
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Search docs/gotchas/ .md files for sections whose heading or body contains keyword.
 * Returns at most 5 matching sections as { heading, content, file } objects.
 * Returns [] when no matches or files absent.
 *
 * @param {string} projectDir
 * @param {string} keyword
 * @returns {{ heading: string, content: string, file: string }[]}
 */
export function searchConstraints(projectDir, keyword) {
  if (!keyword || typeof keyword !== 'string') return [];

  const gotchasDir = join(resolve(projectDir), GOTCHAS_REL);
  const files = readMdFiles(gotchasDir);
  const needle = keyword.toLowerCase();
  const matches = [];

  for (const { path: filePath, text } of files) {
    const sections = parseSections(text, filePath);
    for (const section of sections) {
      if (matches.length >= 5) break;
      const headingLower = section.heading.toLowerCase();
      const contentLower = section.content.toLowerCase();
      if (headingLower.includes(needle) || contentLower.includes(needle)) {
        matches.push(section);
      }
    }
    if (matches.length >= 5) break;
  }

  return matches;
}

/**
 * Search docs/solutions/index.json for entries matching keyword and/or tags.
 * If both keyword and tags provided, either match (OR logic).
 * Returns at most 5 matches as { title, file, summary } objects.
 * Returns [] when no matches.
 *
 * @param {string} projectDir
 * @param {string|null|undefined} keyword
 * @param {string[]|null|undefined} tags
 * @returns {{ title: string, file: string, summary: string }[]}
 */
export function searchPatterns(projectDir, keyword, tags) {
  const hasKeyword = keyword && typeof keyword === 'string' && keyword.length > 0;
  const hasTags = Array.isArray(tags) && tags.length > 0;

  if (!hasKeyword && !hasTags) return [];

  const indexPath = join(resolve(projectDir), INDEX_PATH);
  let entries;
  try {
    const raw = readFileSync(indexPath, 'utf8');
    entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
  } catch {
    return [];
  }

  const needle = hasKeyword ? keyword.toLowerCase() : null;
  const tagNeedles = hasTags
    ? tags.map((t) => (typeof t === 'string' ? t.toLowerCase() : ''))
    : [];

  const results = [];

  for (const entry of entries) {
    if (results.length >= 5) break;
    if (!entry || typeof entry.title !== 'string' || typeof entry.file !== 'string') continue;

    const entryKeywords = Array.isArray(entry.keywords)
      ? entry.keywords.map((k) => (typeof k === 'string' ? k.toLowerCase() : ''))
      : [];
    const entryTags = Array.isArray(entry.tags)
      ? entry.tags.map((t) => (typeof t === 'string' ? t.toLowerCase() : ''))
      : [];

    let matched = false;

    if (needle) {
      const titleLower = entry.title.toLowerCase();
      if (titleLower.includes(needle) || entryKeywords.some((k) => k.includes(needle))) {
        matched = true;
      }
    }

    if (!matched && tagNeedles.length > 0) {
      if (tagNeedles.some((tn) => entryTags.includes(tn))) {
        matched = true;
      }
    }

    if (!matched) continue;

    // Path-traversal guard: resolved file must stay within docs/solutions/
    const solutionsDir = join(resolve(projectDir), 'docs', 'solutions');
    const resolvedFile = resolve(projectDir, entry.file);
    if (!resolvedFile.startsWith(solutionsDir)) continue; // skip — fail-open

    // Read file for summary
    let summary = '';
    try {
      const text = readFileSync(resolvedFile, 'utf8');
      summary = extractSummary(text, 200);
    } catch {
      // fail-open: summary stays empty
    }

    results.push({ title: entry.title, file: entry.file, summary });
  }

  return results;
}

/**
 * Write a new solution doc and update docs/solutions/index.json.
 * Uses atomic writes for both the .md file and the index.
 * Throws if the index update fails (orphaned doc is reported).
 *
 * @param {string} projectDir
 * @param {{ title: string, content: string, tags: string[] }} options
 * @returns {{ file: string }}
 */
export function appendSolutionDoc(projectDir, { title, content, tags }) {
  if (!title || typeof title !== 'string') throw new Error('appendSolutionDoc: title is required');
  if (typeof content !== 'string') throw new Error('appendSolutionDoc: content is required');
  const safeTags = Array.isArray(tags) ? tags : [];

  // Sanitize: strip newlines from user-supplied strings before YAML injection
  const safeTitle = title.replace(/[\r\n]/g, ' ').trim();

  // Derive slug
  const slug = safeTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const resolvedProject = resolve(projectDir);
  const solutionsDir = join(resolvedProject, 'docs', 'solutions');
  const docFileName = `${slug}.md`;
  const docPath = join(solutionsDir, docFileName);
  const indexPath = join(resolvedProject, INDEX_PATH);

  // Build YAML frontmatter — escape internal double-quotes in all string values
  const escapeYaml = (s) => s.replace(/"/g, '\\"');
  const tagsYaml = safeTags
    .map((t) => `  - "${escapeYaml(String(t).replace(/[\r\n]/g, ' ').trim())}"`)
    .join('\n');
  const frontmatter = [
    '---',
    `title: "${escapeYaml(safeTitle)}"`,
    'tags:',
    tagsYaml || '  []',
    '---',
    '',
  ].join('\n');

  // If content starts with '---', prepend a blank line so the YAML parser does not
  // treat user content as closing the frontmatter block (injection guard).
  const safeContentBody = content.startsWith('---') ? '\n' + content : content;
  const docContent = frontmatter + safeContentBody;

  // Step 1: write the .md file atomically
  atomicWrite(docPath, docContent);

  // Step 2: update index.json atomically — if this fails, report orphaned path
  const repoRelFile = join('docs', 'solutions', docFileName).replace(/\\/g, '/');
  const newEntry = {
    title: safeTitle,
    file: repoRelFile,
    tags: safeTags,
    keywords: safeTags,
  };

  let existingEntries = [];
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existingEntries = parsed;
  } catch {
    // fail-open: start with empty array if index missing or unreadable
  }

  existingEntries.push(newEntry);

  try {
    atomicWrite(indexPath, JSON.stringify(existingEntries, null, 2) + '\n');
  } catch (err) {
    throw new Error(
      `appendSolutionDoc: index update failed — orphaned doc at ${docPath}. Cause: ${err.message}`,
    );
  }

  return { file: repoRelFile };
}
