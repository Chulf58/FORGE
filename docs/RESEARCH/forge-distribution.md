# FORGE Distribution Research
_Completed: 2026-03-22_

## Question
How can FORGE (the Electron app) be packaged and copied to another device? What is included in a distributable build, what needs to be configured on the new machine, and whether a one-click installer or portable build is feasible?

## Verdict
**Ready to ship — no code changes needed.** The build pipeline is fully configured. Target machine only needs Claude CLI + API key. No Node.js required.

---

## Build pipeline

Two stages:
1. `electron-vite build` → compiles TS/Svelte into `out/`
2. `electron-builder` → packages into platform installers in `dist/`

| Command | Output |
|---------|--------|
| `npm run build:win` | `dist/forge-<version>-setup.exe` (NSIS installer) + portable exe |
| `npm run build:mac` | `dist/forge-<version>.dmg` |
| `npm run build:linux` | AppImage, snap, deb |

No pre-built artifacts exist in the repo — all built locally on demand.

---

## What the target machine needs

| Requirement | Notes |
|-------------|-------|
| **Claude CLI** | Must be installed and on PATH. FORGE searches 6 known locations then falls back to PATH. Install via `npm i -g @anthropic-ai/claude` or Anthropic's installer. |
| **ANTHROPIC_API_KEY** | Must be set as an environment variable before launching FORGE. FORGE passes it through to Claude subprocess — no credential storage in app. |
| **Node.js** | NOT required. Electron bundles its own runtime. |
| **npm/pnpm** | NOT required. |

---

## Hardcoded paths / portability

None that break across machines. Everything uses:
- `app.getAppPath()` for bundled resources (templates, agents)
- `app.getPath('userData')` for settings and project registry (resolves to platform-appropriate location automatically)
- `findClaude()` searches platform-specific PATH locations with fallback

The `electron-builder.yml` already specifies `asarUnpack` for `.claude/**` and `templates/**` so file operations on those directories work in packaged builds.

---

## Deployment options

**Portable ZIP (recommended for internal/team use)**
1. `npm run build:unpack` → builds to `dist/` without packaging
2. Zip the unpacked directory, transfer via USB/cloud
3. Extract, run `forge.exe` directly
4. No system integration (no shortcuts/uninstaller), but zero installer friction

**NSIS Installer (recommended for Windows public release)**
1. `npm run build:win`
2. Transfer `dist/forge-<version>-setup.exe`
3. Creates Program Files entry, desktop shortcut, Start Menu entry

**Native installers**: DMG (macOS drag-to-Applications), deb/AppImage (Linux) — each requires a separate platform build.

---

## Blockers

| Issue | Severity | Notes |
|-------|----------|-------|
| Code signing (Windows) | Low for internal | Shows "Unknown Publisher" warning without Authenticode cert; fine for trusted network |
| Code signing (macOS) | Medium for external | Gatekeeper blocks unsigned apps; notarization disabled in current config; user can right-click → Open to bypass |
| Auto-update URL | Not urgent | Configured as `https://example.com/auto-updates` placeholder — not functional |
| No native modules | None | All deps are pure JS; `npmRebuild: false` in config |

**No blockers for internal distribution.** Code signing only required for public/App Store release.

---

## Recommendation

For "copy to another device" today: **run `npm run build:win`, send the setup.exe, install Claude CLI separately.** That's the full workflow — no code changes needed.

If a smoother onboarding experience is wanted later, consider:
- A setup script that checks for Claude CLI and prompts for the API key
- Enabling the auto-update mechanism (update the placeholder URL)
- macOS notarization for wider distribution
