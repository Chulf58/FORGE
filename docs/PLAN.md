# Active Plan

## Active Plan

### Feature: Git Integration for Apply Pipeline

- [ ] 1. Add `gitIntegration` to `ALLOWED_CONFIG_KEYS` in `mcp/server.js` (`mcp/server.js`)
  Append `"gitIntegration"` to the `ALLOWED_CONFIG_KEYS` array at line 262. The value is an object — the allowlist check gates on the key name only; no type validation of the object is required at this layer.
  Verify: `ALLOWED_CONFIG_KEYS` in `mcp/server.js` includes `"gitIntegration"`; `forge_set_project_config` accepts `{ gitIntegration: { enabled: false } }` without returning an "Unknown config key" error.

- [ ] 2. Add git helper functions to `skills/apply/SKILL.md` — branch creation step (`skills/apply/SKILL.md`) (wave: 1)
  Before the pipeline sequence section, add a `## Git integration` section describing the full git workflow. All steps are gated on `gitIntegration.enabled === true` in `.pipeline/project.json` (read via `forge_read_project` or Read fallback). Define the branch name as `${branchPrefix}${slug}` where `branchPrefix` defaults to `"forge/"` and `slug` comes from `$ARGUMENTS` or the first `### Feature:` heading in `docs/PLAN.md`. Document the branch creation step: run `git checkout -b <branch>` via Bash. If it fails (branch exists, dirty tree, or any error): log the error to output, emit a one-line warning, and **continue** — never abort the pipeline.
  Verify: `skills/apply/SKILL.md` contains a `## Git integration` section; branch name derivation from `$ARGUMENTS` and PLAN.md fallback is described; error-and-continue behaviour is explicit; step is gated on `gitIntegration.enabled`.

- [ ] 3. Add auto-commit step to `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 2)
  Within the same `## Git integration` section, document the post-implementer + post-test commit step. Only runs when `gitIntegration.autoCommit === true`. Commit message format: `"feat(forge): <feature name>"`. Steps: `git add -A`, then `git commit -m "<message>"`. Handle two known failure cases explicitly: (a) nothing to commit — detect by exit code or output containing "nothing to commit"; log and skip silently. (b) pre-commit hook failure — log full output, emit a one-line warning, and continue. Never use `--no-verify`. Never amend. Never force.
  Verify: `skills/apply/SKILL.md` documents the commit step under `## Git integration`; commit message format is `feat(forge): <feature name>`; "nothing to commit" is handled as a silent skip; pre-commit hook failure is logged and continued; `--no-verify`, `--amend`, and force flags are explicitly forbidden.

- [ ] 4. Add auto-PR step to `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 3)
  Within the same `## Git integration` section, document the post-documenter PR step. Only runs when `gitIntegration.autoPR === true`. Before attempting PR creation: (a) check `gh` is installed via `gh --version`; if missing, log "gh CLI not found — skipping PR creation" and skip. (b) run `git push -u origin <branch>` first; if push fails, log the error and skip PR creation. Then run `gh pr create --title "feat(forge): <feature name>" --body "Applied by FORGE apply pipeline."`. If `gh pr create` fails (not authenticated, repo not found, etc.): log the full error output and continue — do not abort. Never `git push --force`.
  Verify: `skills/apply/SKILL.md` documents the PR step; `gh --version` check precedes any `gh pr create` call; `git push` precedes `gh pr create`; all failure modes (gh missing, push fails, gh pr fails) log and continue; `--force` push is explicitly forbidden.

- [ ] 5. Integrate git steps into the pipeline sequence in `skills/apply/SKILL.md` (`skills/apply/SKILL.md`) (wave: 4)
  Update the `## Pipeline sequence` numbered list to include git steps at the correct positions:
  1. Git branch creation (if `gitIntegration.enabled`) — **before** implementer-triage
  2. Implementer-triage (unchanged)
  3. Implementer (unchanged)
  4. Test execution (unchanged)
  5. Auto-commit (if `gitIntegration.autoCommit`) — **after** tests pass (or after implementer if no tests)
  6. Documenter (unchanged)
  7. Auto-PR (if `gitIntegration.autoPR`) — **after** documenter
  Verify: `## Pipeline sequence` in `skills/apply/SKILL.md` lists git branch as step before implementer-triage; auto-commit appears after test execution; auto-PR appears after documenter; all three steps are gated on their respective config flags.

- [ ] 6. Document `gitIntegration` config in `docs/gotchas/GENERAL.md` (`docs/gotchas/GENERAL.md`)
  Add a new `## Git integration — apply pipeline` section. Document: the config schema (full JSON block with all four fields and their defaults), where it lives (`.pipeline/project.json`), what each field does, slug derivation order (`$ARGUMENTS` → first `### Feature:` heading in `docs/PLAN.md`), commit message format, PR title format, and the non-destructive safety guarantees (no force push, no amend, no `--no-verify`). Keep under 30 lines.
  Verify: `docs/gotchas/GENERAL.md` contains a `## Git integration` section; the config JSON block shows all four fields with correct defaults; slug derivation and commit/PR formats are documented; safety guarantees are listed.

### Research needed

- Confirm `gh pr create` flag name for PR body on Windows (some versions use `--body`, some use `--body-file`). The plan assumes `--body` with inline text — Researcher should verify the minimum supported `gh` CLI version and flag availability.
- Confirm whether `git checkout -b` is the correct command when the project may use git worktrees (where branches may already be checked out in another worktree and the error message differs from the normal "branch already exists" case).

### Approach summary

**Key decisions:**
- All git steps live in `skills/apply/SKILL.md` as natural language instructions — no new hook scripts or Node.js files needed. The apply skill already runs in `fork` context with `Bash` in its allowed-tools, so git CLI calls are native.
- Tasks 2–5 all touch `skills/apply/SKILL.md` but are sequenced waves 1→2→3→4 to avoid concurrent writes to the same file; each wave builds on the prior section content.

**Trade-offs accepted:**
- PR body is a static one-liner — no dynamic summary from handoff.md. Keeps the implementation simple; the user can edit the PR body after creation.
- Slug falls back to PLAN.md heading parsing rather than a structured config field — avoids adding a new config key but is fragile if the plan heading is unusual.

**Uncertainties:**
- `gh pr create` flag compatibility across versions and platforms (see Research needed above).

---

### Feature: Hello World Slash Command

- [ ] 1. Create the `/forge:hello` slash command file (`commands/forge/hello.md`)
  Create `commands/forge/hello.md` with a minimal prompt body that outputs the text "Hello, World!" when invoked. No YAML frontmatter is required for a simple static command. The file body should be a single instruction directing Claude to respond with "Hello, World!".
  Verify: `commands/forge/hello.md` exists and contains text that will cause Claude to output "Hello, World!" when the user types `/forge:hello`.

### Research needed

- None.

### Approach summary

**Key decisions:**
- Single file, single task — the minimum needed for a working slash command. Slash commands in this plugin are Markdown files under `commands/forge/`; no agent, hook, or config change is required for a static response command.
