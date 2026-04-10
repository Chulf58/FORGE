# Research: Memory Scaffolding on Project Creation/Import

## Question: What is the exact path-encoding algorithm Claude Code uses for the project memory directory?

**Finding:** Reverse-engineered from five live examples in `C:\Users\cuj\.claude\projects\`:

| Windows path | Encoded directory name |
|---|---|
| `C:\Users\cuj\Forge` | `C--Users-cuj-Forge` |
| `C:\Users\cuj\test` | `C--Users-cuj-test` |
| `C:\Users\cuj\Tools\Dieselpriser` | `C--Users-cuj-Tools-Dieselpriser` |
| `C:\Users\cuj\Claude UI` | `C--Users-cuj-Claude-UI` |

The encoding rule is:

1. Remove the `:` after the drive letter (`C:` becomes `C`).
2. Replace every `\` (backslash) with `-`.
3. Replace every `/` (forward slash) with `-`.
4. Replace every ` ` (space) with `-`.

The `Claude UI` example (space in folder name → `Claude-UI`) **confirms spaces become dashes**. This was not explicit in the plan but is now confirmed from live data.

No Claude Code source or documentation was found that formally specifies this algorithm. The above is inferred empirically from five data points across this machine. The implementation should be treated as a best-effort heuristic — if a project path contains other special characters (e.g. `(`, `)`, `#`, `%`) the exact substitution is unknown. The safest implementation replaces any character that is not alphanumeric or a dash with a dash, then collapses consecutive dashes.

**Recommended implementation for `encodeProjectPath`:**

```typescript
function encodeProjectPath(p: string): string {
  // Normalise separators to forward slash first
  const normalised = p.replace(/\\/g, '/')
  // Remove drive colon: "C:/..." -> "C/..."
  const noColon = normalised.replace(/^([A-Za-z]):/, '$1')
  // Replace all non-alphanumeric, non-dash characters with dashes
  const dashed = noColon.replace(/[^A-Za-z0-9-]/g, '-')
  // Collapse consecutive dashes (e.g. root slash produces leading dash after drive letter)
  return dashed.replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
    // But keep double-dash at start: "C:/Users" -> "C-Users" not "C--Users"
    // Wait — observed output IS "C--Users" so double-dash is preserved at drive boundary
}
```

Actually the observed output for `C:\Users\cuj\Forge` is `C--Users-cuj-Forge` — there are TWO dashes between `C` and `Users`. That means the root `\` after the drive letter is kept as a dash, giving `C` + `-` (from `:` removal is just drop) + `-` (from `\`) = `C--`. The `:` is simply dropped (not replaced), and `\` becomes `-`. So:

- `C:\Users\cuj\Forge`
- Drop `:` → `C\Users\cuj\Forge`
- Replace `\` and `/` with `-` → `C-Users-cuj-Forge`

But the observed name is `C--Users-cuj-Forge` (double dash). This means the `:` is replaced with `-` (not dropped), giving:
- `C:\Users\cuj\Forge`
- Replace `:` with `-` → `C-\Users\cuj\Forge`
- Replace `\` with `-` → `C--Users-cuj-Forge`

This is consistent with all examples. **Final confirmed rule:**

1. Replace `:` with `-`.
2. Replace `\` with `-`.
3. Replace `/` with `-`.
4. Replace ` ` (space) with `-`.

No collapsing of consecutive dashes is done — the double dash `C--` is intentional (colon becomes dash, backslash becomes dash, they are adjacent).

**Correct implementation:**

```typescript
function encodeProjectPath(p: string): string {
  return p.replace(/:/g, '-').replace(/[\\/]/g, '-').replace(/ /g, '-')
}
```

Example verification: `C:\Users\cuj\Forge` → `C-\Users\cuj\Forge` → `C--Users-cuj-Forge`. Matches observed directory name exactly.

**Source:** Live filesystem at `C:\Users\cuj\.claude\projects\` — five directory names observed via Glob.

**Recommendation:** Implement `encodeProjectPath` exactly as the four-step rule above. Do not collapse double dashes. Do not strip leading/trailing dashes. The function is local to the `scaffold-memory` handler in `src/main/index.ts`. Add a code comment referencing the observed examples so future maintainers understand the empirical basis.

---

## Question: Is `homedir` already imported in `src/main/index.ts`?

**Finding:** Yes. Line 6 of `src/main/index.ts` reads:

```typescript
import { homedir } from 'os'
```

`homedir` is used throughout the file already (e.g. in `findClaude()` at lines 17–21).

**Source:** `C:\Users\cuj\Forge\src\main\index.ts`, line 6.

**Recommendation:** No new import is needed. The `scaffold-memory` handler can call `homedir()` directly.

---

## Question: What is the exact frontmatter format for Claude Code memory files?

**Finding:** Confirmed from three live memory files in `C:\Users\cuj\.claude\projects\C--Users-cuj-Forge\memory\`:

`project.md` (lines 1–5):
```
---
name: FORGE project context
description: What FORGE is, how it is developed, and the key architectural context
type: project
---
```

`user.md` (lines 1–5):
```
---
name: User profile
description: Who the user is, their background, goals, and working preferences
type: user
---
```

`reference.md` (lines 1–5):
```
---
name: Key file reference
description: Where to find important files and what each one does in the FORGE project
type: reference
---
```

The `MEMORY.md` index format is:
```
# Memory Index

