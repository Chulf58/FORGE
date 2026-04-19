#!/usr/bin/env node
// Token/fan-out audit for FORGE pipeline runs.
// Walks Claude Code session transcripts under ~/.claude/projects/<slug>/<uuid>/subagents/*.jsonl
// and produces a ranked-by-output-tokens table plus a fan-out map of agent types
// per session. Intentionally bounded — no persistence, no dashboards, one-shot read.
//
// Usage:
//   node scripts/audit-tokens.mjs              # auto-picks the N most-recent sessions
//   node scripts/audit-tokens.mjs --sessions=A,B,C
//   node scripts/audit-tokens.mjs --top=N      # how many recent sessions to include (default 3)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROJECT_SLUG = 'C--Users-cuj-forge-plugin';
const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects', PROJECT_SLUG);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const TOP_N = Number(args.top ?? 3);
const SESSIONS_ARG = typeof args.sessions === 'string' ? args.sessions.split(',') : null;

function listSessions() {
  const entries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== 'memory');
  const withStats = dirs
    .map((d) => {
      const subagentsDir = path.join(PROJECTS_ROOT, d.name, 'subagents');
      if (!fs.existsSync(subagentsDir)) return null;
      const files = fs.readdirSync(subagentsDir).filter((f) => f.endsWith('.jsonl'));
      if (!files.length) return null;
      const newest = Math.max(
        ...files.map((f) => fs.statSync(path.join(subagentsDir, f)).mtimeMs),
      );
      return { id: d.name, newest, agentFileCount: files.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.newest - a.newest);
  return withStats;
}

function loadAgentMeta(sessionId, agentId) {
  const metaPath = path.join(PROJECTS_ROOT, sessionId, 'subagents', `agent-${agentId}.meta.json`);
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return { agentType: 'unknown', description: '' };
  }
}

function sumAgentTranscript(sessionId, agentId) {
  const jsonlPath = path.join(PROJECTS_ROOT, sessionId, 'subagents', `agent-${agentId}.jsonl`);
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let toolUses = 0;
  let assistantTurns = 0;
  let model = null;
  let startedAt = null;
  let endedAt = null;

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : null;
    if (ts) {
      if (startedAt === null || ts < startedAt) startedAt = ts;
      if (endedAt === null || ts > endedAt) endedAt = ts;
    }
    if (obj.type !== 'assistant' || !obj.message) continue;
    assistantTurns += 1;
    if (obj.message.model && !model) model = obj.message.model;
    const usage = obj.message.usage;
    if (usage) {
      inputTokens += Number(usage.input_tokens || 0);
      outputTokens += Number(usage.output_tokens || 0);
      cacheCreate += Number(usage.cache_creation_input_tokens || 0);
      cacheRead += Number(usage.cache_read_input_tokens || 0);
    }
    const content = Array.isArray(obj.message.content) ? obj.message.content : [];
    for (const c of content) {
      if (c && c.type === 'tool_use') toolUses += 1;
    }
  }
  return {
    inputTokens,
    outputTokens,
    cacheCreate,
    cacheRead,
    toolUses,
    assistantTurns,
    model,
    startedAt,
    endedAt,
    durationMs: startedAt && endedAt ? endedAt - startedAt : null,
  };
}

function auditSession(sessionId) {
  const subagentsDir = path.join(PROJECTS_ROOT, sessionId, 'subagents');
  const files = fs.readdirSync(subagentsDir).filter((f) => f.endsWith('.jsonl'));
  const agentIds = files.map((f) => f.replace(/^agent-/, '').replace(/\.jsonl$/, ''));
  const rows = agentIds.map((agentId) => {
    const meta = loadAgentMeta(sessionId, agentId);
    const sums = sumAgentTranscript(sessionId, agentId);
    return { agentId, agentType: meta.agentType || 'unknown', ...sums };
  });
  rows.sort((a, b) => b.outputTokens - a.outputTokens);
  return { sessionId, rows };
}

function fmt(n) {
  return n == null ? '-' : Number(n).toLocaleString('en-US');
}

