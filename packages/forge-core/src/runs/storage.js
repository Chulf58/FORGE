// storage.js — File I/O for run registry
// All paths are derived from projectRoot. No global state, no caching.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, openSync, closeSync } from 'node:fs';
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
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

export function withIndexLock(projectRoot, fn) {
  const lockPath = indexPath(projectRoot) + '.lock';
  const maxAttempts = 10;
  const retryMs = 50;
  let fd;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (i === maxAttempts - 1) throw new Error('index.json lock timeout after ' + (maxAttempts * retryMs) + 'ms');
      const start = Date.now();
      while (Date.now() - start < retryMs) { /* spin */ }
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try { unlinkSync(lockPath); } catch (_) {}
  }
}
