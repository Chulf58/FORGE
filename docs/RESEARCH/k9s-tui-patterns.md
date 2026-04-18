# K9s TUI Patterns — Findings for the FORGE Ink Observer

## Summary

K9s is a Kubernetes terminal UI built on tview (Go TUI library) that uses dense tables with contextual actions, a colon-command palette for navigation, breadcrumb trails for view hierarchy, and semantic status colors. It demonstrates table patterns (sortable columns, sticky headers, row marking), action registration via keymap structs, modal dialogs for confirmation/input, and skin-based themability. The observer adopts K9s's command-palette pattern (colon-style navigation maps to "jump to run ID"), action-registry pattern for Shift+click row actions (approve/discard gates), and semantic status colors (Pending/Error/Completed states); skips advanced features (kill actions, RBAC complexity) and multi-column sorting (overkill for simple observer state).

**Top 3 adopt picks:**
1. **Command-palette navigation** (colon-prefix commands like `:pod`, `:ns` map to resource jumping; generalizes to `:run-12345`, `:gate-feature`) — discoverable, keyboard-driven, scales to actions
2. **Row-based action registry** (KeyMap struct binding keys to contextual actions; generalizes to approve/discard/retry buttons per row) — decoupled, extensible, no hardcoded menu
3. **Semantic status colors** (Pending/Error/Completed/Modified mapped to distinct colors via skin config) — matches FORGE's signal semantics (runs pending/blocked/done)

**Top 2 skip picks:**
1. **Multi-column sorting** — Observer renders runs/gates/todos in order-by-time; secondary sort adds complexity without benefit
2. **Delete/kill actions** — Observer is read-only dashboard (no destructive ops); approval/discard are the only row-level mutations

---

## Source

- **Repo:** https://github.com/derailed/k9s (Go Kubernetes TUI, tview-based)
- **Commit inspected:** Latest main branch (2026-04-18)
- **Files/sections read:** README.md (bindings, features), internal/view/ (view types), internal/ui/ (table, action, crumbs, config, dialog), internal/ui/dialog/ (modal types), tview library docs
- **Screenshots/demo:** Yes, UI sections (Pulses, Pods, Logs, XRay) with tables and command palette visible in k9scli.io

---

## Patterns

### 1. Command Palette (Colon-Prefix Navigation)

**What K9s does:**
Users press `:` to open a command prompt. K9s recognizes resource shortcuts (`:pod`, `:deployment`, `:ns` for namespace, `:ctx` for context), full resource names, and namespace-scoped jumps. Typing `:pod default/my-pod` navigates directly to that resource's detail view. No autocomplete shown in docs, but the pattern is routing + state-jump.

**Verdict:** **ADOPT**

**Why:** The observer needs a way to jump to a specific run ID or filter gates by feature without scrolling. A colon-command palette `:run 12345` or `:gate feature-name` is discoverable (users learn `:` via help pane), unobtrusive (no modal until `:` is pressed), and scales to future actions (`:retry-run`, `:approve-all`). The routing pattern (parse input → derive state → jump) is identical to K9s's resource navigation.

**How to apply:**
- On `:` keypress, show a single-line prompt at the top or bottom of the observer
- Recognize commands: `:run <id>`, `:gate <feature-substring>`, `:todo <priority>`
- Filter or scroll the corresponding section to match; highlight the row
- Closing the palette (ESC or Enter) returns focus to the dashboard
- Add hint to footer: `": command (q quit, r refresh, ? help)"`

---

### 2. Row-Based Action Registry (KeyMap Pattern)

**What K9s does:**
K9s defines a `KeyActions` struct with a `KeyMap` field binding `tcell.Key` values to `KeyAction` objects. Each view (Pod, Deployment, etc.) registers relevant actions: delete (`ctrl-d`), logs (`l`), edit (`e`), describe (`d`), port-forward (`shift-f`), YAML view (`y`). The `ActionHandler` callback processes the keystroke and executes the action. The `Dangerous` flag selectively hides destructive actions in certain contexts. `Hints()` generates user-visible key hints from the registered set.

**Verdict:** **ADOPT**

**Why:** The observer currently has no row-level mutations. But future slices will add gate approval/discard (keyboard shortcut + mouse click), run retry, and log view. Rather than hardcode these in the input handler, registering them as keymaps makes the action set discoverable and testable. The "Dangerous" flag (selectively hiding actions) maps to gate approval being context-dependent (e.g., only available for pending gates, not completed ones).

