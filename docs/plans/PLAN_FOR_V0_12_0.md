# PLAN_FOR_V0_12_0 — EngineClient modularization · Ops polish · CI hardening

**Status:** **M0–M3 complete** through **0.12.3** (train closed)  
**Baseline:** monorepo **0.12.3**  
**Parent backlog:** next train → [`PLAN_FOR_V0_13_0.md`](./PLAN_FOR_V0_13_0.md) (contract gates · closed 0.13.3)

## One-line

Shrink the desktop mega-client, document multi-replica file-SSOT ops gaps, and harden CI around collab/agent-lock — without opening CRDT or sticky-SSE product work.

## Why v0.12 now

v0.11 closed agent lock identity (run bind · UX · tool files · Workers UI). Remaining high-leverage work is **maintainability and ops clarity**, not a new collab protocol:

| Closed through 0.11 | This train |
|---|---|
| Agent lock enforce + shared lock registry | `EngineClient` still ~3.8k lines (project/collab ball of mud) |
| Tool-path parity + Workers UI | Multi-replica **file SSOT** ops guidance thin |
| Inventory v11 | Agent-lock / multi-replica coverage mostly nightly or unit-only |

## Goals

1. **Modular EngineClient (M0–M1):** extract transport + Design Project/collab API; then optional workers/settings slices  
2. **Ops polish (M2):** sticky-SSE design note (no impl) + shared `NEOS_DATA_DIR` multi-replica caveats  
3. **CI / docs (M3):** inventory `v12Features` + migration/release closeout  

## Non-goals

- Full CRDT multi-caret  
- Sticky SSE implementation / load-balancer affinity product  
- Multi-tenant RBAC  
- Web Workflow clone  

## Train

| M | Theme | Exit | Target |
|---|---|---|---|
| **M0** | Project/collab client extract | `engine-transport` + `engine-project`; EngineClient extends; tests green | **done 0.12.0** |
| **M1** | Further client slices | Workflows module (`engine-workflow`); engine.ts under ~2k | **done 0.12.1** |
| **M2** | Ops docs | sticky SSE design note + data-dir multi-replica section | **done 0.12.2** |
| **M3** | Inventory / closeout | migration + `v12Features` + release | **done 0.12.3** |

---

## Task M0 (0.12.0) — Engine transport + project API extract

**Exit:** Design Project and collab methods live in `engine-project.ts`; HTTP helpers + base client in `engine-transport.ts`; `EngineClient` extends `EngineProjectClient`; public imports from `engine.js` unchanged.

- [x] Plan file (this document)  
- [x] `engine-transport.ts` — SSE/HTTP helpers + `EngineTransport` base  
- [x] `engine-project.ts` — Design Project types + collab/files/runs methods  
- [x] `engine.ts` — re-exports + remaining domains; `class EngineClient extends EngineProjectClient`  
- [x] Preserve v0.11 APIs (`sessionId` on createProjectRun, `agentsHardEnforce`, collab status flags)  
- [x] Typecheck + `engine.test.ts`  
- [x] Impl note + version **0.12.0**  

### M0 acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, DesignProject } from './engine.js'` | Still works |
| ProjectWorkspace / Settings collab | Typecheck + unit tests green |
| `listCollabLocks` / `createProjectRun` v0.11 fields | Present on client |

---

## Task M1 (0.12.1) — Further client slice (Workflows)

**Exit:** If `engine.ts` still oversized (&gt; 2k), extract one more domain module; public imports unchanged.

- [x] Measure remaining line count (~2.4k after M0)  
- [x] Extract **Workflows** (+ webhook, revisions, deployments) → `engine-workflow.ts`  
- [x] `EngineClient extends EngineWorkflowClient extends EngineProjectClient`  
- [x] Typecheck + `engine.test.ts`  
- [x] Impl note + version **0.12.1**  

### M1 acceptance

| Case | Expected |
|---|---|
| `import { Workflow, EngineClient } from './engine.js'` | Still works |
| engine.ts line count | Under ~2k |
| Unit tests | `engine.test.ts` green |

---

## Task M2 (0.12.2) — Ops docs

**Exit:** Operators have explicit guidance on sticky SSE (out of scope) and multi-replica file SSOT.

- [x] Sticky SSE design note (design-only; no product impl) — [`docs/ops/sticky-sse.md`](../ops/sticky-sse.md)  
- [x] `docs/ops/multi-replica-collab.md` — shared volume / single-writer caveats for project files  
- [x] Impl + version **0.12.2**  

### M2 acceptance

| Case | Expected |
|---|---|
| Sticky SSE doc | States not implemented; when sticky is/isn’t needed |
| File SSOT section | Postures A–D; SQLite multi-writer unsupported |
| Cross-links | multi-replica ↔ sticky-sse |

---

## Task M3 (0.12.3) — Docs · inventory · closeout

- [x] `docs/migration/v0.12.0.md`  
- [x] `docs/releases/v0.12.3.md`  
- [x] Inventory `v12Features`  
- [x] README pointers  
- [x] Version **0.12.3**  
- [x] `docs/implementation/v0.12/v0.12.3.md`  

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q39** | EngineClient structure | Inheritance: Transport → ProjectClient → EngineClient; re-export from `engine.js` | **locked (M0)** |
| **Q40** | Sticky SSE | Design note only in M2 (not implemented) | **locked (M2)** |
| CRDT | Multi-caret | Still deferred | locked (carry-forward) |

---

## References

- Parent: [`PLAN_FOR_V0_11_0.md`](./PLAN_FOR_V0_11_0.md)  
- Ops: [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