- [user.md](user.md) — Who the user is: ...
- [project.md](project.md) — FORGE context: ...
- [reference.md](reference.md) — Where to find things: ...
```

Key observations:
- Frontmatter block uses `---` delimiters (YAML).
- Three fields: `name` (short descriptive title), `description` (one sentence), `type` (one of `project`, `reference`, `user`).
- No `id`, `tags`, or other fields present in observed examples.
- Body content after the closing `---` is plain markdown with `##` sections.
- `MEMORY.md` uses a `# Memory Index` h1 heading, then a bullet list of relative markdown links with ` — ` separator and a one-line description. No frontmatter in `MEMORY.md` itself.

**Source:** `C:\Users\cuj\.claude\projects\C--Users-cuj-Forge\memory\project.md`, `user.md`, `reference.md`, `MEMORY.md`.

**Recommendation:** The plan's specified frontmatter schema (`name`, `description`, `type`) matches the observed format exactly. The Coder should implement it verbatim. The `MEMORY.md` bullet format `- [file.md](file.md) — <one-line description>` also matches — use this pattern precisely (relative link, em-dash with surrounding spaces).

The plan also mentions `projectName` is needed for the `project.md` frontmatter `name` field. The handler currently receives `projectFolder` as a parameter. `projectName` is **not** in the proposed handler signature in task 1 of the plan — the handler must either derive the name from `basename(projectFolder)` or the caller must pass it as an additional parameter. The plan's task 5 (WizardModal call) passes only `folder` and the three answers, not `projectName`. The Coder should add `projectName` as an explicit parameter to the `scaffold-memory` IPC call (main handler, preload bridge, type declaration, and both modal callers) — or derive it from `basename(projectFolder)` as a fallback. **Recommendation: add `projectName` as an optional parameter; fall back to `basename(projectFolder)` if empty.** This is a gap in the plan that the Coder must handle.

---

## Question: Does the plan need an `ipc.ts` wrapper for `scaffoldMemory`?

**Finding:** The IPC quadruple for FORGE is:
1. `ipcMain.handle(...)` in `src/main/index.ts`
2. `contextBridge.exposeInMainWorld('claude', {...})` in `src/preload/index.ts`
3. Type in `ClaudeAPI` interface in `src/renderer/src/types/claude.d.ts`
4. Typed wrapper function in `src/renderer/src/lib/ipc.ts`

All four locations are confirmed required by `docs/gotchas/GENERAL.md` and the coder agent pre-flight checklist. The plan's tasks 1–3 cover locations 1–3 but the plan text does not mention adding a wrapper to `src/renderer/src/lib/ipc.ts`.

However, examining how the two caller modals use IPC:

- `WizardModal.svelte` calls `window.claude.scaffoldProject(...)` directly (not via `ipc.ts`) — line 79.
- `WizardModal.svelte` calls `window.claude.generateGeneralMd(...)` directly — line 84.
- `ImportModal.svelte` calls `window.claude.importProject(...)` directly — line 119.
- `ImportModal.svelte` calls `window.claude.generateGeneralMd(...)` directly — line 144.

Both modals bypass `ipc.ts` and call `window.claude` directly. This is an inconsistency in the codebase — `ipc.ts` wrappers exist for these same methods (`scaffoldProject` at line 112, `generateGeneralMd` at line 116, `importProject` at line 124 of `ipc.ts`) but the modals don't use them.

The plan's task 5 (WizardModal) and task 7 (ImportModal) both show `window.claude.scaffoldMemory(...)` calls directly — consistent with the existing modal pattern of calling `window.claude` directly rather than going through `ipc.ts`.

**Conclusion:** The modals call `window.claude` directly, not through `ipc.ts`. However, the IPC quadruple rule still requires the `ipc.ts` wrapper to be added for completeness and type safety — even if the initial callers don't use it. The gotcha-checker and reviewer will flag a missing `ipc.ts` wrapper as a quadruple violation.

**Source:** `C:\Users\cuj\Forge\src\renderer\src\lib\ipc.ts` (lines 110–131 for scaffolding wrappers); `C:\Users\cuj\Forge\src\renderer\src\components\overlays\WizardModal.svelte` (lines 79, 84); `C:\Users\cuj\Forge\src\renderer\src\components\overlays\ImportModal.svelte` (lines 119, 144).

**Recommendation:** The Coder must add a `scaffoldMemory` wrapper to `src/renderer/src/lib/ipc.ts` as task 8 of the implementation — even though the plan does not list it. Without it the IPC quadruple is incomplete and the feature will be blocked by the gotcha-checker. The wrapper signature should match the type:

```typescript
export function scaffoldMemory(
  projectFolder: string,
  answers: { userBackground: string; projectPurpose: string; keyConventions: string },
  projectName?: string
): Promise<{ ok?: boolean; error?: string }> {
  return c().scaffoldMemory(projectFolder, answers, projectName)
}
```

Place it in the `// --- Project scaffolding ---` section of `ipc.ts` alongside `scaffoldProject` and `generateGeneralMd`.

---

## Additional finding: `projectName` parameter gap

**Finding:** The plan's task 1 handler signature is `(_, { projectFolder, userBackground, projectPurpose, keyConventions })` — `projectName` is absent. The handler uses `projectName` to populate `project.md` frontmatter's `name` field (`name: <projectName> project context`). Without it the handler must derive the name from `basename(projectFolder)`.

In WizardModal (task 5), `projectName` is available as the `projectName` `$state` variable. In ImportModal (task 6/7), `projectName` is also available as the `projectName` `$state` variable. Both callers can easily pass it.

**Recommendation:** Add `projectName?: string` to the IPC handler parameters, the preload bridge, the type declaration, and both modal call sites. The handler body uses `projectName || basename(projectFolder)` as the display name. This is a one-line addition at each of the four locations and prevents the frontmatter name from showing a raw folder basename like `my-app-forge` instead of the user-entered project name.
