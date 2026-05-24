'use strict';
// Shared preflight helpers — used by hooks/mcp-deps-install.js and
// scripts/forge-observer.mjs to detect and self-heal missing direct deps.
//
// CJS module so it can be require()'d from both CommonJS hooks and ESM
// scripts (via createRequire).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveNpmTimeout() {
  return parseInt(process.env.FORGE_NPM_INSTALL_TIMEOUT_MS || '600000', 10);
}

// Builds a runNpm function using the resolved Node installation's bundled
// npm-cli.js. Falls back to bare `npm` only if npm-cli.js is not found.
// Using the bundled npm-cli.js means callers do not need bare `npm` on PATH —
// important for the observer's standalone launch path, where the SessionStart
// hook has not run yet and the user's shell PATH may not include the Node bin.
function makeNpmRunner() {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const hasNpmCli = fs.existsSync(npmCli);
  if (!hasNpmCli) {
    process.stderr.write('[preflight] npm-cli.js not found at ' + npmCli + ' — falling back to bare npm\n');
  }
  return function runNpm(args, cwd) {
    if (hasNpmCli) {
      execFileSync(process.execPath, [npmCli].concat(args), {
        cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: resolveNpmTimeout(),
      });
    } else {
      execFileSync('npm', args, {
        cwd, stdio: ['ignore', 'ignore', 'inherit'], timeout: resolveNpmTimeout(),
      });
    }
  };
}

/**
 * Checks whether all direct dependencies declared in the given package.json
 * are present (directory + package.json inside) under nodeModulesPath.
 *
 * Returns the first missing dep name, or null if all are healthy.
 *
 * A ghost directory (created by a partial npm install interrupted by EPERM or
 * network failure on Windows) passes the existsSync(dir) check but lacks a
 * package.json — Node.js would then throw "Cannot find package" at import
 * time. This helper catches that case.
 *
 * Fail-open on any read/parse error — returns null so the caller never blocks
 * on partial corruption.
 *
 * @param {string} packageJsonPath  Absolute path to package.json
 * @param {string} nodeModulesPath  Absolute path to node_modules directory
 * @returns {string | null}
 */
function findMissingDirectDep(packageJsonPath, nodeModulesPath) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (_) {
    return null;
  }
  const deps = pkg && pkg.dependencies ? Object.keys(pkg.dependencies) : [];
  for (const depName of deps) {
    const depDir = path.join(nodeModulesPath, depName);
    if (!fs.existsSync(depDir) || !fs.existsSync(path.join(depDir, 'package.json'))) {
      return depName;
    }
  }
  return null;
}

/**
 * Runs the preflight check for the given forgeCorePath directory.
 * If a missing dep is found, calls runNpm(['install'], forgeCorePath) to
 * self-heal. If npm fails, writes an informative message to stderr and
 * returns the error so the caller can exit with a non-zero code.
 *
 * @param {string} forgeCorePath  Absolute path to packages/forge-core
 * @param {(args: string[], cwd: string) => void} runNpm
 * @returns {{ depName: string | null, error: Error | null }}
 */
function runPreflight(forgeCorePath, runNpm) {
  const packageJsonPath = path.join(forgeCorePath, 'package.json');
  const nodeModulesPath = path.join(forgeCorePath, 'node_modules');
  const depName = findMissingDirectDep(packageJsonPath, nodeModulesPath);
  if (depName === null) {
    return { depName: null, error: null };
  }
  try {
    runNpm(['install'], forgeCorePath);
    return { depName, error: null };
  } catch (err) {
    process.stderr.write(
      '[observer-preflight] failed to install ' + depName + ' in ' + forgeCorePath +
      ': run `npm install` in ' + forgeCorePath + '\n',
    );
    return { depName, error: err };
  }
}

module.exports = { findMissingDirectDep, runPreflight, makeNpmRunner, resolveNpmTimeout };