**How to apply:**
- Create a `rowActions` registry at the observer level: `{ "a": { label: "Approve", handler: approveGate }, "d": { label: "Discard", handler: discardGate } }`
- When a row is selected/clicked, check its type (gate, run, todo) and filter to applicable actions
- Display hints in the footer: `"[a] Approve [d] Discard [l] Logs"`
- On keypress, look up the action in the registry and invoke the handler
- For mouse: Shift+click a row to select it; 'a' or 'd' then executes the action (or embed buttons inline in row if UI space permits)

---

### 3. Semantic Status Colors

**What K9s does:**
K9s defines a color scheme via **skin files** with semantic names: `PendingColor`, `ErrorColor`, `CompletedColor`, `ModifyColor`, `AddColor`, etc. Each color carries meaning (red = error, green = success, orange = modification). The `Styles` object loads from environment variable (`K9S_SKIN`), context-specific config, or stock defaults. Colors are applied to status indicators, row backgrounds, and text; the schema is themeable without code changes.

**Verdict:** **ADOPT**

**Why:** The observer already uses semantic colors (Ink's `color="red"` for blockage, `color="green"` for completed). K9s's skin-file pattern is overkill for a single observer, but the naming convention is worth copying: instead of `color="red"`, name it `statusColor("error")` and define the mapping centrally. This makes the observer themeable later and ensures consistency with Codeburn's semantic palette (orange for highlights, cyan for primary, red for alerts).

**How to apply:**
- Define a `colors.js` constants file: `export const STATUS_COLORS = { pending: "yellow", error: "red", completed: "green", modified: "magenta", blocked: "red" }`
- Map FORGE signal states to colors: `Signal.pending → STATUS_COLORS.pending`, `Signal.blocked → STATUS_COLORS.error`
- Use `Text({ color: STATUS_COLORS.pending }, "Pending")` instead of hardcoding color
- Future: allow color overrides via environment or config without code change

---

### 4. Sticky Header + Sortable Columns (Table Rendering)

**What K9s does:**
Tables display headers (NAME, NAMESPACE, STATUS, AGE) with sticky positioning (visible when scrolling). K9s tracks the current sort column and direction (`SortInvertCmd()` toggles ascending/descending). Column widths are computed via `MaxyPad` based on content; cells are left-aligned and padded. A column indicator shows which column is sorted and in which direction. Marked rows (user selects items for batch operations) use distinct highlight colors.

**Verdict:** **ADAPT**

**Why:** The observer's four sections (active runs, pending gates, recent completions, todos) are simple lists without sorting need—runs are ordered by start time (most recent first), gates by submission order, etc. But Ink's Box container doesn't have native table semantics (sticky header, sortable columns). For now, skip the full table machinery and use simple Text rows with left-padded alignment. Reserve sortable tables for future "token usage per run" or "test results per module" views where users might want to sort by cost or test count.

**How to apply:**
- For the observer's current sections: render each row as padded Text, no sorting UI
- Use fixed column widths: `ID (8 chars) | Status (10 chars) | Feature (30 chars) | Elapsed (12 chars)`
- Header row: render as bold `Text({ bold: true }, "ID       | Status     | Feature...")`
- If a future slice adds a table with sorting: implement column-click to sort + visual indicator (e.g., ` ▲` / ` ▼` suffix on header); use Ink's `Box` with `flexDirection="row"` for columns + manual width tracking

---

### 5. Modal Dialogs for Confirmation

**What K9s does:**
K9s implements a dialog system with `Confirm` (yes/no), `Delete` (specialized confirm), `Error` (read-only message), `Prompt` (text input), `Selection` (choose from list), and `Restart` (confirm action) dialogs. Each dialog is modal (blocks other interaction), centered on screen, with a title, message/prompt, and buttons/options. Escape cancels; Enter confirms.

**Verdict:** **ADAPT**

**Why:** The observer is a read-only dashboard today. But gate approval/discard should ideally have a confirm dialog ("Approve gate for feature-x?") to prevent accidental clicks. Ink has no native modal; we'd need to build one using a centered Box overlay + `useInput` to capture keys. This is doable but not urgent for Phase 1. For now, gate approval can be direct (click/key = action) with undo capability; if we add modals, model them after K9s's confirm pattern (centered box, title, message, Yes/No buttons, Escape cancels).

**How to apply:**
- Implement a `<ConfirmDialog>` Ink component: Box with 3 lines (title, message, button hints), centered via calc of terminal size
- On approval button click, check if gate has no running tasks; if so, show confirm dialog
- Dialog render: `confirm="Approve feature-x?"`, button hints `"[Y] Yes [N] No [ESC] Cancel"`
- Closing the dialog returns to normal dashboard view with the action either executed or cancelled

---

### 6. Breadcrumb Navigation Trail

**What K9s does:**
K9s maintains a stack of visited views. Each navigation push adds to the breadcrumb; pressing ESC pops the stack and returns to the previous view. Breadcrumbs are displayed as a styled trail (e.g., `Cluster > Namespace:default > Pods > my-pod`) with the active item highlighted. The stack is reactive—breadcrumbs update automatically when the stack changes.

**Verdict:** **SKIP**

**Why:** The observer is a single full-screen view with no detail panes or modal transitions. All four sections (runs, gates, completions, todos) are visible simultaneously. A colon-command to jump to a run detail view would need a back mechanism, but that's a future feature (Phase 2+). For now, skip breadcrumbs; they add visual clutter without addressing current needs. If detail views are added, breadcrumbs become natural (Dashboard > Runs > Run-12345 > Logs).

**How to apply (non-adoption):**
- Keep the observer's current layout: single view, no back button, no breadcrumbs
- If future slices add detail panes (e.g., clicking a run opens inline logs), implement a simple back button or ESC-to-close pattern first
- Add breadcrumbs only if nested navigation depth exceeds 2 levels

---

### 7. Action Hints Footer

**What K9s does:**
K9s displays a footer bar with available key bindings: `"? Help | : Cmd | / Filter | ctrl-d Delete | l Logs | e Edit | y YAML"`. The hints are auto-generated from the registered `KeyActions` via a `Hints()` method, ensuring the footer stays in sync with available actions. Hints use brackets for key names: `[ctrl-d]`, `[Shift+F]`, `[?]`.

**Verdict:** **ADOPT**

**Why:** The observer currently shows minimal hints: `"q/Q/Ctrl+C quit, r refresh"`. K9s's auto-generated hints pattern ensures new actions (approve, discard, jump) are discovered without manual footer updates. The footer should be a single line at the bottom, color-dimmed, and updated whenever the action registry changes.

**How to apply:**
- Generate hints from the `rowActions` registry: `hints = Object.entries(rowActions).map(([key, action]) => `[${key}] ${action.label}`).join(" | ")`
- Add global hints: `"[?] Help"`, `[:] Command"`, `[/] Filter"`
- Render as a `Text({ dim: true }, hints)` component in the footer Box
- Update the hint string whenever a new action is registered (e.g., when user clicks a gate row, "Approve/Discard" hints appear)

---

### 8. Filter + Search Pattern (`/` key)

**What K9s does:**
Pressing `/` opens a filter prompt that accepts regex patterns. The table re-renders, showing only rows matching the regex. K9s also supports `-f` flag for fuzzy search. The filter is temporary (cleared on view change); it's applied at the table-rendering level, not a separate filtered view.

**Verdict:** **ADAPT**

**Why:** The observer's four sections (runs, gates, completions, todos) are relatively small (max ~20 items each). Filtering by regex is overkill. But a substring search would be useful: `/feature-name` to show only runs for that feature, `/pending` to show only pending gates. Rather than implement regex parsing, use simple substring matching (case-insensitive) against NAME + STATUS fields. This keeps the observer lean while enabling quick navigation.

**How to apply:**
- On `/` keypress, show a single-line prompt at the top (same component as the colon-command palette)
- Validate input as a substring (no regex parsing)
- Filter displayed rows to those matching substring in ID, Feature, or Status columns
- Filter state persists until ESC (to match K9s), or clear on view change
- Display count badge: `"Showing 5/20"` next to the filter prompt

---

## Non-goals reminder

- No Go code ported. K9s patterns extracted; adaptation to Ink/Node.js is the implementer's responsibility.
- No rewrite proposed. K9s informs three shallow feature slices: colon-command palette, row action registry, and semantic color constants.
- All pattern details verified from source; unverified behaviors flagged as such.

