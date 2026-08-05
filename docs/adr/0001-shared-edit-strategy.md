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
- Optional **hard enforce** when `NEOS_SHARED_EDIT=1` (see surface below)  
- UI shows “locked by …” when another session holds the open file  

### Hard enforce surface (0.6.3 → extended 0.8.x)

When `NEOS_SHARED_EDIT=1` (or `true`) **and** a lock exists on the target path,
only the lock holder may complete these **peer / human** mutations:

| Method | Path | Notes |
|---|---|---|
| `PUT` | `/api/projects/:id/files/*` | Only when body `source` is `user` (default) |
| `DELETE` | `/api/projects/:id/files/*` | Optional JSON body |
| `POST` | `/api/projects/:id/revisions/:revisionId/restore` | Enforces lock on the revision’s path |
| `POST` | `/api/projects/:id/mkdir` | Enforces lock on the mkdir target path |

**Session identity** (either is enough; prefer both on clients):

| Channel | Field |
|---|---|
| JSON body | `sessionId` (collab presence id from SSE `ready`) |
| Header | `x-neos-session-id` (same value; survives proxies that strip DELETE bodies) |

Mismatch or missing session while another peer holds the lock → **HTTP 423** with
`{ ok: false, error, data: { holder } }` (same shape as lock conflict holder).

### Agent bypass (accepted decision)

| Writer | Hard-enforce |
|---|---|
| Human / UI (`source: "user"`) | **Yes** |
| Agent / run pipeline (`source: "agent"` or daemon tool writes) | **No** |
| `NEOS_SHARED_EDIT` off (default) | Advisory locks only (no 423) |

**Rationale:** Peer locks constrain multi-human clients on a shared project.
Agent runs are daemon-mediated and must still apply file tool writes while a
human holds a lock (edit-with-AI while “my lock” is normal). Requiring agents to
impersonate a collab session would couple the run registry to presence without a
clear multi-user ownership model.

**Future (if product requires):** optional `NEOS_SHARED_EDIT_AGENTS=1` to enforce
locks on agent writes, or bind run → sessionId at create time.

Wire/doc conventions for hash fields and envelopes:
[`skills/api-docs/references/conventions.md`](../../skills/api-docs/references/conventions.md).

### Later (if multi-caret is required)

1. Introduce WebSocket or binary SSE framing  
2. Map one Y.Doc / Loro doc per project file with save → disk export  
3. Keep lock layer for “exclusive canvas drag” regions  

## Security

- Paths sanitized (no `..`, no control chars, length caps)  
- Locks never include absolute host paths  
- Same Bearer auth as project routes  
- Session ids reject control characters (`\0`, CR, LF)

## References

- [`PLAN_FOR_V0_6_0.md`](../plans/PLAN_FOR_V0_6_0.md) Task 5  
- `apps/server/src/lib/project-collab.ts` (`isSharedEditHardEnforce`)  
- `apps/server/src/routes/projects.ts` (`hardEnforceLockBlock`, `resolveCollabSessionId`)  
- Ops: [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  

