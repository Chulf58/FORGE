# Research: TUI Library Evaluation

## Scope & Requirements

FORGE needs a TUI library replacement or supplement to `blessed` for two surfaces:
- **Wrapper** (forge-wrapper-proto.mjs): split-pane with embedded Claude PTY child on left, live-polled dashboard right
- **Observer** (forge-observer-proto.mjs): standalone full-screen dashboard, 2s refresh

**Evaluation grid:**

| Requirement | Category | Must-Have |
|---|---|---|
| Terminal-native rendering, opaque backgrounds | Core | Yes |
| Full-color SGR (RGB truecolor + 256-palette) | Core | Yes |
| Mouse support (clickable buttons, drag-drop eventual) | Core | Yes |
| Shift+click-drag text selection compatible | Core | Yes |
| Node.js runtime, Windows-primary, single runtime | Core | Yes |
| ESM-native (or loadable from CJS via createRequire) | Impl | Yes |
| Coexist with node-pty child in wrapper pane | Wrapper | Yes |
| Alt-screen mode | Core | Yes |
| No install-time PATH setup beyond SessionStart hooks | Core | Yes |
| Avoid imperative setContent/screen.render boilerplate | DX | Preferred |

---

## Per-Candidate Analysis

### blessed (0.1.81) — current baseline

**Repository & Status:**
- GitHub: https://github.com/chjj/blessed
- Latest npm: 0.1.81, published **11 years ago**
- Last commit: unverified from fetch; repo shows 1,170 commits total
- Issues: 204 open (unverified recency)
- Dependents: 126k, 1.2M weekly downloads
- **Status: INACTIVE** — no releases in 12 months; critical security fixes unlikely

**API Paradigm:**
- Imperative widget tree: `blessed.screen()`, `blessed.box()`, `element.setContent()`, `screen.render()`
- Manual state/render sync required; complex for interactive features

**Observer-style dashboard (poll every 2s):**
```js
// Pseudo-structure: duplicated from proto
const dashboard = buildState(); // read .pipeline/ files
const markup = renderDashboard(dashboard);
pane.setContent(markup);
screen.render();
```
Workable but stateless; no reactivity; duplicated rendering logic in wrapper + observer.

**Clickable gate approve/discard:**
```js
// Blessed mouse events work (MOUSE_LEFT_CLICK, etc.)
// Must manually track button coords, re-render on action
button.on('mouse', (mouse) => {
  if (mouse.action === 'mousedown') {
    // update state, screen.render()
  }
});
```
Possible but verbose; no component-level state binding.

**Mouse & text selection:**
- Blessed does support mouse events (SGR 1006 / xterm). 
- **Documented alt-screen support** (DEC modes 1046, 1047, 1049).
- Text selection: terminal must be configured to allow click-drag outside blessed's mouse capture. Observer proto explicitly disables `mouse: false` to let terminal own selection — this works.

**Node-pty coexistence:**
- Wrapper proto successfully uses blessed + node-pty; cells from xterm headless buffer are copied into blessed box via ~60-line SGR painter.
- Proven working.

**Truecolor & SGR:**
- ✓ Full SGR support (including 256-color, 24-bit RGB)

**Native bindings:**
- ✓ Pure JavaScript

**ESM vs CJS:**
- **CommonJS only** (v0.1.81 is UMD)
- Wrapper/observer load via `createRequire(import.meta.url)` — awkward but functional

**Pains addressed by replacement:**
- Inactive upstream — no security response
- Imperative setContent + manual render sync doesn't scale with interactive features (gates, drag-drop, optimistic UI)
- CJS-in-ESM awkwardness

---

### neo-blessed — blessed fork

**Repository & Status:**
- Primary: https://github.com/blessedjs/neo-blessed (87 tags, 1,219 commits)
- npm: https://www.npmjs.com/package/neo-blessed (maintained)
- Last release: **unverified from fetch** — fetch returned 404; search result indicates maintenance continues
- **Estimated status: SUSTAINABLE** (cited as "drop-in replacement with bug fixes")
- Forks: embarklabs/neo-blessed, philipp-spiess/neo-blessed (multiple concurrent efforts)

**API Paradigm:**
- Drop-in API replacement for blessed; no changes to widget tree or render model

