# PLAN_FOR_V0_16_0 — EngineClient modularization (A) · Shared run registry MVP (B)

**Status:** **complete** (A0 + B0 + C0 through **0.16.2**)  
**Baseline:** monorepo **0.15.0** → closeout **0.16.2**  
**Parent:** [`PLAN_FOR_V0_15_0.md`](./PLAN_FOR_V0_15_0.md) (browser E2E closed)

## One-line

In parallel: **(A)** shrink desktop `EngineClient` by extracting settings + MCP; **(B)** add an optional multi-replica **run summary + cancel** registry so cancel/status work across pods without sticky SSE.

## Why both now

| Track | Pain | Fit |
|---|---|---|
| **A** | `engine.ts` still ~1.8k after v0.12 transport/project/workflow | Maintainability; pure desktop client |
| **B** | Runs are in-memory per process; multi-replica cancel 404s | Ops HA; pure server/runtime |

Tracks **do not share files** → safe parallel worktrees.

## Goals

### Track A — EngineClient (desktop)

1. Extract **settings + connection-test + MCP** (servers, OAuth, Codex install, presets) to `engine-settings.ts`  
2. Hierarchy: `EngineClient extends EngineSettingsClient extends EngineWorkflowClient …`  
3. Public imports from `engine.js` **unchanged**  
4. `engine.test.ts` green; prefer `engine.ts` under ~1.2k if possible  

### Track B — Shared run registry (server / agent-runtime)

1. Optional dual-write of **run summary** (id, status, nodeId, projectId, collabSessionId, timestamps)  
2. Modes: `NEOS_RUN_REGISTRY=auto|memory|redis|off` (default **auto**: redis when collab bus redis, else memory)  
3. `GET /api/runs/:id` hydrates from shared store if not local  
4. `POST /api/runs/:id/cancel`: local cancel if owned here; else publish cancel intent so owner aborts (or best-effort mark canceled in store)  
5. Unit tests; ops note in multi-replica docs  
6. **Non-goal:** full multi-node event SSE fan-out / durable event log  

## Non-goals (train)

- Sticky SSE implementation  
- CRDT  
- Browser E2E expansion  
- Extracting media/skills/plugins (later slice)  
- Postgres run store  

## Train map

| M | Track | Exit | Target | Status |
|---|---|---|---|---|
| **A0** | A | settings+MCP extract, tests green | **0.16.0** | **done** |
| **B0** | B | run registry dual-write + cross-node get/cancel MVP + tests | **0.16.1** | **done** |
| **C0** | Closeout | migration · release · inventory `v16Features` · README | **0.16.2** | **done** |

---

## Track A acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, … } from './engine.js'` | Still works |
| Settings / MCP methods | On `EngineSettingsClient` prototype chain |
| `pnpm --filter @neos-work/desktop test` engine tests | green |
| engine.ts line count | material drop (settings+MCP moved) |

## Track B acceptance

| Case | Expected |
|---|---|
| Memory mode (default local) | create/get/cancel unchanged |
| Redis mode (with redis pkg + URL) | create dual-writes summary; other process get finds summary |
| Cross-node cancel | owner cancels or remote marks canceled without 404 when summary exists |
| Contract / journey e2e | still green (memory path) |

## Decisions

| ID | Question | Default |
|---|---|---|
| **Q45** | Where shared run metadata lives | Redis keys + optional memory mirror (like locks) |
| **Q46** | Event stream multi-node | Deferred; summary + cancel first |
| **Q47** | Settings extract vs media | Settings+MCP first (A0) |

## File ownership (parallel)

| Track | Touch |
|---|---|
| **A** | `apps/desktop/src/lib/engine*.ts`, `engine.test.ts` only |
| **B** | `packages/agent-runtime/**`, `apps/server/src/**` (runs + collab/run registry), `docs/ops/multi-replica-collab.md` |
| **Closeout** | root package.json, inventory, README, docs/migration|releases|implementation |

## References

- Engine split: [`PLAN_FOR_V0_12_0.md`](./PLAN_FOR_V0_12_0.md)  
- Sticky SSE limits: [`docs/ops/sticky-sse.md`](../ops/sticky-sse.md)  
- Run registry: `packages/agent-runtime/src/run-registry.ts`  
- Cancel route: `apps/server/src/routes/runs.ts`  
