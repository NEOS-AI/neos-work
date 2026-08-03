# NEOS Work — Docker self-host

Single-process engine image (`apps/server`) with a persistent volume for SQLite
and media under `NEOS_DATA_DIR=/data`.

## Quick start

```bash
# from monorepo root
cp deploy/.env.example deploy/.env
# edit NEOS_AUTH_TOKEN (openssl rand -hex 32)

docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f neos
```

Health (no auth):

```bash
curl -s http://127.0.0.1:3000/api/health
```

Authenticated API:

```bash
export NEOS_AUTH_TOKEN=…   # same as deploy/.env
curl -s -H "Authorization: Bearer $NEOS_AUTH_TOKEN" \
  http://127.0.0.1:3000/api/projects
```

CLI against Docker:

```bash
export NEOS_SERVER_URL=http://127.0.0.1:3000
export NEOS_AUTH_TOKEN=…   # same token
pnpm --filter @neos-work/cli exec neos status
```

## Volumes

| Path | Purpose |
|---|---|
| `/data` (`neos_data`) | SQLite `data.db`, media, durable state |

## Environment

| Variable | Default | Notes |
|---|---|---|
| `NEOS_HOST` | `0.0.0.0` in image | Bind address |
| `NEOS_PORT` | `3000` | Container listen port |
| `NEOS_DATA_DIR` | `/data` | Durable data root |
| `NEOS_AUTH_TOKEN` | (required in compose) | Stable bearer token |
| `NEOS_ALLOW_ANY_HOST` | `1` in image | Skip Host header allowlist (behind trusted network) |
| `NEOS_CORS_ORIGINS` | empty | Extra browser origins |

## Build only

```bash
docker build -f deploy/Dockerfile -t neos-work:latest .
```

## Helm (optional, v0.6 M5+)

Single-replica chart under [`helm/neos-work/`](./helm/neos-work/):

```bash
docker build -f deploy/Dockerfile -t neos-work:0.8.5 .
helm upgrade --install neos ./deploy/helm/neos-work \
  --set authToken="$(openssl rand -hex 32)" \
  --set image.tag=0.8.5
```

See [helm/neos-work/README.md](./helm/neos-work/README.md). Not multi-tenant HA;
default collab is in-process (**one replica**).

## Multi-replica collab (optional)

For Redis-backed event fan-out and shared presence membership (`NEOS_COLLAB_BUS`,
`NEOS_COLLAB_REDIS_URL`, `NEOS_COLLAB_PRESENCE`), see:

- **Ops:** [docs/ops/multi-replica-collab.md](../docs/ops/multi-replica-collab.md)
- **Release:** [docs/releases/v0.8.5.md](../docs/releases/v0.8.5.md)
- **Migrations:** [v0.7](../docs/migration/v0.7.0.md) · [v0.8](../docs/migration/v0.8.0.md)

Compose above remains single-process; the ops doc includes an optional
docker-compose snippet with Redis.

## Notes

- Desktop Tauri app is not included; use CLI or `apps/web` client.
- Keep `NEOS_AUTH_TOKEN` secret; when set via env it is not printed in full (v0.6+).
- Do not expose the engine to the public internet without TLS reverse proxy and network policy.
- Migration: [docs/migration/v0.8.0.md](../docs/migration/v0.8.0.md) (parent trains: [v0.7](../docs/migration/v0.7.0.md), [v0.6](../docs/migration/v0.6.0.md))
