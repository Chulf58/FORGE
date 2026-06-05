#!/usr/bin/env node
// Risk-surface classifier for reviewer dispatch.
//
// Given a coder-produced handoff.md (or a git unified diff + coder-status.json),
// decide whether reviewer dispatch can be skipped. Skip is allowed only
// when ALL of:
//   1. Verification is clean (coder-status.verificationClean === true, or
//      `## Verification` section contains the single literal line `pre-flight clean`)
//   2. No blockers (coder-status.hasBlockers === false, or `## Blockers` is absent)
//   3. The changed code does NOT touch the risk surface (shell/fs/auth/net/schema/etc)
//   4. The caller did not pass `forceReview: true` (operator escape hatch)
//
// Two entry points:
//   classifyHandoff({ handoffContent, forceReview }) — original, reads handoff.md
//   classifyDiff({ diffContent, coderStatus, forceReview }) — new, reads git diff
//
// The classifier is pure — no I/O, no side effects — so it is trivially testable.
// A CLI wrapper at the bottom reads input files and prints JSON for the skill
// to capture. The dispatcher always runs the classifier; a clean handoff with no
// risk-surface match results in an empty reviewer list (reviewers skipped).
//
// Usage (CLI):
//   node scripts/lean-risk-classify.mjs --handoff=<path> [--force-review]
//   node scripts/lean-risk-classify.mjs --diff=<path> --coder-status=<path> [--force-review]
//
// Exit codes: 0 on success (JSON on stdout), non-zero on unrecoverable error.

import fs from 'node:fs';
import path from 'node:path';
import { extractSection, extractCodeBlockContent } from './lib/handoff-utils.mjs';

// --- Risk-surface rules -----------------------------------------------------
// Path-based: if any handoff-declared file path matches, reviewers must run.
const RISK_PATH_PATTERNS = [
  {
    rule: 'bin-script',
    regex: /^bin\//,
    suggestedCheck: 'Review bin/ script entrypoint for shell injection, arg handling, and side effects',
  },
  {
    rule: 'hook-script',
    regex: /^hooks\//,
    suggestedCheck: 'Review hook script for stdin handling, exit codes, and project root escape',
  },
  {
    rule: 'mcp-tool',
    regex: /^mcp\//,
    suggestedCheck: 'Review MCP tool registration for schema correctness and side effects',
  },
  {
    rule: 'command',
    regex: /^commands\//,
    suggestedCheck: 'Review slash-command markdown for unintended LLM instructions',
  },
  {
    rule: 'plugin-manifest',
    regex: /^\.claude-plugin\//,
    suggestedCheck: 'Review plugin manifest for permission changes',
  },
  {
    rule: 'pipeline-state-schema',
    regex: /^\.pipeline\/.*\.json$/,
    suggestedCheck: 'Review pipeline-state schema change for backward compatibility',
  },
  {
    rule: 'merge-apply-worktree-boundary',
    regex: /^(bin\/forge-worktree|hooks\/(workflow-guard|gate-enforcement|routing-enforcement|subagent-(start|stop)))/,
    suggestedCheck: 'Review worktree merge/apply boundary for force flags, hook bypass, and uncommitted state',
  },
];

