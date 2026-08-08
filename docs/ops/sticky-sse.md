# Sticky SSE (design note) — **not implemented**

**Status:** Design-only (v0.12 M2 / Q40)  
**Product stance:** **Out of scope** for implementation until multi-replica
load-balancer ops prove sticky affinity is required.  
**Related:** [multi-replica collab](./multi-replica-collab.md) · [ADR 0001](../adr/0001-shared-edit-strategy.md)

---

## Problem

Collab and run streams use **HTTP Server-Sent Events (SSE)**:

| Stream | Path (typical) | Lifetime |
|---|---|---|
| Project collab presence | `GET /api/projects/:id/collab/stream` | Long-lived; heartbeats |
| Project file events | `GET /api/projects/:id/events/stream` | Long-lived |
| Agent / project run | `GET /api/runs/:id/events/stream` | Until run terminal |

Each SSE connection is **local to the engine process that accepted it**. Events
produced on another replica reach that process only if the **CollabBus** (or
equivalent) fans them out, then the local process re-emits to **its** SSE
clients.

```text
Client ──SSE──► Replica A (holds connection)
                    ▲
                    │ bus (Redis pub/sub)
                    │
                Replica B (may own locks / run / file write)
```

**Sticky SSE** would mean: a reverse proxy always routes a given client’s
long-lived SSE (and ideally related HTTP) to the **same** replica for the
session lifetime.

---

## What already works without sticky SSE

With `NEOS_COLLAB_BUS=redis` and presence/lock registries (`auto`/`redis`):

| Concern | How it works without sticky |
|---|---|
| Peer list | Bus + optional Redis presence registry hydrate |
| File locks | Bus + optional Redis lock registry hydrate; hard-enforce can agree |
| Collab selection events | Bus fan-out → each replica re-emits to local SSE clients |
| Client reconnect | New SSE may land on another pod; presence re-joins; lock list hydrates |

So **presence and lock lists do not require sticky sessions** when registries
are healthy (see multi-replica Limits table).

---

## What still hurts without sticky SSE

| Scenario | Effect |
|---|---|
| Mid-stream load-balancer rebalance drops SSE | Client must reconnect; brief gap until re-subscribe |
| Run event SSE on replica A, cancel hits replica B | Cancel is REST by run id; with **v0.16 shared run summary** (`NEOS_RUN_REGISTRY`) cancel no longer 404s when the summary exists (owner aborts via pub/sub). **Event SSE** remains local to A |
| File write REST on B, file SSE only open on A | A learns via file events bus/SSE only if path is wired; design projects rely on shared disk + local publish |
| Expect “one SSE pin forever without reconnect” | Not guaranteed under multi-pod LB without sticky or client reconnect logic |

**Runs registry** abort/events stay in-process. v0.16 ships an optional **shared
run summary** store for GET/cancel across pods (`NEOS_RUN_REGISTRY`); full event
SSE fan-out remains out of scope. Sticky affinity still helps stream UX.

---

## Options considered (no ship decision)

| Option | Pros | Cons |
|---|---|---|
| **A. Client reconnect only** (status quo + good clients) | Simple ops; registries cover peers/locks | Run cancel/stream still node-local |
| **B. LB cookie / consistent-hash sticky** | Keeps SSE + REST on same pod | Sticky loss on scale-in; thrash if cookie missing |
| **C. Shared run registry (Redis)** | Cancel/stream any node | New SSOT; complexity; not planned |
| **D. WebSocket mesh** | Full duplex; one protocol | Large product change; CRDT-adjacent cost |

**Default for now:** **A** — document limits; clients already reconnect collab
SSE; operators use single-replica or accept run locality.

---

## If you must sticky later (checklist — not a build plan)

1. Terminate TLS at a proxy that supports **cookie sticky** or source-IP hash.  
2. Scope sticky to `/api/**/stream` and preferably all `/api/**` for that host.  
3. Keep Redis bus + presence/lock registries — sticky does **not** replace them.  
4. Drain: stop new sticky assignments, wait SSE idle, then scale in.  
5. Never rely on sticky for **auth** (still Bearer / tool token).  
6. Measure: SSE reconnect rate, cross-node 404 on `POST /api/runs/:id/cancel`.

---

## Explicit non-goals

- Implementing sticky cookies in NEOS or Helm chart defaults  
- Moving run registry to Redis  
- Replacing SSE with WebSocket for collab  
- CRDT multi-caret (see ADR 0001)

---

## See also

- [multi-replica collab](./multi-replica-collab.md) — bus, registries, data dir  
- [ADR 0001 shared-edit](../adr/0001-shared-edit-strategy.md) — lock + LWW  
- Plan: [`PLAN_FOR_V0_12_0.md`](../plans/PLAN_FOR_V0_12_0.md) Q40  
