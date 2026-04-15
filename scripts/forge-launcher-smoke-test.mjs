#!/usr/bin/env node
// Smoke test: bin/forge.js launcher must exist, point at the wrapper, and
// successfully delegate. The launcher is the stable user-facing entry point;
// this guards against four kinds of regression:
//   1. Launcher file deleted or unparseable
//   2. Wrapper target path drift (rename without launcher update)
//   3. Windows shim missing/broken
//   4. package.json bin entry drift
//
// The interactive blessed path can't be tested from the harness — same TTY
// limitation as the wrapper smoke test. We verify the non-TTY fallback path
// (which the launcher inherits from the wrapper child via stdio: 'inherit')
// and the static contract pieces (file presence, shebang, content checks).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const LAUNCHER = resolve(PLUGIN_ROOT, 'bin', 'forge.js');
const SHIM = resolve(PLUGIN_ROOT, 'bin', 'forge.cmd');
const PKG_JSON = resolve(PLUGIN_ROOT, 'package.json');
const WRAPPER = resolve(PLUGIN_ROOT, 'scripts', 'forge-wrapper-proto.mjs');

function fail(msg) {
  console.error('[forge-launcher-smoke] FAIL');
  console.error('  ' + msg);
  process.exit(1);
}

async function main() {
  // 1. Launcher exists and has a Node shebang.
  if (!existsSync(LAUNCHER)) fail('bin/forge.js does not exist');
  const launcherSrc = readFileSync(LAUNCHER, 'utf-8');
  if (!launcherSrc.startsWith('#!/usr/bin/env node')) {
    fail('bin/forge.js missing #!/usr/bin/env node shebang');
  }

  // 2. Launcher references the wrapper script path.
  if (!launcherSrc.includes('forge-wrapper-proto.mjs')) {
    fail('bin/forge.js does not reference scripts/forge-wrapper-proto.mjs as its target');
  }

  // 3. Wrapper target file actually exists at the referenced path.
  if (!existsSync(WRAPPER)) fail('wrapper target scripts/forge-wrapper-proto.mjs missing');

  // 4. Windows shim exists and invokes node against forge.js.
  if (!existsSync(SHIM)) fail('bin/forge.cmd Windows shim does not exist');
  const shimSrc = readFileSync(SHIM, 'utf-8');
  if (!/node\s+"%~dp0forge\.js"/.test(shimSrc)) {
    fail('bin/forge.cmd does not invoke `node "%~dp0forge.js"` — got: ' + shimSrc.split('\n').filter(Boolean).slice(-1)[0]);
  }

  // 5. package.json declares the bin entry.
  const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf-8'));
  if (!pkg.bin || pkg.bin.forge !== 'bin/forge.js') {
    fail('package.json bin.forge missing or not pointing at "bin/forge.js" — got: ' + JSON.stringify(pkg.bin));
  }

  // 6. Launcher actually delegates: spawn it in non-TTY mode and verify the
  //    wrapper child fires its non-TTY fallback (exit 0, "not a TTY" stderr).
  //    This proves the launcher → wrapper handoff works end-to-end without
  //    needing a real terminal.
  const proc = spawn(process.execPath, [LAUNCHER], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', d => { stderr += d; });

  const exitCode = await new Promise((r, rej) => {
    const t = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      rej(new Error('launcher did not exit within 5s'));
    }, 5000);
    proc.on('exit', code => { clearTimeout(t); r(code); });
    proc.on('error', err => { clearTimeout(t); rej(err); });
  });

  if (exitCode !== 0) {
    fail('launcher non-TTY delegation: expected exit 0, got ' + exitCode + '. stderr: ' + stderr);
  }
  if (!/not a TTY/i.test(stderr)) {
    fail('launcher non-TTY delegation: expected wrapper "not a TTY" stderr, got: ' + JSON.stringify(stderr));
  }

  console.log('[forge-launcher-smoke] PASS');
  console.log('  bin/forge.js exists with node shebang');
  console.log('  bin/forge.js targets scripts/forge-wrapper-proto.mjs');
  console.log('  bin/forge.cmd Windows shim invokes node against forge.js');
  console.log('  package.json bin.forge → bin/forge.js');
  console.log('  launcher delegated to wrapper, non-TTY fallback fired, exit 0');
}

main().catch(err => {
  console.error('[forge-launcher-smoke] unexpected throw:', err);
  process.exit(1);
});
