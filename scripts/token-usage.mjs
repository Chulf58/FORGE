#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CLAUDE_DIR = join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects');

// Per-model pricing: USD per 1M tokens
const MODEL_PRICING = {
  'opus': { input: 15.0, output: 75.0, cache_read: 1.50, cache_write: 18.75 },
  'sonnet': { input: 3.0, output: 15.0, cache_read: 0.30, cache_write: 3.75 },
  'haiku': { input: 0.80, output: 4.0, cache_read: 0.08, cache_write: 1.00 },
};

function modelTier(modelStr) {
  if (!modelStr) return 'sonnet';
  const m = modelStr.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}

function msgCost(usage, model) {
  const p = MODEL_PRICING[modelTier(model)];
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  return (inp / 1e6) * p.input + (out / 1e6) * p.output + (cr / 1e6) * p.cache_read + (cw / 1e6) * p.cache_write;
}

function walkJsonl(dir, files = []) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walkJsonl(full, files);
        else if (entry.endsWith('.jsonl')) files.push(full);
      } catch (_) {}
    }
  } catch (_) {}
  return files;
}

// Parse arguments
const args = process.argv.slice(2);
const daysBack = parseInt(args.find(a => /^\d+$/.test(a)) || '7', 10);
const filterProject = args.find(a => !/^\d+$/.test(a) && a !== '--all');
const showAll = args.includes('--all');
const cutoff = new Date(Date.now() - daysBack * 86400000);

const allFiles = walkJsonl(CLAUDE_DIR);

// Aggregation structures
const projects = {};
const modelTotals = {};
let grandCost = 0;
let grandMessages = 0;
const grandTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

