# FE↔BE integration audit report

**Repository:** NEOS Work monorepo  
**Scope:** Backend `apps/server`; frontends `apps/web`, `apps/desktop`; client also scanned `apps/cli`  
**Mode:** Investigation only (no code changes outside `audit/`)  
**Date:** 2026-08-05  

Inventories: [`backend-endpoints.md`](./backend-endpoints.md) · [`frontend-calls.md`](./frontend-calls.md) · [`components.md`](./components.md) · [`routes.md`](./routes.md)

---

## Findings (by severity)

| # | Severity | Category | Symptom (what the user experiences) | Evidence (file:line) | Root cause | Proposed fix | Confidence |
|---|----------|----------|-------------------------------------|----------------------|------------|--------------|------------|
| 1 | **P1** | Integration / CORS | Browser client on a **cross-origin** daemon URL that sends `x-neos-session-id` can fail CORS preflight; hard-enforce lock holder identity then only works via body `sessionId` (DELETE body may be stripped by some proxies). Default Vite proxy (same-origin) is OK. | CORS allow-list: `apps/server/src/index.ts:90-94` (`allowHeaders: ['Content-Type', 'Authorization']` only). Clients set header: `apps/web/src/lib/api.ts` collab session headers; `apps/desktop/src/lib/engine.ts` write/delete/restore/mkdir; server reads header: `apps/server/src/routes/projects.ts:95-98`. | Custom header not listed in CORS `allowHeaders`. | Add `x-neos-session-id` to `allowHeaders` (and document). Keep dual body+header. | **confirmed** |
| 2 | **P1** | Integration / product gap | Web user **cannot delete project files** from UI even though API + client method exist. | Client method: `apps/web/src/lib/api.ts:230` `deleteFile`. Usage outside tests: **none** in `apps/web/src/pages/*` (only definition + `api.test.ts`). Server: `apps/server/src/routes/projects.ts:798` DELETE. Desktop UI has delete: `apps/desktop/src/pages/ProjectWorkspace.tsx:1391-1401`. | Thin web client; method never wired to file tree. | Add web file-tree delete (mirror desktop) with sessionId + 423 holder UX. | **confirmed** |
| 3 | **P1** | Integration / product gap | **Project conversation history** API is never used by any frontend or CLI; chat is run-centric only. Users cannot resume multi-turn project conversations via stored messages. | Server: `apps/server/src/routes/projects.ts:969-997` (`GET/POST …/conversations`, messages). Grep of `apps/web`, `apps/desktop`, `apps/cli` for `conversations` path: **0 hits**. | Feature shipped on server without FE/CLI surface. | Wire desktop/web or document as deferred; or remove if abandoned. | **confirmed** |
| 4 | **P2** | Integration / orphan | **mkdir** client exists on desktop but **no UI** calls it; web has no mkdir client. Users cannot create folders from UI (only via agent/disk). | Desktop client: `apps/desktop/src/lib/engine.ts:1808-1831`. Grep pages for `mkdirProjectPath`: **no page usage**. Web `api.ts`: no mkdir. Server: `apps/server/src/routes/projects.ts:830`. | Client-only surface; no product UI. | Add folder create in file tree or document intentional omission. | **confirmed** |
| 5 | **P2** | Integration / orphan | Several **media** routes unused by FE/CLI (`POST /image`, `POST /audio`, `GET /jobs`); clients use `POST /media/generate` + list files. | Server: `apps/server/src/routes/media.ts:144`, `:194`, `:126`. Grep `media/image`, `media/audio` in apps: **0**. CLI: `apps/cli/src/client.ts:309` uses `/api/media/generate`. | Legacy or alternate generate paths. | Document preferred path; deprecate unused routes or wire admin UI. | **confirmed** |
| 6 | **P2** | Integration / orphan | **Tool-token live-artifact** routes (`/api/tools/live-artifacts/*`) unused by browser/desktop/cli (agent tool tokens only). | Server: `apps/server/src/routes/tools-live-artifacts.ts:54,85,100,132`. Grep `tools/live-artifacts` in apps: **0**. Auth exempt: `apps/server/src/lib/auth-paths.ts` (`/api/tools/`). | By design for agent tools, not human UI. | Document as agent-only in API docs; not a FE bug. | **confirmed** |
| 7 | **P2** | Integration / orphan | Other server-only (or agent/OAuth/ops) surfaces with **no FE call site**: e.g. `GET /api/memory/export`, `POST /api/workflow/migrate`, `GET /api/cli-agents/catalog`, `POST /api/domain-packs/install-zip`, OAuth callback paths, `GET /api` banner, live-artifact preview/refreshes list, artifact create/PUT/preview, etc. | Inventory orphans (manual verify subset): memory export `apps/server/src/routes/memory.ts:55`; workflow migrate `workflow.ts:319`; cli-agents catalog `cli-agents.ts:33`; oauth `mcp.ts:563`, `index.ts:150`. Full candidate list in cross-ref notes below. | Dual-surface product + ops/agent endpoints. | Prioritize product orphans; leave OAuth/tool/ops as intentional. | **confirmed** (individual rows vary) |
| 8 | **P2** | Integration / dual-surface | **Web is a thin client** vs desktop: no workflows, harnesses, marketplace UI, media page, etc. Users opening web cannot reach most daemon APIs. | Web routes: `apps/web/src/App.tsx:11-15` (Connect, Projects, ProjectDetail, Settings only). Desktop routes: `apps/desktop/src/App.tsx:41-64` (full app). Web call sites ≈29 vs desktop ≈166 (`audit/frontend-calls.md`). | Product split (documented “desktop-first” for marketplace in release notes). | Keep intentional; expand web only with product decision. | **confirmed** |
| 9 | **P2** | Contract / hygiene | Web write types still allow optional **`contentHash`** on live write result; UI falls back to `contentHash` if `hash` missing — can hide regressions of wrong field. | `apps/web/src/lib/api.ts:191,200`; save path `apps/web/src/pages/ProjectDetail.tsx:719-724`. Server write returns `hash`: `apps/server/src/routes/projects.ts:779-787`. Schema requires `hash`: `packages/shared/src/schemas/api-envelopes.ts:29-36`. | Compatibility fallback after historical mismatch. | Prefer fail-closed on missing `hash` in production clients; keep parse via shared Zod only. | **confirmed** |
| 10 | **P2** | Error handling | Web **Connect** treats all failures generically; **401** not specially handled (Projects/Settings do). User may not know token is wrong vs network. | Connect: `apps/web/src/pages/Connect.tsx:30-35` (ApiError message only). Projects 401: `apps/web/src/pages/Projects.tsx:29`. Settings 401: `apps/web/src/pages/Settings.tsx:78,101`. | Incomplete error UX on first-connect path. | Map 401 → “invalid token” on Connect. | **confirmed** |
| 11 | **P2** | Error handling | Web cancel run / collab: 409 terminal cancel handled loosely; many GETs still **throw** while mutates use envelopes — easy to mishandle when copying patterns. | Envelope policy: `apps/web/src/lib/api.ts:1-8,59-95`. cancelRun: `api.ts:358-363` + `ProjectDetail.tsx:654-685`. | Intentional dual policy; risk is developer footgun. | Document in skill (done Session D); keep contract tests. | **confirmed** |
| 12 | **P2** | Dead code | Desktop **`createHarness` / `updateHarness` / `deleteHarness`** are deprecated aliases with **no page call sites** (pages use workers). | `apps/desktop/src/lib/engine.ts:3406-3418`. Grep pages for createHarness: empty. | Deprecation leftovers. | Remove after migration window or keep with @deprecated only. | **confirmed** |
| 13 | **P2** | Dead code | Web **`deleteFile`** client method only used from unit tests, not product UI (see #2). | `apps/web/src/lib/api.ts:230`; tests `apps/web/src/lib/api.test.ts:65-82`. | Premature client API. | Wire UI or mark internal until used. | **confirmed** |
| 14 | **P2** | Routes | Desktop **ModeSelection** blocks all routes until engine connects — expected, but deep links to `/projects/:id` while disconnected never mount. | `apps/desktop/src/App.tsx:68-76`. | Auth/connection gate. | Optional: show connect shell preserving intended path. | **confirmed** |
| 15 | **P2** | Components | Some component-like exports show **0 external imports** in static scan (may be false positive for colocated/default-export patterns). Examples from inventory: local helpers named like components. | `audit/components.md` “no external imports” rows; e.g. colocated `WorkflowNodeComponent` in `WorkflowEditor.tsx`. | Static import graph limits. | Manual review before deleting. | **suspected** (for true dead components) |

---

## Cross-reference notes (Phase 2)

### Phantom calls

Automated matching reported FE URLs with **query string templates** (`/api/session${qs}`, `/api/runs${qs}`, etc.) as phantoms. Manual inspection shows they are **valid GET**s against existing routes (`apps/desktop/src/lib/engine.ts:548`, `:1991`, etc.). **No confirmed phantom path/method** after verification.

### Orphan endpoints (server exists; no FE/CLI usage verified)

| Method | Path | Notes | Confidence |
|--------|------|-------|------------|
| GET | `/api` | Version banner | intentional ops |
| GET/POST | `/api/projects/:id/conversations…` | No client | product gap **P1** |
| GET/POST | `/api/tools/live-artifacts/*` | Agent tool-token | intentional |
| POST | `/api/media/image`, `/audio` | Prefer `/generate` | orphan **P2** |
| GET | `/api/media/jobs` | Unused by clients | orphan **P2** |
| GET | `/api/memory/export` | Unused | orphan **P2** |
| POST | `/api/workflow/migrate` | Unused | orphan **P2** |
| GET | `/api/cli-agents/catalog` | Unused | orphan **P2** |
| POST | `/api/domain-packs/install-zip` | Unused by FE | orphan **P2** |
| GET | OAuth callbacks | Browser redirect | intentional auth-exempt |
| … | harnesses alias POST/PUT/DELETE | CRUD via `/api/workers` | intentional deprecation |

False orphan positives from matcher (actually used): collab stream, revisions, preview-comments, session list, marketplace catalog with query — **do not treat as unused**.

### Contract mismatches

| Topic | Result |
|-------|--------|
| Live write `hash` vs revision `contentHash` | Documented dual domain; web still soft-fallback (`ProjectDetail.tsx:719-724`) |
| Hard-enforce session | Body + header; CORS header gap (**#1**) |
| Lock acquire 409 vs hard-enforce 423 | Distinct; web/desktop handle holder on write/lock paths |
| Method mismatches | None confirmed after re-scan |

### Broken-behavior patterns checked

| Pattern | Result |
|---------|--------|
| Buttons without handlers (web pages) | No bare product buttons found that lack onClick without form submit |
| Web Edit-with-AI | Uses SSE + poll fallback (`ProjectDetail.tsx` run path) |
| Desktop delete | Wired with confirm + session (`ProjectWorkspace.tsx`) |
| Missing cache library | N/A (no React Query); manual reload after mutates is pattern |
| Hardcoded base URL | Clients take user-provided server URL / engine config |

---

## Counts

| Metric | Count |
|--------|------:|
| Backend endpoints inventoried | **210** |
| Frontend/CLI call sites inventoried | **227** (web ~29, desktop ~166, cli remainder) |
| React component exports (tsx) | **76** |
| App routes (web + desktop) | **25** |
| Files primarily examined | Server routes (~29 modules) + index; web api + pages; desktop engine + App + key pages; auth-paths; shared envelopes |

---

## Areas not fully settled by static analysis

1. **Runtime route order / Hono splat** behavior for `files/*` vs static segments under edge IDs — needs live server.  
2. **SSE reconnect / multi-replica** correctness under packet loss — needs multi-process e2e.  
3. **Whether CORS #1 manifests** depends on deployment (proxy vs cross-origin).  
4. **Component “zero imports”** may be false when re-exported or used only as `default` under different names.  
5. **CLI command surface** vs `client.ts` methods: not every CLI subcommand was mapped to a UX flow.  
6. **Workflow editor** large surface: node config ↔ API field casing not line-audited exhaustively for every block type.

### Items that require running the app

- Confirm CORS preflight failure with web → remote daemon + `x-neos-session-id`.  
- Manual multi-user hard-enforce DELETE/restore/mkdir under `NEOS_SHARED_EDIT=1`.  
- Deep-link desktop while disconnected.  
- Full workflow run + artifact preview matrix.

---

## Severity summary

| Severity | Count (unique issues) |
|----------|----------------------:|
| P0 | 0 |
| P1 | 3 (#1 CORS, #2 web delete UI, #3 conversations API) |
| P2 | 12+ (orphans, dual-surface, dead clients, error UX) |

No **P0** (feature entirely broken for default local desktop happy path) was confirmed: desktop covers the primary product surface; web is intentionally thinner.
