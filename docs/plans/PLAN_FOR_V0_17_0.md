# PLAN_FOR_V0_17_0 — EngineClient media + skills extract

**Status:** **complete** (M0 shipped in **0.17.0**)  
**Baseline:** monorepo **0.16.2** → **0.17.0**  
**Parent:** [`PLAN_FOR_V0_16_0.md`](./PLAN_FOR_V0_16_0.md) (settings/MCP extract + run registry)

## One-line

Continue desktop `EngineClient` modularization: extract **skills**, **media**, and **live artifacts** into `EngineMediaClient`.

## Why v0.17 now

v0.16 Track A moved settings + MCP. `engine.ts` still held skills/media/live-artifacts (and the remaining product surface). This train shrinks that file further without product API breaks.

## Goals

1. Extract **skills + media + live artifacts** to `engine-media.ts` (`EngineMediaClient`)  
2. Hierarchy: `EngineClient extends EngineMediaClient extends EngineSettingsClient …`  
3. Public imports from `engine.js` **unchanged** (re-export types + class)  
4. `engine.test.ts` green; inventory `v17Features`  

## Non-goals

- Deepening shared **run registry** (event fan-out / durable log / Postgres) — deferred  
- Sticky SSE implementation  
- Extracting plugins / sessions / remaining EngineClient domains  
- Server, agent-runtime, e2e changes  

## Train map

| M | Theme | Exit | Target | Status |
|---|---|---|---|---|
| **M0** | Media/skills extract | `engine-media.ts`, tests green, docs + inventory | **0.17.0** | **done** |

---

## Task M0 (0.17.0) — EngineMediaClient

**Move into `EngineMediaClient`:**

| Domain | Methods |
|---|---|
| **Skills** | `listSkills`, `scanSkills`, `toggleSkill`, `deleteSkill`, `upgradeSkillToPlugin` |
| **Media** | `deleteMediaFile`, `listMediaFiles`, `generateMedia`, `getMediaConfig`, `listMediaProviders`, `getMediaJob`, `fetchMediaBlob` |
| **Live artifacts** | `listLiveArtifacts`, `createLiveArtifact`, `refreshLiveArtifact`, `deleteLiveArtifact` |

**Types:** `SkillExampleCard`, `SkillData` (re-exported from `engine.js`)

**Hierarchy:**

```text
EngineTransport
  → EngineProjectClient
    → EngineWorkflowClient
      → EngineSettingsClient
        → EngineMediaClient   // NEW
          → EngineClient
```

## Acceptance

| Case | Expected |
|---|---|
| `import { EngineClient, SkillData } from './engine.js'` | Still works |
| Skills / media / live-artifact methods | On `EngineMediaClient` prototype chain |
| `pnpm --filter @neos-work/desktop` engine tests + typecheck | green |
| `pnpm inventory:check` | `v17Features` ok |

## File ownership

| Area | Touch |
|---|---|
| Desktop client | `apps/desktop/src/lib/engine*.ts` only |
| Closeout | version files, plan, impl, migration, release, inventory |

## References

- Settings extract: [`PLAN_FOR_V0_16_0.md`](./PLAN_FOR_V0_16_0.md)  
- Initial split: [`PLAN_FOR_V0_12_0.md`](./PLAN_FOR_V0_12_0.md)  