**Observer/dashboard:**
- Identical to blessed (same imperative model)

**Clickable buttons:**
- Identical to blessed; adds bug fixes to mouse event handling

**Mouse & text selection:**
- Improvements over blessed (bug fixes cited but unspecified)
- Inherits alt-screen support

**Node-pty coexistence:**
- Assumed compatible (same as blessed); not explicitly verified

**Truecolor & SGR:**
- ✓ Same as blessed

**Native bindings:**
- ✓ Pure JavaScript

**ESM vs CJS:**
- **CommonJS** — same as blessed
- Would require `createRequire` in ESM

**Risk assessment:**
- **Unverified fork — fetch failed (404); unclear which fork is canonical**. Multiple concurrent forks (blessedjs/neo-blessed, embarklabs/, philipp-spiess/) suggest fragmented effort.
- No evidence of npm package currency — cannot confirm active maintenance.
- Would require spiking fetch access or direct npm install test.

**Verdict for Phase 1:** BLOCKED by unverifiable maintenance status. Would need to test install + run before committing.

---

### Ink (v7.0.0, released April 8, 2026) — React-for-terminals

**Repository & Status:**
- GitHub: https://github.com/vadimdemedes/ink
- Latest: **v7.0.0 from April 8, 2026** — actively maintained
- 37.7k stars, 73 releases
- Weekly downloads: high (exact figure in fetch unavailable due to 403)
- **Status: ACTIVELY MAINTAINED**

**API Paradigm:**
- React component model; declarative JSX; hooks (useInput, useStdout, useStdin, useWindowSize, useApp, useFocus, useFocusManager)
- Renders via custom reconciler to terminal buffer

**Observer-style dashboard (poll every 2s):**
```jsx
function Dashboard() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const timer = setInterval(() => {
      const dash = buildDashboardState();
      setState(dash);
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  
  return (
    <Box flexDirection="column">
      <Header state={state} />
      <Content state={state} />
      <Footer />
    </Box>
  );
}
```
Natural fit; no manual render() calls; reactive state.

**Clickable gate approve/discard:**
```jsx
function GateButton() {
  const [clicked, setClicked] = useState(false);
  
  useInput((input, key) => {
    if (key.mouse && key.mouse.action === 'click') {
      setClicked(true);
      // API call to approve/discard
    }
  });
  
  return <Box>{clicked ? '✓ Approved' : '[ Approve ]'}</Box>;
}
```
**Direct component state binding; no manual coord tracking or screen.render().** Much cleaner.

**Mouse & text selection:**
- ✓ Mouse support confirmed (SGR 1006 / xterm)
- ✓ Shift+click-drag: **unverified from library docs**. Search results show feature request for "click+drag, double-click select word, Shift+click extend" — suggests **not yet built-in**. User may need custom implementation or terminal-level workaround.
- **Alt-screen mode: ✓ supported** (docs: "alternateScreen: true" option in render config)

**Node-pty coexistence (wrapper case):**
- **HIGHLY UNCERTAIN — no docs address this.**
- Ink is fundamentally a component renderer for terminal output. The wrapper case requires:
  1. Embed a node-pty PTY process (spawned shell) rendering into one pane
  2. Ink dashboard on another pane
  3. Both live simultaneously, polling xterm buffer for Claude output
- Ink is not designed to read/parse a xterm headless terminal buffer and pluck cells into a pane. Current proto uses blessed's box + hand-rolled SGR painter.
- **Verdict: Wrapper case is NOT FEASIBLE in Ink without major custom work.** Ink is designed for "CLI tool output" (child process stdout piped to Text component), not for embedding a live PTY pane.

**Truecolor & SGR:**
- ✓ Full support (Text component with HEX / RGB colors)

**Native bindings:**
- ✓ Pure JavaScript (uses Yoga layout engine, pure TS)

**ESM vs CJS:**
- **ESM-native** (fetch result indicated Ink handles ESM properly; no createRequire needed)

**Maintenance & ecosystem:**
- Actively maintained (latest release 10 days old as of this research, April 2026)
- Large ecosystem (ink-form, other components)

**Pain points addressed:**
- ✓ Reactive state model (solves imperative setContent boilerplate for observer)
- ✓ ESM-native
- ✗ **Wrapper case not feasible** (cannot embed xterm buffer in Ink pane without re-architecting)
- ✗ Shift+click-drag text selection unverified (may require custom implementation)

