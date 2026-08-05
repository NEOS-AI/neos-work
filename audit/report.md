# FE↔BE integration audit report

**Repository:** NEOS Work monorepo  
**Scope:** Backend `apps/server`; frontends `apps/web`, `apps/desktop`; also `apps/cli` as HTTP client  
**Mode:** Investigation only (no product code changes; only `audit/*` written)  
**Date:** 2026-08-05 (regenerated from source)

Inventories: [`backend-endpoints.md`](./backend-endpoints.md) · [`frontend-calls.md`](./frontend-calls.md) · [`components.md`](./components.md) · [`routes.md`](./routes.md)

---

## Findings (by severity)

| # | Severity | Category | Symptom (what the user experiences) | Evidence (file:line) | Root cause | Proposed fix | Confidence |
|---|----------|----------|-------------------------------------|----------------------|------------|--------------|------------|
| 1 | **P1** | Integration / product gap | Desktop **Media** page can only list/delete/preview existing files; **no UI to generate** image/audio/video despite server + CLI support. Users must use CLI `media` commands. | Media UI calls: `listMediaFiles` / `deleteMediaFile` / `fetchMediaBlob` only — `apps/desktop/src/pages/Media.tsx:48`, `:100`, `:139`. No `generateMedia` / `/api/media/generate` in desktop tree (grep: 0). CLI generate: `apps/cli/src/client.ts:309`, `apps/cli/src/commands/media.ts:50`. Server: `POST /api/media/generate` `apps/server/src/routes/media.ts:273`; also orphan `POST /image` `:144`, `POST /audio` `:194`. | Desktop client never implemented generate; Media page is browse-only. | Wire desktop generate form to `POST /api/media/generate` (and job poll if video) or document CLI-only. | **confirmed** |
| 2 | **P1** | Integration / product gap | Users **cannot create folders** in project file trees (web or desktop). Server + desktop client exist; no page calls them. | Server: `POST /api/projects/:id/mkdir` `apps/server/src/routes/projects.ts:830`. Desktop client: `mkdirProjectPath` `apps/desktop/src/lib/engine.ts:1827-1855`. Grep pages/hooks/components for `mkdirProjectPath`: **definition + tests only**. Web: no mkdir method in `apps/web/src/lib/api.ts`. | Client method never wired to file-tree UI. | Add “New folder” in desktop/web file tree with sessionId for hard-enforce. | **confirmed** |
| 3 | **P1** | Integration / dual-surface | **Web** has **no project conversation** surface; multi-turn history API works on desktop only. Web chat/run path cannot resume stored project conversations. | Server: `apps/server/src/routes/projects.ts:969-1017`. Desktop UI: `listProjectConversations` / `createProjectConversation` `apps/desktop/src/pages/ProjectWorkspace.tsx:191-199`, `:1126-1132`. Web: grep `conversation` under `apps/web/src` product code: **0**. | Web is intentionally thin; conversation feature not ported. | Port conversation load/persist to web `ProjectDetail` or document web as single-run only. | **confirmed** |
| 4 | **P2** | Integration / orphan endpoints | Multiple backend routes have **no FE/CLI call site** (ops/agent/legacy). No user path reaches them from clients. | Verified orphans (static match + manual qs false-positive removal): `GET /api` `index.ts:201`; `POST /api/artifacts` `artifacts.ts:75`; `PUT /api/artifacts/:id` `:150`; `GET …/preview` `:56`; `GET /api/cli-agents/catalog` `cli-agents.ts:33`; `POST /api/domain-packs/install-zip` `domain-packs.ts:93`; harness CRUD under `/api/harness` and `/api/harnesses` POST/PUT/DELETE (UI uses `/api/workers` — `Harnesses.tsx:83,461`); `PATCH /api/live-artifacts/:id` `live-artifacts.ts:147`; `GET …/preview` `:122`; `GET …/refreshes` `:135`; `POST /api/media/image` `media.ts:144`; `POST /api/media/audio` `:194`; `GET /api/memory/export` `memory.ts:55`; `POST /api/workflow/migrate` `workflow.ts:319`; tool-token routes `tools-live-artifacts.ts:54,85,100,132` (agent-only by design). | Dual-surface / deprecation / agent-only. | Document intentional orphans; deprecate or wire product UI for the rest. | **confirmed** |
| 5 | **P2** | Meaningless code / dead client | Desktop `EngineClient` methods exist **only for unit tests**, never called from pages/hooks/components. | Unused-by-UI methods (grep pages+components+hooks = 0; only `engine.ts` + `engine.test.ts`): e.g. `listWorkspaces`/`createWorkspace`/`updateWorkspace`/`deleteWorkspace` (`engine.ts:752+`), `cancelSession` (`:718`), `listModels` (`:846`), `listMcpPresets` (`:927`), `refreshMcpOAuth` (`:1016`), `listNeosMcpTools` (`:1060`), `listProjectRuns` (`:2071`), `getRoutine` (`:2396`), `createProjectToolToken` (`:2507`), `listMediaProviders` (`:2557`), `getMediaJob` (`:2574`), `connectionTest` (`:2704`), `getPlugin` (`:2803`), `getWebhookRateLimit` (`:3199`), `getDeployment` (`:3351`), `getDomainPack` (`:3405`), `validateDomainPackManifest` (`:3424`), deprecated `createHarness`/`updateHarness`/`deleteHarness` (`:3507-3518`). Sessions hardcodes `workspaceId: 'default'` (`Sessions.tsx:125`) instead of workspace APIs. | API surface grew ahead of UI; aliases kept for tests. | Delete or gate behind admin UI; keep harness aliases only if external scripts need them. | **confirmed** |
| 6 | **P2** | Contract / hygiene | Web save path still **falls back to `contentHash`** if `hash` missing after write — can mask wrong field if `writeFile` parser is bypassed. | Soft fallback: `apps/web/src/pages/ProjectDetail.tsx:798-803`. Server returns `hash`: `projects.ts:779-787`. Shared schema requires `hash`: `packages/shared/src/schemas/api-envelopes.ts:29-36`. Client already validates via `parseProjectFileWriteResponse` (`api.ts:205-208`) which **rejects** contentHash-only (`api-envelopes.ts:242-256`). | Historical dual-domain compatibility left in UI layer. | Remove contentHash branch in UI; rely on shared parse only. | **confirmed** |
| 7 | **P2** | Error handling | Web **Connect** does not special-case **401**; user sees generic error vs Projects/Settings which clear session and redirect. | Connect: `apps/web/src/pages/Connect.tsx:28-35` (message only). Projects 401: `Projects.tsx:29-31`. Settings 401: `Settings.tsx:78,101`. Health is auth-exempt so wrong token fails on `listProjects()` (`Connect.tsx:25`) with ApiError text only. | Incomplete first-connect UX. | Map 401 → “Invalid token” + do not save connection. | **confirmed** |
| 8 | **P2** | Integration / dual-surface | Web is a **thin client** (4 routes) vs desktop full app; most daemon APIs unreachable from browser UI by design. | Web routes: `App.tsx:11-15` (Connect, Projects, ProjectDetail, Settings). Desktop routes: `App.tsx:41-64` (19 routes). Call sites: web 24 vs desktop 170 (`audit/frontend-calls.md`). | Product split. | Keep intentional; expand only with product decision. | **confirmed** |
| 9 | **P2** | Broken-behavior / routing | Desktop deep links while **disconnected** never mount target route; user always sees ModeSelection until connect (intended gate, but loses intended path). | `apps/desktop/src/App.tsx:68-76` returns `<ModeSelection />` without `RouterProvider`. | Connection gate before router. | Preserve intended path across ModeSelection → connect. | **confirmed** |
| 10 | **P2** | Dead code / deprecation | `createHarness` / `updateHarness` / `deleteHarness` are `@deprecated` aliases to workers; **no page** calls them (Harnesses page uses `listWorkers`/`createWorker`). | Aliases: `engine.ts:3507-3518`. Live UI: `Harnesses.tsx:83`, `:461`. | Deprecation leftovers. | Remove after migration window. | **confirmed** |
| 11 | **P2** | Integration / media alternate paths | `POST /api/media/image` and `POST /api/media/audio` unused; preferred path is `/generate` (CLI only from clients). `GET /api/media/jobs` list unused (`getMediaJob` client uses `/jobs/:id` but UI never calls it). | Server `media.ts:144,194,126`. Desktop `getMediaJob` `engine.ts:2574-2588` — tests only. | Legacy/alternate APIs. | Deprecate image/audio routes or document. | **confirmed** |
| 12 | **P2** | Integration / agent-only | `/api/tools/live-artifacts/*` has no human client; auth-exempt for tool tokens. | Routes: `tools-live-artifacts.ts:54,85,100,132`. Auth: `auth-paths.ts:30-31`. Grep apps web/desktop/cli: 0. Server tests use them. | By design for agents. | Document as agent-only (not FE bug). | **confirmed** |
| 13 | **P2** | CLI surface | `listCliAgents` client method unused by CLI commands (only defined). Catalog endpoint also unused. | Client: `apps/cli/src/client.ts:316-317`. Catalog: `cli-agents.ts:33`. | Incomplete CLI wiring. | Wire `neos cli-agents` command or drop method. | **confirmed** |
| 14 | **P2** | Contract / workspace | Multi-workspace API exists but UI always uses hard-coded `'default'` workspace on session create — workspace CRUD unreachable from UI. | Create session: `Sessions.tsx:124-125` `workspaceId: 'default'`. Workspace routes: `session.ts:804-885`. Client methods unused by UI (finding #5). | Single-workspace product assumption. | Either expose workspace picker or remove unused workspace APIs from client. | **confirmed** |

---

## Cross-reference notes (Phase 2)

### Phantom calls

Automated matching flagged FE URLs with **query-string templates** (`/api/session${qs}`, `/api/runs${qs}`, `/api/projects/.../revisions${qs}`, etc.) as phantoms.

Manual verification: all are **valid GET/DELETE** against existing routes. Method mis-detection: `GET /api/skills` was once reported as POST (desktop `listSkills` uses GET without method option — `engine.ts:856-858`).

**No confirmed phantom path/method** after verification.

### Orphan endpoints (server exists; no FE/CLI product usage)

| Method | Path | Classification | Confidence |
|--------|------|----------------|------------|
| GET | `/api` | ops banner | intentional |
| POST/PUT/GET preview | `/api/artifacts…` (create/put/preview) | artifacts created by engine runs; FE uses list/get/patch/delete/refresh | intentional + partial orphan |
| GET | `/api/cli-agents/catalog` | unused | orphan P2 |
| POST | `/api/domain-packs/install-zip` | unused by FE | orphan P2 |
| POST/PUT/DELETE | `/api/harness`, `/api/harnesses` | superseded by `/api/workers` | intentional deprecation |
| PATCH/GET preview/refreshes | `/api/live-artifacts/:id…` | partial surface | orphan P2 |
| POST | `/api/media/image`, `/audio` | prefer `/generate` | orphan P2 |
| GET | `/api/memory/export` | unused | orphan P2 |
| POST | `/api/workflow/migrate` | unused | orphan P2 |
| * | `/api/tools/live-artifacts/*` | agent tool-token | intentional |

False orphan positives removed: revisions, preview-comments, runs events, workflow runs DELETE (query templates); collab stream (fetch stream).

### Contract mismatches

| Topic | Result |
|-------|--------|
| Live write `hash` vs revision `contentHash` | Enforced by shared Zod + server assert; web UI soft-fallback is residual hygiene (#6) |
| Hard-enforce session | Body + `x-neos-session-id` header; **CORS already allows header** (`index.ts:94`) — prior audit claim of missing CORS header is **stale/false** |
| Lock 409 vs hard-enforce 423 | Web/desktop handle holder on write/delete/restore |
| Method mismatches | None confirmed |

### Broken-behavior patterns checked

| Pattern | Result |
|---------|--------|
| Buttons without handlers (web+desktop pages) | Scanner: 0 bare `<button>` without onClick/submit (`audit/_crossref.json` bareButtonsCount=0) |
| Forms without onSubmit | 0 bare forms |
| Async without await | Product paths use `void fn()` or await in handlers; not exhaustively proven for every fire-and-forget heartbeat (collab heartbeat intentionally `.catch(() => {})` — `ProjectDetail.tsx:295`) |
| Loading/error/empty | Web Projects: loading+error+empty (`Projects.tsx:63-70`). ProjectDetail: error states + empty files/revisions/runs. Media: loading+error+empty pattern present |
| Cache invalidation | No React Query; manual reload after mutations is the pattern |
| Hardcoded env base URL | Web/desktop take user-provided server URL; no `import.meta.env` API base in app src |
| useEffect cleanup | Collab/beforeunload effects clean up; SSE uses abort patterns in api.ts |

---

## Counts

| Metric | Count |
|--------|------:|
| Backend endpoints inventoried | **211** |
| Frontend/CLI call sites inventoried | **220** (web 24, desktop 170, cli 26) |
| Component-like symbols (tsx) | **132** |
| App routes (web + desktop) | **24** (5 + 19) |
| Verified orphan endpoint candidates | **23** (after false-positive removal) |
| Files primarily examined | Server routes (~29 modules) + `index.ts` + `auth-paths.ts`; web `api.ts` + all pages; desktop `engine.ts` + `App.tsx` + Sidebar + key pages; shared envelopes; CLI client |

---

## Areas not fully settled by static analysis

1. **Hono splat routing** order for `files/*` vs static segments under odd IDs — needs live server edge cases.  
2. **SSE reconnect / multi-replica** correctness under packet loss — needs multi-process e2e (`e2e/multi-replica`).  
3. **Workflow editor** node config ↔ API field casing for every block type — not line-audited exhaustively.  
4. **Runtime-only dynamic URLs** built without `/api/` string literals would be missed (none found in primary clients).  
5. **Agent-runtime internal** HTTP to tool-token routes — out of FE scope; not mapped to agent code paths here.  
6. **Component “zero imports”** false positives for same-file registration / package-internal use (documented in `components.md`).

### Items that require running the app

- CORS preflight for custom headers on true cross-origin deployments (header is allow-listed; still verify browser network tab).  
- Hard-enforce 423 UX under two simultaneous desktop/web clients.  
- Media generate end-to-end with real provider keys.  
- ModeSelection → deep-link restoration behavior.  
- Whether workspace id `default` always exists on fresh daemon (session create depends on it).

---

## Method

1. Phase 1: Hono route scan of `apps/server/src/routes/*.ts` + `index.ts` mounts; FE `request`/`requestEnvelope`/`fetch` path extraction for web/desktop/cli; React component export scan; RR6 JSX routes + RR7 `createBrowserRouter` object routes.  
2. Phase 2: Path-template match of every call vs every endpoint; manual verification of phantoms/orphans; grep for product-gap symbols; unused client method scan against pages/hooks/components; bare button/form scan; 401 handling scan.  
3. Phase 3: This report. No product source modified.
