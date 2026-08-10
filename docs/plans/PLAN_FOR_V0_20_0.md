# PLAN_FOR_V0_20_0 — EngineCatalog + project client split

**Status:** **complete** (Track C + Track D shipped in **0.20.0**)  
**Baseline:** monorepo **0.19.0** → **0.20.0**  
**Parent:** [`PLAN_FOR_V0_19_0.md`](./PLAN_FOR_V0_19_0.md)

## One-line

Finish desktop client modularization: extract blocks/templates/memory into
`EngineCatalogClient`, and split the large Design Project client into
Core → Collab → Files → ProjectClient.

## Goals

### Track C — EngineCatalogClient

1. Move blocks, templates, memory off `EngineClient`  
2. `EngineClient extends EngineCatalogClient` becomes a thin stable entrypoint  
3. Public `engine.js` imports unchanged  

### Track D — Project client split

1. Split ~1.3k `engine-project.ts` without breaking workflow inheritance  
2. Hierarchy: Core → Collab → Files → **`EngineProjectClient` (leaf name kept)**  
3. Types still exported from `engine-project.js`  

## Non-goals

- Server / run registry / sticky SSE changes  
- CRDT multi-caret  
- Web dual-surface expansion  

## Train map

| Track | Theme | Exit | Status |
|---|---|---|---|
| **C** | Catalog extract | `engine-catalog.ts`, thin EngineClient | **done** |
| **D** | Project split | core/collab/files + leaf, tests green | **done** |

## Hierarchy

### Product client

```text
… → EngineOpsClient → EngineCatalogClient → EngineClient
```

### Design Project client

```text
EngineTransport
  → EngineProjectCoreClient
    → EngineProjectCollabClient
      → EngineProjectFilesClient
        → EngineProjectClient          // EngineWorkflowClient extends this
          → EngineWorkflowClient → …
```

## Acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, MemoryItem } from './engine.js'` | Works |
| `EngineWorkflowClient extends EngineProjectClient` | Still true |
| Project methods on EngineClient chain | Yes |
| `pnpm --filter @neos-work/desktop` typecheck + engine tests | green |
| `pnpm inventory:check` | `v20Features` ok |

## References

- Impl C: [`v0.20.0`](../implementation/v0.20/v0.20.0.md)  
- Impl D: [`v0.20.1`](../implementation/v0.20/v0.20.1.md)  
