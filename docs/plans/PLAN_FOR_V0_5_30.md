# PLAN_FOR_V0_5_30 — List B stretch polish

**Status:** done  
**Baseline:** monorepo **0.5.29** (v0.5 closeout)  
**Goal:** Ship the deferred dual-surface stretch items without opening v0.6 scope.

## Goals

1. Thin **`packages/ui-app`** for shared non-editor UI (MCP install panel first).
2. Web **Settings** surface with MCP install snippets (desktop already had it).
3. **Hash-aware SSE** reload skip on desktop + web file streams.
4. Web **conflict banner** parity tests (dirty + agent disk tip).

## Non-goals

- Full page extraction of all desktop routes into ui-app  
- Free-canvas / multiplayer / marketplace (v0.6)  
- Full Figma atom suite  

## Tasks

| ID | Item | Status |
|---|---|---|
| B1 | Create `@neos-work/ui-app` + `McpInstallPanel` | Done |
| B2 | Desktop Settings use shared panel | Done |
| B3 | Web `/settings` + install-info client | Done |
| B4 | `shouldSkipDiskReload` + SSE skip (web/desktop) | Done |
| B5 | Web conflict + hash-skip tests | Done |
| B6 | Version **0.5.30** + implementation note | Done |

## Commands

```bash
pnpm --filter @neos-work/ui-app test
pnpm --filter @neos-work/design-editor test
pnpm --filter @neos-work/web test
pnpm --filter @neos-work/desktop exec vitest run src/pages/Settings.test.tsx src/pages/ProjectWorkspace.test.tsx
```
