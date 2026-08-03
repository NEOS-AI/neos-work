# PLAN_FOR_V0_7_0 — Canvas polish · Collab transport · Selection awareness

**Status:** **M0–M4 complete** through **0.7.4**  
**Baseline:** monorepo **0.7.4**
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
| **M2** | Selection awareness | SSE `selection.changed` peer indicators — **done 0.7.2** |
| **M3** | Canvas multi-select | Shift+click multi bbox — **done 0.7.3** |
| **M4** | Docs / inventory | v0.7 migration + inventory gates — **done 0.7.4** |

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

## Task M2 (0.7.2)

- [x] `PeerSelection` + `selection.changed` event type  
- [x] `setSessionSelection` + clear on leave  
- [x] `presence.sync.selections` snapshot  
- [x] `POST /api/projects/:id/collab/selection` + `GET …/selections`  
- [x] Bus fan-out for `selection.changed`  
- [x] Web + desktop publish + `PresencePeersBar` indicators  
- [x] Tests + `docs/implementation/v0.7/v0.7.2.md`  

## Task M3 (0.7.3)

- [x] Bridge Shift+click multi + `selection.multi` / `neos.highlight-multi`  
- [x] Layers Shift+click multi highlight  
- [x] CanvasOverlay primary + extra bboxes  
- [x] Multi-move HTML SSOT (resize primary-only)  
- [x] Tests + `docs/implementation/v0.7/v0.7.3.md`  

## Task M4 (0.7.4)

- [x] `docs/migration/v0.7.0.md`  
- [x] Inventory `v07Features` gate (plan, migration, M0–M3 code, impl M0–M4)  
- [x] README / Helm pointers  
- [x] Tests + `docs/implementation/v0.7/v0.7.4.md`  
- [x] Version **0.7.4**  

## Decisions

| ID | Default |
|---|---|
| Q17 | Resize writes `width`/`height` px (+ keep position styles) |
| Q18 | Collab multi-node later via Redis pub/sub; not default |
| Q19 | CRDT remains out of scope until product pull |

## References

- [`PLAN_FOR_V0_6_0.md`](./PLAN_FOR_V0_6_0.md)  
- [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
