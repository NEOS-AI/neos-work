# Multi-replica collab (ops)

How to run **more than one engine process** with shared collab fan-out and peer
membership. Local-first single process needs **no** Redis; defaults stay
in-memory.

| Related | Link |
|---|---|
| Release summary | [docs/releases/v0.8.4.md](../releases/v0.8.4.md) |
| Migration v0.7 | [docs/migration/v0.7.0.md](../migration/v0.7.0.md) (CollabBus) |
| Migration v0.8 | [docs/migration/v0.8.0.md](../migration/v0.8.0.md) (presence registry) |
| Deploy Docker / Helm | [deploy/README.md](../../deploy/README.md) |

**Baseline:** monorepo **≥ 0.8.4** recommended for multi-replica presence.

---

## Architecture (short)

```text
Client A ──SSE──► Replica 1 ──publish──► Redis pub/sub (neos:collab:events)
Client B ──SSE──► Replica 2 ◄─subscribe─┘
                      │
                      ├─ membership memory (local + remote-mirrored)
                      └─ optional Redis presence registry (TTL keys)
```

| Surface | Where it lives |
|---|---|
| SSE connection | **Local to one replica** (not shared) |
| Collab events (join/leave/heartbeat/selection/locks…) | Bus fan-out (`memory` or `redis`) |
| Peer membership list | In-process store + bus mirror; optional Redis hydrate |
| File content | Disk / SQLite under `NEOS_DATA_DIR` (shared volume or single writer) |

---

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEOS_COLLAB_BUS` | `memory` | `memory` \| `redis` — event fan-out |
| `NEOS_COLLAB_REDIS_URL` | unset | Preferred Redis URL when bus/registry need Redis |
| `REDIS_URL` | unset | Fallback URL if `NEOS_COLLAB_REDIS_URL` unset |
| `NEOS_COLLAB_PRESENCE` | `auto` | `auto` \| `memory` \| `redis` \| `off` — membership registry |
| `NEOS_SHARED_EDIT` | off | Hard file-lock enforce (unchanged; useful for multi-client edit) |
| `NEOS_AUTH_TOKEN` | (process random) | Use a **stable** shared secret across replicas |

### Presence modes

| `NEOS_COLLAB_PRESENCE` | Behavior |
|---|---|
| `auto` | Redis registry **when** `NEOS_COLLAB_BUS=redis`; else in-process membership only |
| `memory` | In-process only (bus still mirrors remotes when events arrive) |
| `redis` | Force Redis registry (needs URL + optional `redis` package) |
| `off` | No registry dual-write / hydrate (membership still updates from local + bus) |

### Redis presence keys (0.8.1+)

| Key | Type | TTL |
|---|---|---|
| `neos:collab:presence:peer:{projectId}:{sessionId}` | string JSON peer | ~270s |
| `neos:collab:presence:members:{projectId}` | set of sessionIds | ~270s |

Bus channel: `neos:collab:events` (pub/sub).

---

## Run with Redis

### 1. Optional package

The server does **not** hard-depend on the `redis` npm package. For real pub/sub
and registry:

```bash
pnpm add redis -F @neos-work/server
```

Without the package or URL, `NEOS_COLLAB_BUS=redis` uses **redis-stub**
(local-only fan-out; see [Limits](#limits)).

### 2. Dev (two processes, one Redis)

```bash
# terminal 0 — Redis (example)
docker run --rm -p 6379:6379 redis:7-alpine

# terminal 1 — replica A
NEOS_PORT=3000 \
NEOS_COLLAB_BUS=redis \
NEOS_COLLAB_REDIS_URL=redis://127.0.0.1:6379 \
NEOS_COLLAB_PRESENCE=auto \
NEOS_AUTH_TOKEN=dev-shared-token \
  pnpm --filter @neos-work/server dev

# terminal 2 — replica B (different port / data dir if not sharing SQLite)
NEOS_PORT=3001 \
NEOS_DATA_DIR=/tmp/neos-b \
NEOS_COLLAB_BUS=redis \
NEOS_COLLAB_REDIS_URL=redis://127.0.0.1:6379 \
NEOS_COLLAB_PRESENCE=auto \
NEOS_AUTH_TOKEN=dev-shared-token \
  pnpm --filter @neos-work/server dev
```

Check status on each:

```bash
curl -s -H "Authorization: Bearer dev-shared-token" \
  http://127.0.0.1:3000/api/collab/status
# expect bus redis (or redis-stub), presence.kind redis|memory, ready true
```

For Design Editor multi-select / group scale UI, enable canvas overlay on web:

```bash
VITE_NEOS_CANVAS_OVERLAY=1 pnpm --filter @neos-work/web dev
```

Point clients at the same logical project (and, for file locks, a **shared**
data directory or a single writer replica).

### 3. Docker Compose snippet (optional Redis + multi-neos)

Default [deploy/docker-compose.yml](../../deploy/docker-compose.yml) is
**single-process**. Example extension for multi-replica collab prep:

```yaml
# Example only — not the default deploy/docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  neos-a:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    environment:
      NEOS_HOST: "0.0.0.0"
      NEOS_PORT: "3000"
      NEOS_DATA_DIR: /data
      NEOS_AUTH_TOKEN: "${NEOS_AUTH_TOKEN}"
      NEOS_ALLOW_ANY_HOST: "1"
      NEOS_COLLAB_BUS: redis
      NEOS_COLLAB_REDIS_URL: redis://redis:6379
      NEOS_COLLAB_PRESENCE: auto
    volumes:
      - neos_data:/data
    ports:
      - "3000:3000"
    depends_on: [redis]

  neos-b:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    environment:
      NEOS_HOST: "0.0.0.0"
      NEOS_PORT: "3000"
      NEOS_DATA_DIR: /data
      NEOS_AUTH_TOKEN: "${NEOS_AUTH_TOKEN}"
      NEOS_ALLOW_ANY_HOST: "1"
      NEOS_COLLAB_BUS: redis
      NEOS_COLLAB_REDIS_URL: redis://redis:6379
      NEOS_COLLAB_PRESENCE: auto
    volumes:
      - neos_data:/data
    ports:
      - "3001:3000"
    depends_on: [redis]

