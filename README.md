# NEOS Work

An open-source alternative to Claude Cowork — **local-first agent platform**
with two equal product surfaces:

| Surface | What it is |
|---|---|
| **Workflow** | Cowork-style automation graphs, Domain Workers, packs, gates |
| **Design Project** | File workspace + **Design Editor** (LLM generate → edit → refine) |

**[한국어](README.ko.md)** | **English**

---

## Quick start — Design Editor loop (v0.5)

```bash
pnpm install
pnpm --filter @neos-work/server dev   # note NEOS_PORT + NEOS_AUTH_TOKEN
# Desktop: cd apps/desktop && pnpm tauri dev
# or Web:  pnpm --filter @neos-work/web dev  → paste token
# Create a Design Project → open Editor (Preview / Code / Layers)
# Chat brief → agent writes HTML → edit in Code → save → Preview reloads
# Select a layer → Edit with AI (patch / replace-selection by default)
```

CLI headless: `pnpm neos -- doctor` · `neos project list` · `neos mcp serve`

**Migration (v0.4 → v0.5):** [docs/migration/v0.5.0.md](docs/migration/v0.5.0.md)  
**Security:** [docs/security/v0.5.md](docs/security/v0.5.md)  
**Capability dump:** `pnpm inventory` / `pnpm inventory:check` · smoke: `pnpm e2e:smoke`

---

## What's new in v0.5

- **Design Projects** + path sandbox, revisions, folder import
- **Design Editor**: Preview · Code · Layers (Figma-like tree) · Inspect · Edit with AI
- **Agent runtime** registry (≥12 coding-agent CLI defs), runs + SSE + `editContext`
- Skills packages (`SKILL.md`), plugins/atoms, media multi-provider, live artifacts
- **`neos` CLI**, browser **web** client, **Docker** self-host
- Domain Pack **custom loader**, NEOS as **MCP server** (`neos mcp serve`)

v0.4 Domain Workers / schemaVersion **2** workflows are unchanged.

---

## What's new in v0.4.0

v0.4.0 redesigns agents around **Domain Workers** and workflow **schemaVersion 2**.

- Unified graph node: `agent` + `workerId` (replaces `agent_finance` / `agent_coding`)
- Built-in **Domain Packs**: finance, coding, research, general
- **Coordinator** mode (`spawn_worker` / `await_workers`) without a separate node type
- API: **`/api/workers`**, **`/api/domain-packs`** (`/api/harness` deprecated alias)
- Typed ports MVP (soft warnings; set `strictPorts=1` for hard fail)

**Migration:** existing workflows upgrade automatically on load. See
[docs/migration/v0.4.0.md](docs/migration/v0.4.0.md) for the full breaking
changelog and checklist.

---

## Running Locally

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Rust** (for the Tauri desktop app) — install via [rustup](https://rustup.rs)

### Install

```bash
pnpm install
```

### Development

#### Backend server only

```bash
cd apps/server
pnpm dev
```

The server binds to `127.0.0.1` on a random port. The actual port is printed to the console as `NEOS_PORT=<port>` on startup.

#### Desktop app (Tauri + Vite)

```bash
cd apps/desktop
pnpm tauri dev
```

This starts the Vite dev server (`http://localhost:1420`) and the Tauri window together.

#### Full workspace (Turborepo)

Run from the repo root to build all packages and start all dev servers simultaneously:

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

## Configuration (API Keys & Environment Variables)

### API Keys

NEOS Work does **not** use `.env` files for secrets. API keys and other sensitive values are entered via the **Settings page** in the app UI and stored encrypted (AES-256-GCM) in `~/.neos-work/data.db`.

Supported setting keys:

| Key | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `TAVILY_API_KEY` | Tavily web search API key |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | Korea Investment & Securities API keys |

To set a key directly via the REST API:

```bash
curl -X PUT http://127.0.0.1:<PORT>/api/settings/ANTHROPIC_API_KEY \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d '{"value": "sk-ant-..."}'
```

> `PORT` and `AUTH_TOKEN` are printed to the console when the server starts.

### Server Environment Variables

You can control server behavior by exporting variables in your shell or passing them inline:

| Variable | Default | Description |
|---|---|---|
| `PORT` | random | Port the server listens on (OS-assigned if unset) |

**Example** (fixed port, standalone server):

```bash
cd apps/server
PORT=3000 pnpm dev
```

> The server does not auto-load `.env` files. To use one, inject variables via a tool like `dotenv-cli`:
> ```bash
> npx dotenv-cli -e .env -- pnpm dev
> ```

### Other Commands

| Command | Description |
|---|---|
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm format` | Format with Prettier |
| `pnpm inventory` | Dump capability catalog JSON (agents/skills/plugins/…) |
| `pnpm inventory:check` | Fail if catalog gates miss minima |
| `pnpm inventory:write` | Write `docs/generated/capability-inventory.json` |
| `pnpm e2e:smoke` | Fixture + inventory contract smoke |
| `pnpm clean` | Remove build artifacts and node_modules |

## Browser web client

MVP browser UI (`apps/web`, v0.5.x):

```bash
# terminal 1 — engine
pnpm --filter @neos-work/server dev

# terminal 2 — Vite (proxies /api → daemon)
pnpm --filter @neos-work/web dev
# open http://localhost:5173 — paste NEOS_AUTH_TOKEN from server logs
```

Serve the built SPA from the daemon:

```bash
pnpm --filter @neos-work/web build
NEOS_WEB_DIST="$(pwd)/apps/web/dist" pnpm --filter @neos-work/server start
```

## Self-host (Docker)

Single-process engine with a persistent volume (v0.5.19 / Task 13):

```bash
cp deploy/.env.example deploy/.env
# set NEOS_AUTH_TOKEN (openssl rand -hex 32)
docker compose -f deploy/docker-compose.yml up -d --build
curl -s http://127.0.0.1:3000/api/health
```

See [deploy/README.md](deploy/README.md) for volumes, env vars, and CLI usage.

### Local tools/dev lifecycle

```bash
node tools/dev/dev.mjs start
node tools/dev/dev.mjs status
node tools/dev/dev.mjs logs -f
node tools/dev/dev.mjs stop
```

