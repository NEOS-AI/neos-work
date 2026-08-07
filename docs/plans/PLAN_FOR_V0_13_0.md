# PLAN_FOR_V0_13_0 — Contract gates for shared-edit · Agent lock wire in PR CI

**Status:** **M0–M3 complete** through **0.13.3** (train closed)  
**Baseline:** monorepo **0.13.3**  
**Parent backlog:** [`PLAN_FOR_V0_12_0.md`](./PLAN_FOR_V0_12_0.md) (train closed)

## One-line

Lock **v0.10–v0.11 shared-edit wire** into the existing FE/BE contract suite so PR CI fails if agent enforce, run→session bind, or tool-file 423 shapes regress — without opening CRDT or sticky SSE.

## Why v0.13 now

v0.12 modularized the desktop client and documented multi-replica ops. Product
collab features from 0.10–0.11 are covered mainly by package unit tests; the
**PR contract smoke** (`pnpm e2e:contract`) still centers on hash, lock 409, and
dry-run cancel. Expanding that suite is the cheapest way to protect the train.

## Goals

1. **Contract M0:** Agent hard-enforce 423 + run bind inherit + tools/files write in `contract-fe-be.test.ts`  
2. **Contract M1:** Locks snapshot flags (`hardEnforce` / `agentsHardEnforce`) + run `collabSessionId` parse  
3. **CI/docs M2:** Ensure root scripts / CI mention v0.13 gates; optional shared parse helper for 423  
4. **Closeout M3:** migration + `v13Features` + release  

## Non-goals

- Sticky SSE implementation  
- Live multi-replica in PR CI (stays nightly)  
- CRDT  
- New product UI  

## Train

| M | Theme | Exit | Target |
|---|---|---|---|
| **M0** | Agent lock + bind + tools in contract | New cases green under `e2e:contract` | **done 0.13.0** |
| **M1** | Snapshot / summary wire | Flags + collabSessionId asserted | **done 0.13.1** |
| **M2** | CI hygiene | Contract case docs + shared parse unit tests | **done 0.13.2** |
| **M3** | Closeout | migration + `v13Features` + release | **done 0.13.3** |

---

## Task M0 (0.13.0) — Contract cases for shared-edit train

**Exit:** `pnpm e2e:contract` covers:

1. Agent PUT 423 under both shared-edit flags (holder shape via `parseCollabLockConflict`)  
2. Run create with `sessionId` → `collabSessionId`; agent PUT inherit via `runId`  
3. Tool token `files` write succeeds; 423 when locked without session  

- [x] Plan file  
- [x] Expand `contract-fe-be.test.ts`  
- [x] Mount tools/files in contract Hono app  
- [x] Impl note + version **0.13.0**  

### M0 acceptance

| Case | Expected |
|---|---|
| both flags on, agent PUT no session, path locked | **423** + holder parseable |
| run bind = holder, agent PUT with runId only | **200** |
| tools/files write capability + unlock | **200** with hash |
| tools/files locked no session | **423** |

---

## Task M1 (0.13.1) — Snapshot flags + run summary

- [x] Locks GET includes `hardEnforce` / `agentsHardEnforce` when env set  
- [x] Dry-run create with session returns `collabSessionId`  
- [x] Shared Zod parse for locks snapshot + run summary  
- [x] Version **0.13.1**  

### M1 acceptance

| Case | Expected |
|---|---|
| flags off | snapshot hardEnforce/agentsHardEnforce false |
| both env on | both flags true |
| dry-run + session | collabSessionId matches |
| dry-run no session | collabSessionId null |

---

## Task M2 (0.13.2) — CI hygiene

- [x] Document contract cases (suite header + this plan + impl note)  
- [x] Shared unit tests: `collabSessionId: null` + locks snapshot flags  
- [x] Version **0.13.2**  

### Contract suite map (`pnpm e2e:contract` → PR CI)

| # | Case | Train |
|---|---|---|
| 1 | Write `hash` not `contentHash` | wire |
| 2 | Lock 409 holder | collab |
| 3 | Peers / locks snapshot (+ flags off) | collab / v0.13 M1 |
| 4 | Multi-selection snapshot | collab |
| 5 | Dry-run + cancel 409 | runs |
| 6 | Agent hard-enforce 423 | v0.10 / M0 |
| 7 | Run bind + PUT via runId | v0.11 / M0 |
| 8 | tools/files write + 423 | v0.11 / M0 |
| 9 | Locks flags env on | v0.13 M1 |
| 10 | Dry-run collabSessionId bind | v0.13 M1 |

### M2 acceptance

| Case | Expected |
|---|---|
| Shared parse null collabSessionId | ok |
| Shared parse locks flags | ok |
| CI still runs `e2e:contract` | unchanged workflow |

---

## Task M3 (0.13.3) — Closeout

- [x] `docs/migration/v0.13.0.md`  
- [x] `docs/releases/v0.13.3.md`  
- [x] Inventory `v13Features`  
- [x] README pointers  
- [x] `docs/implementation/v0.13/v0.13.3.md`  
- [x] Version **0.13.3**  

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q41** | Where to gate 0.10–0.11 wire | Expand `e2e:contract` (PR CI) | **locked (M0)** |
| Sticky SSE / CRDT | | Still deferred | locked (carry-forward) |

---

## References

- Parent: [`PLAN_FOR_V0_12_0.md`](./PLAN_FOR_V0_12_0.md)  
- Contract: `apps/server/src/routes/contract-fe-be.test.ts`  
- Shared-edit: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
