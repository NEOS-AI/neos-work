# NEOS Work

An open-source alternative to Claude Cowork

**[한국어](README.ko.md)** | **English**

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
| `pnpm clean` | Remove build artifacts and node_modules |
