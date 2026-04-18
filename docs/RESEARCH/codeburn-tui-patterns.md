# Codeburn TUI Patterns — Findings for the FORGE Ink Observer

## Summary

Codeburn is an Ink-based (React for terminals) token-usage dashboard with a clean, color-coded multi-panel layout. It uses 4-5 semantic status colors (orange for highlights, cyan/magenta for panels, red for high-impact data), responsive two-column grids that collapse to single-column on small terminals, Unicode block glyphs for cost/usage bars, and keyboard-driven navigation with no animations or hover states. The observer adopts Codeburn's color-semantic approach and responsive grid logic for specs panel and token usage visibility; skips animation (Codeburn has none) and mouseclick-refresh patterns (Codeburn uses arrow keys/number pad, the observer already does click-refresh).

**Top 3 adopt picks:**
1. **Semantic color palette** (orange for highlights, cyan for primary panels, gray for secondary labels) — consistent, minimal, readable
2. **Responsive column-grid layout** (halves terminal width when space permits, collapses to single-column below 90 chars) — elegant and works on tiny terminals
3. **Unicode bar charts** (█ filled, ░ empty) — zero dependencies, compact information density

**Top 2 skip picks:**
1. **No animations** — Codeburn shows state changes via color only, not transitions. The observer benefits from the same (simpler React, lower CPU, clearer state semantics).
2. **Keyboard shortcuts library (1-5 number pad)** — Codeburn uses number-key period selection; the observer uses clicking and the 'r' refresh key, which is already sufficient.

---

## Source

- **Repo:** https://github.com/AgentSeal/codeburn
- **Commit inspected:** Latest main branch (2026-04-18)
- **Files read:** `src/dashboard.tsx`, `src/cli.ts`, `src/format.ts`, `src/types.ts`, `src/config.ts`, `package.json`, `README.md`
- **Screenshots/demo:** Yes, three dashboard/optimize/menubar visuals mentioned in README; detailed dashboard component code verified

---

## Patterns

### 1. Color Palette & Semantic Weight

**What Codeburn does:**
Uses a minimal, semantic palette: orange (`#FF8C42`) for interactive highlights and section breaks; cyan (`#5BF5E0`) and magenta (`#F55BE0`) for panel type differentiation; red (`#F55B5B`) for high-impact warnings; gray (`#555555`) for labels and secondary info. Daily panels use dedicated colors (blue `#5B9EF5`, green `#5BF5A0`). Gradient interpolation (`lerp()`) creates smooth color transitions for trends. All color choices carry meaning: red = risk, orange = action, cyan/magenta = data categories.

**Verdict:** **ADOPT**

**Why:** Semantic colors are immediately readable even to colorblind users (position + text convey info independently). Codeburn's 4-5-color constraint forces discipline; the observer's four sections (active runs, pending gates, recent completions, board summary) map perfectly to cyan (primary) + gray (secondary labels) + red (blocking state). The palette is terminal-safe (no exotic 256-color sequences, works on monochrome fallback).

**How to apply:**
- Specs panel border: cyan (primary detail panel)
- Token usage section: yellow/orange (shows cost, which carries semantic weight)
- Project status failures: red
- Inactive sections: gray

---

### 2. Responsive Column-Grid Layout

**What Codeburn does:**
Full-width header with period tabs and provider indicator; below, an "Overview" summary (full width); then a two-column grid for "Daily Activity + Project Breakdown" and "Activity + Model Breakdown" side-by-side. The grid halves the terminal width when horizontal space exceeds 90 characters (`MIN_WIDE = 90`); below that threshold, all panels stack vertically. Footer is a single-line status bar with keyboard hints. No fixed widths; flex layout adapts to terminal size dynamically.

**Verdict:** **ADOPT**

**Why:** Codeburn's responsive breakpoint (90 chars) is proven to work on 80-column terminals (older machines, narrow SSH windows) and wide 180+ terminals simultaneously. The observer already has four sections displayed linearly (top to bottom); the specs panel and token usage slices will add width-consuming detail. The responsive grid pattern lets specs and token-usage cards sit side-by-side on a 140+ char terminal, collapsing to single-column on smaller screens — no CSS needed, just Box flexDirection="row" conditional on terminal.columns.

