## Planner

### Power Automate

- Flows are JSON-based packages (`.zip`) following the Azure Logic Apps 2016-06-01 schema. Plan tasks at the flow level, not the action level.
- Connection references have two layers: the stable connector api name (e.g. `shared_sharepointonline`) and the environment-specific `connectionName` GUID. Only the api name is portable — plan tasks must not assume a specific connectionName will exist in the target environment.
- Business-data values (SharePoint site URLs, list names/GUIDs, Dataverse entity names) are environment-specific. Plan tasks must include a step to gather these from the user or leave explicit placeholders.
- The non-solution `.zip` package format and the solution XML format are incompatible — plan which format the feature targets before writing any tasks.
- The `Http` built-in action type is Premium in Power Automate. If the feature uses HTTP fetches against external URLs, note the Premium license requirement in the plan.

## Coder

### Power Automate

- Package structure: `manifest.json` at zip root + `Microsoft.Flow/flows/<UUID>/definition.json`. The UUID folder name must match the flow resource key in `manifest.json`.
- `definition.json` uses the Logic Apps 2016-06-01 schema. Always include `$schema`, `contentVersion: "1.0.0.0"`, and the standard `$connections`/`$authentication` parameters block.
- Actions are a keyed object (not array). Execution order is controlled by `runAfter`. The first action after the trigger has `"runAfter": {}`.
- For each `OpenApiConnection` action, three things must align: (1) `inputs.host.connectionName` in the action, (2) the key in `connectionReferences`, and (3) a matching connection instance entry in `manifest.json`.
- The `Http` built-in action (`type: "Http"`) requires no `connectionReferences` entry and no `manifest.json` entry — it is self-contained.
- UUIDs in `manifest.json` resource keys are arbitrary cross-reference IDs; use `crypto.randomUUID()` for all of them. The flow folder UUID must match the flow resource key.
- `operationMetadataId` inside action `metadata` blocks is optional and can be omitted.
- `configurableBy: "User"` on connection instance entries in `manifest.json` is what surfaces the connection-remapping prompt in the import wizard — it must be present for every connector the user must authenticate.

## Implementer

### Power Automate

- When writing `definition.json`, actions must reference `connectionName` values that exactly match the keys in `connectionReferences` — a mismatch silently breaks the flow at runtime.
- All `OpenApiConnection` actions must include `"authentication": "@parameters('$authentication')"` in `inputs`.
- `runAfter` status values are: `"Succeeded"`, `"Failed"`, `"Skipped"`, `"TimedOut"`. Multiple statuses can be combined.
- `source` parameter in Excel Online (Business) actions expects a SharePoint site URL — not the full document path. The `file` parameter is the path from the document library root.
- Recurrence trigger: use `"AUS Western Standard Time"` for Perth, `"AUS Eastern Standard Time"` for Sydney/Melbourne. The trigger name (key in `triggers`) becomes the dependency label for the first action's `runAfter`.
- Zip generation must produce a valid binary zip. Use `archiver` or `jszip` — do not try to construct raw zip bytes manually.

## Tester

### Power Automate

- Validate that every `OpenApiConnection` action's `inputs.host.connectionName` matches a key in `connectionReferences`. A mismatch is a silent runtime failure.
- Validate that every connector used in an `OpenApiConnection` action has two entries in `manifest.json` resources: one `Microsoft.PowerApps/apis` entry and one `Microsoft.PowerApps/apis/connections` entry.
- Validate that the flow folder UUID in `Microsoft.Flow/flows/<UUID>/` matches the flow resource key in `manifest.json`.
- Validate that all `runAfter` references name existing actions (no dangling references).
- Check that `type: "Http"` actions have no `connectionReferences` entry — they are self-contained.

---

## Reviewer

### Verdict signal

After completing all checks, emit the verdict signal as the **last line** of your response:

`[reviewer-verdict] {"agent":"<your-agent-name>","verdict":"<APPROVED|BLOCK|REVISE>","blockers":<N>,"warnings":<N>,"feature":"<feature name>"}`

- `verdict`: `APPROVED` (no issues), `REVISE` (minor issues, gate proceeds), or `BLOCK` (hard blockers, gate disabled)
- `blockers`: integer count of BLOCK-level findings; 0 if APPROVED
- `warnings`: integer count of REVISE-level findings; 0 if APPROVED or BLOCK
- `feature`: taken verbatim from the feature name heading in your review output
- Each reviewer emits its own signal independently; do not aggregate other reviewers' verdicts

---

## Tool-call-auditor

- After completing your audit and emitting any findings, emit the following as the **last line** of your output:
  `[pipeline-summary] mode=<apply-pipeline-mode> verdict=N/A`
- If agent-optimizer is triggered (recurring deviation found), do **not** emit `[pipeline-summary]` — that becomes agent-optimizer's responsibility after it presents its proposed changes.
- Never emit `[pipeline-summary]` more than once per run.
