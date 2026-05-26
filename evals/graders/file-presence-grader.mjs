// Checks that named artifact paths exist on disk.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} baseDir - base directory to resolve relative paths against
 * @param {string[]} paths - relative file paths to check
 * @returns {{ ok: boolean, present: string[], missing: string[] }}
 */
export function gradeFilePresence(baseDir, paths) {
  const present = paths.filter((p) => existsSync(join(baseDir, p)));
  const missing = paths.filter((p) => !existsSync(join(baseDir, p)));
  return { ok: missing.length === 0, present, missing };
}