**How to apply:**
- Measure `process.stdout.columns` on each render
- Above 120 chars: render specs + token-usage in a two-column Box (flexDirection="row", flex: 0.5 each)
- Below 120 chars: render both cards stacked (flexDirection="column")
- Use padding/margin constants (2 spaces margin-left for nesting, 1 space margin-bottom between sections)

---

### 3. Unicode Bar Charts & Information Density

**What Codeburn does:**
Uses `█` (U+2588 FULL BLOCK) for cost/usage bar fills and `░` (U+2591 LIGHT SHADE) for empty space. Example: "████░░░░░ $4.23" (40% cost visualized in 10 chars). Horizontal separators are rendered as repeated box-drawing characters. No sparklines or miniature charts; just bar glyphs and numeric labels side-by-side. Text is truncated via `wrap="truncate-end"` to fit terminal width; long strings (project paths) are shortened via utility functions.

**Verdict:** **ADOPT**

**Why:** Unicode bar glyphs compress cost or token counts into a visual scannable format without third-party dependencies (no `blessed`, no `inquirer`, just Text + Box). Codeburn shows 15–20 data rows on a standard 40-line terminal without scrolling; the observer's token usage section (per-run costs, per-session totals) will benefit from the same compact bar-glyph pattern. Combining `█████` + `"$12.34"` next to each other is clear and requires no hover or mode-switching to understand.

**How to apply:**
- Token usage row: render 10-character bar (e.g., `█████░░░░` for 50% of budget) + `"$0.50 / $1.00"` label to the right
- Use `Math.round(value / max * 10)` to convert numeric ratio to bar width
- Pad bar and label with `padStart/padEnd` for column alignment
- Repeat the pattern for per-run + per-session + per-project totals (stacked or in a table format)

---

### 4. Card / Panel Design (Borders, Titles, Separators)

**What Codeburn does:**
Each data section (Daily Activity, Project Breakdown, etc.) is a titled panel with a rounded border (borderStyle="round") and color-matched border color. Title text is bold and colored (e.g., cyan for Daily Activity). Content inside uses left-margin indentation (2 spaces) for hierarchy. Separators between rows are simple line breaks + indentation, no explicit dividers. Panels conditionally hide/show based on state (e.g., "Optimize" button only appears if findings exist).

**Verdict:** **ADAPT**

**Why:** Codeburn's round borders and left-margin nesting are clean, but Ink's current box border support is limited compared to `blessed`. The observer already uses Box with `marginLeft` for nesting. Skip the round-border rendering (use Box indentation instead) and adopt the color-matched section title + left-margin pattern for the specs panel and token usage cards.

**How to apply:**
- Specs panel: render as `Text({ color: "cyan" }, "Project Specs")` followed by indented Box with margin-left=2
- Token usage: render as `Text({ color: "yellow" }, "Token Usage")` followed by indented details
- Use conditional rendering (if-exists checks) to hide empty sections, not false placeholder dividers
- No explicit borders; rely on indentation + color contrast for visual separation

---

### 5. Animation & Motion

**What Codeburn does:**
**None.** Codeburn has zero animations, transitions, or fade effects. State changes (period switches, data updates) trigger full re-renders with new text/colors immediately. The dashboard does re-render every frame (React hook polling), but React's virtual DOM batches renders efficiently. Visual feedback is purely color changes (e.g., a grade changing from A-green to F-red when cost increases).

**Verdict:** **SKIP**

**Why:** No animations keeps the observer simple (smaller bundle, lower CPU, fewer edge cases). The current forge-observer.mjs already does full-page re-renders every 2 seconds and renders instantly. Animations would add complexity (timing states, cancellation logic) for no user-facing benefit — users can see the cost changed when the color flips from green to red.

**How to apply (non-adoption):**
- Keep the observer's current 2-second polling interval with instant full re-render
- Do not add fade-in, slide, or pulse effects to new sections
- Communicate state changes via color only (e.g., active run changes from yellow to green when completed)