function renderSessionReport(result) {
  const { sessionId, rows } = result;
  const totalOut = rows.reduce((s, r) => s + r.outputTokens, 0);
  const totalIn = rows.reduce((s, r) => s + r.inputTokens, 0);
  const totalCacheRead = rows.reduce((s, r) => s + r.cacheRead, 0);
  const totalCacheCreate = rows.reduce((s, r) => s + r.cacheCreate, 0);

  console.log('\n==============================');
  console.log('Session:', sessionId);
  console.log('Agents recorded:', rows.length);
  console.log('==============================');
  console.log('Ranked by OUTPUT tokens (descending):');
  console.log(
    'agentType                    | out      | in       | cacheCreate | cacheRead | toolUses | turns | model',
  );
  for (const r of rows) {
    console.log(
      `${(r.agentType || '').padEnd(29)}| ${fmt(r.outputTokens).padStart(8)} | ${fmt(
        r.inputTokens,
      ).padStart(8)} | ${fmt(r.cacheCreate).padStart(11)} | ${fmt(r.cacheRead).padStart(
        9,
      )} | ${fmt(r.toolUses).padStart(8)} | ${fmt(r.assistantTurns).padStart(5)} | ${r.model || '?'}`,
    );
  }
  console.log('-------------------------------');
  console.log(
    'TOTAL out:',
    fmt(totalOut),
    'in:',
    fmt(totalIn),
    'cacheCreate:',
    fmt(totalCacheCreate),
    'cacheRead:',
    fmt(totalCacheRead),
  );

  // Fan-out: group by agentType, count invocations
  const byType = new Map();
  for (const r of rows) {
    const key = r.agentType || 'unknown';
    const prev = byType.get(key) || { count: 0, out: 0, in: 0 };
    prev.count += 1;
    prev.out += r.outputTokens;
    prev.in += r.inputTokens;
    byType.set(key, prev);
  }
  const fanout = Array.from(byType.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.count - a.count || b.out - a.out);
  console.log('\nFan-out by agentType (same agent invoked N times in this session):');
  for (const f of fanout) {
    console.log(
      `  ${f.type.padEnd(29)} count=${String(f.count).padStart(2)}  outTotal=${fmt(f.out).padStart(
        8,
      )}  inTotal=${fmt(f.in).padStart(8)}`,
    );
  }
  return { sessionId, totalOut, totalIn, totalCacheCreate, totalCacheRead, rows, fanout };
}

function main() {
  if (!fs.existsSync(PROJECTS_ROOT)) {
    console.error('Projects root not found:', PROJECTS_ROOT);
    process.exit(1);
  }
  let sessionIds;
  if (SESSIONS_ARG) {
    sessionIds = SESSIONS_ARG;
  } else {
    sessionIds = listSessions().slice(0, TOP_N).map((s) => s.id);
  }
  const aggregated = new Map();
  for (const sid of sessionIds) {
    const r = auditSession(sid);
    renderSessionReport(r);
    for (const row of r.rows) {
      const key = row.agentType;
      const prev = aggregated.get(key) || {
        count: 0,
        out: 0,
        in: 0,
        cacheCreate: 0,
        cacheRead: 0,
      };
      prev.count += 1;
      prev.out += row.outputTokens;
      prev.in += row.inputTokens;
      prev.cacheCreate += row.cacheCreate;
      prev.cacheRead += row.cacheRead;
      aggregated.set(key, prev);
    }
  }
  console.log('\n==============================');
  console.log('AGGREGATE across', sessionIds.length, 'session(s):');
  console.log('==============================');
  const agg = Array.from(aggregated.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.out - a.out);
  console.log(
    'agentType                    | outTotal | inTotal  | cacheCreate | cacheRead | invocations',
  );
  for (const r of agg) {
    console.log(
      `${r.type.padEnd(29)}| ${fmt(r.out).padStart(8)} | ${fmt(r.in).padStart(8)} | ${fmt(
        r.cacheCreate,
      ).padStart(11)} | ${fmt(r.cacheRead).padStart(9)} | ${String(r.count).padStart(11)}`,
    );
  }
  console.log('\nDone.');
}

main();
