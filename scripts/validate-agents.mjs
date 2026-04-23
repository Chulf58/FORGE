#!/usr/bin/env node
// validate-agents.mjs — Validates YAML frontmatter in all agents/*.md files.
// Usage: node scripts/validate-agents.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENTS_DIR = join(import.meta.dirname, '..', 'agents');

const VALID_MODELS = new Set([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]);

const VALID_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
  'Agent', 'WebSearch', 'WebFetch',
]);

const REQUIRED_FIELDS = ['name', 'description', 'model', 'tools'];

function parseFrontmatter(content, filename) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { error: 'no frontmatter found' };

  const fields = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let inArray = false;

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '') {
        fields[currentKey] = [];
        inArray = true;
      } else {
        fields[currentKey] = val.replace(/^["']|["']$/g, '');
        inArray = false;
      }
      continue;
    }
    const itemMatch = line.match(/^\s+-\s+(.*)/);
    if (itemMatch && currentKey && inArray) {
      if (!Array.isArray(fields[currentKey])) fields[currentKey] = [];
      fields[currentKey].push(itemMatch[1].trim());
    }
  }
  return { fields };
}

let errors = 0;
const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).sort();

for (const file of files) {
  const content = readFileSync(join(AGENTS_DIR, file), 'utf-8');
  const { fields, error } = parseFrontmatter(content, file);
  const issues = [];

  if (error) {
    issues.push(error);
  } else {
    for (const req of REQUIRED_FIELDS) {
      if (!(req in fields)) issues.push(`missing required field: ${req}`);
    }

    if (fields.name && fields.name !== file.replace('.md', '')) {
      issues.push(`name "${fields.name}" does not match filename "${file.replace('.md', '')}"`);
    }

    if (fields.model && !VALID_MODELS.has(fields.model)) {
      issues.push(`unknown model: "${fields.model}" — valid: ${[...VALID_MODELS].join(', ')}`);
    }

    if (fields.tools) {
      if (!Array.isArray(fields.tools)) {
        issues.push('tools must be a YAML array');
      } else {
        for (const t of fields.tools) {
          if (!VALID_TOOLS.has(t)) issues.push(`unknown tool: "${t}"`);
        }
      }
    }

    if (fields.maxTurns !== undefined) {
      const n = Number(fields.maxTurns);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        issues.push(`maxTurns must be an integer 1-100, got "${fields.maxTurns}"`);
      }
    }
  }

  if (issues.length > 0) {
    errors += issues.length;
    console.error(`✘ ${file}`);
    for (const i of issues) console.error(`    ${i}`);
  } else {
    console.log(`✔ ${file}`);
  }
}

console.log(`\n${files.length} agents, ${errors} issue(s)`);
process.exit(errors > 0 ? 1 : 0);
