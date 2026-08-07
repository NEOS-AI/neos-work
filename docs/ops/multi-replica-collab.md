# Multi-replica collab (ops)

How to run **more than one engine process** with shared collab fan-out and peer
membership. Local-first single process needs **no** Redis; defaults stay
in-memory.

| Related | Link |
|---|---|
| Release summary | [docs/releases/v0.8.4.md](../releases/v0.8.4.md) |
| Migration v0.7 | [docs/migration/v0.7.0.md](../migration/v0.7.0.md) (CollabBus) |
| Migration v0.8 | [docs/migration/v0.8.0.md](../migration/v0.8.0.md) (presence registry) |
| v0.10 M1 locks | [docs/implementation/v0.10/v0.10.1.md](../implementation/v0.10/v0.10.1.md) |
| Sticky SSE (design only) | [docs/ops/sticky-sse.md](./sticky-sse.md) (v0.12 M2 — **not implemented**) |
| Deploy Docker / Helm | [deploy/README.md](../../deploy/README.md) |

**Baseline:** monorepo **≥ 0.10.1** recommended for multi-replica presence **and** shared file locks.  
**Data dir / file SSOT:** see [File content SSOT (`NEOS_DATA_DIR`)](#file-content-ssot-neos_data_dir) below (v0.12 M2).

---

## Architecture (short)

```text
Client A ──SSE──► Replica 1 ──publish──► Redis pub/sub (neos:collab:events)
Client B ──SSE──► Replica 2 ◄─subscribe─┘
                      │
                      ├─ membership memory (local + remote-mirrored)
                      ├─ optional Redis presence registry (TTL keys)
                      └─ optional Redis lock registry (TTL keys)  ← v0.10 M1
```

| Surface | Where it lives |
|---|---|
| SSE connection | **Local to one replica** (not shared) |
| Collab events (join/leave/heartbeat/selection/locks…) | Bus fan-out (`memory` or `redis`) |
| Peer membership list | In-process store + bus mirror; optional Redis hydrate |
| File locks | In-process map + bus mirror; optional Redis lock registry (hydrate on list/acquire/hard-enforce) |
| File content | Disk / SQLite under `NEOS_DATA_DIR` (shared volume or single writer) |

---

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `NEOS_COLLAB_BUS` | `memory` | `memory` \| `redis` — event fan-out |
| `NEOS_COLLAB_REDIS_URL` | unset | Preferred Redis URL when bus/registry need Redis |
| `REDIS_URL` | unset | Fallback URL if `NEOS_COLLAB_REDIS_URL` unset |
| `NEOS_COLLAB_PRESENCE` | `auto` | `auto` \| `memory` \| `redis` \| `off` — membership registry |
| `NEOS_COLLAB_LOCKS` | `auto` | `auto` \| `memory` \| `redis` \| `off` — **file lock registry** (v0.10 M1) |
| `NEOS_SHARED_EDIT` | off | Hard file-lock enforce for multi-client edit (see below) |
| `NEOS_SHARED_EDIT_AGENTS` | off | Also hard-enforce `source=agent` PUTs when base shared-edit is on (v0.10 M0) |
| `NEOS_AUTH_TOKEN` | (process random) | Use a **stable** shared secret across replicas |

### Hard enforce (`NEOS_SHARED_EDIT=1`)

When a peer holds a file lock, other sessions get **HTTP 423** + `data.holder` on:

- `PUT /api/projects/:id/files/*` with `source: "user"`
- `DELETE /api/projects/:id/files/*`
- `POST /api/projects/:id/revisions/:revisionId/restore`
- `POST /api/projects/:id/mkdir` (lock on the mkdir target path)

With **`NEOS_SHARED_EDIT_AGENTS=1`**, the same 423 applies to `source: "agent"` PUTs
(see [ADR 0001](../adr/0001-shared-edit-strategy.md)).

Lock holders must send collab **session id** (from SSE `ready`):

| Transport | How |
|---|---|
| Body | `{ "sessionId": "<presence-session>" }` (writes also include content/source) |
| Header | `x-neos-session-id: <presence-session>` |

Clients (web + desktop) send **both** on file mutates. Prefer the header when DELETE
bodies may be stripped by a proxy.

**Agent bypass (default):** run-pipeline / `source: "agent"` writes are **not** hard-enforced
unless `NEOS_SHARED_EDIT_AGENTS=1` is also set.

### Presence modes

| `NEOS_COLLAB_PRESENCE` | Behavior |
|---|---|
| `auto` | Redis registry **when** `NEOS_COLLAB_BUS=redis`; else in-process membership only |
| `memory` | In-process only (bus still mirrors remotes when events arrive) |
| `redis` | Force Redis registry (needs URL + optional `redis` package) |
| `off` | No registry dual-write / hydrate (membership still updates from local + bus) |

### Lock registry modes (v0.10 M1)

| `NEOS_COLLAB_LOCKS` | Behavior |
|---|---|
| `auto` | Redis lock registry **when** `NEOS_COLLAB_BUS=redis`; else in-process locks only |
| `memory` | In-process only (bus still mirrors `lock.*` events) |
| `redis` | Force Redis lock registry (needs URL + `redis` package) |
| `off` | No lock dual-write / hydrate (list/hard-enforce use local + bus only) |

Hard-enforce and REST lock list **hydrate** from the lock registry before reading,
so a cold replica agrees on the holder even if it missed the bus event.

### Redis presence keys (0.8.1+)

| Key | Type | TTL |
|---|---|---|
| `neos:collab:presence:peer:{projectId}:{sessionId}` | string JSON peer | ~270s |
| `neos:collab:presence:members:{projectId}` | set of sessionIds | ~270s |

### Redis lock registry keys (0.10.1+)

| Key | Type | TTL |
|---|---|---|
| `neos:collab:lock:{projectId}:{path}` | string JSON `FileLock` | ~270s |
| `neos:collab:locks:{projectId}` | set of paths | ~270s |

TTL is refreshed on re-acquire and while the holder’s presence session is touched
(SSE heartbeat / touch). Bus channel: `neos:collab:events` (pub/sub).
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
NEOS_COLLAB_LOCKS=auto \
NEOS_SHARED_EDIT=1 \
NEOS_AUTH_TOKEN=dev-shared-token \
  pnpm --filter @neos-work/server dev

# terminal 2 — replica B (different port / data dir if not sharing SQLite)
NEOS_PORT=3001 \
NEOS_DATA_DIR=/tmp/neos-b \
NEOS_COLLAB_BUS=redis \
NEOS_COLLAB_REDIS_URL=redis://127.0.0.1:6379 \
NEOS_COLLAB_PRESENCE=auto \
NEOS_COLLAB_LOCKS=auto \
NEOS_SHARED_EDIT=1 \
NEOS_AUTH_TOKEN=dev-shared-token \
  pnpm --filter @neos-work/server dev
```

Check status on each:

```bash
curl -s -H "Authorization: Bearer dev-shared-token" \
  http://127.0.0.1:3000/api/collab/status
# expect bus redis, presence.kind redis|memory, locks.kind redis|memory, ready true
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
      NEOS_COLLAB_LOCKS: auto
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
      NEOS_COLLAB_LOCKS: auto
    volumes:
      - neos_data:/data
    ports:
      - "3001:3000"
    depends_on: [redis]

volumes:
  neos_data:
```

Notes:

- Sharing one SQLite volume across writers is **risky**; see
  [File content SSOT](#file-content-ssot-neos_data_dir). File SSOT remains
  disk (see ADR).
- Image must include the optional `redis` package (or install at build) for real
  Redis, not stub.
- Helm chart remains **single-replica by default** (`replicaCount: 1`). See
  [deploy/helm/neos-work/README.md](../../deploy/helm/neos-work/README.md).

---

## File content SSOT (`NEOS_DATA_DIR`)

Collab **events** (presence, locks, selection) can be multi-node via Redis.
**Project file bytes** and most durable state still live on the filesystem under
`NEOS_DATA_DIR` (default: `~/.config/neos-work` or image `/data`). Disk remains
SSOT for Design Project content (ADR 0001 — lock + LWW, not CRDT).

### What lives under the data dir (typical)

| Path / area | Multi-replica note |
|---|---|
| SQLite (`data.db` etc.) | **Not** a multi-writer database. Concurrent writers on a shared volume risk corruption. |
| Design project trees | Path sandboxed project roots; concurrent writers need shared FS **and** lock discipline |
| Media / packs / skills | Same volume semantics as projects |
| Ephemeral run registry | **In-memory per process** — not under `NEOS_DATA_DIR` |

### Supported operator postures

| Posture | When to use | Requirements |
|---|---|---|
| **A. Single engine** | Local-first, default Helm | One process; no Redis required |
| **B. Multi-engine, single writer for files** | Scale collab SSE readers / API fan-out carefully | Shared Redis for bus/registries; **route file mutates** to one primary (or accept LWW races) |
| **C. Multi-engine, shared volume** | Lab / e2e (`e2e:multi-replica:live`) | All replicas same `NEOS_DATA_DIR` mount; **still prefer one writer**; SQLite multi-writer **unsupported** |
| **D. Split data dirs** | Independent nodes | **No** shared project files; collab peers/locks can still fan out via Redis but file content diverges |

### Recommended production pattern

1. **`replicaCount: 1`** (Helm default) for any deployment that **writes** Design
   Project files or SQLite.  
2. If you add replicas for HA **read** or collab fan-out experiments:
   - Shared **`NEOS_AUTH_TOKEN`**
   - `NEOS_COLLAB_BUS=redis` + working Redis
   - `NEOS_COLLAB_PRESENCE=auto` / `NEOS_COLLAB_LOCKS=auto`
   - **Do not** put two SQLite writers on one volume  
3. Prefer a reverse proxy that sends **mutating** `/api/projects/*/files*` (and
   restore/mkdir) to a **primary** replica; optional sticky for SSE is a separate
   concern — see [sticky-sse.md](./sticky-sse.md).  
4. Shared project files require a coherent FS (NFS/CSI with proper locking is
   operator territory). LWW still applies: last successful write wins.

### Explicit risks

| Risk | Mitigation |
|---|---|
| Two pods write SQLite on one PVC | **Avoid** — single writer or separate data dirs |
| Two pods write same project path without locks | Enable `NEOS_SHARED_EDIT` (+ agents flag if needed); use lock registry |
| Split-brain content (different `NEOS_DATA_DIR`) | Same mount or single writer; clients must hit the node that owns files |
| “Redis will sync files” | **False** — Redis is collab bus/registry only |

### Lab / CI shared dir

Live multi-replica e2e intentionally shares one temp `NEOS_DATA_DIR` to exercise
lock hydrate + 423 across engines. That is a **test harness**, not a production
SQLite multi-writer endorsement.

```bash
pnpm e2e:multi-replica:live
```

---

## Automated e2e (C4)

Structural checks (CI-safe, no Docker required) — also run on every PR:

```bash
pnpm e2e:multi-replica
```

Live two-engine probe (starts Redis via Docker when needed, shared `NEOS_DATA_DIR`,
asserts collab status, cross-node peers, selection fan-out, **shared lock list + 423**):

```bash
# requires: built server (pnpm --filter @neos-work/server build), Docker, redis npm dep
pnpm e2e:multi-replica:live
# or: NEOS_MULTI_REPLICA_E2E=1 pnpm e2e:multi-replica
```

GitHub Actions: **Nightly multi-replica live** workflow
(`.github/workflows/nightly-multi-replica.yml`) — daily schedule + `workflow_dispatch`.

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
| **Cold replica** | Without Redis presence/lock registry, a cold node has empty remote membership/locks until bus events arrive. With registries (`auto`/`redis` + working Redis), hydrate fills peers on stream/join and locks on list/acquire/hard-enforce. |
| **Sticky sessions** | Not required for presence/lock lists when registries are on; still required if you expect a single long-lived SSE pin to a given pod without reconnect. Design note: [sticky-sse.md](./sticky-sse.md) (**not implemented**). |
| **File / SQLite SSOT** | Content under `NEOS_DATA_DIR` is disk SSOT; multi-writer SQLite **unsupported**. See [File content SSOT](#file-content-ssot-neos_data_dir). |
| **Run registry** | In-memory per process — run SSE/cancel are node-local unless sticky or future shared store. |
| **Helm default** | Chart is single-replica; multi-replica is operator-configured (Redis + env + shared data policy). |

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Peers never appear on other node | Bus is `memory` or `redis-stub`; Redis URL/package; different `NEOS_AUTH_TOKEN` / project |
| `presence.kind` is memory with bus redis | `NEOS_COLLAB_PRESENCE=memory` or registry connect failed |
| `locks.kind` is memory with bus redis | `NEOS_COLLAB_LOCKS=memory` or lock registry connect failed |
| Status ready false | Redis still connecting; check logs / detail string |
| Locks disagree across nodes | `NEOS_COLLAB_LOCKS=off` / redis-stub; bus not redis; or missed hydrate — check `GET /api/collab/status` → `locks` |
| Hard-enforce only on one replica | Lock registry off + missed bus event; enable `NEOS_COLLAB_LOCKS=auto` with working Redis |
| File content missing / diverges across pods | Split `NEOS_DATA_DIR` or no shared volume — see [File content SSOT](#file-content-ssot-neos_data_dir) |
| SQLite errors under multi-replica | Multiple writers on one DB file — use single writer |
| Run cancel 404 on “other” pod | Run registry is per process — cancel on creator node or use sticky SSE later |

---

## See also

- [docs/ops/sticky-sse.md](./sticky-sse.md) — sticky SSE design note (v0.12; not implemented)  
- [docs/releases/v0.8.4.md](../releases/v0.8.4.md) — train highlights  
- [docs/migration/v0.8.0.md](../migration/v0.8.0.md) — upgrade steps  
- [docs/adr/0001-shared-edit-strategy.md](../adr/0001-shared-edit-strategy.md) — edit model  
- [docs/security/v0.5.md](../security/v0.5.md) — auth / exposure guidance  
- [deploy/README.md](../../deploy/README.md) — single-process Docker volume defaults  
