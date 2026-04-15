#!/usr/bin/env node
// png-to-sprite — convert a PNG into a terminal sprite (half-block + truecolor).
//
// Usage:
//   node scripts/png-to-sprite.mjs <path-to-png> [--trim] [--scale N]
//
// Output: a block of characters + ANSI escape codes that renders the PNG
// as pixel art in any truecolor terminal. Each terminal character represents
// two vertically-stacked pixels (upper half block U+2580: fg = top pixel,
// bg = bottom pixel). Fully transparent pixels become terminal background.
//
// Options:
//   --trim     Crop surrounding transparent/white padding automatically
//   --scale N  Downscale by integer factor N (e.g. --scale 8 on a 128-wide
//              PNG gives a 16-wide sprite). Average color per block.
//
// Designed as the reusable asset pipeline for FORGE's terminal worker cards.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { PNG } = require(resolve(__dirname, "..", "mcp", "node_modules", "pngjs"));

const X = "\x1b[0m";
const UHB = "\u2580"; // upper half block

function rgb(fg, bg) {
  let s = "";
  if (fg) s += `\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m`;
  if (bg) s += `\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m`;
  return s;
}

function parseArgs(argv) {
  const out = { path: null, trim: false, scale: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--trim") out.trim = true;
    else if (a === "--scale") out.scale = parseInt(argv[++i], 10) || 1;
    else if (!out.path) out.path = a;
  }
  return out;
}

function decodePng(filepath) {
  const buf = readFileSync(filepath);
  const png = PNG.sync.read(buf);
  // pixels[y][x] = [r, g, b, a]
  const w = png.width, h = png.height;
  const pixels = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      row.push([png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]]);
    }
    pixels.push(row);
  }
  return { pixels, w, h };
}

// Consider a pixel "transparent" if alpha < 128 OR it's pure white
// (PNG sample uses white as implicit transparency).
function isEmpty(px) {
  const [r, g, b, a] = px;
  if (a < 128) return true;
  if (r > 245 && g > 245 && b > 245) return true;
  return false;
}

function trim(pixels, w, h) {
  let top = 0, bot = h - 1, left = 0, right = w - 1;
  // top
  while (top < h && pixels[top].every(isEmpty)) top++;
  // bottom
  while (bot >= top && pixels[bot].every(isEmpty)) bot--;
  // left
  while (left < w && pixels.every(row => isEmpty(row[left]))) left++;
  // right
  while (right >= left && pixels.every(row => isEmpty(row[right]))) right--;
  const cropped = [];
  for (let y = top; y <= bot; y++) {
    cropped.push(pixels[y].slice(left, right + 1));
  }
  return { pixels: cropped, w: right - left + 1, h: bot - top + 1 };
}

function downscale(pixels, w, h, s) {
  if (s <= 1) return { pixels, w, h };
  const newW = Math.ceil(w / s), newH = Math.ceil(h / s);
  const out = [];
  for (let y = 0; y < newH; y++) {
    const row = [];
    for (let x = 0; x < newW; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const sy = y * s + dy, sx = x * s + dx;
          if (sy < h && sx < w) {
            const [pr, pg, pb, pa] = pixels[sy][sx];
            r += pr; g += pg; b += pb; a += pa; n++;
          }
        }
      }
      row.push([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]);
    }
    out.push(row);
  }
  return { pixels: out, w: newW, h: newH };
}

function render(pixels, w, h) {
  const lines = [];
  for (let y = 0; y < h; y += 2) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const top = pixels[y][x];
      const bot = (y + 1 < h) ? pixels[y + 1][x] : [0, 0, 0, 0];
      const tEmpty = isEmpty(top), bEmpty = isEmpty(bot);
      if (tEmpty && bEmpty) {
        line += " ";
      } else if (tEmpty) {
        line += rgb(null, bot.slice(0, 3)) + " " + X;
      } else if (bEmpty) {
        line += rgb(top.slice(0, 3), null) + UHB + X;
      } else {
        line += rgb(top.slice(0, 3), bot.slice(0, 3)) + UHB + X;
      }
    }
    lines.push(line);
  }
  return lines;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path) {
    console.error("Usage: node scripts/png-to-sprite.mjs <path.png> [--trim] [--scale N]");
    process.exit(1);
  }
  let { pixels, w, h } = decodePng(args.path);
  if (args.trim) ({ pixels, w, h } = trim(pixels, w, h));
  if (args.scale > 1) ({ pixels, w, h } = downscale(pixels, w, h, args.scale));
  const lines = render(pixels, w, h);
  console.log(lines.join("\n"));
  console.error(`\n[png-to-sprite] rendered ${w}x${h} px (${lines.length} rows, ${w} cols in terminal)`);
}

main();
