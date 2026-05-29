#!/usr/bin/env node
// Regression tests for mcp/lib/config-store.js schema validation.
// Tests validateForgeConfig() directly to keep tests fast and dependency-free.
// Run: node mcp/config-store-test.mjs

import { validateForgeConfig } from './lib/config-store.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log('  PASS  ' + label); passed++; }
  else { console.error('  FAIL  ' + label); failed++; }
}

function assertThrows(fn, containsText, label) {
  try {
    fn();
    console.error('  FAIL  ' + label + ' (did not throw)');
    failed++;
  } catch (e) {
    if (containsText && !e.message.includes(containsText)) {
      console.error('  FAIL  ' + label + ' (threw but wrong message: ' + e.message + ')');
      failed++;
    } else {
      console.log('  PASS  ' + label);
      passed++;
    }
  }
}

const MINIMAL_VALID = {
  providers: [
    { id: 'anthropic', type: 'anthropic', envVar: 'ANTHROPIC_API_KEY', enabled: true, name: 'Anthropic' },
    { id: 'openai',    type: 'openai',    envVar: 'OPENAI_API_KEY',    enabled: false, name: 'OpenAI' },
  ],
  models: [
    { id: 'claude-sonnet-4-6', providerId: 'anthropic', reasoningTier: 'sonnet', capabilities: ['reasoning'] },
  ],
  agentModelMap: {
    planner: { preferred: 'claude-sonnet-4-6', fallback: 'claude-sonnet-4-6', requiredCapabilities: ['reasoning'] },
  },
};

console.log('\n── config-store-test.mjs ────────────────────────────────────────────────');

// 1. Valid minimal config passes
{
  let threw = false;
  try { validateForgeConfig(MINIMAL_VALID, 'test'); } catch { threw = true; }
  assert(!threw, 'valid minimal config: no error');
}

// 2. forge-config.default.json passes validation
{
  const defaultPath = resolve(__dirname, '..', 'forge-config.default.json');
  const defaultConfig = JSON.parse(readFileSync(defaultPath, 'utf-8'));
  let threw = false;
  try { validateForgeConfig(defaultConfig, defaultPath); } catch (e) { threw = true; console.error('  default config error:', e.message); }
  assert(!threw, 'forge-config.default.json: passes validation');
}

// 3. Unknown provider type rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'evil', type: 'malicious', envVar: 'SAFE_KEY', enabled: true }] }, 'test'),
  'unknown type',
  'unknown provider type: rejected'
);

// 4. Malicious envVar with shell metacharacters rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'p1', type: 'openai', envVar: '$(whoami)', enabled: true }] }, 'test'),
  'invalid envVar',
  'envVar with shell injection ($()): rejected'
);

// 5. envVar with path traversal rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'p1', type: 'openai', envVar: '../../etc/passwd', enabled: true }] }, 'test'),
  'invalid envVar',
  'envVar with path traversal: rejected'
);

// 6. Lowercase envVar rejected (must be uppercase)
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'p1', type: 'openai', envVar: 'openai_key', enabled: true }] }, 'test'),
  'invalid envVar',
  'lowercase envVar: rejected'
);

// 7. Non-string envVar rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'p1', type: 'openai', envVar: 42, enabled: true }] }, 'test'),
  'invalid envVar',
  'non-string envVar: rejected'
);

// 8. Empty envVar rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ id: 'p1', type: 'openai', envVar: '', enabled: true }] }, 'test'),
  'invalid envVar',
  'empty envVar: rejected'
);

// 9. Provider missing id rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: [{ type: 'openai', envVar: 'KEY', enabled: true }] }, 'test'),
  'missing "id"',
  'provider missing id: rejected'
);

// 10. providers not an array rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, providers: 'not-array' }, 'test'),
  '"providers" must be an array',
  'providers not array: rejected'
);

// 11. Model missing id rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, models: [{ providerId: 'anthropic' }] }, 'test'),
  'missing "id"',
  'model missing id: rejected'
);

// 12. Model missing providerId rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, models: [{ id: 'my-model' }] }, 'test'),
  'missing "providerId"',
  'model missing providerId: rejected'
);

// 13. agentModelMap value that is not an object rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, agentModelMap: { planner: 'not-an-object' } }, 'test'),
  'must be an object',
  'agentModelMap entry not object: rejected'
);

// 14. agentModelMap that is an array rejected
assertThrows(
  () => validateForgeConfig({ ...MINIMAL_VALID, agentModelMap: [] }, 'test'),
  '"agentModelMap" must be an object',
  'agentModelMap as array: rejected'
);

// 15. Config with no models field (optional) passes
{
  const noModels = { providers: MINIMAL_VALID.providers };
  let threw = false;
  try { validateForgeConfig(noModels, 'test'); } catch { threw = true; }
  assert(!threw, 'config without models field: passes (models is optional)');
}

console.log('');
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
