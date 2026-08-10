# PLAN_FOR_V0_19_0 — EngineOps extract + shared run event fan-out

**Status:** **complete** (Track A + Track B shipped in **0.19.0**)  
**Baseline:** monorepo **0.18.0** → **0.19.0**  
**Parent:** [`PLAN_FOR_V0_18_0.md`](./PLAN_FOR_V0_18_0.md)

## One-line

Parallel train: **A** finish desktop ops extract (`EngineOpsClient`); **B** multi-replica **run event** buffer so non-owner pods can serve run event GET/SSE.

## Goals

### Track A — EngineOpsClient

1. Extract design systems, artifacts, routines, deploy helpers → `engine-ops.ts`  
2. Hierarchy: `EngineClient extends EngineOpsClient extends EnginePluginsClient …`  
3. Public `engine.js` imports unchanged  

### Track B — Run event fan-out MVP

1. Shared event buffer on `SharedRunStore` (memory + redis; cap 500)  
2. Owner dual-write via `appendRunEvent`  
3. Non-local `GET /api/runs/:id/events` + `events/stream` poll shared buffer when summary exists  
4. Ops + sticky docs updated (sticky not required for run SSE when registry on)

## Non-goals

- Durable Postgres event log  
- Sticky SSE LB implementation  
- Extract blocks / templates / memory (remain on EngineClient)  
- Split `engine-project.ts`  
- CRDT multi-caret  

## Train map

| Track | Theme | Exit | Status |
|---|---|---|---|
| **A** | Ops client extract | `engine-ops.ts`, desktop tests green | **done** |
| **B** | Run event fan-out | shared append/list + route remote path + tests | **done** |

## Hierarchy (A)

```text
… → EngineMediaClient → EngineSessionsClient → EnginePluginsClient
  → EngineOpsClient   // NEW
    → EngineClient    // blocks, templates, memory
```

## Acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, DesignSystem } from './engine.js'` | Works |
| Ops methods on EngineClient prototype chain | Yes |
| Owner-local run SSE | Unchanged |
| Non-owner GET events when summary + buffer | 200 with events |
| `NEOS_RUN_REGISTRY=off` | No dual-write; remote events 404 |
| `pnpm inventory:check` | `v19Features` ok |

## References

- Impl A: [`v0.19.0`](../implementation/v0.19/v0.19.0.md)  
- Impl B: [`v0.19.1`](../implementation/v0.19/v0.19.1.md)  
- Ops: [`multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- Sticky: [`sticky-sse.md`](../ops/sticky-sse.md)  