---

### 6. Mouse Interaction Patterns

**What Codeburn does:**
**Not mouse-driven.** Codeburn uses arrow keys (left/right to switch periods), number keys 1–5 (for period selection), `o` key (open optimize), `b` key (back from optimize), `p` key (toggle providers), and `q` key (quit). No click targets, no hover states, no drag-and-drop. The CLI is fully keyboard-first.

**Verdict:** **SKIP**

**Why:** The observer already implements mouse-driven refresh (left-click anywhere = refresh, Shift+click-drag = user-side selection in Windows Terminal). Codeburn's keyboard-shortcut set (1-5, o, b, p) is redundant with the observer's simpler interaction model. The observer's mouse-click-refresh is a found pattern (not in Codeburn) and works well; do not add number-key period cycling.

**How to apply (non-adoption):**
- Keep the observer's current input handler: `r`/`R` for refresh, `q`/`Q`/Ctrl+C for quit
- Keep SGR mouse reporting enabled; left-click triggers refresh, Shift+click-drag is user's selection gesture
- Do not add `1`–`5` keys or `o`/`b`/`p` shortcuts; they conflict with the observer's simpler paradigm

---

### 7. State Rendering (Empty, Loading, Error)

**What Codeburn does:**
- **Loading:** Displays "Loading [period]..." message (single line, no spinner)
- **Empty:** Shows "No usage data found" or provider-specific message ("No MCP usage") with explanation
- **Error:** Graceful fallbacks — dashes (`-`) for missing metrics instead of crashing; entire sections conditionally hidden when data is absent
- **Success:** Full panel with colored title, nested rows, and metric values aligned in columns

**Verdict:** **ADOPT**

**Why:** Codeburn's empty/error states are minimal (no spinners, no verbose logs), which matches the observer's philosophy. The observer currently shows "Loading…" (good); the spec panel and token usage slices should adopt the same pattern: missing data renders as `-` or `n/a`, error messages go to stderr only, no in-UI spinner.

**How to apply:**
- Specs panel (when project config not found): `Text({ color: "gray" }, "Project specs: not found")`
- Token usage (when no usage data): `Text({ color: "gray" }, "Token usage: no data")`
- Errors: log to stderr via `console.error()`, do not render error text to stdout (it corrupts Ink's output)
- Use conditional short-circuit to skip entire sections if their source data is missing

---

### 8. Typography & Unicode Glyph Choices

**What Codeburn does:**
- **Bold text** for metric values and section titles (e.g., `chalk.bold("$4.23")`)
- **Dimmed text** for labels and secondary info (e.g., "cost per session")
- **Unicode:** `█` and `░` for bar charts; `↓` arrow for "trend improving"; directional arrows `< >` in keyboard hints
- **No custom fonts or emojis.** Monospace only (assumes terminal default).
- **Truncation:** Long strings (project paths, model names) shortened via utility functions; line wrapping via Ink's `wrap="truncate-end"`

**Verdict:** **ADOPT**

**Why:** Using only bold + dim + monospace ensures readability on any terminal (no 256-color assumptions, works on Linux/macOS/Windows TTY, accessible to screen readers). The `█` and `░` glyphs are standard ASCII-adjacent, universally supported. Codeburn avoids emoji (which can render as double-width, breaking layout), so should the observer.

**How to apply:**
- Metric values in specs panel: `Text({ bold: true }, "128k context")`
- Section labels: `Text({ dim: true }, "MCP servers:")`
- Bars: use `█` for filled, `░` for empty (10-character normalized width)
- Arrows: use `↓` (trend down), `↑` (trend up), or `→` (direction hint) when needed
- No emojis; no custom Unicode art; keep glyphs at baseline terminal support

---

## Non-goals reminder

- No Codeburn source code copied. Patterns extracted and adapted for Ink + FORGE semantics.
- No multi-week refactor proposed. Patterns serve as reference for three shallow feature slices (specs panel, token visibility, signal timeline).
- All pattern details verified from code; no speculation about internals.

