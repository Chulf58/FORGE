# GENERAL — Power Automate Cloud Flows

> This project generates Power Automate non-solution flow packages (`.zip`) for import via My Flows > Import Package (Legacy). Agents: this is not a web app, not a Node.js app, not an Electron app. All runtime logic lives in Power Automate cloud flows using the Azure Logic Apps 2016-06-01 schema.

---

## Process boundary — no Node runtime in flows

Power Automate flows run in Microsoft's cloud. There is no Node.js, no file system, no shell access. All logic must use Power Automate expression functions (`indexOf`, `substring`, `split`, `formatDateTime`, etc.), built-in actions, or OpenApiConnection actions.

---

## Package format — two incompatible formats

Non-solution `.zip` package: `manifest.json` + `Microsoft.Flow/flows/<UUID>/definition.json`. Import via My Flows > Import Package (Legacy).

Solution XML: a larger zip with `customizations.xml` and `Workflows/` folder. Import requires a Dataverse environment and Power Platform admin access.

**Always use the non-solution `.zip` format** for generated deliverables — it works in all Power Automate environments without admin access.

---

## Connection references — two-layer system

Layer 1 — connector api name (stable, portable): e.g. `shared_sharepointonline`. Same across all tenants.
Layer 2 — connection instance name (environment-specific GUID): replaced by the user at import time.

Do not hardcode real connection GUIDs — they will not exist in the destination environment. Use placeholder strings; the import wizard remaps them.

---

## Environment-specific values

These values are specific to the destination environment and CANNOT be generated:
- SharePoint site URLs (`https://<tenant>.sharepoint.com/sites/<site>`)
- SharePoint list names / GUIDs
- Dataverse custom entity names
- Teams team/channel IDs

Always use obvious placeholder strings (e.g. `"<YOUR_SHAREPOINT_SITE_URL>"`) or gather from the user upfront.

---

## Premium license — HTTP built-in action

`type: "Http"` (plain HTTP fetch against any URL) is a **Premium** action in Power Automate. Flows using it require a Power Automate Premium license for the flow owner. Standard-tier alternatives (`shared_webcontents`) only support Entra ID-protected endpoints — not public URLs.

---

## Tool preference — see CLAUDE.md

Authoritative tool-choice guidance lives in the template's root `CLAUDE.md` under `## Tool efficiency`. It covers Read / Glob / Grep / Edit / Write / MCP tools and the common mistakes to avoid (including `node -e` misuse). Do not restate those rules here — one source of truth per template.
