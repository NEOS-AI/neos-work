# PLAN_FOR_V0_18_0 — EngineClient sessions + plugins extracts

**Status:** **complete** (M0 + M1 shipped in **0.18.0**)  
**Baseline:** monorepo **0.17.0** → **0.18.0**  
**Parent:** [`PLAN_FOR_V0_17_0.md`](./PLAN_FOR_V0_17_0.md) (EngineMediaClient)

## One-line

Continue desktop `EngineClient` modularization: extract **sessions/chat/agent/workspaces** into `EngineSessionsClient` and **plugins/marketplace/workers/packs** into `EnginePluginsClient` (M0 + M1 in parallel).

## Why v0.18 now

v0.17 moved skills/media/live-artifacts. `engine.ts` still held sessions, plugins, workers, and other product surface. This train shrinks that file further without product API breaks.

## Goals

1. **M0** — Extract health + sessions + chat/agent SSE + workspaces + cli-agents → `EngineSessionsClient`  
2. **M1** — Extract marketplace + plugins + workers + domain packs → `EnginePluginsClient`  
3. Hierarchy: `EngineClient extends EnginePluginsClient extends EngineSessionsClient extends EngineMediaClient …`  
4. Public imports from `engine.js` **unchanged**  
5. `engine.test.ts` green; inventory `v18Features`

## Non-goals

- Run registry deepen (multi-node event SSE / durable log)  
- Sticky SSE implementation  
- Design systems / artifacts / routines / blocks / memory extracts  
- Server, agent-runtime, e2e product changes  

## Train map

| M | Theme | Exit | Target | Status |
|---|---|---|---|---|
| **M0** | Sessions extract | `engine-sessions.ts`, tests green | **0.18.0** | **done** |
| **M1** | Plugins extract | `engine-plugins.ts`, hierarchy wired | **0.18.0** | **done** |

---

## Task M0 — EngineSessionsClient

**Move into `EngineSessionsClient`:**

| Domain | Methods |
|---|---|
| **Health** | `health`, `checkConnection` |
| **Sessions** | `listSessions`, `createSession`, `deleteSession` |
| **Messages** | `listMessages` |
| **Chat / agent SSE** | `chat`, `runAgent` |
| **Cancel / tool** | `cancelSession`, `confirmTool` |
| **Workspaces** | `listWorkspaces`, `createWorkspace`, `updateWorkspace`, `deleteWorkspace` |
| **CLI agents** | `listCliAgents` |

**Types:** `SessionData`, `MessageData`, `AgentStep`, `AgentTask`, `AgentChunk`

## Task M1 — EnginePluginsClient

**Move into `EnginePluginsClient`:**

| Domain | Methods |
|---|---|
| **Marketplace** | `getMarketplaceCatalogUrl`, `setMarketplaceCatalogUrl`, `fetchMarketplaceCatalog`, `installMarketplaceEntry` |
| **Plugins** | `listPlugins`, `runPlugin`, `resumePlugin` |
| **Workers / packs** | `listWorkers`, domain-pack CRUD/install/validate/toggle, worker CRUD, `listHarnesses` |

## Hierarchy

```text
EngineTransport
  → EngineProjectClient
    → EngineWorkflowClient
      → EngineSettingsClient
        → EngineMediaClient
          → EngineSessionsClient   // NEW (M0)
            → EnginePluginsClient  // NEW (M1)
              → EngineClient
```

## Acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, SessionData, AgentChunk } from './engine.js'` | Still works |
| Sessions / plugins methods | On prototype chain of `EngineClient` |
| `pnpm --filter @neos-work/desktop` engine tests + typecheck | green |
| `pnpm inventory:check` | `v18Features` ok |

## File ownership

| Area | Touch |
|---|---|
| Desktop client | `apps/desktop/src/lib/engine*.ts` |
| Inventory | `tools/inventory/inventory.mjs` (+ test) |
| Closeout | plan, impl M0/M1, migration, release, README |

## References

- Media extract: [`PLAN_FOR_V0_17_0.md`](./PLAN_FOR_V0_17_0.md)  
- Settings extract: [`PLAN_FOR_V0_16_0.md`](./PLAN_FOR_V0_16_0.md)  
