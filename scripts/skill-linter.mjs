#!/usr/bin/env node
// @covers scripts/skill-linter.mjs
//
// Lints skill SKILL.md files for stale references across four categories:
//   file-paths  — backtick code referencing paths that do not exist on disk
//   agent-names — backtick code referencing forge:* agents not in the known set
//   skill-names — backtick code referencing /forge:* skills not in the known set
//   mcp-tools   — backtick code referencing forge_* tools not in the known set
//
// Only tokens inside backtick spans or fenced code blocks are examined.
// YAML frontmatter (---...---) is skipped entirely.
// Per-file suppressions via: <!-- skill-linter:ignore <category> <token> -->
//
// Usage: node scripts/skill-linter.mjs [--skills-dir <path>]
// Exit 0 = no errors; Exit 1 = one or more errors found.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// --- Known sets (pre-computed from agents/*.md and skills/*/SKILL.md) ---------

const KNOWN_AGENTS = new Set([
  'forge:architect',
  'forge:coder-scout',
  'forge:coder',
  'forge:completeness-checker',
  'forge:compound-refresh',
  'forge:critic',
  'forge:debug',
  'forge:documenter',
  'forge:gotcha-checker',
  'forge:implementation-architect',
  'forge:learnings-extractor',
  'forge:plan-extractor',
  'forge:planner',
  'forge:red-team',
  'forge:refactor',
  'forge:researcher',
  'forge:reviewer-boundary',
  'forge:reviewer-logic',
  'forge:reviewer-performance',
  'forge:reviewer-safety',
  'forge:reviewer-tests',
  'forge:skills-generator',
  'forge:supervisor',
  'forge:technical-skeptic',
  'forge:test-author',
]);

const KNOWN_SKILLS = new Set([
  '/forge:apply',
  '/forge:approve',
  '/forge:chat',
  '/forge:commit',
  '/forge:config',
  '/forge:dashboard',
  '/forge:debug',
  '/forge:discard',
  '/forge:explore',
  '/forge:gotchas',
  '/forge:grill-intent',
  '/forge:grill-plan',
  '/forge:health',
  '/forge:help',
  '/forge:ideate',
  '/forge:implement',
  '/forge:init',
  '/forge:note',
  '/forge:overview',
  '/forge:plan',
  '/forge:planned',
  '/forge:refactor',
  '/forge:refresh',
  '/forge:refresh-docs',
  '/forge:research',
  '/forge:resume',
  '/forge:spawn',
  '/forge:status',
  '/forge:supervise',
  '/forge:todo',
  '/forge:unblock',
]);

const KNOWN_MCP_TOOLS = new Set([
  'forge_add_learning',
  'forge_add_model',
  'forge_add_note',
  'forge_add_todo',
  'forge_advance_stage',
  'forge_assign_module',
  'forge_call_external',
  'forge_check_gate',
  'forge_classify_risk',
  'forge_create_run',
  'forge_create_worktree',
  'forge_dashboard_state',
  'forge_delete_note',
  'forge_escalate',
  'forge_get_active_run',
  'forge_get_constraints',
  'forge_get_linked',
  'forge_get_model_recommendation',
  'forge_get_patterns',
  'forge_get_run',
  'forge_kill_worker',
  'forge_list_models',
  'forge_list_runs',
  'forge_read_board',
  'forge_read_criteria',
  'forge_read_modules',
  'forge_read_notes',
  'forge_read_project',
  'forge_read_usage',
  'forge_reset_usage',
  'forge_respond_to_escalation',
  'forge_resume_run',
  'forge_set_blocked_by',
  'forge_set_gate',
  'forge_update_agent_model',
  'forge_update_config',
  'forge_update_model',
  'forge_update_run',
  'forge_update_task',
  'forge_write_criteria',
]);

// --- Allowlist parsing --------------------------------------------------------

/**
 * Parses allowlist entries from file content.
 * Format: <!-- skill-linter:ignore <category> <token> -->
 * @param {string} content
 * @returns {Map<string, Set<string>>} category -> set of ignored tokens
 */
function parseAllowlist(content) {
  const allowlist = new Map();
  const re = /<!--\s*skill-linter:ignore\s+(\S+)\s+(\S+)\s*-->/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, category, token] = m;
    if (!allowlist.has(category)) {
      allowlist.set(category, new Set());
    }
    allowlist.get(category).add(token);
  }
  return allowlist;
}

// --- Content extraction -------------------------------------------------------

/**
 * Strips YAML frontmatter from content (---...--- block at the start).
 * @param {string} content
 * @returns {string}
 */
function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}

/**
 * Extracts only the text that appears inside backtick spans or fenced code blocks.
 * @param {string} content
 * @returns {string[]} array of code segment strings
 */
