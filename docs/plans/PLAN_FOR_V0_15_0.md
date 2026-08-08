# PLAN_FOR_V0_15_0 — Browser E2E (Playwright) Design Project loop

**Status:** **Complete** (M2 shipped in **0.15.0**)  
**Baseline:** monorepo **0.14.1**  
**Parent:** [`PLAN_FOR_V0_14_0.md`](./PLAN_FOR_V0_14_0.md) (M1 process journey · M3 multi-replica; M2 deferred)

## One-line

Prove the **Web UI** can Connect → create Design Project → open file → edit Code → Save → Preview shows content, using Playwright against a real engine + Vite.

## Why v0.15 now

v0.14 added **T2 process** E2E (`e2e:journey`). Operators still cannot treat a green PR as “the browser product path works.” This train ships the deferred **M2 browser** path only.

## Goals

1. Playwright golden path for Web Design Project loop  
2. Root script `pnpm e2e:browser` boots server + Vite + runs spec  
3. PR CI (or nightly if flaky) runs browser e2e with Chromium  
4. Docs + inventory `v15Features`  

## Non-goals

- Desktop Tauri window automation  
- Real LLM / Edit-with-AI agent run  
- Workflow graph UI  
- CRDT / sticky SSE  

## Train

| M | Theme | Exit | Target |
|---|---|---|---|
| **M2** | Browser Design Project | `e2e:browser` green | **0.15.0** |

(No M0/M1/M3 renumber — this is the deferred M2 from v0.14.)

---

## Task M2 (0.15.0) — Playwright Design Project loop

**Exit:** `pnpm e2e:browser` asserts:

| # | Step | Expected |
|---|---|---|
| 1 | Connect URL + token | lands on `/projects` |
| 2 | Create project | navigates to `/projects/:id` |
| 3 | Seed `index.html` (API) + reload | file in tree; Design Editor open |
| 4 | Code mode edit + Save | dirty clears; no error alert |
| 5 | Preview mode | iframe `#hero` shows marker text |

- [x] Plan file  
- [x] `e2e/browser/` Playwright config + spec  
- [x] Root `e2e:browser` + `@playwright/test`  
- [x] CI step  
- [x] Migration / release / inventory / README  
- [x] Version **0.15.0**  

## Suite tier update

| Tier | Command | When |
|---|---|---|
| T2 Process | `e2e:journey` | PR |
| **T3 UI** | **`e2e:browser`** | **PR (new)** |
| T4 Topology | `e2e:multi-replica:live` | Nightly |

## References

- Journey (T2): `e2e/journey/run.mjs`  
- Web: `apps/web` · Connect / Projects / ProjectDetail  
- Design editor: `@neos-work/design-editor` (`save-button`, `preview-frame`, `mode-*`)  
