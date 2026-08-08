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
**Capability dump:** `pnpm inventory` / `pnpm inventory:check` · smoke: `pnpm e2e:smoke` · contract: `pnpm e2e:contract` · journey: `pnpm e2e:journey` · browser: `pnpm e2e:browser` · C5: `pnpm e2e:c5` · live (opt-in): `NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke`  
**v0.5 closeout:** [docs/plans/PLAN_FOR_V0_5_29.md](docs/plans/PLAN_FOR_V0_5_29.md) · **v0.6 plan:** [docs/plans/PLAN_FOR_V0_6_0.md](docs/plans/PLAN_FOR_V0_6_0.md)  
**v0.6 migration:** [docs/migration/v0.6.0.md](docs/migration/v0.6.0.md) · **Helm:** [deploy/helm/neos-work](deploy/helm/neos-work)  
**v0.7 plan:** [docs/plans/PLAN_FOR_V0_7_0.md](docs/plans/PLAN_FOR_V0_7_0.md) · **v0.7 migration:** [docs/migration/v0.7.0.md](docs/migration/v0.7.0.md)  
**v0.8 plan:** [docs/plans/PLAN_FOR_V0_8_0.md](docs/plans/PLAN_FOR_V0_8_0.md) · **v0.8 migration:** [docs/migration/v0.8.0.md](docs/migration/v0.8.0.md)  
**v0.9 plan:** [docs/plans/PLAN_FOR_V0_9_0.md](docs/plans/PLAN_FOR_V0_9_0.md) · **v0.9 migration:** [docs/migration/v0.9.0.md](docs/migration/v0.9.0.md) · **dual-surface:** [docs/reference/dual-surface.md](docs/reference/dual-surface.md)  
**v0.10 plan:** [docs/plans/PLAN_FOR_V0_10_0.md](docs/plans/PLAN_FOR_V0_10_0.md) · **migration:** [docs/migration/v0.10.0.md](docs/migration/v0.10.0.md) · **release:** [docs/releases/v0.10.3.md](docs/releases/v0.10.3.md) · inventory `v10Features`  
**v0.11 plan:** [docs/plans/PLAN_FOR_V0_11_0.md](docs/plans/PLAN_FOR_V0_11_0.md) · **migration:** [docs/migration/v0.11.0.md](docs/migration/v0.11.0.md) · **release:** [docs/releases/v0.11.3.md](docs/releases/v0.11.3.md) · inventory `v11Features`  
**v0.12 plan:** [docs/plans/PLAN_FOR_V0_12_0.md](docs/plans/PLAN_FOR_V0_12_0.md) · **migration:** [docs/migration/v0.12.0.md](docs/migration/v0.12.0.md) · **release:** [docs/releases/v0.12.3.md](docs/releases/v0.12.3.md) · inventory `v12Features`  
**v0.13 plan:** [docs/plans/PLAN_FOR_V0_13_0.md](docs/plans/PLAN_FOR_V0_13_0.md) · **migration:** [docs/migration/v0.13.0.md](docs/migration/v0.13.0.md) · **release:** [docs/releases/v0.13.3.md](docs/releases/v0.13.3.md) · inventory `v13Features`  
**v0.14 plan:** [docs/plans/PLAN_FOR_V0_14_0.md](docs/plans/PLAN_FOR_V0_14_0.md) · **migration:** [docs/migration/v0.14.0.md](docs/migration/v0.14.0.md) · **release:** [docs/releases/v0.14.1.md](docs/releases/v0.14.1.md) · inventory `v14Features`  
**v0.15 plan:** [docs/plans/PLAN_FOR_V0_15_0.md](docs/plans/PLAN_FOR_V0_15_0.md) · **migration:** [docs/migration/v0.15.0.md](docs/migration/v0.15.0.md) · **release:** [docs/releases/v0.15.0.md](docs/releases/v0.15.0.md) · inventory `v15Features`  

## What's new in v0.15

- **0.15.0** **Browser Design Project E2E** — `pnpm e2e:browser` (Playwright Chromium: Connect → create → Code → Save → Preview; Node 22+; PR CI) ([plan](docs/plans/PLAN_FOR_V0_15_0.md) · [migration](docs/migration/v0.15.0.md) · [release](docs/releases/v0.15.0.md) · [impl](docs/implementation/v0.15/v0.15.0.md) · inventory `v15Features`)

---

## What's new in v0.14

- **0.14.0** **Process API golden path** — `pnpm e2e:journey` boots built server and covers health → project → file `hash` → collab → lock 409/423 → dry-run (Node 22+; PR CI) ([plan](docs/plans/PLAN_FOR_V0_14_0.md) · [impl](docs/implementation/v0.14/v0.14.0.md))  
- **0.14.1** Multi-replica live **L7** agent hard-enforce 423 + train closeout — [migration](docs/migration/v0.14.0.md) · [release](docs/releases/v0.14.1.md) · inventory `v14Features` ([impl](docs/implementation/v0.14/v0.14.1.md))  

---

## What's new in v0.13

