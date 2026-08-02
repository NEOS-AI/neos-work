# PLAN_FOR_V0_7_0 — Canvas polish · Collab transport · Selection awareness

**Status:** M0–M1 shipped through **0.7.1**; M2+ open  
**Baseline:** monorepo **0.7.1**
**Parent backlog:** free-canvas stretch, multi-replica collab, CRDT (deferred from v0.6)

## One-line

Deepen Design Editor canvas tooling and prepare collab for multi-node without abandoning file-SSOT / lock+LWW.

## Goals

1. **Canvas M0–M1:** Resize handles, size writes to HTML SSOT; optional multi-select later  
2. **Collab transport M1–M2:** Pluggable bus (in-process default; Redis optional) for presence/locks  
3. **Selection awareness M2:** Broadcast “editing path / selector” to peers  
4. Keep disk SSOT, advisory locks, single-writer per file unless CRDT is explicitly adopted later  

## Non-goals

- Full CRDT multi-caret in 0.7.0  
- Multi-tenant RBAC  
- Figma auto-layout engine  

## Train

| M | Theme | Exit |
|---|---|---|
| **M0** | Canvas resize | SE resize handle → width/height styles; tests; **0.7.0** |
| **M1** | Collab bus interface | `CollabBus` + memory + Redis/stub — **done 0.7.1** |
| **M2** | Selection awareness | SSE `selection.changed` peer indicators |
| **M3** | Canvas multi-select | Shift+click multi bbox (stretch) |
| **M4** | Docs / inventory | v0.7 migration + inventory gates |

## Task M0 (0.7.0)

- [x] Plan file  
- [x] `mergeSizeDeltaIntoOpenTag` / `applySizeDeltaToHtml`  
- [x] CanvasOverlay SE resize handle  
- [x] DesignEditor `onTransformEnd` wiring  
- [x] Tests + `docs/implementation/v0.7/v0.7.0.md`  
- [x] Version **0.7.0**  

## Task M1 (0.7.1)

- [x] `CollabBus` interface + `initCollabBus`  
- [x] Memory bus (default)  
- [x] Redis adapter + stub (`NEOS_COLLAB_BUS=redis`)  
- [x] Hub fan-out + `applyRemoteCollabEvent`  
- [x] `GET /api/collab/status`  
- [x] Tests + `docs/implementation/v0.7/v0.7.1.md`  

## Decisions

| ID | Default |
|---|---|
| Q17 | Resize writes `width`/`height` px (+ keep position styles) |
| Q18 | Collab multi-node later via Redis pub/sub; not default |
| Q19 | CRDT remains out of scope until product pull |

## References

- [`PLAN_FOR_V0_6_0.md`](./PLAN_FOR_V0_6_0.md)  
- [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
