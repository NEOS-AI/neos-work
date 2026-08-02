# ADR 0001: Shared-edit strategy (v0.6 M3)

**Status:** Accepted for M3 spike (0.6.3)  
**Date:** 2026-08-02  
**Context:** Multi-user Design Project editing on a local-first daemon; disk files remain SSOT.

## Decision

**Ship advisory file locks + last-write-wins (LWW) via the existing collab SSE hub first.**  
Defer full CRDT (Yjs / Loro) until product validates multi-user demand and WebSocket fan-out is justified.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Lock + LWW** (chosen) | Fits file-SSOT model; tiny surface; works on SSE; no new deps; easy security review | No character-level merge; one writer per file |
| **Yjs** | Mature CRDT, rich editor bindings | Needs WS/binary sync; conflicts with “disk is SSOT” unless we mirror Y.Doc↔file carefully; large deps |
| **Loro** | Modern CRDT, strong versioning | Same integration cost; smaller ecosystem for HTML code editors |

## Consequences

### M3 (this release)

- Ephemeral **file locks** keyed by project + relative path  
- Lock holders broadcast on collab channel; released on leave/idle/unsub  
- Optional **hard enforce** on `PUT` file write when `NEOS_SHARED_EDIT=1`  
- UI shows “locked by …” when another session holds the open file  

### Later (if multi-caret is required)

1. Introduce WebSocket or binary SSE framing  
2. Map one Y.Doc / Loro doc per project file with save → disk export  
3. Keep lock layer for “exclusive canvas drag” regions  

## Security

- Paths sanitized (no `..`, no control chars, length caps)  
- Locks never include absolute host paths  
- Same Bearer auth as project routes  

## References

- [`PLAN_FOR_V0_6_0.md`](../plans/PLAN_FOR_V0_6_0.md) Task 5  
- `apps/server/src/lib/project-collab.ts`  
