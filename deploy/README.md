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
docker build -f deploy/Dockerfile -t neos-work:0.8.6 .
helm upgrade --install neos ./deploy/helm/neos-work \
  --set authToken="$(openssl rand -hex 32)" \
  --set image.tag=0.8.5
```

See [helm/neos-work/README.md](./helm/neos-work/README.md). Not multi-tenant HA;
default collab is in-process (**one replica**).

## Multi-replica (optional)

Default [docker-compose.yml](./docker-compose.yml) stays **single-engine**. For
Redis-backed collab bus + presence across two engines (ports **3000** / **3001**):

```bash
# from monorepo root (same deploy/.env with NEOS_AUTH_TOKEN)
docker compose -f deploy/docker-compose.multi.yml up -d --build
docker compose -f deploy/docker-compose.multi.yml logs -f
```

| File | Role |
|---|---|
| [docker-compose.multi.yml](./docker-compose.multi.yml) | `redis` + `neos-a` + `neos-b`; `NEOS_COLLAB_BUS=redis`, `NEOS_COLLAB_REDIS_URL=redis://redis:6379`, `NEOS_COLLAB_PRESENCE=auto` |
| [docs/ops/multi-replica-collab.md](../docs/ops/multi-replica-collab.md) | Env, QA checklist, limits (SSE local, redis-stub, shared volume risks) |

Optional release / migration notes: [v0.8.4](../docs/releases/v0.8.4.md) · [v0.7](../docs/migration/v0.7.0.md) · [v0.8](../docs/migration/v0.8.0.md).

## Notes

- Desktop Tauri app is not included; use CLI or `apps/web` client.
- Keep `NEOS_AUTH_TOKEN` secret; when set via env it is not printed in full (v0.6+).
- Do not expose the engine to the public internet without TLS reverse proxy and network policy.
- Migration: [docs/migration/v0.8.0.md](../docs/migration/v0.8.0.md) (parent trains: [v0.7](../docs/migration/v0.7.0.md), [v0.6](../docs/migration/v0.6.0.md))
