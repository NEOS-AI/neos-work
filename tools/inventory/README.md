# Capability inventory

Dumps bundled agents, skills, design-systems, plugins, media providers, domain
packs, MCP tools, and train feature gates (`v06Features`, `v07Features`) for
drift checks.

```bash
pnpm inventory
pnpm inventory:check
pnpm inventory:write
pnpm test:inventory
```

Gates fail (`inventory:check` exit 1) when catalogs drop below minima or when
required v0.6 / v0.7 surface files are missing (see `docs/migration/v0.7.0.md`).