function extractCodeSegments(content) {
  const segments = [];

  // Fenced code blocks: ```[lang]\n...\n```
  const fencedRe = /```[^\n]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = fencedRe.exec(content)) !== null) {
    segments.push(m[1]);
  }

  // Inline backtick spans: `...` — scan with fenced blocks blanked to avoid double-matching
  const blanked = content.replace(/```[^\n]*\r?\n[\s\S]*?```/g, (match) => ' '.repeat(match.length));
  const inlineRe = /`([^`\n]+)`/g;
  while ((m = inlineRe.exec(blanked)) !== null) {
    segments.push(m[1]);
  }

  return segments;
}

// --- Per-file lint ------------------------------------------------------------

/**
 * @typedef {{ category: string, token: string, file: string }} LintError
 */

/**
 * Lints a single SKILL.md file.
 * @param {string} filePath - absolute path to the SKILL.md
 * @param {string} projectRoot - project root for resolving file paths
 * @returns {{ errors: LintError[], allowlistUses: string[] }}
 */
function lintFile(filePath, projectRoot) {
  const raw = readFileSync(filePath, 'utf8');
  const allowlist = parseAllowlist(raw);
  const content = stripFrontmatter(raw);
  const segments = extractCodeSegments(content);
  const combined = segments.join('\n');

  const errors = [];
  const allowlistUses = [];

  /**
   * Checks if a token is allowed; records use if suppressed.
   * @param {string} category
   * @param {string} token
   * @returns {boolean} true if suppressed
   */
  function isAllowed(category, token) {
    const categorySet = allowlist.get(category);
    if (categorySet && categorySet.has(token)) {
      allowlistUses.push(`${filePath}:${category}:${token}`);
      return true;
    }
    return false;
  }

  // 1. file-paths
  {
    // Negative lookbehind: exclude matches where root word is a suffix of a longer path segment
    // (e.g. `.claude/agents/` must not match as `agents/`).
    // Also exclude glob wildcards (* ?) from matched paths.
    // Negative lookahead (?![a-z0-9]) ensures extension is not a prefix of a longer extension
    // (e.g. prevents .js from matching inside .json).
    const re = /(?<![/.\w])((?:scripts|agents|hooks|mcp|bin|packages)[/\\][^\s`'"<>()*?\n]+\.(?:mjs|js|cjs|sh|md|ts))(?![a-z0-9])/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(combined)) !== null) {
      const rawPath = m[1];
      const normalizedPath = rawPath.replace(/\\/g, '/');
      if (seen.has(normalizedPath)) continue;
      seen.add(normalizedPath);
      const absPath = join(projectRoot, normalizedPath);
      if (!existsSync(absPath)) {
        if (!isAllowed('file-paths', normalizedPath)) {
          errors.push({ category: 'file-paths', token: normalizedPath, file: filePath });
        }
      }
    }
  }

  // 2. agent-names: forge:* but NOT preceded by / (skill invocation) or [ (log prefix)
  //    Also skip tokens whose <name> part is a known skill name (e.g. forge:gotchas in YAML arrays)
  {
    // Build a skills-name set (without the leading /forge: prefix) for cross-check
    const SKILL_NAMES = new Set([...KNOWN_SKILLS].map((s) => s.replace('/forge:', '')));
    const re = /(?<![/\[])(forge:[a-z][a-z0-9-]+)/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(combined)) !== null) {
      const token = m[1];
      if (seen.has(token)) continue;
      seen.add(token);
      const name = token.replace('forge:', '');
      if (!KNOWN_AGENTS.has(token) && !SKILL_NAMES.has(name)) {
        if (!isAllowed('agent-names', token)) {
          errors.push({ category: 'agent-names', token, file: filePath });
        }
      }
    }
  }

  // 3. skill-names: /forge:*
  {
    const re = /(\/forge:[a-z][a-z0-9-]+)/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(combined)) !== null) {
      const token = m[1];
      if (seen.has(token)) continue;
      seen.add(token);
      if (!KNOWN_SKILLS.has(token)) {
        if (!isAllowed('skill-names', token)) {
          errors.push({ category: 'skill-names', token, file: filePath });
        }
      }
    }
  }

  // 4. mcp-tools: forge_*
  {
    const re = /\b(forge_[a-z][a-z0-9_]+)\b/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(combined)) !== null) {
      const token = m[1];
      if (seen.has(token)) continue;
      seen.add(token);
      if (!KNOWN_MCP_TOOLS.has(token)) {
        if (!isAllowed('mcp-tools', token)) {
          errors.push({ category: 'mcp-tools', token, file: filePath });
        }
      }
    }
  }

  return { errors, allowlistUses };
}

// --- Discovery + main --------------------------------------------------------

function parseArgs(argv) {
  const args = { skillsDir: join(PROJECT_ROOT, 'skills') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skills-dir' && argv[i + 1]) {
      args.skillsDir = resolve(argv[i + 1]);
      i++;
    }
  }
  return args;
}

function discoverSkillFiles(skillsDir) {
  const files = [];
  if (!existsSync(skillsDir)) return files;
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMd = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillMd)) {
        files.push(skillMd);
      }
    }
  }
  return files.sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillFiles = discoverSkillFiles(args.skillsDir);

  const allErrors = {
    'file-paths': [],
    'agent-names': [],
    'skill-names': [],
    'mcp-tools': [],
  };
  const allAllowlistUses = [];

  for (const filePath of skillFiles) {
    const { errors, allowlistUses } = lintFile(filePath, PROJECT_ROOT);
    for (const err of errors) {
      allErrors[err.category].push({ token: err.token, file: err.file });
    }
    allAllowlistUses.push(...allowlistUses);
  }

  const result = {
    checkedFiles: skillFiles.length,
    errors: allErrors,
    allowlistUses: allAllowlistUses,
  };

  process.stdout.write(JSON.stringify(result) + '\n');

  const hasErrors = Object.values(allErrors).some((arr) => arr.length > 0);
  process.exit(hasErrors ? 1 : 0);
}

main();
