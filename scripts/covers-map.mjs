#!/usr/bin/env node
// @covers scripts/covers-map.mjs
// Impact-map builder: globs test files, reads @covers tags, returns src → [testFile] map.
// Export: buildCoversMap(rootDir: string) → Promise<Record<string, string[]>>

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'node:fs/promises';
import { parseCovers } from './covers-parser.mjs';

/**
 * Glob test files under the given root using the three canonical patterns.
 * Falls back to manual glob when node:fs/promises glob is unavailable (Node < 22).
 *
 * @param {string} rootDir
 * @returns {Promise<string[]>} absolute paths
 */
async function globTestFiles(rootDir) {
  const patterns = [
    'hooks/*-test.js',
    'mcp/*-test.mjs',
    'scripts/*-test.mjs',
  ];

  // node:fs/promises glob is available from Node 22+.
  // For Node 20 compatibility, fall back to a manual readdir approach.
  const results = [];

  for (const pattern of patterns) {
    try {
      // Try the native glob first (Node 22+)
      // @ts-ignore — glob may not exist on older Node typings
      const matches = glob(pattern, { cwd: rootDir });
      for await (const match of matches) {
        results.push(join(rootDir, match));
      }
    } catch {
      // Fall back to manual approach if glob throws (Node < 22)
      const matched = await globFallback(rootDir, pattern);
      results.push(...matched);
    }
  }

  return results;
}

/**
 * Manual glob fallback for Node < 22.
 * Only handles the simple `<dir>/*-test.<ext>` patterns used in globTestFiles.
 *
 * @param {string} rootDir
 * @param {string} pattern  e.g. 'scripts/*-test.mjs'
 * @returns {Promise<string[]>}
 */
async function globFallback(rootDir, pattern) {
  const { readdir } = await import('node:fs/promises');
  const parts = pattern.split('/');
  if (parts.length !== 2) return [];
  const [dir, filePattern] = parts;
  const dirPath = join(rootDir, dir);

  let entries;
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }

  // Convert the glob pattern to a regex: replace * with [^/]*
  const regexStr = '^' + filePattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$';
  const re = new RegExp(regexStr);

  return entries
    .filter(e => re.test(e))
    .map(e => join(rootDir, dir, e));
}

/**
 * Build the impact map: canonical source path → [absolute test file paths].
 * Globs hooks/*-test.js, mcp/*-test.mjs, scripts/*-test.mjs under rootDir.
 * Reads each with parseCovers and accumulates the reverse map.
 *
 * @param {string} rootDir - project root (absolute path)
 * @returns {Promise<Record<string, string[]>>}
 */
export async function buildCoversMap(rootDir) {
  const testFiles = await globTestFiles(rootDir);
  /** @type {Record<string, string[]>} */
  const map = {};

  await Promise.all(
    testFiles.map(async (testFile) => {
      let content;
      try {
        content = await readFile(testFile, 'utf8');
      } catch {
        return; // unreadable — skip silently
      }

      const { covered } = parseCovers(content);
      for (const srcPath of covered) {
        if (!map[srcPath]) {
          map[srcPath] = [];
        }
        map[srcPath].push(testFile);
      }
    }),
  );

  return map;
}
