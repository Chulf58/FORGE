# Research: Power Automate Cloud Flow Package Format

> Goal: determine whether Claude can generate a valid, importable Power Automate flow package from scratch, or whether environment-specific values make that impractical.

---

## Question 1: What files are inside an exported Power Automate flow .zip package?

**Finding:**

A non-solution flow exported as `.zip` ("Import Package (Legacy)") has this layout:

```
FlowName_Timestamp.zip
├── manifest.json
├── connections.json          (optional — sometimes absent)
└── Microsoft.Flow/
    └── flows/
        └── <FlowGUID>/       (a UUID, e.g. 850217b0-90b7-4519-82c6-217b583eca01)
            ├── definition.json
            └── flow.json     (optional metadata, sometimes absent)
```

A solution export (the recommended ALM path) produces a larger zip with `customizations.xml`, `[Content_Types].xml`, and a `Workflows/` folder containing the flow JSON. The two formats are **incompatible** — a non-solution package cannot be imported as a solution and vice versa.

**Source:**
- edvaldoguimaraes.com — "Editing Power Automate Export Packages" (2025)
- GitHub OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates (real exported template structure)
- [Microsoft Learn: Export and import a non-solution flow](https://learn.microsoft.com/en-us/power-automate/export-import-flow-non-solution)

**Recommendation:** Any generated package must reproduce this exact folder/file structure, including a real UUID as the flow folder name.

---

## Question 2: What does the flow definition JSON look like?

**Finding:**

`definition.json` (inside the flow GUID folder) is the core of the package. It is human-readable, logically structured JSON. The top-level `clientdata` string (when accessing flows via the Dataverse API) or the unwrapped definition file contains:

```json
{
  "properties": {
    "connectionReferences": {
      "shared_sharepointonline": {
        "connectionName": "shared-sharepointonl-594ec2f7-b783-4358-8a34-901d2cf18e0e",
        "source": "Invoker",
        "id": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
        "tier": "NotSpecified"
      }
    },
    "definition": {
      "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
      "contentVersion": "1.0.0.0",
      "parameters": {
        "$connections": { "defaultValue": {}, "type": "Object" },
        "$authentication": { "defaultValue": {}, "type": "SecureObject" }
      },
      "triggers": {
        "manual": {
          "type": "Request",
          "kind": "Button",
          "inputs": { "schema": { "type": "object", "properties": {}, "required": [] } }
        }
      },
      "actions": {
        "List_rows": {
          "runAfter": {},
          "type": "OpenApiConnection",
          "inputs": {
            "host": {
              "apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps",
              "connectionName": "shared_commondataserviceforapps",
              "operationId": "ListRecords"
            },
            "parameters": { "entityName": "accounts", "$select": "name", "$top": 1 },
            "authentication": "@parameters('$authentication')"
          }
        }
      }
    }
  },
  "schemaVersion": "1.0.0.0"
}
```

Key structural facts:
- Actions are an **object** (not an array), keyed by action name (spaces replaced with `_`).
- Execution order is controlled by `runAfter` — the first action has `"runAfter": {}`, subsequent actions list the name(s) they depend on.
- The schema is the Azure Logic Apps schema (2016-06-01); Power Automate is built on Logic Apps.
- `operationMetadataId` (a UUID inside `metadata`) is **optional** — it was added later and can be omitted entirely without breaking the flow.
- The February 2022 export format change made definition JSON multi-line and human-readable (previously single-line).

**Source:**
- [Microsoft Learn: Work with cloud flows using code](https://learn.microsoft.com/en-us/power-automate/manage-flows-with-code) — contains full working example
- [DEV Community: Understanding the Power Automate Definition](https://dev.to/wyattdave/understanding-the-power-automate-definition-42po)
- [PnP Blog: Flows — The Inner Workings](https://pnp.github.io/blog/post/flows-inner-workings-dissecting-power-automate-flows/)

**Recommendation:** The definition JSON is genuinely Claude-generatable. The action structure is logical and the schema is publicly documented. The `operationMetadataId` UUID inside each action's `metadata` block can safely be omitted (or generated with `crypto.randomUUID()`).

---

## Question 3: What are "connection references" — environment-specific or templatable?

**Finding:**

Connection references come in two distinct layers:

**Layer 1 — The connector type** (fully portable, not environment-specific):
```json
"api": { "name": "shared_sharepointonline" }
```
These are stable string identifiers like `shared_sharepointonline`, `shared_office365`, `shared_commondataserviceforapps`. They are the same across all tenants and environments — essentially the connector catalogue ID.

**Layer 2 — The actual connection instance** (environment-specific):
```json
"connectionName": "shared-sharepointonl-594ec2f7-b783-4358-8a34-901d2cf18e0e"
```
This is the GUID-based name of a specific authenticated connection that exists in the user's environment. It is created when a user authenticates a connector and is unique per environment.

**During import of a package**, the user is prompted to either:
- Select an existing connection from their environment, OR
- Create a new connection on the spot.

The import UI replaces the `connectionName` in the package with the user's actual connection. This means **the `connectionName` value in the exported package does not need to be valid in the destination environment** — the import wizard handles remapping.

For solution-based flows, connection references use a `connectionReferenceLogicalName` (a stable solution-level identifier) instead of the raw connection GUID, which is even cleaner for ALM.

**Source:**
- [DEV Community: Understanding the Power Automate Definition](https://dev.to/wyattdave/understanding-the-power-automate-definition-42po)
- [Microsoft Learn: Pre-populate connection references for automated deployments](https://learn.microsoft.com/en-us/power-platform/alm/conn-ref-env-variables-build-tools)
- GitHub OfficeDev template manifest.json (real package showing connection structure)

**Recommendation:** When generating a package, Claude should use the correct `api.name` for the connector type (these are stable, well-documented strings), and can use a placeholder `connectionName` value. The import wizard will prompt the user to select a real connection. The `configurableBy: "User"` flag in `manifest.json` signals which connections the user must configure.

---

## Question 4: Are there GUIDs or IDs throughout the definition that must match the user's environment?

**Finding:**

There are several categories of values, with very different portability:

| Value | Location | Environment-specific? | Notes |
|---|---|---|---|
| Flow GUID | zip folder name `Microsoft.Flow/flows/<UUID>/` and `manifest.json` resources key | No — assigned on import | A new UUID is generated when imported as "Create as new" |
| `operationMetadataId` | Each action's `metadata` block | No | Optional, can be omitted or any UUID |
| `connectionName` | `connectionReferences[].connectionName` | Yes — BUT remapped at import | Import wizard replaces with user's connection |
| `api.name` / `apiId` | `host.apiId` and `connectionReferences[].id` | No — stable catalogue IDs | e.g. `/providers/Microsoft.PowerApps/apis/shared_sharepointonline` |
| `operationId` | `host.operationId` | No — stable operation names | e.g. `GetItems`, `ListRecords`, `SendEmailV2` |
| SharePoint `dataset` (site URL) | Action `parameters.dataset` | Yes — tenant-specific URL | Must be updated for target environment |
| SharePoint `table` (list GUID or name) | Action `parameters.table` | Yes — list GUID or internal name | Must be set to target list |
| Dataverse entity names | Action `parameters.entityName` | Partially — standard entity names are portable; custom entity names are not | |
| `packageTelemetryId` in manifest | `manifest.json details` | No | Any UUID, just telemetry |

**The critical insight**: Most GUIDs in the flow definition are either:
1. Generated fresh on import (flow GUID), OR
2. Remapped interactively by the user (connection names), OR
3. Stable catalogue IDs that are the same across all tenants (api names, operationIds)

The only values that genuinely require target-environment knowledge are business-data references: **SharePoint site URLs**, **list names/GUIDs**, **Dataverse entity names**, and similar data-layer identifiers.

**Source:**
- [Microsoft Learn: Work with cloud flows using code](https://learn.microsoft.com/en-us/power-automate/manage-flows-with-code)
- [DEV Community: Creating a Power Automate Flow in Code](https://dev.to/wyattdave/creating-a-power-automate-flow-in-code-29pk)
- edvaldoguimaraes.com — "Editing Power Automate Export Packages"

**Recommendation:** Claude can generate all GUIDs (flow folder UUID, operationMetadataId) as fresh `crypto.randomUUID()` values. The connector catalogue IDs (`shared_sharepointonline` etc.) must be from the real catalogue — these are well-documented and Claude knows them. Business-data values (site URLs, list names) must be templated as placeholders or gathered from the user upfront.

---

## Question 5: Can a flow package be imported into a different tenant/environment from where it was exported?

**Finding:**

**Yes, with manual steps.** Cross-tenant and cross-environment import works as follows:

1. The package zip is uploaded via **My Flows > Import > Import Package (Legacy)**.
2. The import wizard surfaces every connection reference and asks the user to select or create a connection.
3. Any hardcoded business-data URLs (SharePoint site URLs, list names, Teams channel IDs) inside action parameters **are not remapped automatically** — the user must manually edit those action parameters after import, or they must have been made generic in the definition.
4. HTTP-triggered flows get a **new trigger URL** after import — callers must be updated.
5. All imported flows start in **Draft (Off)** state and must be manually enabled.

**Cross-tenant specific issues:**
- Connections themselves are never exported — only the connector type is recorded.
- After import, all connections must be re-authenticated in the destination tenant.
- Security group memberships, sharing, and co-ownership do not transfer.
- Flows that reference tenant-specific resources (specific SharePoint sites, specific Teams teams/channels, Dataverse tables in a managed solution) will error on first run until those parameters are updated.

**Source:**
- [Microsoft Learn: Tenant-to-tenant migrations](https://learn.microsoft.com/en-us/power-platform/admin/move-environment-tenant)
- [Microsoft Learn: Export and import a non-solution flow](https://learn.microsoft.com/en-us/power-automate/export-import-flow-non-solution)
- Community forum findings (multiple sources confirm connection re-authentication requirement)

**Recommendation:** A Claude-generated package is actually in a better position than a real export for cross-environment use: since connections start as placeholders and the import wizard always remaps them, there's no legacy connection to confuse. The key risk is hardcoded business-data values in action parameters — Claude should either leave these as obvious placeholders (`"<YOUR_SHAREPOINT_SITE_URL>"`) or collect them from the user before generation.

---

## Question 6: Is there an alternative to the .zip package format?

**Finding:**

There are three alternative approaches, each with tradeoffs:

**A. Dataverse Web API (POST to `workflows` table)**

The most programmatic approach. You POST a JSON body directly to the Dataverse Web API:

```http
POST https://<org>.api.crm.dynamics.com/api/data/v9.2/workflows
Content-Type: application/json

{
  "category": 5,
  "name": "My Flow Name",
  "type": 1,
  "primaryentity": "none",
  "clientdata": "{\"properties\":{\"connectionReferences\":{...},\"definition\":{...}}}"
}
```

The `clientdata` field is a **string-encoded JSON** (the entire flow properties JSON, JSON.stringified). This creates the flow in Draft state. The flow must then be activated separately.

This approach bypasses the zip package entirely. It requires:
- Dataverse Web API access (OAuth token for the target org)
- The user to have an environment with Dataverse (solutions-capable environments)
- The flow is created in "My Flows" by default unless placed in a solution

**B. Solution XML export**

Flows in solutions are stored as JSON files in a `Workflows/` folder inside the solution zip. The JSON there is the expanded `clientdata` (not double-encoded). This is the Microsoft-recommended ALM path but requires the flow to be solution-aware.

**C. Power Platform CLI (`pac flow`)**

The `pac` CLI can export/import flows and generate deployment settings files (`pac solution create-settings`). This is a DevOps tool, not useful for end-user delivery.

**D. "Send a Copy" (UI only)**

A UI feature that emails a copy of the flow to another user. Not programmable, requires both parties to be logged in.

**The api.flow.microsoft.com REST API is officially unsupported** — Microsoft explicitly states customers should use the Dataverse Web APIs instead.

**Source:**
- [Microsoft Learn: Work with cloud flows using code](https://learn.microsoft.com/en-us/power-automate/manage-flows-with-code)
- [Microsoft Learn: Pre-populate connection references](https://learn.microsoft.com/en-us/power-platform/alm/conn-ref-env-variables-build-tools)

**Recommendation:** For Claude generating a deliverable, the `.zip package` is the most accessible format — any Power Automate user can import it without needing API access or developer credentials. The Dataverse Web API approach is more powerful but requires OAuth setup. Recommend generating the `.zip` package format as primary output, with optional instructions for the API path for technical users.

---

## Question 7: What does Microsoft document about the flow package schema / ALM?

**Finding:**

Microsoft's official documentation covers:

1. **Schema**: The flow definition follows the [Azure Logic Apps Workflow Definition Language schema](https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json) (`2016-06-01`). This is publicly documented with full JSON schema.

2. **ALM recommendation**: Microsoft explicitly recommends using **solutions** (not the legacy package format) for all ALM scenarios: *"For application lifecycle management (ALM) capabilities in Microsoft Power Platform environments, use Microsoft Dataverse and solutions instead of the package export and import."*

3. **Dataverse workflow table**: The `workflow` entity in Dataverse stores flows with category `5` (Modern Flow). The `clientdata` column holds the entire flow definition as a stringified JSON.

4. **Deployment settings file**: For automated CI/CD, a `deploymentSettings.json` specifies `ConnectionReferences` (with `LogicalName`, `ConnectionId`, `ConnectorId`) and `EnvironmentVariables`. This is generated by `pac solution create-settings`.

5. **Connection reference ALM pattern**:
   - `LogicalName`: stable identifier used in solution (e.g. `tst_SharepointSiteURL`) — the key used inside flow actions
   - `ConnectionId`: environment-specific GUID of the actual authenticated connection
   - `ConnectorId`: stable catalogue path (e.g. `/providers/Microsoft.PowerApps/apis/shared_sharepointonline`)

   On import into a new environment, `LogicalName` and `ConnectorId` come from the solution; only `ConnectionId` must be provided for the target environment.

**Source:**
- [Microsoft Learn: Work with cloud flows using code](https://learn.microsoft.com/en-us/power-automate/manage-flows-with-code)
- [Microsoft Learn: Export and import a non-solution flow](https://learn.microsoft.com/en-us/power-automate/export-import-flow-non-solution)
- [Microsoft Learn: Pre-populate connection references and environment variables](https://learn.microsoft.com/en-us/power-platform/alm/conn-ref-env-variables-build-tools)
- [Azure Logic Apps Workflow Definition Language](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-definition-language)

---

## Summary Verdict: Can Claude generate a valid importable flow?

**Yes, with important caveats.**

### What Claude CAN generate reliably

- The complete zip package structure (`manifest.json`, `Microsoft.Flow/flows/<UUID>/definition.json`)
- A valid `manifest.json` with correct resource entries for each connector type used
- A valid flow `definition.json` with:
  - Correct trigger types (`Request/Button`, `Recurrence`, `OpenApiConnection`)
  - Correct action structure (`runAfter`, `type`, `inputs.host`, `inputs.parameters`)
  - Correct `api.name` and `operationId` values (stable catalogue identifiers, Claude knows these)
  - Correct `connectionReferences` structure with placeholder `connectionName` values (remapped at import)
  - Optional `operationMetadataId` UUIDs (can be omitted or randomly generated)
- A working zip binary (Node.js `archiver` or `JSZip` library)

### What Claude CANNOT generate without user input

- **SharePoint site URLs** — tenant-specific (`https://<tenant>.sharepoint.com/sites/<site>`)
- **List names / GUIDs** — environment-specific internal identifiers
- **Dataverse table names** — if using custom tables (standard table names like `accounts`, `contacts` are portable)
- **Teams team/channel IDs** — tenant-specific GUIDs
- **Email addresses** used as hardcoded recipients

### What the user must do manually after import

1. At import time: select or create connections in the import wizard (2–5 minutes, unavoidable)
2. If placeholder values were left in action parameters: navigate to each step and update them in the designer
3. Enable the flow (all imports start as Draft/Off)
4. For HTTP-triggered flows: update callers with the new trigger URL

### Practical assessment

A Claude-generated flow package is **genuinely importable** and **functionally equivalent** to a real export for the import wizard. The connection remapping step is unavoidable for any import (even real exports from the same tenant require this). The only real gap is business-data values (site URLs, list names) — if Claude collects these from the user upfront or uses clear placeholders, the resulting package imports cleanly and runs correctly after the user configures connections.

The `.zip package` format is simpler to generate than the solution format and is supported by all Power Automate environments (no Dataverse required). It is the recommended output format for a tool generating flows for non-developer end users.

**Bottom line: Claude can generate a valid importable `.zip` flow package. It cannot be fully zero-touch (connection remapping in the import wizard is a Microsoft platform requirement), but the import experience will be the same as importing any real exported flow.**

---

## Deep Dive 1: Full Flow Definition Schema (2016-06-01)

**Finding:**

The official schema URL is:
```
https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#
```

This is the Azure Logic Apps Workflow Definition Language schema. Power Automate is built on top of Logic Apps and uses this same schema for all flow definitions.

### Top-level `definition` object structure

| Field | Required | Type | Description |
|---|---|---|---|
| `$schema` | Yes (when external) | string | The schema URL above |
| `contentVersion` | No | string | Always `"1.0.0.0"` |
| `triggers` | No | object | Keyed by trigger name; max 10 |
| `actions` | No | object | Keyed by action name; max 250 |
| `parameters` | No | object | Parameter definitions |
| `outputs` | No | object | Output definitions; max 10 |
| `staticResults` | No | object | Mock outputs for testing |

### `parameters` section (always present in Power Automate flows)

Power Automate flows always include these two standard parameters:

```json
"parameters": {
  "$connections": { "defaultValue": {}, "type": "Object" },
  "$authentication": { "defaultValue": {}, "type": "SecureObject" }
}
```

`$authentication` is used by all `OpenApiConnection` actions: `"authentication": "@parameters('$authentication')"`.

### `triggers` section

Each trigger is an object keyed by a name (e.g. `"manual"`, `"Recurrence"`). The trigger name becomes the `runAfter` dependency key for the first action. The name can be anything — it does not affect functionality.

### `actions` section

Each action is keyed by its display name with spaces replaced by `_`. Action names must be unique within the flow. The `runAfter` field controls execution order. An empty `"runAfter": {}` means "run first" (immediately after the trigger fires).

### `runAfter` field

```json
"runAfter": {
  "Previous_Action_Name": ["Succeeded"]
}
```

Valid status values: `"Succeeded"`, `"Failed"`, `"Skipped"`, `"TimedOut"`. Multiple statuses can be listed. Multiple dependencies can be declared (all must satisfy their conditions for the action to run).

### `operationMetadataId` field

```json
"metadata": {
  "operationMetadataId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

This UUID field is **optional**. It appears in every action's `metadata` block in real exports but has no functional effect. It can be omitted entirely, or any valid UUID can be used.

**Source:**
- [Microsoft Learn: Workflow Definition Language schema reference](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-definition-language)
- [Microsoft Learn: Workflow triggers and actions](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-actions-triggers)

**Recommendation:** Always include `$schema` and `contentVersion`. Always include `$connections` and `$authentication` parameters. Omit `operationMetadataId` for cleanliness — it is not validated on import.

---

## Deep Dive 2: manifest.json Format

**Finding:**

The `manifest.json` file at the root of the zip package contains global metadata and declares all connectors the flow depends on. A real example from the Microsoft Teams Shifts Power Automate Templates repository (OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates) shows the complete structure:

```json
{
  "schema": "1.0",
  "details": {
    "displayName": "My Flow Name",
    "description": "What this flow does.",
    "createdTime": "2024-01-15T10:00:00.0000000Z",
    "packageTelemetryId": "2bc9878b-8e4d-478c-b4b5-199c570d60de",
    "creator": "Author Name",
    "sourceEnvironment": ""
  },
  "resources": {
    "<flow-uuid>": {
      "type": "Microsoft.Flow/flows",
      "suggestedCreationType": "New",
      "creationType": "Existing, New, Update",
      "details": {
        "displayName": "My Flow Name"
      },
      "configurableBy": "User",
      "hierarchy": "Root",
      "dependsOn": ["<connector-uuid-1>", "<conn-instance-uuid-1>"]
    },
    "<connector-uuid-1>": {
      "id": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
      "name": "shared_sharepointonline",
      "type": "Microsoft.PowerApps/apis",
      "suggestedCreationType": "Existing",
      "details": {
        "displayName": "SharePoint",
        "iconUri": "https://connectoricons-prod.azureedge.net/sharepointonline/icon_1.0.1359.2036.png"
      },
      "configurableBy": "System",
      "hierarchy": "Child",
      "dependsOn": []
    },
    "<conn-instance-uuid-1>": {
      "type": "Microsoft.PowerApps/apis/connections",
      "suggestedCreationType": "Existing",
      "creationType": "Existing",
      "details": {
        "displayName": "Select Account",
        "iconUri": "https://connectoricons-prod.azureedge.net/sharepointonline/icon_1.0.1359.2036.png"
      },
      "configurableBy": "User",
      "hierarchy": "Child",
      "dependsOn": ["<connector-uuid-1>"]
    }
  }
}
```

### Required fields

| Field | Required | Notes |
|---|---|---|
| `schema` | Yes | Always `"1.0"` |
| `details.displayName` | Yes | Flow name shown in import wizard |
| `details.description` | No | Shown in import wizard |
| `details.createdTime` | No | ISO 8601 timestamp |
| `details.packageTelemetryId` | No | Any UUID; telemetry only |
| `details.creator` | No | Author string |
| `details.sourceEnvironment` | No | Can be empty string |
| `resources` | Yes | Object keyed by UUID |

### Resource pattern

Each connector requires **two resource entries** in the `resources` object:

1. **API entry** (`type: "Microsoft.PowerApps/apis"`) — describes the connector type
   - `id`: full provider path e.g. `/providers/Microsoft.PowerApps/apis/shared_sharepointonline`
   - `name`: short api name e.g. `shared_sharepointonline`
   - `configurableBy: "System"` — system-managed, not user-configurable
   - `hierarchy: "Child"`
   - `dependsOn: []`

2. **Connection instance entry** (`type: "Microsoft.PowerApps/apis/connections"`) — represents the user's authenticated connection
   - `configurableBy: "User"` — this is what triggers the import wizard prompt
   - `hierarchy: "Child"`
   - `dependsOn: ["<connector-api-uuid>"]` — references the API entry above

The flow resource (`type: "Microsoft.Flow/flows"`) is the root entry:
   - `hierarchy: "Root"`
   - `dependsOn: [...]` — lists all connector-api and connection-instance UUIDs
   - `suggestedCreationType: "New"` for generated packages (use `"Update"` only if updating an existing flow by GUID)

### Key insight on UUIDs in manifest

The UUIDs used as keys in `resources` are arbitrary — they are just internal cross-reference IDs within this manifest. They must be consistent (the flow's `dependsOn` must reference the same UUIDs used as keys), but they do not need to match any external identifiers. Fresh `crypto.randomUUID()` values work for all of them except the flow GUID, which must match the folder name in `Microsoft.Flow/flows/<UUID>/`.

**Source:**
- [GitHub: OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates — manifest.json](https://github.com/OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates/blob/master/templates/AutoApproveRequests/AutoApproveOpenShiftRequestwithEmailNotification/manifest.json)
- [Microsoft Learn: Export and import a non-solution flow](https://learn.microsoft.com/en-us/power-automate/export-import-flow-non-solution)

**Recommendation:** For each connector used in the flow, generate two resource entries (api + connection instance) with fresh UUIDs. The flow root entry's `dependsOn` must list all of them. The `configurableBy: "User"` on connection instances is what surfaces the remapping prompt in the import wizard — it must be present.

---

## Deep Dive 3: HTTP Connector — Fetching Web Pages

**Finding:**

There are two fundamentally different ways to make HTTP requests in Power Automate, with different action types in the flow definition JSON:

### Option A: Built-in `Http` action type (Premium)

The `Http` action type is a **built-in Logic Apps action** — it does **not** use `OpenApiConnection` and does **not** require a connection reference in `connectionReferences`. It is self-contained.

```json
"Get_diesel_price_page": {
  "type": "Http",
  "inputs": {
    "method": "GET",
    "uri": "https://www.fuelwatch.wa.gov.au/fuelwatch/pages/home",
    "headers": {
      "User-Agent": "Mozilla/5.0"
    }
  },
  "runAfter": {}
}
```

Required `inputs` fields:
- `method` — HTTP verb: `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`
- `uri` — full URL string

Optional `inputs` fields:
- `headers` — object of header name/value pairs
- `queries` — object of query parameter name/value pairs
- `body` — string body for POST/PUT
- `authentication` — authentication object (various types: Basic, ClientCertificate, ManagedServiceIdentity, OAuth, Raw)
- `retryPolicy` — retry configuration

The response body is accessed in subsequent actions as `@body('Get_diesel_price_page')` and the status code as `@outputs('Get_diesel_price_page')['statusCode']`.

**Premium status:** The HTTP action is **Premium** in Power Automate. It requires a Power Automate Premium (formerly Per User Plan) or Power Automate Process license. It is Standard in Azure Logic Apps. This is a frequent source of confusion — the action type exists in the Logic Apps schema and works in Logic Apps without premium, but in Power Automate it is marked premium.

**No connection reference needed:** Because `type: "Http"` is a built-in action (not an OpenApiConnection), it does not appear in the `connectionReferences` section of the definition and does not require a corresponding entry in `manifest.json`. This simplifies the package significantly for flows that only do HTTP fetches.

### Option B: HTTP with Microsoft Entra ID connector (Standard, connector-based)

```
api name: shared_webcontents
operationId: InvokeHttp
type: OpenApiConnection (in the flow definition)
```

This connector IS an `OpenApiConnection` type — it requires a connection reference and a manifest entry. It is **Standard** (no premium license required) but requires the destination URL to support Entra ID (Azure AD) authentication. It cannot be used for arbitrary public web pages without Entra ID.

For fetching a **public web page** (like a diesel price site), this connector is not suitable. It is designed for Microsoft services and Entra-ID-protected resources.

### Recommendation for diesel price scraping

Use `type: "Http"` with `method: "GET"` and the target URL. No connection reference needed. The user will need a Premium license. The response body will be the raw HTML string. Add a `Content-Conversion` action (see Deep Dive 4) or use expression functions to extract the price.

**Source:**
- [Microsoft Learn: Workflow triggers and actions — HTTP action](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-actions-triggers#http-action)
- [Microsoft Learn: HTTP with Microsoft Entra ID (preauthorized) connector](https://learn.microsoft.com/en-us/connectors/webcontents/)
- [Power Platform Community: HTTP Connector — Built-in vs Premium](https://community.powerplatform.com/forums/thread/details/?threadid=dec6c7aa-6a0e-421a-83e2-cf9ad2b1a7e6)

---

## Deep Dive 4: Content Conversion Connector (HTML to Text)

**Finding:**

The **Content Conversion** connector provides a single action for converting HTML to plain text. It is a **Standard** connector (no premium license required).

```
api name:    shared_conversionservice
operationId: HtmlToText
type:        OpenApiConnection
```

### Action schema in flow definition

```json
"Convert_HTML_to_text": {
  "type": "OpenApiConnection",
  "inputs": {
    "host": {
      "apiId": "/providers/Microsoft.PowerApps/apis/shared_conversionservice",
      "connectionName": "shared_conversionservice",
      "operationId": "HtmlToText"
    },
    "parameters": {
      "Content": "@body('Get_diesel_price_page')"
    },
    "authentication": "@parameters('$authentication')"
  },
  "runAfter": {
    "Get_diesel_price_page": ["Succeeded"]
  }
}
```

The `Content` parameter accepts an HTML string. The output is plain text accessed as `@body('Convert_HTML_to_text')`.

### Known limitations

- Max content: 5 MB
- Max DOM depth: 70 levels
- Max line length: 80 characters (then a line break)
- Links become `text[url]` format or just `text` if link = text
- Headers (`<h1>`, `<h2>`) are uppercased
- Empty lines are trimmed
- Does not support GCC or GCC High regions for new implementations

### Connection reference and manifest entry required

Because this is an `OpenApiConnection`, it requires:
1. A `connectionReferences` entry in `definition.json`
2. API + connection instance entries in `manifest.json`
3. The user to select/create a connection at import time

**Source:**
- [Microsoft Learn: Content Conversion connector](https://learn.microsoft.com/en-us/connectors/conversionservice/)

**Recommendation:** After fetching raw HTML with the `Http` action, pipe the response body into a `HtmlToText` action. This converts the HTML to plain text that is much easier to parse with string expression functions (`indexOf`, `substring`, `split`). For a diesel price page, the text output will contain the price in a predictable format if the page structure is consistent.

---

## Deep Dive 5: Excel Online (Business) Connector — Add a Row

**Finding:**

The Excel Online (Business) connector is a **Standard** connector (no premium license required).

```
api name:    shared_excelonlinebusiness
operationId: AddRowV2   (the current non-deprecated version)
type:        OpenApiConnection
```

### "Add a row into a table" action schema

```json
"Add_a_row_into_a_table": {
  "type": "OpenApiConnection",
  "inputs": {
    "host": {
      "apiId": "/providers/Microsoft.PowerApps/apis/shared_excelonlinebusiness",
      "connectionName": "shared_excelonlinebusiness",
      "operationId": "AddRowV2"
    },
    "parameters": {
      "source": "sites/<SharePoint-Site-URL>",
      "drive": "Documents",
      "file": "/path/to/Prices.xlsx",
      "table": "PricesTable",
      "item": {
        "Date": "@formatDateTime(utcNow(), 'yyyy-MM-dd')",
        "Price": "@variables('extractedPrice')",
        "Site": "Perth Metro"
      }
    },
    "authentication": "@parameters('$authentication')"
  },
  "runAfter": {
    "Previous_Action": ["Succeeded"]
  }
}
```

### Required parameters

| Parameter key | Required | Description |
|---|---|---|
| `source` | Yes | Location: `"me"` for OneDrive, a SharePoint site URL, `"users/<UPN>"`, `"groups/<group-id>"`, or `"sites/<SharePoint-URL>:/teams/<team-name>:"` |
| `drive` | Yes | Document library name (e.g. `"Documents"`) |
| `file` | Yes | Path to the Excel file from the drive root (e.g. `/Prices.xlsx`) |
| `table` | Yes | Table name as defined in Excel (not the sheet name) |
| `item` | Yes | Dynamic object — keys are the Excel table column headers, values are the cell data |

### `item` field

The `item` field is typed as `dynamic` — its structure is determined by the actual column names in the target Excel table. At design time in the Power Automate designer, the connector queries the Excel file to discover column names. In a generated package (without designer), the keys must exactly match the Excel table column headers (case-sensitive).

### Deprecated vs current operationId

- `AddRowV2` — current, recommended
- `AddRow` — deprecated, still functional but should not be used in new flows

### Connection reference and manifest entry

Requires standard `OpenApiConnection` setup: `connectionReferences` entry in definition, API + connection instance in manifest.

**Source:**
- [Microsoft Learn: Excel Online (Business) connector](https://learn.microsoft.com/en-us/connectors/excelonlinebusiness/)

**Recommendation:** The `source` parameter for SharePoint-hosted Excel files should be set to the SharePoint site URL (e.g. `"https://contoso.sharepoint.com/sites/finance"`). This is an environment-specific value that must be gathered from the user or left as a placeholder. The `table` parameter must exactly match the Excel table name (not sheet name) — collect this from the user upfront.

---

## Deep Dive 6: Recurrence Trigger — Daily Schedule

**Finding:**

The Recurrence trigger is a **built-in trigger** (`type: "Recurrence"`) that does not require a connection reference. It is not an `OpenApiConnection` and has no corresponding entry in `connectionReferences` or `manifest.json`.

### Minimal daily recurrence trigger

```json
"triggers": {
  "Recurrence": {
    "type": "Recurrence",
    "recurrence": {
      "frequency": "Day",
      "interval": 1
    }
  }
}
```

### Full daily recurrence with specific time and timezone

```json
"triggers": {
  "Recurrence": {
    "type": "Recurrence",
    "recurrence": {
      "frequency": "Day",
      "interval": 1,
      "startTime": "2024-01-15T06:00:00",
      "timeZone": "AUS Western Standard Time",
      "schedule": {
        "hours": [6],
        "minutes": [0]
      }
    }
  }
}
```

### `frequency` valid values

`"Second"`, `"Minute"`, `"Hour"`, `"Day"`, `"Week"`, `"Month"`

### `schedule` object (optional, only for `Day` or `Week` frequency)

| Field | Type | Description |
|---|---|---|
| `hours` | integer array | Hour marks 0–23 |
| `minutes` | integer array | Minute marks 0–59 |
| `weekDays` | string array | Only for `Week` frequency: `"Monday"` through `"Sunday"` |

### `timeZone` values

Standard Windows timezone names. For Australia: `"AUS Eastern Standard Time"` (Sydney/Melbourne), `"AUS Western Standard Time"` (Perth), `"Cen. Australia Standard Time"` (Darwin).

### Important: trigger name

The trigger name (the key in `triggers`) becomes the dependency key for the first action's empty `runAfter`. The name `"Recurrence"` is conventional but can be any string.

**Source:**
- [Microsoft Learn: Workflow triggers and actions — Recurrence trigger](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-actions-triggers)

**Recommendation:** For a daily diesel price check, use `frequency: "Day"`, `interval: 1`, with a morning `startTime` and a relevant `timeZone`. The timezone should match the user's locale. The `schedule.hours` and `schedule.minutes` fields let you pin the exact time of day. No connection reference or manifest entry is needed for this trigger type.

---

## Deep Dive 7: Premium License Implications

**Finding:**

### Connector tier summary for a diesel price scraping + Excel flow

| Connector / Action | Type | Tier | api name | Notes |
|---|---|---|---|---|
| Recurrence trigger | Built-in trigger | Standard (free) | n/a — no connection reference | No license required |
| HTTP action | Built-in Logic Apps action | **Premium in Power Automate** | n/a — no connection reference | Requires Premium license |
| Content Conversion (HTML to Text) | OpenApiConnection | Standard (free) | `shared_conversionservice` | No premium required |
| Excel Online (Business) | OpenApiConnection | Standard (free) | `shared_excelonlinebusiness` | No premium required |
| SharePoint | OpenApiConnection | Standard (free) | `shared_sharepointonline` | No premium required |

### What "Premium" means in practice

A **Power Automate Premium** license (formerly "Per User Plan with Attended RPA") costs approximately $15/user/month (as of 2025). For automated/scheduled flows (not instant flows), only the **flow owner** needs the Premium license — users who trigger or are affected by the flow do not need it.

For a diesel price scraping flow (Recurrence-triggered, fully automated), only the person who owns the flow needs the Premium license.

### The single premium dependency

The only Premium element in the diesel price flow is the `Http` action. If the user does not have a Premium license, they have two alternatives:

**Alternative 1: HTTP with Microsoft Entra ID connector** (`shared_webcontents`)
- Standard connector (no premium required)
- operationId: `InvokeHttp`
- Limitation: the target URL must support Entra ID authentication — **not suitable for public web pages**

**Alternative 2: SharePoint "Send an HTTP request" action** (`shared_sharepointonline`, operationId: `HttpRequest`)
- Standard connector
- Limitation: only works against SharePoint REST API endpoints (`/_api/...`) — **not suitable for external web pages**

**Conclusion:** For scraping a public diesel price page from an external website, the `type: "Http"` action is the only viable built-in approach, and it requires a Premium license. There is no standard-tier workaround for arbitrary external HTTP GET requests.

### HTML parsing without a third-party connector

After converting HTML to text with `Content Conversion`, price extraction uses Power Automate expression functions:
- `indexOf(body('Convert_HTML_to_text'), 'search-string')` — find a landmark string
- `substring(body('Convert_HTML_to_text'), startIndex, length)` — extract a slice
- `split(body('Convert_HTML_to_text'), '\n')` — split into lines
- `trim(...)` — clean whitespace

No additional connector is needed for basic string parsing. For complex HTML with regex needs, Office Scripts (via Excel Online) can run JavaScript/TypeScript in the Excel workbook context — but this adds significant complexity.

**Source:**
- [Microsoft Learn: List of all Premium tier connectors](https://learn.microsoft.com/en-us/connectors/connector-reference/connector-reference-premium-connectors)
- [Microsoft Learn: Content Conversion connector](https://learn.microsoft.com/en-us/connectors/conversionservice/)
- [Microsoft Learn: HTTP with Microsoft Entra ID (preauthorized)](https://learn.microsoft.com/en-us/connectors/webcontents/)
- [DEV Community: Invoke an HTTP request without a premium license](https://dev.to/kkazala/invoke-an-http-request-without-a-premium-license-connectors-summary-4pmd)

---

## Deep Dive 8: Connection Reference Format — Complete Reference

**Finding:**

### Confirmed `api.name` values for relevant connectors

| Connector | api name | Full provider path | Tier |
|---|---|---|---|
| SharePoint | `shared_sharepointonline` | `/providers/Microsoft.PowerApps/apis/shared_sharepointonline` | Standard |
| Excel Online (Business) | `shared_excelonlinebusiness` | `/providers/Microsoft.PowerApps/apis/shared_excelonlinebusiness` | Standard |
| Content Conversion | `shared_conversionservice` | `/providers/Microsoft.PowerApps/apis/shared_conversionservice` | Standard |
| Office 365 Outlook | `shared_office365` | `/providers/Microsoft.PowerApps/apis/shared_office365` | Standard |
| Office 365 Users | `shared_office365users` | `/providers/Microsoft.PowerApps/apis/shared_office365users` | Standard |
| HTTP with Microsoft Entra ID | `shared_webcontents` | `/providers/Microsoft.PowerApps/apis/shared_webcontents` | Standard |
| Dataverse | `shared_commondataserviceforapps` | `/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps` | Standard |

Note: The plain `Http` action (`type: "Http"`) is **not** an OpenApiConnection and therefore **has no `api.name`** and appears in neither `connectionReferences` nor `manifest.json`. It is a built-in Logic Apps action.

### Connection reference in `definition.json`

```json
"connectionReferences": {
  "shared_excelonlinebusiness": {
    "connectionName": "shared-excelonlinebusiness-placeholder-guid",
    "source": "Invoker",
    "id": "/providers/Microsoft.PowerApps/apis/shared_excelonlinebusiness",
    "tier": "NotSpecified"
  },
  "shared_conversionservice": {
    "connectionName": "shared-conversionservice-placeholder-guid",
    "source": "Invoker",
    "id": "/providers/Microsoft.PowerApps/apis/shared_conversionservice",
    "tier": "NotSpecified"
  }
}
```

The key in `connectionReferences` (e.g. `"shared_excelonlinebusiness"`) is called the **logical connection name** and is what `inputs.host.connectionName` references in each action. When multiple connections of the same connector type are needed, they are named with incrementing suffixes: `shared_excelonlinebusiness`, `shared_excelonlinebusiness_1`, etc.

### How `type: "Http"` differs

The `Http` action type requires no `connectionName` and no `connectionReferences` entry:

```json
"Fetch_page": {
  "type": "Http",
  "inputs": {
    "method": "GET",
    "uri": "https://example.com/prices"
  },
  "runAfter": {}
}
```

No `host` block. No `authentication: "@parameters('$authentication')"`. No manifest entry.

**Source:**
- [GitHub: OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates](https://github.com/OfficeDev/Microsoft-Teams-Shifts-Power-Automate-Templates) — confirmed `shared_office365users`, `shared_office365`, `shared_shifts` names
- [Microsoft Power Automate connector page: shared_excelonlinebusiness](https://powerautomate.microsoft.com/en-my/connectors/details/shared_excelonlinebusiness/excel-online-business/) — URL confirms the api name
- [Microsoft Learn: Workflow triggers and actions — HTTP action](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-workflow-actions-triggers#http-action)

**Recommendation:** Use the exact `api.name` values from the table above. The `Http` action type is the exception — it needs no connection reference plumbing at all. For all `OpenApiConnection` actions, the `connectionName` in both `connectionReferences` and `inputs.host.connectionName` must match exactly (they are the same string — the logical connection name).
