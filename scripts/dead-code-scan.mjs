#!/usr/bin/env node
// dead-code-scan.mjs — deterministic dead-code pre-scan
// Detects unused exports and orphaned files. Writes docs/context/pre-scan-findings.json.
// Exit 0 always. All logging to stderr. No console.log.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outFile = path.join(projectRoot, 'docs', 'context', 'pre-scan-findings.json');

/** Normalise Windows backslashes to forward slashes for consistent JSON output. */
function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

/** Attempt the knip branch. Returns findings array or null if knip unavailable/failed. */
function tryKnip() {
  const knipBin = path.join(projectRoot, 'node_modules', '.bin', 'knip');
  try {
    fs.accessSync(knipBin, fs.constants.F_OK);
  } catch {
    return null; // knip not installed
  }

  process.stderr.write('[dead-code-scan] knip detected — running knip --reporter json\n');
  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [knipBin, '--reporter', 'json'],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    // knip exits non-zero when it finds issues — capture stdout even on failure
    stdout = err.stdout ?? '';
    if (!stdout) {
      process.stderr.write(`[dead-code-scan] knip failed with no output: ${err.message}\n`);
      return null;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    process.stderr.write('[dead-code-scan] knip output was not valid JSON — falling through\n');
    return null;
  }

  const findings = [];

  // knip `exports` array: each entry has `file` and optionally `exports` array of symbol names
  const exports_ = Array.isArray(parsed.exports) ? parsed.exports : [];
  for (const entry of exports_) {
    const file = normalisePath(path.relative(projectRoot, path.resolve(projectRoot, entry.file ?? '')));
    const symbols = Array.isArray(entry.exports) ? entry.exports : [];
    if (symbols.length === 0) {
      findings.push({ file, symbol: null, reason: 'unused-export' });
    } else {
      for (const sym of symbols) {
        const name = typeof sym === 'string' ? sym : (sym.name ?? null);
        findings.push({ file, symbol: name, reason: 'unused-export' });
      }
    }
  }

  // knip `files` array: orphaned files with no imports
  const files_ = Array.isArray(parsed.files) ? parsed.files : [];
  for (const f of files_) {
    const file = normalisePath(path.relative(projectRoot, path.resolve(projectRoot, f)));
    findings.push({ file, symbol: null, reason: 'orphaned-file' });
  }

  process.stderr.write(`[dead-code-scan] knip found ${findings.length} issue(s)\n`);
  return findings;
}

/** Extract named export identifiers from source text (best-effort regex). */
function extractExports(src) {
  const names = new Set();
  // export function/class/const/let/var/async function name
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)) {
    names.add(m[1]);
  }
  // export { a, b as c, ... }
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias && alias !== 'default') names.add(alias);
    }
  }
  // export default is intentionally excluded — it has no name to track
  return names;
}

/** Extract all imported identifiers referenced in source text (best-effort regex). */
function extractImports(src) {
  const names = new Set();
  // import { a, b as c } from '...'
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  // import name from '...'
  for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) {
    names.add(m[1]);
  }
  // import * as ns from '...'
  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from/g)) {
    names.add(m[1]);
  }
  // dynamic: require('...') — not worth tracking for this heuristic
  return names;
}

/** Fallback: import-graph traversal across JS/MJS/MD files. */
function importGraphTraversal() {
  process.stderr.write('[dead-code-scan] knip absent — running import-graph traversal\n');

  // Collect all source files (JS/MJS only for export analysis; skip node_modules/.worktrees)
  function walkDir(dir, results = []) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.worktrees' || entry.name === '.git') continue;
        walkDir(full, results);
      } else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }

  const allFiles = walkDir(projectRoot);
  process.stderr.write(`[dead-code-scan] scanning ${allFiles.length} JS/MJS file(s)\n`);

  // Map: symbol name → array of files that export it
  /** @type {Map<string, string[]>} */
  const exportedBy = new Map();
  // Set of all imported symbol names across the entire project
  const allImported = new Set();

  for (const filePath of allFiles) {
    let src;
    try {
      src = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const relPath = normalisePath(path.relative(projectRoot, filePath));
    const exported = extractExports(src);
    for (const sym of exported) {
      if (!exportedBy.has(sym)) exportedBy.set(sym, []);
      exportedBy.get(sym).push(relPath); // safe: just added
    }

    const imported = extractImports(src);
    for (const sym of imported) allImported.add(sym);
  }

  const findings = [];
  for (const [sym, files] of exportedBy) {
    if (!allImported.has(sym)) {
      for (const file of files) {
        findings.push({ file, symbol: sym, reason: 'unused-export' });
      }
    }
  }

  process.stderr.write(`[dead-code-scan] import-graph traversal found ${findings.length} candidate(s)\n`);
  return findings;
}

function main() {
  let findings;

  const knipResult = tryKnip();
  if (knipResult !== null) {
    findings = knipResult;
  } else {
    findings = importGraphTraversal();
  }

  const outDir = path.dirname(outFile);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
    // directory already exists — ignore
  }

  const payload = { findings };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  process.stderr.write(`[dead-code-scan] wrote ${findings.length} finding(s) to ${normalisePath(path.relative(projectRoot, outFile))}\n`);
  process.exit(0);
}

main();