for (const file of allFiles) {
  const relPath = file.slice(CLAUDE_DIR.length + 1).replace(/\\/g, '/');
  const projectSlug = relPath.split('/')[0];
  if (filterProject && !projectSlug.toLowerCase().includes(filterProject.toLowerCase())) continue;

  const sessionId = relPath.split('/')[1]?.replace('.jsonl', '') || 'unknown';

  let lines;
  try { lines = readFileSync(file, 'utf8').split('\n'); } catch (_) { continue; }

  for (const line of lines) {
    if (!line.includes('input_tokens')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }

    const usage = obj?.message?.usage;
    if (!usage) continue;

    const ts = obj.timestamp ? new Date(obj.timestamp) : null;
    if (ts && ts < cutoff) continue;

    const model = obj.message?.model || 'unknown';
    const tier = modelTier(model);
    const c = msgCost(usage, model);
    const dateKey = ts ? ts.toISOString().slice(0, 10) : 'unknown';

    const inp = usage.input_tokens || 0;
    const out = usage.output_tokens || 0;
    const cr = usage.cache_read_input_tokens || 0;
    const cw = usage.cache_creation_input_tokens || 0;

    // Project aggregation
    if (!projects[projectSlug]) {
      projects[projectSlug] = { cost: 0, messages: 0, sessions: new Set(), models: {}, dates: {} };
    }
    const p = projects[projectSlug];
    p.cost += c;
    p.messages += 1;
    p.sessions.add(sessionId);
    if (!p.models[tier]) p.models[tier] = { cost: 0, messages: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const pm = p.models[tier];
    pm.cost += c; pm.messages += 1; pm.input += inp; pm.output += out; pm.cache_read += cr; pm.cache_write += cw;

    if (!p.dates[dateKey]) p.dates[dateKey] = { cost: 0, messages: 0 };
    p.dates[dateKey].cost += c;
    p.dates[dateKey].messages += 1;

    // Model totals
    if (!modelTotals[tier]) modelTotals[tier] = { cost: 0, messages: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const mt = modelTotals[tier];
    mt.cost += c; mt.messages += 1; mt.input += inp; mt.output += out; mt.cache_read += cr; mt.cache_write += cw;

    grandCost += c;
    grandMessages += 1;
    grandTokens.input += inp; grandTokens.output += out; grandTokens.cache_read += cr; grandTokens.cache_write += cw;
  }
}

// Display helpers
function bar(val, max, width = 20) {
  const filled = Math.round((val / (max || 1)) * width);
  return '\u2588'.repeat(Math.min(filled, width)) + '\u2591'.repeat(Math.max(width - filled, 0));
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function fmtCost(usd) { return '$' + usd.toFixed(2); }

console.log();
console.log('  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log(`   Token Usage \u2014 Last ${daysBack} days (per-model pricing)`);
console.log('  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log();

const sorted = Object.entries(projects).sort((a, b) => b[1].cost - a[1].cost);

if (sorted.length === 0) {
  console.log('  No usage data found for the specified period.');
  process.exit(0);
}

// Per-project breakdown
const maxCost = sorted[0][1].cost;
console.log('  BY PROJECT');
console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
for (const [slug, p] of sorted) {
  const name = slug.replace(/^C--Users-cuj-/, '').replace(/-/g, '/') || slug;
  console.log(`  ${bar(p.cost, maxCost, 15)} ${fmtCost(p.cost).padStart(8)}  ${name}`);
  console.log(`  ${''.padStart(15)}          ${p.sessions.size} sessions \u00b7 ${p.messages} API calls`);
  const modelParts = Object.entries(p.models)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([t, m]) => `${t}: ${fmtCost(m.cost)} (${m.messages} calls)`)
    .join(' \u00b7 ');
  console.log(`  ${''.padStart(15)}          ${modelParts}`);
  console.log();
}

// Grand total
console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`  TOTAL: ${fmtCost(grandCost)}`);
console.log(`  ${grandMessages} API calls \u00b7 in: ${fmt(grandTokens.input)} \u00b7 out: ${fmt(grandTokens.output)} \u00b7 cache-r: ${fmt(grandTokens.cache_read)} \u00b7 cache-w: ${fmt(grandTokens.cache_write)}`);
console.log();

// By model tier
console.log('  BY MODEL');
console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
const modelSorted = Object.entries(modelTotals).sort((a, b) => b[1].cost - a[1].cost);
const maxModelCost = modelSorted.length ? modelSorted[0][1].cost : 1;
for (const [tier, m] of modelSorted) {
  const p = MODEL_PRICING[tier];
  console.log(`  ${bar(m.cost, maxModelCost, 15)} ${fmtCost(m.cost).padStart(8)}  ${tier.toUpperCase()}`);
  console.log(`  ${''.padStart(15)}          ${m.messages} calls \u00b7 in: ${fmt(m.input)} \u00b7 out: ${fmt(m.output)} \u00b7 cache-r: ${fmt(m.cache_read)} \u00b7 cache-w: ${fmt(m.cache_write)}`);
  console.log(`  ${''.padStart(15)}          rates: in=$${p.input}/M out=$${p.output}/M cache-r=$${p.cache_read}/M cache-w=$${p.cache_write}/M`);
  console.log();
}

// Daily view
if (filterProject || showAll || sorted.length === 1) {
  const target = sorted.length === 1 ? sorted[0] : sorted.find(([s]) => filterProject && s.toLowerCase().includes(filterProject.toLowerCase()));
  if (target) {
    const [slug, p] = target;
    const dates = Object.entries(p.dates).sort();
    if (dates.length > 1) {
      console.log(`  DAILY \u2014 ${slug.replace(/^C--Users-cuj-/, '').replace(/-/g, '/')}`);
      console.log('  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
      const maxDay = Math.max(...dates.map(([, d]) => d.cost));
      for (const [date, d] of dates) {
        console.log(`  ${date}  ${bar(d.cost, maxDay, 20)} ${fmtCost(d.cost).padStart(8)}  ${d.messages} calls`);
      }
      console.log();
    }
  }
}

console.log('  Pricing: per-model rates from Anthropic (Opus/Sonnet/Haiku)');
console.log('  Note: Actual billing depends on your plan caps');
console.log();