volumes:
  neos_data:
```

Notes:

- Sharing one SQLite volume across writers is **risky**; use for collab *event*
  tests or put a reverse proxy + single primary for writes. File SSOT remains
  disk (see ADR).
- Image must include the optional `redis` package (or install at build) for real
  Redis, not stub.
- Helm chart remains **single-replica by default** (`replicaCount: 1`). See
  [deploy/helm/neos-work/README.md](../../deploy/helm/neos-work/README.md).

---

## Automated e2e (C4)

Structural checks (CI-safe, no Docker required):

```bash
pnpm e2e:multi-replica
```

Live two-engine probe (starts Redis via Docker when needed, shared `NEOS_DATA_DIR`,
asserts collab status, cross-node peers, selection fan-out):

```bash
# requires: built server (pnpm --filter @neos-work/server build), Docker, redis npm dep
pnpm e2e:multi-replica:live
# or: NEOS_MULTI_REPLICA_E2E=1 pnpm e2e:multi-replica
```

Optional: point at an existing Redis with `NEOS_COLLAB_REDIS_URL` and
`--skip-redis-docker`. Verbose engine logs: `NEOS_MULTI_REPLICA_VERBOSE=1`.

Compose stack for manual multi-container runs:

```bash
cp deploy/.env.example deploy/.env   # set NEOS_AUTH_TOKEN
docker compose -f deploy/docker-compose.multi.yml up -d --build
```

---

## Two-client manual QA checklist

Use two browsers (or two browser profiles). Prefer two replicas behind Redis
for multi-node coverage; single replica still validates product UX.

| # | Check | Pass criteria |
|---|---|---|
| 1 | **Presence count ≥ 1** | Open same project on client B; client A peers / presence shows the remote session (count ≥ 1 remote or total peers ≥ 2 including self depending on UI) |
| 2 | **Selection awareness** | Client A selects a layer/path; client B sees peer selection indicator (path · selector / avatar) without exclusive lock |
| 3 | **Multi-select `N sel`** | Client A multi-selects (≥2); peer UI on B shows multi hint e.g. `file · N sel · #primary` / `selectors` |
| 4 | **File locks** | Client A acquires edit lock on a path; client B sees lock owner / cannot hard-edit when `NEOS_SHARED_EDIT` enforce is on |
| 5 | **Canvas group scale** | With overlay on: multi-select frames, drag SE handle — all selected scale (size + position about primary TL); HTML SSOT updates |

Optional probes:

```bash
# bus + presence
curl -s -H "Authorization: Bearer $NEOS_AUTH_TOKEN" \
  "$BASE/api/collab/status"

# peers for project
curl -s -H "Authorization: Bearer $NEOS_AUTH_TOKEN" \
  "$BASE/api/projects/$PROJECT_ID/collab/peers"
```

---

## Limits

| Topic | Behavior |
|---|---|
| **SSE local** | Each SSE stream stays on the replica that accepted the connection. Events from other nodes arrive via the bus and are re-emitted to **local** SSE clients only. |
| **redis-stub** | If `NEOS_COLLAB_BUS=redis` but URL missing, package missing, or connect fails, the process uses **local-only** fan-out (`kind: redis-stub`). Multi-replica **will not** share events until Redis is healthy. Check `GET /api/collab/status` detail. |
| **CRDT out of scope** | No multi-caret CRDT; conflict model remains **lock + LWW** on files (ADR). |
| **Cold replica** | Without Redis presence registry, a cold node has empty remote membership until bus events arrive. With registry (`auto`/`redis` + working Redis), hydrate fills peers on stream/join. |
| **Sticky sessions** | Not required for presence lists when registry is on; still required if you expect a single long-lived SSE pin to a given pod without reconnect. |
| **Helm default** | Chart is single-replica; multi-replica is operator-configured (Redis + env + shared data policy). |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Peers never appear on other node | Bus is `memory` or `redis-stub`; Redis URL/package; different `NEOS_AUTH_TOKEN` / project |
| `presence.kind` is memory with bus redis | `NEOS_COLLAB_PRESENCE=memory` or registry connect failed |
| Status ready false | Redis still connecting; check logs / detail string |
| Locks disagree across nodes | Separate `NEOS_DATA_DIR` without shared storage — locks are process/disk local to data dir |

---

## See also

- [docs/releases/v0.8.4.md](../releases/v0.8.4.md) — train highlights  
- [docs/migration/v0.8.0.md](../migration/v0.8.0.md) — upgrade steps  
- [docs/adr/0001-shared-edit-strategy.md](../adr/0001-shared-edit-strategy.md) — edit model  
- [docs/security/v0.5.md](../security/v0.5.md) — auth / exposure guidance  
