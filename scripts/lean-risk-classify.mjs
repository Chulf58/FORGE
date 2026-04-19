#!/usr/bin/env node
// LEAN-lite reviewer-skip classifier.
//
// Given a coder-produced handoff.md, decide whether LEAN-mode reviewer dispatch
// can be skipped. Skip is allowed only when ALL of:
//   1. `## Verification` section contains the single literal line `pre-flight clean`
//   2. `## Blockers` section is absent or has no bullets
//   3. The handoff does NOT touch the risk surface (shell/fs/auth/net/schema/etc)
//   4. The caller did not pass `forceReview: true` (operator escape hatch)
//
// The classifier is pure — no I/O, no side effects — so it is trivially testable.
// A CLI wrapper at the bottom reads a handoff file and prints JSON for the skill
// to capture. The skill uses this in the LEAN pipeline path only; STANDARD and
// FULL ignore the classifier entirely.
//
// Usage (CLI):
//   node scripts/lean-risk-classify.mjs --handoff=<path> [--force-review]
//
// Exit codes: 0 on success (JSON on stdout), non-zero on unrecoverable error.

import fs from 'node:fs';
import path from 'node:path';

// --- Risk-surface rules -----------------------------------------------------
// Path-based: if any handoff-declared file path matches, reviewers must run.
const RISK_PATH_PATTERNS = [
  { rule: 'bin-script', regex: /^bin\// },
  { rule: 'hook-script', regex: /^hooks\// },
  { rule: 'mcp-tool', regex: /^mcp\// },
  { rule: 'command', regex: /^commands\// },
  { rule: 'plugin-manifest', regex: /^\.claude-plugin\// },
  {
    rule: 'merge-apply-worktree-boundary',
    regex: /^(bin\/forge-worktree|hooks\/(workflow-guard|gate-enforcement|routing-enforcement|subagent-(start|stop)))/,
  },
];

// Content-based: if any pattern matches in the Files-to-create / Files-to-modify
// code blocks, reviewers must run. `extraCheck` can veto a false positive.
const RISK_CONTENT_PATTERNS = [
  {
    rule: 'shell-spawn',
    regex: /\b(child_process|spawn\s*\(|execSync\s*\(|spawnSync\s*\(|\.exec\s*\()/,
  },
  {
    rule: 'fs-write-outside-pipeline',
    regex: /fs\.(writeFile|unlink|rm|rmdir|appendFile|mkdir|cp)\s*\(/,
    extraCheck: (content, matchStart) => {
      // Look at the surrounding line — if it references .pipeline/, treat as safe.
      const lineStart = content.lastIndexOf('\n', matchStart) + 1;
      let lineEnd = content.indexOf('\n', matchStart);
      if (lineEnd === -1) lineEnd = content.length;
      const line = content.slice(lineStart, lineEnd);
      return !/\.pipeline\//.test(line);
    },
  },
  {
    rule: 'auth-crypto-secrets',
    regex: /\b(jsonwebtoken|\bjwt\.|\boauth\b|bcrypt|createCipher|createHash|crypto\.subtle|process\.env\.[A-Z_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL)[A-Z_]*)/i,
  },
  {
    rule: 'network-boundary',
    regex: /\b(http\.createServer|https?:\/\/[\w.-]+|\bfetch\s*\(|\baxios\b|node-fetch|express\s*\(\s*\)|new\s+URL\s*\()/,
  },
  {
    rule: 'new-public-handler',
    regex: /\b(export\s+(async\s+)?function\s+\w*(Handler|Route)\b|function\s+handle[A-Z]\w*|app\.(get|post|put|delete|patch)\s*\()/,
  },
  {
    rule: 'schema-contract-change',
    regex: /\b(registerTool\s*\(|z\.object\s*\(|z\.string\s*\(|z\.enum\s*\(|\[reviewer-verdict\]|\[suggest\]|\[todo\])/,
  },
  {
    rule: 'env-or-path-resolution',
    regex: /\b(path\.resolve\s*\(.*process\.env|resolveProjectDir|resolvePluginRoot|resolvePluginDataDir)/,
  },
];

// --- Section extraction -----------------------------------------------------
// Pull the body of a level-2 markdown section by heading text.
// Returns the body (without the heading) or null if absent.
function extractSection(content, headingText) {
  const headingRegex = new RegExp(
    `^##\\s+${headingText.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*$`,
    'mi',
  );
  const match = content.match(headingRegex);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = content.slice(start);
  const nextHeading = rest.match(/^##\s+\S/m);
  const end = nextHeading ? nextHeading.index : rest.length;
  return rest.slice(0, end);
}

function extractFilePaths(filesSection) {
  if (!filesSection) return [];
  const seen = new Set();
  const add = (p) => { const n = p.replace(/\\/g, '/'); if (n) seen.add(n); };

  // Pattern 1 (primary): ### `path/to/file.ext` or ### path/to/file.ext
  const re1 = /^###\s+[`'"]?([^\s`'"]+)[`'"]?\s*$/gm;
  let m;
  while ((m = re1.exec(filesSection)) !== null) add(m[1]);

  // Pattern 2: #### `path/to/file.ext` (level-4 headings)
  const re2 = /^####\s+[`'"]?([^\s`'"]+)[`'"]?\s*$/gm;
  while ((m = re2.exec(filesSection)) !== null) add(m[1]);

  // Pattern 3: **`path/to/file.ext`** or **path/to/file.ext:**
  const re3 = /^\*\*[`']?([^`'*\s][^`'*]*?)[`']?\*\*:?\s*$/gm;
  while ((m = re3.exec(filesSection)) !== null) {
    const p = m[1].trim();
    if (p.includes('/')) add(p); // must look like a path
  }

  // Pattern 4: - `path/to/file.ext` or * `path/to/file.ext` (list items)
  const re4 = /^[-*]\s+`([^`]+)`/gm;
  while ((m = re4.exec(filesSection)) !== null) {
    const p = m[1].trim();
    if (p.includes('/')) add(p); // must contain / to distinguish from inline code
  }

  return Array.from(seen);
}

function extractCodeBlockContent(filesSection) {
  if (!filesSection) return '';
  // Concatenate every fenced code block body so content patterns can match
  // across languages. The triple-backtick fence is the universal delimiter.
  const out = [];
  const re = /```[\w-]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(filesSection)) !== null) {
    out.push(m[1]);
  }
  return out.join('\n');
}

// --- Main classifier --------------------------------------------------------
export function classifyHandoff({ handoffContent, forceReview = false }) {
  if (forceReview) {
    return {
      skipReviewers: false,
      reasons: ['force-review-requested'],
      triggeredRules: [],
    };
  }

  if (typeof handoffContent !== 'string' || !handoffContent.trim()) {
    return {
      skipReviewers: false,
      reasons: ['handoff-empty-or-invalid'],
      triggeredRules: [],
    };
  }

  // --- Check 1: Verification clean ---
  const verificationBody = extractSection(handoffContent, 'Verification');
  if (!verificationBody) {
    return {
      skipReviewers: false,
      reasons: ['verification-section-missing'],
      triggeredRules: [],
    };
  }
  const verificationTrimmed = verificationBody.trim();
  const isClean = /^pre-flight\s+clean\s*$/i.test(verificationTrimmed);
  if (!isClean) {
    return {
      skipReviewers: false,
      reasons: ['verification-not-clean'],
      triggeredRules: [],
    };
  }

  // --- Check 2: Blockers absent or empty ---
  const blockersBody = extractSection(handoffContent, 'Blockers');
  if (blockersBody) {
    const hasBullets = /^\s*[-*]\s+\S/m.test(blockersBody);
    if (hasBullets) {
      return {
        skipReviewers: false,
        reasons: ['blockers-present'],
        triggeredRules: [],
      };
    }
  }

  // --- Check 3: Risk-surface classification ---
  const createBody = extractSection(handoffContent, 'Files to create');
  const modifyBody = extractSection(handoffContent, 'Files to modify');
  const filePaths = [
    ...extractFilePaths(createBody),
    ...extractFilePaths(modifyBody),
  ];
  const codeContent = [
    extractCodeBlockContent(createBody),
    extractCodeBlockContent(modifyBody),
  ].join('\n');

  const triggered = [];

  for (const file of filePaths) {
    for (const pat of RISK_PATH_PATTERNS) {
      if (pat.regex.test(file)) {
        triggered.push(`${pat.rule}:${file}`);
      }
    }
  }

  for (const pat of RISK_CONTENT_PATTERNS) {
    const globalRegex = new RegExp(pat.regex.source, pat.regex.flags.includes('g') ? pat.regex.flags : pat.regex.flags + 'g');
    let m;
    while ((m = globalRegex.exec(codeContent)) !== null) {
      const passesExtraCheck = !pat.extraCheck || pat.extraCheck(codeContent, m.index);
      if (passesExtraCheck) {
        triggered.push(`${pat.rule}:${m[0].slice(0, 40)}`);
        break; // one confirmed match per rule is enough
      }
    }
  }

  if (triggered.length > 0) {
    return {
      skipReviewers: false,
      reasons: ['risk-surface-match'],
      triggeredRules: triggered,
    };
  }

  return {
    skipReviewers: true,
    reasons: ['verification-clean', 'no-blockers', 'no-risk-surface-match'],
    triggeredRules: [],
  };
}

// --- CLI --------------------------------------------------------------------
function isMainModule() {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  return path.basename(scriptPath) === 'lean-risk-classify.mjs';
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    out[k] = v === undefined ? true : v;
  }
  return out;
}

function runCli() {
  const args = parseArgs(process.argv);
  const handoffPath = args.handoff || 'docs/context/handoff.md';
  const forceReview = Boolean(args['force-review']);

  let content;
  try {
    content = fs.readFileSync(handoffPath, 'utf8');
  } catch (err) {
    const result = {
      skipReviewers: false,
      reasons: ['handoff-unreadable'],
      triggeredRules: [],
      error: err.message,
      handoffPath,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }

  const result = classifyHandoff({ handoffContent: content, forceReview });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (isMainModule()) {
  runCli();
}
