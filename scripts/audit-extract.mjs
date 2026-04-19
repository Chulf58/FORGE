#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const CLAUDE_DIR = join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects', 'C--Users-cuj-forge-plugin');

// Contract change timestamps
const CODER_CHANGE = new Date('2026-04-19T08:05:00Z');    // b8937af
const DOC_CHANGE = new Date('2026-04-19T14:30:00Z');       // e999296

const TARGET_AGENTS = ['forge:coder', 'forge:documenter'];

function parseJsonl(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      messages.push(obj);
    } catch (_) {}
  }
  return messages;
}

function extractAgentStats(jsonlPath) {
  const messages = parseJsonl(jsonlPath);
  let outputTokens = 0;
  let inputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let turns = 0;
  let toolUses = 0;
  let firstTs = null;
  let lastTs = null;
  let model = 'unknown';

  for (const msg of messages) {
    const usage = msg?.message?.usage;
    if (!usage) continue;

    turns++;
    outputTokens += usage.output_tokens || 0;
    inputTokens += usage.input_tokens || 0;
    cacheRead += usage.cache_read_input_tokens || 0;
    cacheWrite += usage.cache_creation_input_tokens || 0;

    if (msg.message?.model) model = msg.message.model;
    if (msg.timestamp) {
      const ts = new Date(msg.timestamp);
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    // Count tool uses in content blocks
    const content = msg?.message?.content;
    if (Array.isArray(content)) {
      toolUses += content.filter(b => b.type === 'tool_use').length;
    }
  }

  return {
    outputTokens, inputTokens, cacheRead, cacheWrite,
    turns, toolUses, model, firstTs, lastTs,
    totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite
  };
}

// Scan all sessions
const entries = readdirSync(CLAUDE_DIR).filter(e => {
  return e.match(/^[0-9a-f]{8}-/) && !e.endsWith('.jsonl');
});

const results = [];

for (const sessionDir of entries) {
  const subagentDir = join(CLAUDE_DIR, sessionDir, 'subagents');
  if (!existsSync(subagentDir)) continue;

  const metaFiles = readdirSync(subagentDir).filter(f => f.endsWith('.meta.json'));

  for (const metaFile of metaFiles) {
    const metaPath = join(subagentDir, metaFile);
    let meta;
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch (_) { continue; }

    if (!TARGET_AGENTS.includes(meta.agentType)) continue;

    const jsonlFile = metaFile.replace('.meta.json', '.jsonl');
    const jsonlPath = join(subagentDir, jsonlFile);
    if (!existsSync(jsonlPath)) continue;

    const stats = extractAgentStats(jsonlPath);
    const agentType = meta.agentType.replace('forge:', '');

    // Determine PRE/POST
    let period;
    if (agentType === 'coder') {
      period = stats.firstTs && stats.firstTs >= CODER_CHANGE ? 'POST' : 'PRE';
    } else if (agentType === 'documenter') {
      period = stats.firstTs && stats.firstTs >= DOC_CHANGE ? 'POST' : 'PRE';
    }

    results.push({
      session: sessionDir.slice(0, 8),
      agent: agentType,
      period,
      outputTokens: stats.outputTokens,
      inputTokens: stats.inputTokens,
      cacheRead: stats.cacheRead,
      cacheWrite: stats.cacheWrite,
      totalTokens: stats.totalTokens,
      turns: stats.turns,
      toolUses: stats.toolUses,
      model: stats.model,
      firstTs: stats.firstTs?.toISOString(),
      description: meta.description || '',
      outPerTurn: stats.turns ? Math.round(stats.outputTokens / stats.turns) : 0,
      outPerTool: stats.toolUses ? Math.round(stats.outputTokens / stats.toolUses) : 0,
    });
  }
}

// Sort by agent then timestamp
results.sort((a, b) => {
  if (a.agent !== b.agent) return a.agent.localeCompare(b.agent);
  return (a.firstTs || '').localeCompare(b.firstTs || '');
});

// Print coder section
console.log('\n=== CODER CALLS ===\n');
const coders = results.filter(r => r.agent === 'coder');
for (const r of coders) {
  console.log(`[${r.period}] ${r.session} | out: ${r.outputTokens.toLocaleString()} | turns: ${r.turns} | tools: ${r.toolUses} | out/turn: ${r.outPerTurn} | out/tool: ${r.outPerTool}`);
  console.log(`       ${r.description.slice(0, 80)}`);
}

const coderPre = coders.filter(r => r.period === 'PRE');
const coderPost = coders.filter(r => r.period === 'POST');
console.log(`\nCoder PRE  (N=${coderPre.length}): avg out/call = ${coderPre.length ? Math.round(coderPre.reduce((s,r) => s+r.outputTokens, 0)/coderPre.length) : 'n/a'}, avg out/turn = ${coderPre.length ? Math.round(coderPre.reduce((s,r) => s+r.outPerTurn, 0)/coderPre.length) : 'n/a'}`);
console.log(`Coder POST (N=${coderPost.length}): avg out/call = ${coderPost.length ? Math.round(coderPost.reduce((s,r) => s+r.outputTokens, 0)/coderPost.length) : 'n/a'}, avg out/turn = ${coderPost.length ? Math.round(coderPost.reduce((s,r) => s+r.outPerTurn, 0)/coderPost.length) : 'n/a'}`);
if (coderPre.length && coderPost.length) {
  const preAvg = coderPre.reduce((s,r) => s+r.outputTokens, 0)/coderPre.length;
  const postAvg = coderPost.reduce((s,r) => s+r.outputTokens, 0)/coderPost.length;
  console.log(`Delta: ${((postAvg - preAvg) / preAvg * 100).toFixed(1)}% per-call`);
  const preTurn = coderPre.reduce((s,r) => s+r.outPerTurn, 0)/coderPre.length;
  const postTurn = coderPost.reduce((s,r) => s+r.outPerTurn, 0)/coderPost.length;
  console.log(`Delta: ${((postTurn - preTurn) / preTurn * 100).toFixed(1)}% per-turn`);
}

// Print documenter section
console.log('\n=== DOCUMENTER CALLS ===\n');
const docs = results.filter(r => r.agent === 'documenter');
for (const r of docs) {
  console.log(`[${r.period}] ${r.session} | out: ${r.outputTokens.toLocaleString()} | turns: ${r.turns} | tools: ${r.toolUses} | out/turn: ${r.outPerTurn} | out/tool: ${r.outPerTool}`);
  console.log(`       ${r.description.slice(0, 80)}`);
}

const docPre = docs.filter(r => r.period === 'PRE');
const docPost = docs.filter(r => r.period === 'POST');
console.log(`\nDoc PRE  (N=${docPre.length}): avg out/call = ${docPre.length ? Math.round(docPre.reduce((s,r) => s+r.outputTokens, 0)/docPre.length) : 'n/a'}, avg out/turn = ${docPre.length ? Math.round(docPre.reduce((s,r) => s+r.outPerTurn, 0)/docPre.length) : 'n/a'}, median out/call = ${docPre.length ? docPre.map(r=>r.outputTokens).sort((a,b)=>a-b)[Math.floor(docPre.length/2)] : 'n/a'}`);
console.log(`Doc POST (N=${docPost.length}): avg out/call = ${docPost.length ? Math.round(docPost.reduce((s,r) => s+r.outputTokens, 0)/docPost.length) : 'n/a'}, avg out/turn = ${docPost.length ? Math.round(docPost.reduce((s,r) => s+r.outPerTurn, 0)/docPost.length) : 'n/a'}, median out/call = ${docPost.length ? docPost.map(r=>r.outputTokens).sort((a,b)=>a-b)[Math.floor(docPost.length/2)] : 'n/a'}`);
if (docPre.length && docPost.length) {
  const preAvg = docPre.reduce((s,r) => s+r.outputTokens, 0)/docPre.length;
  const postAvg = docPost.reduce((s,r) => s+r.outputTokens, 0)/docPost.length;
  console.log(`Delta: ${((postAvg - preAvg) / preAvg * 100).toFixed(1)}% per-call`);
  const preTurn = docPre.reduce((s,r) => s+r.outPerTurn, 0)/docPre.length;
  const postTurn = docPost.reduce((s,r) => s+r.outPerTurn, 0)/docPost.length;
  console.log(`Delta: ${((postTurn - preTurn) / preTurn * 100).toFixed(1)}% per-turn`);
}

// PRE outlier analysis for documenter
if (docPre.length > 2) {
  const sorted = [...docPre].sort((a,b) => b.outputTokens - a.outputTokens);
  console.log(`\nDoc PRE max: ${sorted[0].outputTokens.toLocaleString()} (${sorted[0].description.slice(0,50)})`);
  console.log(`Doc PRE min: ${sorted[sorted.length-1].outputTokens.toLocaleString()}`);
  console.log(`Variance ratio: ${(sorted[0].outputTokens / sorted[sorted.length-1].outputTokens).toFixed(1)}x`);
}