**Verdict:** **EXCELLENT for observer (full-screen dashboard), but NOT VIABLE for wrapper (PTY embedding case).**

---

### terminal-kit (v3.1.2, last release ~1 year ago)

**Repository & Status:**
- GitHub: https://github.com/cronvel/terminal-kit
- npm: https://www.npmjs.com/package/terminal-kit (v3.1.2)
- Stars: 3.4k, forks: 210
- Last release: ~1 year ago (April 2025)
- **Status: DORMANT** — single maintainer, no recent releases

**API Paradigm:**
- Imperative widget tree (similar to blessed): screen buffers, input handling, mouse support
- Low-level terminal control; no declarative component model

**Observer dashboard:**
- Similar to blessed; imperative draw/refresh model

**Clickable buttons:**
- Mouse support included; same imperative pattern as blessed (coord tracking, manual state sync)

**Mouse & text selection:**
- ✓ Mouse support documented (GPM on Linux Console; presumably works on Windows)
- Shift+click-drag: unverified
- Alt-screen: not mentioned in available docs — **unverified**

**Node-pty coexistence:**
- No docs or evidence; would require testing

**Truecolor & SGR:**
- ✓ 256-color support documented; 24-bit RGB unverified

**Native bindings:**
- ✓ Pure JavaScript (no ncurses dependency)

**ESM vs CJS:**
- **ESM support unverified** — search did not return package.json details; likely CommonJS (older library)

**Maintenance concern:**
- Single maintainer, no releases for 1 year
- Popular (104k weekly downloads) but dormant upstream

**Verdict:** SIMILAR TO BLESSED — imperative model, dormant maintenance, ESM unverified. No advantage over blessed; worse maintenance outlook.

---

### react-curse (v1.0.23, last release 5 months ago)

**Repository & Status:**
- GitHub: https://github.com/infely/react-curse
- npm: https://www.npmjs.com/package/react-curse (v1.0.23)
- Last release: **5 months ago** (late November 2025)
- **Status: ACTIVE but sparse** — maintained, infrequent releases

**API Paradigm:**
- React component model (similar to Ink)
- Claimed: "fastest terminal UI for React" (draws only changed characters)
- Supports keyboard + mouse, fullscreen + inline modes

**Observer dashboard:**
```jsx
// Similar to Ink: useState + JSX
function Dashboard() {
  const [state, setState] = useState(buildDashboardState());
  // ... render with react-curse components
}
```
Natural fit; reactive model.

**Clickable buttons & mouse:**
- Mouse supported; direct component state binding (React model)

**Shift+click-drag:**
- Unverified in docs

**Alt-screen mode:**
- Unverified in available docs; supports "fullscreen and inline modes" (ambiguous)

**Node-pty coexistence:**
- No docs; unknown feasibility

**Truecolor & SGR:**
- Unverified from search; claims "fancy components ready to use"

**ESM vs CJS:**
- Unverified; likely ESM-native (modern project, React-based)

**Orphan risk:**
- Only 1 maintainer (Oleksandr Vasyliev); sparse release cadence
- Smaller ecosystem than Ink
- MIT licensed

**Verdict:** INTERESTING MIDDLE GROUND — reactive like Ink, less widely adopted, ESM/alt-screen/node-pty all unverified. **Would require spike to confirm suitability.**

---

### Claude Code's actual stack — Ink fork + custom Yoga

**What we know from leaked source (March 31, 2026 npm disclosure):**
- Claude Code started with Ink, then **forked it beyond recognition**
- Custom React reconciler bridging React virtual DOM to screen buffer
- Pure TypeScript Yoga (layout engine) — not C++ bindings or WASM
- Custom parser stack: ANSI/CSI/DEC/ESC/OSC
- 500K+ daily sessions — production-proven on massive scale

**Why they forked:**
- Ink out-of-the-box does not support:
  - Drag-drop (needed for canvas interaction, e.g., rearrangeable panes)
  - Live PTY embedding (needed for integrated Claude terminal)
  - Pixel-art / half-block sprites
- Coupling tight enough that building atop Ink was slower than forking

