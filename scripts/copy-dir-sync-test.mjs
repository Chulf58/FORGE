#!/usr/bin/env node
// Tests for copyDirSync in packages/forge-core/src/runs/createWorktree.js.
// Closes 10575378 — worktree creation marks tracked docs as Modified-vs-HEAD
// because copyDirSync overwrites files already checked out by `git worktree
// add`. Fix: support a `skipExisting: true` option that leaves tracked files
// in place (git's exact bytes) and only copies gitignored files (which don't
// exist in the worktree after the initial checkout).
//
// Run: node --test scripts/copy-dir-sync-test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { copyDirSync } from '../packages/forge-core/src/runs/createWorktree.js';

function makeSrcDst(srcContent, dstContent) {
  const root = mkdtempSync(join(tmpdir(), 'copydir-test-'));
  const src = join(root, 'src');
  const dst = join(root, 'dst');
  mkdirSync(src, { recursive: true });
  mkdirSync(dst, { recursive: true });
  if (srcContent !== undefined) writeFileSync(join(src, 'file.txt'), srcContent, 'utf8');
  if (dstContent !== undefined) writeFileSync(join(dst, 'file.txt'), dstContent, 'utf8');
  return { root, src, dst };
}

test('default behavior — copyDirSync overwrites existing destination files', () => {
  const { root, src, dst } = makeSrcDst('SRC\n', 'DST\n');
  try {
    copyDirSync(src, dst);
    assert.equal(readFileSync(join(dst, 'file.txt'), 'utf8'), 'SRC\n',
      'default copyDirSync should overwrite existing files (back-compat)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skipExisting=true — copyDirSync preserves the destination file', () => {
  const { root, src, dst } = makeSrcDst('SRC\n', 'DST\n');
  try {
    copyDirSync(src, dst, { skipExisting: true });
    assert.equal(readFileSync(join(dst, 'file.txt'), 'utf8'), 'DST\n',
      'skipExisting=true should NOT overwrite existing files — closes 10575378 phantom-modification bug');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skipExisting=true — files that DO NOT exist at destination still get copied', () => {
  const { root, src, dst } = makeSrcDst('SRC\n', undefined);
  try {
    copyDirSync(src, dst, { skipExisting: true });
    assert.equal(readFileSync(join(dst, 'file.txt'), 'utf8'), 'SRC\n',
      'skipExisting=true must still copy NEW files (the gitignored-files use case)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skipExisting=true — recurses into subdirectories preserving the flag', () => {
  const root = mkdtempSync(join(tmpdir(), 'copydir-test-rec-'));
  try {
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    mkdirSync(join(src, 'sub'), { recursive: true });
    mkdirSync(join(dst, 'sub'), { recursive: true });
    // src/sub/keep.txt has "SRC"; dst/sub/keep.txt has "DST" — should be kept
    // src/sub/new.txt has "SRC"; dst/sub/new.txt does NOT exist — should be copied
    writeFileSync(join(src, 'sub', 'keep.txt'), 'SRC\n', 'utf8');
    writeFileSync(join(dst, 'sub', 'keep.txt'), 'DST\n', 'utf8');
    writeFileSync(join(src, 'sub', 'new.txt'), 'SRC\n', 'utf8');
    copyDirSync(src, dst, { skipExisting: true });
    assert.equal(readFileSync(join(dst, 'sub', 'keep.txt'), 'utf8'), 'DST\n',
      'subdirectory preserved-file behavior');
    assert.equal(readFileSync(join(dst, 'sub', 'new.txt'), 'utf8'), 'SRC\n',
      'subdirectory new-file behavior');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
