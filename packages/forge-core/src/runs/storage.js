// storage.js — File I/O for run registry
// All paths are derived from projectRoot. No global state, no caching.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function runsDir(projectRoot) {
  return join(projectRoot, '.pipeline', 'runs');
}

export function indexPath(projectRoot) {
  return join(runsDir(projectRoot), 'index.json');
}

export function runDir(projectRoot, runId) {
  return join(runsDir(projectRoot), runId);
}

export function runPath(projectRoot, runId) {
  return join(runDir(projectRoot, runId), 'run.json');
}

export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

export function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
