# PLAN_FOR_V0_8_0 — Shared presence · Multi-replica collab hardening

**Status:** M0–M2 shipped through **0.8.2**; M3+ open  
**Baseline:** monorepo **0.8.2**  
**Parent backlog:** multi-replica presence membership (deferred from v0.7 M1); group resize / multi broadcast stretch; CRDT (Q19 still out of scope)

## One-line

Make peer lists accurate across engine replicas by sharing **presence membership** (not only event fan-out), while keeping SSE connections local and disk as file SSOT.

## Goals

1. **Shared presence membership M0:** Remote peers from CollabBus appear in `presence.sync` / `listProjectPeers`  
2. **Liveness:** Heartbeats refresh remote membership; idle sweep drops stale remotes  
3. Prefer Redis when `NEOS_COLLAB_BUS=redis` for durable TTL membership (memory mirror always works on bus events)  
4. Keep lock+LWW, selection awareness, single-writer file model  

## Non-goals

- Full CRDT multi-caret (Q19)  
- Sticky SSE sessions across replicas  
- Multi-tenant RBAC  

## Train

| M | Theme | Exit |
|---|---|---|
| **M0** | Shared presence membership | join/leave/heartbeat → membership; sync lists remote peers — **done 0.8.0** |
| **M1** | Redis presence registry | Optional Redis SET+TTL + hydrate — **done 0.8.1** |
| **M2** | Group canvas resize | Multi-select scale — **done 0.8.2** |
| **M3** | Collab multi-selection | Broadcast multi set (stretch) |
| **M4** | Docs / inventory | v0.8 migration + `v08Features` gates |

## Task M0 (0.8.0)

- [x] Plan file  
- [x] Membership map (local + remote-mirrored)  
- [x] `presence.heartbeat` bus event + touch refresh  
- [x] `presence.sync` / `listProjectPeers` include remotes  
- [x] Idle sweep for remote members  
- [x] Tests + `docs/implementation/v0.8/v0.8.0.md`  
- [x] Version **0.8.0**  

## Task M1 (0.8.1)

- [x] Redis presence keys (peer SET EX + members set)  
- [x] Dual-write put / touch / del from membership store  
- [x] `hydrateMembershipFromRegistry` before SSE join + REST peers  
- [x] `NEOS_COLLAB_PRESENCE=auto|memory|redis|off`  
- [x] `GET /api/collab/status` → `presence`  
- [x] Tests + `docs/implementation/v0.8/v0.8.1.md`  
- [x] Version **0.8.1**  

## Task M2 (0.8.2)

- [x] Group scale math + `applyGroupResizeToHtml`  
- [x] DesignEditor multi-select SE → all selected  
- [x] CanvasOverlay live group preview  
- [x] Tests + `docs/implementation/v0.8/v0.8.2.md`  
- [x] Version **0.8.2**  

## Decisions

| ID | Default |
|---|---|
| Q20 | Membership is ephemeral (memory + optional Redis TTL); not SQLite |
| Q21 | Heartbeat fan-out interval ~30s; remote idle ~3× local idle |
| Q22 | CRDT remains deferred until product pull |

## References

- [`PLAN_FOR_V0_7_0.md`](./PLAN_FOR_V0_7_0.md)  
- [`docs/migration/v0.7.0.md`](../migration/v0.7.0.md)  
- [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