// Content-based: if any pattern matches in the Files-to-create / Files-to-modify
// code blocks, reviewers must run. `extraCheck` can veto a false positive.
const RISK_CONTENT_PATTERNS = [
  {
    rule: 'shell-spawn',
    regex: /\b(child_process|spawn\s*\(|execSync\s*\(|spawnSync\s*\(|\.exec\s*\()/,
    suggestedCheck: 'Review shell invocation for injection risk and argument quoting',
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
    suggestedCheck: 'Review fs write/delete for path traversal and unintended target',
  },
  {
    rule: 'auth-crypto-secrets',
    regex: /\b(jsonwebtoken|\bjwt\.|\boauth\b|bcrypt|createCipher|createHash|crypto\.subtle|process\.env\.[A-Z_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL)[A-Z_]*)/i,
    suggestedCheck: 'Review secret handling for leakage in logs, files, or env',
  },
  {
    rule: 'network-boundary',
    regex: /\b(http\.createServer|https?:\/\/[\w.-]+|\bfetch\s*\(|\baxios\b|node-fetch|express\s*\(\s*\)|new\s+URL\s*\()/,
    suggestedCheck: 'Review network call for trust boundary, validation, and rate limits',
  },
  {
    rule: 'new-public-handler',
    regex: /\b(export\s+(async\s+)?function\s+\w*(Handler|Route)\b|function\s+handle[A-Z]\w*|app\.(get|post|put|delete|patch)\s*\()/,
    suggestedCheck: 'Review new public handler for input validation and error response shape',
  },
  {
    rule: 'schema-contract-change',
    regex: /\b(registerTool\s*\(|z\.object\s*\(|z\.string\s*\(|z\.enum\s*\()/,
    suggestedCheck: 'Review schema change for downstream consumer compatibility',
  },
  {
    rule: 'env-or-path-resolution',
    regex: /\b(path\.resolve\s*\(.*process\.env|resolveProjectDir|resolvePluginRoot|resolvePluginDataDir)/,
    suggestedCheck: 'Review env/path resolution for symlink traversal and unset-var fallback',
  },
  {
    rule: 'signal-format-change',
    regex: /\[reviewer-verdict\]|\[todo\]|\[suggest\]|\[health\]|\[task-block\]|\[solution-hit\]|\[promote-gotcha\]/,
    suggestedCheck: 'Review signal-format change for downstream parser compatibility',
  },
  {
    // 81b8f299: a change to the agent-dispatch permission/write-confinement boundary needs
    // reviewer-LOGIC (callback path-resolution edge cases) on top of the safety/boundary that
    // the mcp-tool file-path rule already pulls — the canUseTool leak fix got only reviewer-tests.
    rule: 'agent-dispatch-permission',
    regex: /\b(permissionMode|canUseTool|bypassPermissions|allowDangerouslySkipPermissions)\b/,
    suggestedCheck: 'Review agent-dispatch permission/write-confinement change for escape paths, over-blocking, and the Bash route',
  },
];

// --- Section extraction -----------------------------------------------------
// extractSection and extractCodeBlockContent are imported from ./lib/handoff-utils.mjs

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

// --- Main classifier --------------------------------------------------------
export function classifyHandoff({ handoffContent, forceReview = false }) {
  if (forceReview) {
    return {
      skipReviewers: false,
      reasons: ['force-review-requested'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
    };
  }

  if (typeof handoffContent !== 'string' || !handoffContent.trim()) {
    return {
      skipReviewers: false,
      reasons: ['handoff-empty-or-invalid'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
    };
  }

  // --- Check 1: Verification clean ---
  const verificationBody = extractSection(handoffContent, 'Verification');
  if (!verificationBody) {
    return {
      skipReviewers: false,
      reasons: ['verification-section-missing'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
    };
  }
  const verificationTrimmed = verificationBody.trim();
  const isClean = /^pre-flight\s+clean\s*$/i.test(verificationTrimmed);
  if (!isClean) {
    return {
      skipReviewers: false,
      reasons: ['verification-not-clean'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
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
        triggeredRulesLegacy: [],
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
  // Scan code blocks from canonical sections AND the full handoff.
  // A manipulated coder could place risk-surface code in non-canonical sections
  // (e.g. "## Approach") to evade section-scoped scanning.
  const codeContent = [
    extractCodeBlockContent(createBody),
    extractCodeBlockContent(modifyBody),
    extractCodeBlockContent(handoffContent),
  ].join('\n');

  const triggered = [];
  const triggeredLegacy = [];

  for (const file of filePaths) {
    for (const pat of RISK_PATH_PATTERNS) {
      if (pat.regex.test(file)) {
        triggered.push({ rule: pat.rule, file, line: null, snippet: file, suggestedCheck: pat.suggestedCheck });
        triggeredLegacy.push(`${pat.rule}:${file}`);
      }
    }
  }

  for (const pat of RISK_CONTENT_PATTERNS) {
    const globalRegex = new RegExp(pat.regex.source, pat.regex.flags.includes('g') ? pat.regex.flags : pat.regex.flags + 'g');
    let m;
    while ((m = globalRegex.exec(codeContent)) !== null) {
      const passesExtraCheck = !pat.extraCheck || pat.extraCheck(codeContent, m.index);
      if (passesExtraCheck) {
        const snippet = m[0].slice(0, 80);
        // Compute line number: count newlines before match index (1-based)
        const line = (typeof m.index === 'number') ? codeContent.slice(0, m.index).split('\n').length : null;
        // Resolve which file contains this snippet by checking all file sections
        let matchFile = null;
        const sectionContents = [
          { body: createBody, paths: extractFilePaths(createBody) },
          { body: modifyBody, paths: extractFilePaths(modifyBody) },
        ];
        for (const sec of sectionContents) {
          if (sec.body && sec.body.includes(snippet)) {
            matchFile = sec.paths[0] || null;
            break;
          }
        }
        triggered.push({ rule: pat.rule, file: matchFile || '', line, snippet, suggestedCheck: pat.suggestedCheck });
        triggeredLegacy.push(`${pat.rule}:${m[0].slice(0, 40)}`);
        break; // one confirmed match per rule is enough
      }
    }
  }

  if (triggered.length > 0) {
    return {
      skipReviewers: false,
      reasons: ['risk-surface-match'],
      triggeredRules: triggered,
      triggeredRulesLegacy: triggeredLegacy,
    };
  }

  return {
    skipReviewers: true,
    reasons: ['verification-clean', 'no-blockers', 'no-risk-surface-match'],
    triggeredRules: [],
    triggeredRulesLegacy: [],
  };
}

// --- Diff classifier --------------------------------------------------------
// Extract changed file paths from unified diff `+++ b/<path>` headers.
function extractDiffFilePaths(diffContent) {
  if (!diffContent) return [];
  const seen = new Set();
  const re = /^\+\+\+\s+b\/(.+)$/gm;
  let m;
  while ((m = re.exec(diffContent)) !== null) {
    const p = m[1].trim().replace(/\\/g, '/');
    if (p) seen.add(p);
  }
  return Array.from(seen);
}

// Extract added-line code from unified diff (lines prefixed with `+` but not `+++`).
function extractDiffAddedCode(diffContent) {
  if (!diffContent) return '';
  const lines = diffContent.split('\n');
  return lines
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1))
    .join('\n');
}

/**
 * Given a diff and a character offset into the addedCode string, resolve which
 * source file owns that offset by reconstructing which +++ b/<file> header
 * the added line was extracted from.
 *
 * @param {string} diffContent - raw unified diff text
 * @param {number} addedCodeOffset - character offset into the addedCode string
 * @param {string} addedCode - the result of extractDiffAddedCode(diffContent)
 * @returns {string} - resolved file path, or '' if not resolvable
 */
function resolveFileFromDiff(diffContent, addedCodeOffset, addedCode) {
  // Build a map of [addedCodeCharOffset, filePath] by scanning the diff
  const diffLines = diffContent.split('\n');
  let currentFile = '';
  let addedCharCount = 0;

  for (const diffLine of diffLines) {
    if (diffLine.startsWith('+++ b/')) {
      currentFile = diffLine.slice(6).trim().replace(/\\/g, '/');
      continue;
    }
    if (diffLine.startsWith('+') && !diffLine.startsWith('+++')) {
      const addedLine = diffLine.slice(1);
      const lineLen = addedLine.length + 1; // +1 for the '\n' join
      if (addedCharCount + lineLen > addedCodeOffset) {
        return currentFile;
      }
      addedCharCount += lineLen;
    }
  }
  return currentFile || '';
}

export function classifyDiff({ diffContent, coderStatus, forceReview = false }) {
  if (forceReview) {
    return {
      skipReviewers: false,
      reasons: ['force-review-requested'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
      classifiedBy: 'diff',
    };
  }

  if (typeof diffContent !== 'string' || !diffContent.trim()) {
    return {
      skipReviewers: false,
      reasons: ['diff-empty-or-invalid'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
      classifiedBy: 'diff',
    };
  }

  // --- Check 1: Verification clean (from coderStatus, not handoff parsing) ---
  if (!coderStatus || typeof coderStatus !== 'object') {
    return {
      skipReviewers: false,
      reasons: ['coder-status-missing'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
      classifiedBy: 'diff',
    };
  }
  if (coderStatus.verificationClean !== true) {
    return {
      skipReviewers: false,
      reasons: ['verification-not-clean'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
      classifiedBy: 'diff',
    };
  }

  // --- Check 2: Blockers absent (from coderStatus, not handoff parsing) ---
  if (coderStatus.hasBlockers === true) {
    return {
      skipReviewers: false,
      reasons: ['blockers-present'],
      triggeredRules: [],
      triggeredRulesLegacy: [],
      classifiedBy: 'diff',
    };
  }

  // --- Check 3: Risk-surface classification ---
  const filePaths = extractDiffFilePaths(diffContent);
  const addedCode = extractDiffAddedCode(diffContent);

  const triggered = [];
  const triggeredLegacy = [];

  for (const file of filePaths) {
    for (const pat of RISK_PATH_PATTERNS) {
      if (pat.regex.test(file)) {
        triggered.push({ rule: pat.rule, file, line: null, snippet: file, suggestedCheck: pat.suggestedCheck });
        triggeredLegacy.push(`${pat.rule}:${file}`);
      }
    }
  }

  for (const pat of RISK_CONTENT_PATTERNS) {
    const globalRegex = new RegExp(pat.regex.source, pat.regex.flags.includes('g') ? pat.regex.flags : pat.regex.flags + 'g');
    let m;
    while ((m = globalRegex.exec(addedCode)) !== null) {
      const passesExtraCheck = !pat.extraCheck || pat.extraCheck(addedCode, m.index);
      if (passesExtraCheck) {
        const snippet = m[0].slice(0, 80);
        // Compute line number: count newlines before match index (1-based)
        const line = (typeof m.index === 'number') ? addedCode.slice(0, m.index).split('\n').length : null;
        // Resolve file from diff headers: find which +++ b/<path> file owns this added code
        const fileForMatch = resolveFileFromDiff(diffContent, m.index, addedCode);
        triggered.push({ rule: pat.rule, file: fileForMatch || '', line, snippet, suggestedCheck: pat.suggestedCheck });
        triggeredLegacy.push(`${pat.rule}:${m[0].slice(0, 40)}`);
        break;
      }
    }
  }

  if (triggered.length > 0) {
    return {
      skipReviewers: false,
      reasons: ['risk-surface-match'],
      triggeredRules: triggered,
      triggeredRulesLegacy: triggeredLegacy,
      classifiedBy: 'diff',
    };
  }

  return {
    skipReviewers: true,
    reasons: ['verification-clean', 'no-blockers', 'no-risk-surface-match'],
    triggeredRules: [],
    triggeredRulesLegacy: [],
    classifiedBy: 'diff',
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
  const forceReview = Boolean(args['force-review']);

  // Diff path takes precedence when provided
  if (args.diff) {
    const diffPath = args.diff;
    const coderStatusPath = args['coder-status'];

    let diffContent;
    try {
      diffContent = fs.readFileSync(diffPath, 'utf8');
    } catch (err) {
      const result = {
        skipReviewers: false,
        reasons: ['diff-unreadable'],
        triggeredRules: [],
        classifiedBy: 'diff',
        error: err.message,
        diffPath,
      };
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(1);
    }

    let coderStatus = null;
    if (coderStatusPath) {
      try {
        coderStatus = JSON.parse(fs.readFileSync(coderStatusPath, 'utf8'));
      } catch (err) {
        const result = {
          skipReviewers: false,
          reasons: ['coder-status-unreadable'],
          triggeredRules: [],
          classifiedBy: 'diff',
          error: err.message,
          coderStatusPath,
        };
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        process.exit(1);
      }
    }

    const result = classifyDiff({ diffContent, coderStatus, forceReview });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Fallback: handoff path
  const handoffPath = args.handoff || 'docs/context/handoff.md';

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