- **0.13.0** **Contract smoke** covers agent hard-enforce 423, run→session bind inherit, and tools/files write ([plan](docs/plans/PLAN_FOR_V0_13_0.md) · [impl](docs/implementation/v0.13/v0.13.0.md))  
- **0.13.1** Locks snapshot **hardEnforce / agentsHardEnforce** + run summary **collabSessionId** in contract ([impl](docs/implementation/v0.13/v0.13.1.md))  
- **0.13.2** **CI hygiene** — contract suite case map + shared Zod unit tests for bind/flags ([impl](docs/implementation/v0.13/v0.13.2.md))  
- **0.13.3** Train closeout — [migration](docs/migration/v0.13.0.md) · [release](docs/releases/v0.13.3.md) · inventory `v13Features`  

**Canvas overlay (default on since 0.9.1):** move + resize + multi-select + align/z-order + group scale; force off with `VITE_NEOS_CANVAS_OVERLAY=0` or Settings toggle (`neos.canvasOverlay`)

---

## What's new in v0.12

- **0.12.0** Desktop **EngineClient split** — `engine-transport` + `engine-project` (Design Project/collab API); public `engine.js` imports unchanged ([plan](docs/plans/PLAN_FOR_V0_12_0.md) · [impl](docs/implementation/v0.12/v0.12.0.md))  
- **0.12.1** **Workflow client extract** — `engine-workflow` (workflows / webhook / revisions / deployments); hierarchy Transport → Project → Workflow → EngineClient ([impl](docs/implementation/v0.12/v0.12.1.md))  
- **0.12.2** **Ops docs** — [sticky SSE design note](docs/ops/sticky-sse.md) (not implemented) + multi-replica [file SSOT / `NEOS_DATA_DIR`](docs/ops/multi-replica-collab.md#file-content-ssot-neos_data_dir) ([impl](docs/implementation/v0.12/v0.12.2.md))  
- **0.12.3** Train closeout — [migration](docs/migration/v0.12.0.md) · [release](docs/releases/v0.12.3.md) · inventory `v12Features`  

---

## What's new in v0.11

- **0.11.0** **Run → collab session bind** — optional `sessionId` on `POST /api/runs`; agent PUTs inherit via `runId` / `x-neos-run-id` under agent lock enforce ([plan](docs/plans/PLAN_FOR_V0_11_0.md) · [impl](docs/implementation/v0.11/v0.11.0.md))  
- **0.11.1** **Lock / agent-enforce UX** — collab status shows locks registry + shared-edit/agents flags; consistent 423 holder copy; project badge + run lock failures ([impl](docs/implementation/v0.11/v0.11.1.md))  
- **0.11.2** **Tool-path lock parity** — `POST /api/tools/files/write` (tool token `files`) same 423 rules as agent PUT; CLI/MCP pass run/session env ([impl](docs/implementation/v0.11/v0.11.2.md))  
- **0.11.3** Train closeout — primary **`/workers`** (alias `/harnesses`); [migration](docs/migration/v0.11.0.md) · [release](docs/releases/v0.11.3.md) · inventory `v11Features`  

---

## What's new in v0.10

- **0.10.0** Optional **agent lock hard-enforce** — `NEOS_SHARED_EDIT=1` + `NEOS_SHARED_EDIT_AGENTS=1` applies 423 to `source=agent` PUTs on locked paths ([plan](docs/plans/PLAN_FOR_V0_10_0.md))  
- **0.10.1** Multi-replica **shared lock registry** — `NEOS_COLLAB_LOCKS=auto` dual-writes file locks to Redis (like presence); hydrate on list / hard-enforce ([impl](docs/implementation/v0.10/v0.10.1.md) · [ops](docs/ops/multi-replica-collab.md))  
- **0.10.2** **Harness HTTP sunset** — `/api/harness(es)` → **410 Gone**; use `/api/workers` ([migration](docs/migration/v0.10.0.md) · [impl](docs/implementation/v0.10/v0.10.2.md))  
- **0.10.3** Train closeout — [migration](docs/migration/v0.10.0.md) · [release](docs/releases/v0.10.3.md) · inventory `v10Features`  

---

## What's new in v0.9

- **0.9.0** Layers **sibling reorder** (drag same-parent → HTML SSOT)  
- **0.9.1** Canvas **default-on** + align / distribute / z-order tools + Settings toggle  
- **0.9.2** Web **preview comments** + project zip import/export  
- **0.9.3** Dual-surface policy + shared wire parsers; marketplace **desktop-only** — [matrix](docs/reference/dual-surface.md)  
- **0.9.4** Train closeout — [migration](docs/migration/v0.9.0.md) · [release](docs/releases/v0.9.4.md) · inventory `v09Features`

---

## What's new in v0.8

- **Shared presence membership** across engine replicas (bus + optional Redis registry)
- Canvas **group resize** when multi-selecting (Shift = uniform scale in 0.8.5)
- Collab **multi-selection broadcast** (`selectors[]` awareness)
- Canvas transform **undo** + peer outline frames API (0.8.5)
- Migration + inventory: [docs/migration/v0.8.0.md](docs/migration/v0.8.0.md)

---

## What's new in v0.7

- Canvas **resize** (SE handle → HTML `width`/`height` SSOT)
- **CollabBus** (memory default; optional Redis) for multi-node presence/lock fan-out
- **Selection awareness** — peers see path · selector
- Canvas **multi-select** (Shift+click) + multi-move
- Migration + inventory gates: [docs/migration/v0.7.0.md](docs/migration/v0.7.0.md)

v0.6 Design Projects / collab presence / locks remain the base.

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
- API: **`/api/workers`**, **`/api/domain-packs`** (`/api/harness` removed in **0.10.2** — 410 Gone)
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

