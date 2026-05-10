#!/usr/bin/env node
// @covers scripts/wiring-verify.mjs
// Post-handoff wiring verifier.
//
// CLI: node scripts/wiring-verify.mjs --handoff=<path> --root=<path> [--strict]
//
// Reads the handoff "Files modified" section, detects zero-consumer exports,
// agents, hooks, and CLI scripts, and emits [wiring-gap] to stderr for any
// symbol or wiring unit with no consumers.
//
// Exit codes:
//   0 — diagnostic mode (default): gaps are reported but exit is always 0
//   1 — strict mode (--strict): exits 1 when any gaps are found

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import { extractSection, extractCodeBlockContent } from './lib/handoff-utils.mjs';

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  let handoffPath = null;
  let rootDir = null;
  let strict = false;

  for (const arg of argv) {
    if (arg.startsWith('--handoff=')) {
      handoffPath = arg.slice('--handoff='.length);
    } else if (arg.startsWith('--root=')) {
      rootDir = arg.slice('--root='.length);
    } else if (arg === '--strict') {
      strict = true;
    }
  }

  return { handoffPath, rootDir, strict };
}

// ─── Extract modified files from handoff ─────────────────────────────────────

/**
 * Read the handoff file and extract modified/created file paths from the
 * "Files modified" section (code block content, one path per line).
 *
 * @param {string} handoffPath - absolute path to handoff.md
 * @returns {string[]} list of repo-relative source paths (forward-slash)
 */
function extractModifiedFiles(handoffPath) {
  let handoffText;
  try {
    handoffText = readFileSync(handoffPath, 'utf8');
  } catch (err) {
    process.stderr.write(`[wiring-verify] cannot read handoff: ${err.message}\n`);
    return [];
  }

  const section = extractSection(handoffText, 'Files modified');
  const raw = extractCodeBlockContent(section);

  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .map(l => l.replace(/\\/g, '/').replace(/^\.\//, ''));
}

// ─── Pure-Node file walking and search ───────────────────────────────────────

/**
 * Walk a directory tree recursively, yielding absolute file paths whose
 * basename matches one of the given extensions.
 *
 * @param {string} dir - absolute directory path
 * @param {string[]} extensions - e.g. ['.md', '.json']
 * @param {string|null} excludeBasename - skip any file with this basename
 * @param {string[]} excludeDirs - directory basenames to skip entirely (default: node_modules, .git, .worktrees, docs)
 * @returns {string[]} matching absolute file paths
 */
function walkFiles(dir, extensions, excludeBasename, excludeDirs = ['node_modules', '.git', '.worktrees', 'docs']) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (excludeDirs.includes(entry)) continue;
      const sub = walkFiles(full, extensions, excludeBasename, excludeDirs);
      for (const f of sub) results.push(f);
    } else if (stat.isFile()) {
      if (excludeBasename && basename(full) === excludeBasename) continue;
      if (extensions.includes(extname(full))) {
        results.push(full);
      }
    }
  }
  return results;
}

/**
 * Check if a specific file contains a given literal string.
 *
 * @param {string} filePath - absolute path to file
 * @param {string} searchStr - literal string to look for
 * @returns {boolean}
 */
function fileContains(filePath, searchStr) {
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, 'utf8');
    return content.includes(searchStr);
  } catch {
    return false;
  }
}

/**
 * Search for a literal string across all files with given extensions under
 * rootDir, optionally excluding a file by its basename.
 *
 * @param {string} rootDir - absolute root directory
 * @param {string} searchStr - literal string to search for
 * @param {string[]} extensions - file extensions to include (e.g. ['.md', '.json'])
 * @param {string|null} excludeBasename - basename of file to exclude (or null)
 * @returns {boolean} true if string found in any matching file
 */
function containsInTree(rootDir, searchStr, extensions, excludeBasename) {
  const files = walkFiles(rootDir, extensions, excludeBasename);
  for (const filePath of files) {
    if (fileContains(filePath, searchStr)) return true;
  }
  return false;
}

// ─── Wiring checks ────────────────────────────────────────────────────────────

/**
 * Check wiring for an agent file.
 * Agent is wired if its name appears in skills/*.md, other agents/*.md,
 * or *.json config files. Intentionally excludes docs/ to avoid false
 * positives from handoff self-references.
 *
 * @param {string} rootDir
 * @param {string} agentName - e.g. "phantom-agent"
 * @returns {boolean} true if wired
 */
