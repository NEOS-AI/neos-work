# FE↔BE integration audit report

**Repository:** NEOS Work monorepo  
**Scope:** Backend `apps/server`; frontends `apps/web`, `apps/desktop`; also `apps/cli` as HTTP client  
**Mode:** Inventories refreshed post-remediation (product fixes already landed on `main`)  
**Date:** 2026-08-05 (regen via `tools/audit/regen.mjs`)

Inventories: [`backend-endpoints.md`](./backend-endpoints.md) · [`frontend-calls.md`](./frontend-calls.md) · [`components.md`](./components.md) · [`routes.md`](./routes.md)

---

## Counts (current)

| Metric | Count | Prior (pre-remediation audit) |
|--------|------:|-------------------------------:|
| Backend endpoints | **208** | 211 |
| Frontend/CLI call sites | **224** (web 36, desktop 159, cli 29) | 220 (web 24, desktop 170, cli 26) |
| Component-like symbols (exported PascalCase `.tsx`) | **59** | 132† |
| App routes (web + desktop) | **24** (5 + 19) | 24 (5 + 19) |
| Verified orphan endpoints (no FE/CLI call site) | **45** | 23‡ |
| Confirmed phantom FE paths | **0** | 0 (after qs false-positive filter) |

† Component heuristic tightened (exported symbols only; prior pass was broader).  
‡ Orphan matcher improved (fewer query-template false negatives); dual harness mounts + agent-only routes still listed.

### Delta notes

- **Backend −3:** primarily **removed** `POST /api/media/image` and `POST /api/media/audio` after Sunset; other count variance from multi-router attribution fixes.
- **Web +12 call sites:** create/rename/delete project, mkdir, conversations, run SSE, collab helpers already present + new project lifecycle.
- **Desktop −11 call sites:** dead `EngineClient` methods removed; remaining surface still largest client.
- **CLI +3:** `cli-agents` catalog wiring, memory export (`fetchImpl`), etc.

---

## Prior findings — remediation status

| # | Was | Topic | Status now |
|---|-----|-------|------------|
| 1 | P1 | Desktop Media generate UI | **Fixed** — generate form + `/api/media/generate` |
| 2 | P1 | mkdir in project file trees | **Fixed** — web + desktop UI + client |
| 3 | P1 | Web project conversations | **Fixed** — web client + ProjectDetail |
| 4 | P2 | Orphan endpoints catalog | **Updated** — see orphans below; image/audio **gone** |
| 5 | P2 | Dead EngineClient methods | **Fixed** — pruned / wired (workspaces, cancelSession) |
| 6 | P2 | Web contentHash soft-fallback | **Fixed** — fail closed on missing `hash` |
| 7 | P2 | Connect 401 handling | **Fixed** |
| 8 | P2 | Thin web dual-surface | **Intentional** — core expanded (create/rename/delete project) |
| 9 | P2 | Deep-link gate loses path | **Fixed** — pending path restore |
| 10 | P2 | harness aliases on client | **Fixed** — removed from EngineClient |
| 11 | P2 | media image/audio alternate | **Fixed** — routes hard-deleted after Sunset |
| 12 | P2 | tools/live-artifacts agent-only | **Intentional** — still no human FE client |
| 13 | P2 | CLI cli-agents catalog | **Fixed** — `neos cli-agents` |
| 14 | P2 | workspace hard-coded default | **Fixed** — Sessions workspace picker |

Additional remediations tracked in [`progress.md`](./progress.md): workflow restore, memory export CLI, web project rename/delete.

---

## Remaining open gaps (post-refresh)

No new **P0/P1** product blockers found in static FE↔BE matching.

### Orphans worth knowing about (no FE/CLI call site)

**Intentional / ops / agent / deprecation**

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api` | ops banner |
| POST/PUT/GET preview | `/api/artifacts…` | engine-created artifacts; FE uses list/get/patch/delete/refresh subset |
| * | `/api/harness`, `/api/harnesses` | **410 Gone** as of 0.10.2 — use `/api/workers` |
| * | `/api/tools/live-artifacts/*` | agent tool-token (auth-exempt) |
| GET | `/api/mcp/oauth/callback`, mcp-servers oauth callback | browser redirect, not client method |
| POST | `/api/workflow/migrate` | one-shot/ops |
| POST | `/api/domain-packs/install-zip` | unused install path |
| PATCH/preview/refreshes | `/api/live-artifacts/:id…` | partial surface |
| GET | `/api/media/jobs` | list jobs; client uses `/jobs/:id` only if wired |

**Likely true product orphans (method+path unused by clients)**

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/session/:id` | clients delete/list/chat; no get-by-id |
| GET | `/api/models` | no remaining listModels UI call |
| GET | `/api/workers/:id`, `/api/blocks/:id`, `/api/plugins/:id`, `/api/routines/:id`, `/api/memory/:id` | detail GETs unused |
| GET | `/api/deploy/:id` | delete/list/refresh only |
| GET | `/api/design-systems/:id` | content/tokens/delete paths used instead |
| GET | `/api/webhook/:workflowId/rate-limit` | regenerate/secret may still be used |
| DELETE | `/api/settings/:key` | UI may clear via PUT empty |
| POST | `/api/connection-test` | client method may exist tests-only |
| POST | `/api/mcp-servers/oauth/:serverId/refresh` | presets/status partial |
| GET | `/api/mcp-servers/presets`, `/api/mcp/tools` | optional admin surfaces |

These are **not** user-visible regressions unless a page was expected to call them; most are REST completeness without UI.

### Phantoms

**None confirmed.** Query-template URLs (`/api/session${qs}`, `…/revisions${qs}`, stream `${qs}`) match backend routes after suffix strip.

### Dual-surface

Web remains a **thin client** (5 routes): Connect, Projects, ProjectDetail, Settings (+ project detail features). Desktop remains full product surface (19 routes). Expanding web further is a product decision, not an integration bug.

### Contract hygiene (spot checks)

| Topic | Result |
|-------|--------|
| Live write `hash` | Shared Zod + server assert; web UI no longer soft-falls back to `contentHash` |
| Hard-enforce session | Body + `x-neos-session-id`; CORS allows header |
| Lock 409 vs hard-enforce 423 | Web/desktop handle `holder` on write/delete/restore |
| Legacy media routes | **Removed** from server |

---

## How to regenerate

```bash
node tools/audit/regen.mjs
```

Writes `audit/*.md` inventories and `audit/_*.json` machine-readable dumps. Re-classify orphans manually when product intent changes (agent-only, deprecation).

---

## Areas still not settled by static analysis

1. Hono splat routing order for `files/*` under odd IDs — live edge cases.  
2. SSE reconnect / multi-replica under packet loss — `e2e/multi-replica`.  
3. Workflow editor node config ↔ API field casing for every block type — not line-audited exhaustively.  
4. Whether unused detail GET endpoints should be deleted vs kept for API completeness.
