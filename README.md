# FORGE

AI-powered development pipeline manager for Claude Code. Plans, implements, reviews, and applies features through a structured agent pipeline.

## Install

### From self-hosted marketplace

Requires the FORGE repo to be hosted on a public git service (GitHub, GitLab, etc.).

```bash
# Add the marketplace
claude plugin marketplace add <owner>/forge-plugin

# Install FORGE
claude plugin install forge@forge-tools
```

Or from inside a Claude Code session:

```
/plugin marketplace add <owner>/forge-plugin
/plugin install forge@forge-tools
```

Replace `<owner>/forge-plugin` with the actual repository path once a remote is configured.

### From local directory

```bash
claude --plugin-dir /path/to/forge-plugin
```

## After install

Run `/forge:init` in any project to set up FORGE pipeline state. Then:

- `/forge:help` -- what FORGE can do
- `/forge:plan` -- plan a feature
- `/forge:status` -- project snapshot
- `/forge:dashboard` -- live dashboard in browser

## What's included

- 29 specialist agents
- 21 skills (slash commands)
- 13 hook scripts across 7 lifecycle events
- 24 MCP tools for structured pipeline state access
- Optional HTTP sidecar dashboard with gate actions and merge-blocked handling

## License

MIT