function isAgentWired(rootDir, agentName) {
  const agentFilename = `${agentName}.md`;
  // Check skills/**/*.md — no excludes needed, agents don't live here
  if (containsInTree(resolve(rootDir, 'skills'), agentName, ['.md'], null)) return true;
  // Check agents/**/*.md, excluding the agent's own file
  if (containsInTree(resolve(rootDir, 'agents'), agentName, ['.md'], agentFilename)) return true;
  // Check *.json config files (walkFiles already skips docs/ by default)
  return containsInTree(rootDir, agentName, ['.json'], null);
}

/**
 * Check wiring for a hook file.
 * Hook is wired if its filename appears in hooks/hooks.json.
 *
 * @param {string} rootDir
 * @param {string} hookFilename - e.g. "new-hook.js"
 * @returns {boolean} true if wired
 */
function isHookWired(rootDir, hookFilename) {
  const hooksJsonPath = resolve(rootDir, 'hooks', 'hooks.json');
  return fileContains(hooksJsonPath, hookFilename);
}

/**
 * Extract exported symbol names from a JS/MJS/TS source file.
 *
 * Handles:
 *   export function <name>
 *   export async function <name>
 *   export const <name>
 *   export class <name>
 *   export default function <name>
 *
 * @param {string} filePath - absolute path to the source file
 * @returns {string[]} list of exported symbol names
 */
function extractExports(filePath) {
  if (!existsSync(filePath)) return [];
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const symbols = [];
  const patterns = [
    /^export\s+function\s+(\w+)/gm,
    /^export\s+async\s+function\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
    /^export\s+default\s+function\s+(\w+)/gm,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      symbols.push(m[1]);
    }
  }

  return [...new Set(symbols)];
}

/**
 * Check if a symbol name is imported or referenced anywhere in the JS/MJS/TS
 * codebase, excluding the file being declared (matched by basename).
 *
 * @param {string} rootDir
 * @param {string} symbolName
 * @param {string} excludeRelPath - relative path (forward-slash) of the new file
 * @returns {boolean} true if the symbol has at least one consumer
 */
function symbolHasConsumer(rootDir, symbolName, excludeRelPath) {
  return containsInTree(
    rootDir,
    symbolName,
    ['.js', '.mjs', '.ts'],
    basename(excludeRelPath),
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { handoffPath, rootDir, strict } = parseArgs(process.argv.slice(2));

  if (!handoffPath) {
    process.stderr.write('[wiring-verify] --handoff=<path> is required\n');
    process.exit(1);
  }

  const resolvedRoot = rootDir ? resolve(rootDir) : process.cwd();
  const resolvedHandoff = resolve(handoffPath);

  const modifiedFiles = extractModifiedFiles(resolvedHandoff);

  let verifiedCount = 0;
  let gapCount = 0;

  for (const relPath of modifiedFiles) {
    const parts = relPath.split('/');

    // ── agents/<name>.md ──────────────────────────────────────────────────
    if (parts[0] === 'agents' && parts.length === 2 && relPath.endsWith('.md')) {
      const agentName = basename(relPath, '.md');
      if (isAgentWired(resolvedRoot, agentName)) {
        verifiedCount++;
      } else {
        process.stderr.write(`[wiring-gap] agent:${agentName}\n`);
        gapCount++;
      }
      continue;
    }

    // ── hooks/<name>.js ───────────────────────────────────────────────────
    if (parts[0] === 'hooks' && parts.length === 2 && relPath.endsWith('.js')) {
      const hookFilename = basename(relPath);
      if (isHookWired(resolvedRoot, hookFilename)) {
        verifiedCount++;
      } else {
        process.stderr.write(`[wiring-gap] hook:${basename(relPath, '.js')}\n`);
        gapCount++;
      }
      continue;
    }

    // ── *.{js,mjs,ts} source files ────────────────────────────────────────
    const ext = extname(relPath);
    if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
      const absPath = resolve(resolvedRoot, relPath);
      const symbols = extractExports(absPath);

      if (symbols.length === 0) {
        // No exports — nothing to verify for this file
        continue;
      }

      for (const sym of symbols) {
        if (symbolHasConsumer(resolvedRoot, sym, relPath)) {
          verifiedCount++;
        } else {
          process.stderr.write(`[wiring-gap] ${sym}\n`);
          gapCount++;
        }
      }
      continue;
    }

    // Other file types (markdown docs, JSON config, etc.) — skip wiring check
  }

  process.stderr.write(`[wiring] ${verifiedCount} exports verified, ${gapCount} gaps\n`);

  if (strict && gapCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[wiring-verify] unexpected error: ${err.message}\n`);
  process.exit(1);
});
