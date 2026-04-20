#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>');
  console.error('Example: node scripts/bump-version.mjs 0.5.0');
  process.exit(1);
}

const targets = [
  { file: '.claude-plugin/plugin.json', path: ['version'] },
  { file: '.claude-plugin/marketplace.json', path: ['plugins', 0, 'version'] },
];

for (const target of targets) {
  const filePath = path.join(root, target.file);
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  let obj = json;
  for (let i = 0; i < target.path.length - 1; i++) {
    obj = obj[target.path[i]];
  }
  const key = target.path[target.path.length - 1];
  const old = obj[key];
  obj[key] = version;

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
  console.log(`${target.file}: ${old} → ${version}`);
}

console.log(`\nBumped to ${version}. Verify with: grep -r '"version"' .claude-plugin/`);
