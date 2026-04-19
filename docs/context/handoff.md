# Handoff: Add gitIntegration to ALLOWED_CONFIG_KEYS

## Summary
Add `"gitIntegration"` to the `ALLOWED_CONFIG_KEYS` array in `mcp/server.js` so `forge_update_config` accepts the git integration config key.

## Files to modify
### `mcp/server.js`
**Change:** Add `"gitIntegration"` to the allowed config keys array.

**Find:**
```js
const ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand"];
```

**Replace with:**
```js
const ALLOWED_CONFIG_KEYS = ["pipelineMode", "techStacks", "techStackLabels", "description", "testCommand", "gitIntegration"];
```

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
