# PLAN_FOR_V0_10_0 — Agent lock enforce · Multi-replica lock SSOT · API hygiene

**Status:** **M0–M3 complete** through **0.10.3** (train closed)  
**Baseline:** monorepo **0.10.3**  
**Parent backlog:** (none for v0.10 — next train TBD)
## One-line

Make shared-edit optional for **agent writers**, share file-lock membership across replicas when Redis is on, and trim deprecated API surface — without opening CRDT.

## Why v0.10 now

v0.9 closed Design Editor completion and dual-surface parity. Remaining ops/security stretch from ADR 0001 and multi-replica collab is the natural next train: **enforce locks for agents when operators opt in**, then **lock SSOT across nodes**, then **API cleanup**.

## Goals

1. **Agent hard-enforce (M0):** `NEOS_SHARED_EDIT_AGENTS=1` applies lock 423 to `source=agent` writes (and agent-origin tool writes that hit the same path) when `NEOS_SHARED_EDIT=1`  
2. **Shared locks (M1):** Optional Redis-backed (or bus-mirrored) file-lock registry so multi-replica lock lists agree  
3. **API hygiene (M2):** Deprecate/remove `/api/harness*` aliases; triage true orphans from audit  
4. **Docs / inventory (M3):** Migration + `v10Features` gates  

## Non-goals

- Full CRDT multi-caret (still deferred)  
- Multi-tenant RBAC / SaaS control plane  
- Sticky SSE  
- Replacing file-SSOT with a scene graph  

## Train

| M | Theme | Exit | Target |
|---|---|---|---|
| **M0** | Agent lock enforce | Env + tests + status field | **done 0.10.0** |
| **M1** | Shared lock registry | Multi-replica lock hydrate/list | **done 0.10.1** |
| **M2** | API hygiene | Harness sunset + orphan doc/action | **done 0.10.2** |
| **M3** | Docs / inventory | Migration + `v10Features` + closeout | **done 0.10.3** |

---

## Task M0 (0.10.0) — Agent lock enforce (Q28)

**Exit:** With `NEOS_SHARED_EDIT=1` and `NEOS_SHARED_EDIT_AGENTS=1`, an agent PUT on a path locked by another session returns **423** + `holder`. Default remains agent bypass.

- [x] Plan file (this document)  
- [x] `isSharedEditAgentsHardEnforce()` / `shouldHardEnforceWriteSource()` in `project-collab.ts`  
- [x] Apply on `PUT …/files/*` when agent enforce on  
- [x] Document: agents may pass `sessionId` / `x-neos-session-id` as holder  
- [x] Locks snapshot + collab status surface `agentsHardEnforce` / `sharedEdit`  
- [x] Tests: default bypass; both flags 423; holder 200; agents-only flag no-op  
- [x] ADR 0001 + conventions  
- [x] `docs/implementation/v0.10/v0.10.0.md`  
- [x] Version **0.10.0**  

### M0 acceptance

| Case | Expected |
|---|---|
| `SHARED_EDIT=1`, agents off, agent PUT on locked path | **200** (bypass) |
| both flags on, agent PUT no session, path locked | **423** + holder |
| both flags on, agent PUT as holder session | **200** |
| agents on but `SHARED_EDIT` off | no 423 (base enforce off) |

---

## Task M1 (0.10.1) — Shared lock registry

**Exit:** Two engine replicas with Redis see the same lock holder for a path (list + hard-enforce).

- [x] Design: mirror presence pattern (memory + optional Redis TTL keys)  
- [x] Dual-write acquire/release/touch; hydrate on REST lock list  
- [x] Env `NEOS_COLLAB_LOCKS=auto|memory|redis|off` (default `auto` with bus)  
- [x] Ops doc update  
- [x] Tests + impl note + version **0.10.1**  

---

## Task M2 (0.10.2) — API hygiene

**Exit:** Harness aliases removed or hard-deprecated; orphan catalog triaged.

- [x] Sunset `/api/harness` + `/api/harnesses` (prefer `/api/workers`; breaking with migration note)  
- [x] Orphan table: keep / delete / wire (doc in api-surface-notes)  
- [x] Tests for 410/404 on removed paths if removed  
- [x] Impl note + version **0.10.2**  

---

## Task M3 (0.10.3) — Docs · inventory · closeout

- [x] `docs/migration/v0.10.0.md` (started in M2; polish in M3)  
- [x] Inventory `v10Features` gate  
- [x] README / release note  
- [x] Version **0.10.3**  

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q30** | Agent lock enforce | Opt-in via `NEOS_SHARED_EDIT_AGENTS` only when base `NEOS_SHARED_EDIT` is on | **locked (M0)** |
| **Q31** | Agent identity for locks | Same session channels as humans (`sessionId` / header); no run→session bind in M0 | **locked (M0)** |
| **Q32** | Multi-replica locks | Optional Redis registry (like presence); memory default | **locked (M1)** |
| **Q33** | Harness routes | Hard remove (410 Gone) in 0.10.2 | **locked (M2)** |
| Q34 | CRDT | Still deferred | locked (carry-forward) |

---

## Security

- Agent enforce is **opt-in** — default preserves edit-with-AI under human lock  
- When on, agent writes must not forge sessionIds (Bearer auth only; sessionId is collab identity, not auth)  
- 423 shape unchanged (`data.holder`)  

---

## References

- Parent: [`PLAN_FOR_V0_9_0.md`](./PLAN_FOR_V0_9_0.md)  
- ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- Ops: [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- Audit orphans: [`audit/report.md`](../../audit/report.md)  