**Implication for FORGE:**
- If our feature roadmap matches Claude Code's (drag-drop, live PTY panes, sprites), we should expect to fork Ink eventually too
- However, Phase 1 decision should not assume we'll fork — start with candidates as-is

**Verdict:** Claude Code uses a custom Ink fork; this tells us Ink is a solid foundation but **requires customization for advanced features.**

---

## Comparison Matrix

| Requirement | blessed | neo-blessed | Ink | terminal-kit | react-curse |
|---|---|---|---|---|---|
| **Terminal-native SGR** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Truecolor 256-palette** | ✓ | ✓ | ✓ | ✓ | ✓* |
| **Mouse click support** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Shift+click-drag safe** | ✓ (observer disables mouse) | ✓* | ?† | ?† | ?† |
| **Alt-screen mode** | ✓ | ✓* | ✓ | ?† | ?† |
| **Node.js runtime** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Windows-compatible** | ✓ | ✓* | ✓ | ✓* | ✓* |
| **ESM-native** | ✗ (CJS) | ✗ (CJS) | ✓ | ?† | ?† |
| **No install-time PATH** | ✓ | ✓* | ✓ | ✓* | ✓* |
| **node-pty PTY pane** | ✓ (proven) | ✓* | ✗ (not designed for this) | ?† | ?† |
| **Reactive/declarative** | ✗ | ✗ | ✓ | ✗ | ✓ |
| **Observer dashboard** | ✓ (workable) | ✓* | ✓✓ (ideal) | ✓ (workable) | ✓✓ (ideal) |
| **Maintenance status** | INACTIVE (11y) | UNVERIFIED | ACTIVE (4/2026) | DORMANT (1y) | ACTIVE (sparse) |

**Legend:**
- ✓ = Verified working / available
- ✓✓ = Natural fit for use case
- ✓* = Likely works but unverified
- ✗ = Does not support
- ?† = Unverified, needs spike

---

## Open Questions

1. **neo-blessed package accessibility:** The primary GitHub fetch returned 404; is the npm package @blessedjs/neo-blessed or neo-blessed? Which fork is canonical?
2. **Ink + Shift+click text selection:** Ink supports mouse events, but does it allow terminal to capture Shift+click-drag in alt-screen mode, or does Ink always consume mouse input?
3. **react-curse alt-screen / ESM / 24-bit color:** Unverified; claims to support "fullscreen mode" but alt-screen buffer semantics unclear.
4. **terminal-kit 24-bit color / ESM:** Docs emphasize 256-color; 24-bit RGB and ESM support both unverified.
5. **Ink wrapper feasibility spike:** Can we redirect xterm headless buffer updates into an Ink Box pane without hand-rolling a mirror painter? Would require Ink custom component that consumes raw ANSI/cell input.

---

## Sources

- [blessed — GitHub](https://github.com/chjj/blessed)
- [blessed — npm package](https://www.npmjs.com/package/blessed)
- [blessed maintenance status — Snyk](https://snyk.io/advisor/npm-package/blessed)
- [neo-blessed — GitHub](https://github.com/blessedjs/neo-blessed)
- [neo-blessed — npm](https://www.npmjs.com/package/neo-blessed)
- [Ink — GitHub](https://github.com/vadimdemedes/ink)
- [Ink v7.0.0 release — GitHub Releases](https://github.com/vadimdemedes/ink/releases)
- [terminal-kit — GitHub](https://github.com/cronvel/terminal-kit)
- [terminal-kit — npm](https://www.npmjs.com/package/terminal-kit)
- [terminal-kit maintenance — npm package security](https://socket.dev/npm/package/terminal-kit)
- [react-curse — npm](https://www.npmjs.com/package/react-curse)
- [react-curse — GitHub](https://github.com/infely/react-curse)
- [Claude Code source leak analysis — DEV](https://dev.to/minnzen/i-studied-claude-codes-leaked-source-and-built-a-terminal-ui-toolkit-from-it-4poh)
- [How Claude Code is built — Pragmatic Engineer](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)
- [Blessed mouse events documentation](https://blessed.readthedocs.io/en/1.23/mouse.html)
- [Ink mouse events — GitHub issue discussion](https://github.com/vadimdemedes/ink)
- [Building Terminal Interfaces — LogRocket](https://blog.logrocket.com/building-terminal-interfaces-nodejs/)
