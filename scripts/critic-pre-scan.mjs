#!/usr/bin/env node
// critic-pre-scan.mjs — deterministic pre-scan for the critic pipeline
// Runs pattern-based checks that don't need an LLM: dead code, fragility signals,
// security anti-patterns. Writes docs/context/pre-scan-findings.json.
// Exit 0 always. All logging to stderr.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outFile = path.join(projectRoot, 'docs', 'context', 'pre-scan-findings.json');

function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

// ── Dead-code detection (from dead-code-scan.mjs) ────────────────────────

function tryKnip() {
  const knipBin = path.join(projectRoot, 'node_modules', '.bin', 'knip');
  try {
    fs.accessSync(knipBin, fs.constants.F_OK);
  } catch {
    return null;
  }

  process.stderr.write('[critic-pre-scan] knip detected — running knip --reporter json\n');
  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [knipBin, '--reporter', 'json'],
      { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    stdout = err.stdout ?? '';
    if (!stdout) {
      process.stderr.write(`[critic-pre-scan] knip failed with no output: ${err.message}\n`);
      return null;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    process.stderr.write('[critic-pre-scan] knip output was not valid JSON — falling through\n');
    return null;
  }

  const findings = [];
  const exports_ = Array.isArray(parsed.exports) ? parsed.exports : [];
  for (const entry of exports_) {
    const file = normalisePath(path.relative(projectRoot, path.resolve(projectRoot, entry.file ?? '')));
    const symbols = Array.isArray(entry.exports) ? entry.exports : [];
    if (symbols.length === 0) {
      findings.push({ file, symbol: null, reason: 'unused-export', lens: 'technical-debt' });
    } else {
      for (const sym of symbols) {
        const name = typeof sym === 'string' ? sym : (sym.name ?? null);
        findings.push({ file, symbol: name, reason: 'unused-export', lens: 'technical-debt' });
      }
    }
  }

  const files_ = Array.isArray(parsed.files) ? parsed.files : [];
  for (const f of files_) {
    const file = normalisePath(path.relative(projectRoot, path.resolve(projectRoot, f)));
    findings.push({ file, symbol: null, reason: 'orphaned-file', lens: 'technical-debt' });
  }

  process.stderr.write(`[critic-pre-scan] knip found ${findings.length} dead-code issue(s)\n`);
  return findings;
}

function extractExports(src) {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+(\w+)/gm)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias && alias !== 'default') names.add(alias);
    }
  }
  return names;
}

function extractImports(src) {
  const names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  for (const m of src.matchAll(/import\s+(\w+)\s+from/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from/g)) {
    names.add(m[1]);
  }
  return names;
}

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

function importGraphTraversal() {
  process.stderr.write('[critic-pre-scan] knip absent — running import-graph traversal\n');
  const allFiles = walkDir(projectRoot);
  const exportedBy = new Map();
  const allImported = new Set();

  for (const filePath of allFiles) {
    let src;
    try { src = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const relPath = normalisePath(path.relative(projectRoot, filePath));
    const exported = extractExports(src);
    for (const sym of exported) {
      if (!exportedBy.has(sym)) exportedBy.set(sym, []);
      exportedBy.get(sym).push(relPath);
    }
    const imported = extractImports(src);
    for (const sym of imported) allImported.add(sym);
  }

  const findings = [];
  for (const [sym, files] of exportedBy) {
    if (!allImported.has(sym)) {
      for (const file of files) {
        findings.push({ file, symbol: sym, reason: 'unused-export', lens: 'technical-debt' });
      }
    }
  }

  process.stderr.write(`[critic-pre-scan] import-graph found ${findings.length} dead-code candidate(s)\n`);
  return findings;
}

// ── Fragility patterns ───────────────────────────────────────────────────
// Tight filters — only flag clear, unambiguous issues to avoid noise.

function scanFragility(allFiles) {
  const findings = [];

  for (const filePath of allFiles) {
    let src;
    try { src = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const relPath = normalisePath(path.relative(projectRoot, filePath));
    const lines = src.split('\n');

    // Only check hook scripts that IMPORT resolveProjectDir but also use process.cwd() directly.
    // Exclude: hook-utils.js (defines the function), test files.
    const basename = path.basename(filePath);
    const isHookConsumer = relPath.startsWith('hooks/')
      && basename !== 'hook-utils.js'
      && !basename.includes('test')
      && src.includes('resolveProjectDir');
    if (isHookConsumer) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('require')) continue;
        if (line.includes('process.cwd()')) {
          findings.push({
            file: relPath, line: i + 1, reason: 'process-cwd-in-hook',
            lens: 'fragility',
            detail: 'Hook uses process.cwd() but also imports resolveProjectDir — inconsistent project dir resolution',
          });
        }
      }
    }

    // Large file detection (>500 lines, excluding node_modules)
    if (lines.length > 500 && !relPath.includes('node_modules')) {
      findings.push({
        file: relPath, line: null, reason: 'large-file',
        lens: 'fragility',
        detail: `File has ${lines.length} lines`,
      });
    }
  }

  process.stderr.write(`[critic-pre-scan] fragility scan found ${findings.length} pattern(s)\n`);
  return findings;
}

// ── Security patterns ────────────────────────────────────────────────────
// Only flag high-confidence patterns to keep the signal-to-noise ratio high.

function scanSecurity(allFiles) {
  const findings = [];

  for (const filePath of allFiles) {
    let src;
    try { src = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    const relPath = normalisePath(path.relative(projectRoot, filePath));
    if (relPath.includes('node_modules')) continue;
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // Detect string interpolation in exec/spawn/execFile commands
      if (/\b(execSync|execFileSync|exec)\s*\(/.test(line) && line.includes('${')) {
        findings.push({
          file: relPath, line: i + 1, reason: 'interpolation-in-exec',
          lens: 'security-safety',
          detail: 'String interpolation in shell execution — potential command injection',
        });
      }

      // Detect child_process spawn with shell: true
      if (/shell\s*:\s*true/.test(line)) {
        findings.push({
          file: relPath, line: i + 1, reason: 'shell-true-spawn',
          lens: 'security-safety',
          detail: 'spawn/exec with shell: true — command injection risk if args are user-controlled',
        });
      }
    }
  }

  process.stderr.write(`[critic-pre-scan] security scan found ${findings.length} pattern(s)\n`);
  return findings;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const allFiles = walkDir(projectRoot);
  process.stderr.write(`[critic-pre-scan] scanning ${allFiles.length} JS/MJS file(s)\n`);

  // Dead code
  let deadCode;
  const knipResult = tryKnip();
  if (knipResult !== null) {
    deadCode = knipResult;
  } else {
    deadCode = importGraphTraversal();
  }

  // Fragility + security
  const fragility = scanFragility(allFiles);
  const security = scanSecurity(allFiles);

  const findings = [...deadCode, ...fragility, ...security];

  const outDir = path.dirname(outFile);
  try { fs.mkdirSync(outDir, { recursive: true }); } catch {}

  const payload = { findings };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  process.stderr.write(`[critic-pre-scan] wrote ${findings.length} finding(s) to ${normalisePath(path.relative(projectRoot, outFile))}\n`);
  process.exit(0);
}

main();
