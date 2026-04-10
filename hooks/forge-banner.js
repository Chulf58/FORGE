'use strict';

// FORGE Banner — SessionStart hook.
// Renders the FORGE banner via stderr on session start.
// Also injects FORGE context via additionalContext.

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

function exitOk() { process.exit(0); }

// ── ANSI helpers ─────────────────────────────────────────────────
const X  = '\x1b[0m';
const D  = '\x1b[2;37m';

function rgb(r, g, b) { return `\x1b[38;2;${r};${g};${b}m`; }
function lerp(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

// ── 5-row pixel font (4 chars wide per letter) ───────────────────
const FONT = {
  F: ['████', '█   ', '███ ', '█   ', '█   '],
  O: [' ██ ', '█  █', '█  █', '█  █', ' ██ '],
  R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
  G: [' ███', '█   ', '█ ██', '█  █', ' ███'],
  E: ['████', '█   ', '███ ', '█   ', '████'],
};

function buildGradientText(colors) {
  const word = 'FORGE', gap = '  ';
  let totalW = 0;
  for (let i = 0; i < word.length; i++) {
    totalW += 4;
    if (i < word.length - 1) totalW += gap.length;
  }
  const lines = [];
  for (let row = 0; row < 5; row++) {
    let line = '', col = 0;
    for (let i = 0; i < word.length; i++) {
      const chars = FONT[word[i]][row];
      for (let c = 0; c < 4; c++) {
        const ch = chars[c] || ' ';
        if (ch !== ' ') {
          const t   = totalW > 1 ? col / (totalW - 1) : 0;
          const seg = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
          const rc  = lerp(colors[seg], colors[seg + 1], t * (colors.length - 1) - seg);
          line += rgb(rc[0], rc[1], rc[2]) + ch + X;
        } else {
          line += ' ';
        }
        col++;
      }
      if (i < word.length - 1) { line += gap; col += gap.length; }
    }
    lines.push(line);
  }
  return lines;
}

function renderBanner(projectName) {
  const W  = rgb(255, 255, 220);
  const Y  = rgb(255, 230,  50);
  const O  = rgb(255, 155,  25);
  const RO = rgb(240,  80,  15);
  const R  = rgb(210,  35,  15);
  const DR = rgb(130,  15,  10);

  const txt = buildGradientText([[255, 205, 50], [255, 140, 30], [215, 45, 25]]);
  const tag = projectName ? `\u2500\u2500 ${projectName} \u2500\u2500` : '\u2500\u2500 pipeline active \u2500\u2500';

  const rows = [
    `           ${R}\u28C0${X}`,
    `          ${R}\u28FE${RO}\u2844${X}`,
    `        ${R}\u28C0${RO}\u28FF${O}\u2887${X}`,
    `       ${R}\u28C0${RO}\u28FF${O}\u28FF${Y}\u28FF${R}\u2844${X}   ${txt[0]}`,
    `       ${R}\u2838${O}\u28FF${Y}\u28FF${W}\u28FF${Y}\u2887${X}   ${txt[1]}`,
    `      ${R}\u28C0${O}\u28FF${Y}\u28FF${W}\u28FF\u28FF${Y}\u2887${X}   ${txt[2]}`,
    `      ${R}\u2838${O}\u28FF${Y}\u28FF\u28FF\u28FF${O}\u28FF${R}\u2887${X}   ${txt[3]}`,
    `      ${R}\u28F8${O}\u28FF\u28FF${Y}\u28FF${O}\u28FF\u28FF${R}\u2887${X}   ${txt[4]}`,
    `       ${R}\u2838${O}\u28FF\u28FF\u28FF${RO}\u28FF${DR}\u283F${X}   ${D}${tag}${X}`,
    `        ${DR}\u2609\u251B\u2509${X}`,
  ];

  process.stderr.write('\n' + rows.join('\n') + '\n\n');
}

// ── Main ─────────────────────────────────────────────────────────
async function main(rawInput) {
  let payload;
  try { payload = JSON.parse(rawInput); } catch (_) { exitOk(); return; }

  const sessionId = payload.session_id;
  if (!sessionId) { exitOk(); return; }

  // Only show in FORGE-managed projects
  const forgePath = path.join(process.cwd(), '.forge');
  if (!fs.existsSync(forgePath)) { exitOk(); return; }

  // Read project name
  let name = '';
  try { name = JSON.parse(fs.readFileSync(forgePath, 'utf8')).name || ''; } catch (_) {}

  // Set terminal title (OSC 2)
  process.stderr.write(`\x1b]0;\uD83D\uDD25 FORGE\u2009\u2014\u2009${name || 'pipeline active'}\x07`);

  // Render banner to stderr
  renderBanner(name);

  // Output hook response with FORGE context injection
  const context = `This is a FORGE-managed project${name ? ': ' + name : ''}. FORGE pipeline commands are available via /forge:plan, /forge:apply, /forge:debug, /forge:status, etc.`;

  const hookResponse = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context
    }
  };

  process.stdout.write(JSON.stringify(hookResponse));
  exitOk();
}

// ── Stdin reader with timeout guard ─────────────────────────────
let inputData = '';
const timer = setTimeout(() => {
  main(inputData || '{}').catch(() => process.exit(0));
}, 5_000);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => { inputData += line + '\n'; });
rl.on('close', () => {
  clearTimeout(timer);
  main(inputData || '{}').catch(() => process.exit(0));
});
