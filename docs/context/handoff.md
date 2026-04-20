# Handoff: Wire model routing end-to-end

## Summary
Add a `family` field to `recommendModel` output and update 5 skill files to pass `family` (not `modelId`) to `Agent` dispatch.

## Files to modify
### `mcp/lib/router.js`
**Change:** Add `family` field derived from modelId to every return path.

**Find:**
```js
  // Priority 0: capability-cost routing — primary path for all agents.
```

**Replace with:**
```js
  /**
   * Extracts the Agent-tool-compatible short family name from a model ID.
   * Returns null if the pattern does not match (non-Anthropic or unknown format).
   * Examples: 'claude-sonnet-4-6' → 'sonnet', 'claude-opus-4-6' → 'opus',
   *           'claude-haiku-4-5-20251001' → 'haiku'
   */
  function extractFamily(modelId) {
    if (!modelId) return null;
    const m = modelId.match(/^claude-([a-z]+)-/);
    if (!m) return null;
    const name = m[1];
    if (name === 'sonnet' || name === 'opus' || name === 'haiku') return name;
    return null;
  }

  // Priority 0: capability-cost routing — primary path for all agents.
```

**Find:**
```js
      const chosen = capCandidates[0];
      return {
        modelId: chosen.id,
        providerId: chosen.providerId,
        source: 'capability-cost',
        reason: `Most-minimal-match available model in [${providerScope.join(', ')}] satisfying [${requiredCaps.join(', ')}]`,
      };
```

**Replace with:**
```js
      const chosen = capCandidates[0];
      return {
        modelId: chosen.id,
        providerId: chosen.providerId,
        family: chosen.providerId === 'anthropic' ? extractFamily(chosen.id) : null,
        source: 'capability-cost',
        reason: `Most-minimal-match available model in [${providerScope.join(', ')}] satisfying [${requiredCaps.join(', ')}]`,
      };
```

**Find:**
```js
    // No match — fail explicitly; capability requirements are hard constraints
    return {
      modelId: null,
      providerId: null,
      source: 'error',
      reason: `No available model found with capabilities [${requiredCaps.join(', ')}] in scope [${providerScope.join(', ')}] for agent "${agentName}"`,
    };
```

**Replace with:**
```js
    // No match — fail explicitly; capability requirements are hard constraints
    return {
      modelId: null,
      providerId: null,
      family: null,
      source: 'error',
      reason: `No available model found with capabilities [${requiredCaps.join(', ')}] in scope [${providerScope.join(', ')}] for agent "${agentName}"`,
    };
```

**Find:**
```js
  // Priority 1: hardcoded default — safety net for agents with no requirements.
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    source: 'default',
    reason: 'No routing requirements declared; using hardcoded default',
  };
```

**Replace with:**
```js
  // Priority 1: hardcoded default — safety net for agents with no requirements.
  return {
    modelId: DEFAULT_MODEL,
    providerId: DEFAULT_PROVIDER,
    family: extractFamily(DEFAULT_MODEL),
    source: 'default',
    reason: 'No routing requirements declared; using hardcoded default',
  };
```

### `skills/apply/SKILL.md`
**Change:** Replace `model=<modelId>` with `model=<family>` and clarify fallback covers null family.

**Find:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.
```

**Replace with:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.
```

### `skills/implement/SKILL.md`
**Change:** Replace `model=<modelId>` with `model=<family>` and clarify fallback covers null family.

**Find:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.
```

**Replace with:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.
```

### `skills/debug/SKILL.md`
**Change:** Replace `model=<modelId>` with `model=<family>` and clarify fallback covers null family.

**Find:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.
```

**Replace with:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.
```

### `skills/plan/SKILL.md`
**Change:** Replace `model=<modelId>` with `model=<family>` and clarify fallback covers null family.

**Find:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.
```

**Replace with:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.
```

### `skills/refactor/SKILL.md`
**Change:** Replace `model=<modelId>` with `model=<family>` and clarify fallback covers null family.

**Find:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<modelId>)`
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error): fall back to the agent's frontmatter `model:` field via `Agent`.
```

**Replace with:**
```markdown
3. Dispatch based on `providerId`:
   - **`"anthropic"`** → invoke via `Agent(subagent_type=<agent>, model=<family>)` where `family` is the short name returned by the recommendation (`sonnet`, `opus`, or `haiku`). If `family` is `null`, fall back to the agent's frontmatter `model:` field.
   - **any other provider** → read `agents/<agent>.md` (extract body after the closing `---` frontmatter line), assemble required context (plan/handoff content the agent needs), call `forge_call_external(providerId=<providerId>, modelId=<modelId>, prompt=<assembled prompt>, maxTokens=8192)`, treat the text response as the agent's output
4. If `forge_get_model_recommendation` is unavailable (MCP error) or `family` is `null`: fall back to the agent's frontmatter `model:` field via `Agent`.
```

## Verification
pre-flight clean

## Doc hints
arch-update: false
decision: false
