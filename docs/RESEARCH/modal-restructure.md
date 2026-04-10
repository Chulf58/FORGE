# Research: Modal Restructure — Agent Management Distribution

## Q1: Is `appRoot` available at handler registration time?

`appRoot` is already the second parameter of `agentsHandlers.register(ipcMain, appRoot)` (index.ts line 99). The agents handler `register` function already accepts `appRoot: string` (agents.ts line 9) and uses it in the `sync-agents` handler. **No signature change needed** — add `list-forge-agents` directly inside the existing register body.

## Q2: Does anything outside the three deleted files import `AgentEntry`?

No. `AgentEntry` is only referenced in `AgentModal.svelte` (definition), `AgentEditorPane.svelte` (import), and `AgentListPane.svelte` (import) — all three are being deleted. Safe to promote to `claude.d.ts`.

```ts
interface AgentEntry {
  filename: string
  name: string
  model: string
  description: string
  isScaffold: boolean
}
```

## Q3: Pipeline stage lookup for FORGE AGENTS tab

`AGENT_META` has no stage field. `PIPELINES` is the wrong direction (pipeline → agents, not agent → stage). Define `FORGE_AGENT_STAGES` as an inline record in `SettingsModal.svelte`:

| Filename | Stage |
|---|---|
| `planner.md` | Plan |
| `researcher.md` | Plan |
| `gotcha-checker.md` | Plan |
| `coder.md` | Implement |
| `reviewer.md` | Review |
| `reviewer-safety.md` | Review |
| `reviewer-logic.md` | Review |
| `reviewer-style.md` | Review |
| `reviewer-performance.md` | Review |
| `reviewer-triage.md` | Review |
| `implementer.md` | Apply |
| `tester.md` | Apply |
| `documenter.md` | Apply |
| `debug.md` | Debug |
| `refactor.md` | Refactor |
| `architect.md` | Architect |
| `integrity-checker.md` | Utility |
| `nyquist-auditor.md` | Utility |
| `skills-generator.md` | Utility |
| `tool-call-auditor.md` | Utility |

Note: `agent-optimizer.md` is on disk but NOT in `SCAFFOLD_AGENT_NAMES` — exclude from FORGE AGENTS tab.
