# Audit progress

## Phase 1 inventories — COMPLETE (refreshed 2026-08-05 post-remediation)

Regenerate anytime: `node tools/audit/regen.mjs`

- [x] `audit/backend-endpoints.md` — **208** endpoints (was 211; media image/audio removed)
- [x] `audit/frontend-calls.md` — **224** call sites (web=36, desktop=159, cli=29)
- [x] `audit/components.md` — **59** exported PascalCase component symbols (stricter heuristic)
- [x] `audit/routes.md` — web **5** + desktop **19** = **24**

## Phase 2 cross-reference — COMPLETE (refreshed)

- Orphans: **45** with no FE/CLI call site (`_orphans_verified.json`) — many intentional (harness alias, agent tools, ops)
- Phantoms: **0** confirmed (query-string `${qs}` / `${q}` templates match backend)
- Contract: CORS `x-neos-session-id` present; write `hash` fail-closed on web
- Prior product gaps (media generate, mkdir, web conversations, dead clients) **remediated**
- Dual-surface web thin client confirmed (core project lifecycle now includes create/rename/delete)

## Phase 3

- [x] `audit/report.md` — rewritten as post-remediation status + remaining orphans

## P2 remediation (implementation) — COMPLETE

| Finding | Action |
|---------|--------|
| Connect 401 | Web `Connect.tsx` special-cases 401; tests added |
| contentHash soft-fallback | Removed; fail closed if `hash` missing after write |
| Deep-link gate | Desktop `App.tsx` remembers/restores path across ModeSelection |
| harness aliases | Removed `create/update/deleteHarness` from EngineClient |
| CLI cli-agents | `neos cli-agents list\|catalog` + catalog client method |
| Orphan docs | `docs/reference/api-surface-notes.md` |
| Dead engine methods | Removed 18 unused EngineClient methods; wired listWorkspaces + cancelSession |
| Media image/audio | Deprecation + Link headers toward /generate |
| Workspace default | Sessions resolves via listWorkspaces (prefer default) |
| Workflow restore | RevisionPanel calls `restoreRevision` then updates editor |
| Workspace picker | New session modal: select + create + edit name/path + delete |
| Media Sunset | **Removed** POST /image and /audio after Sunset; MediaNode → /generate |
| Restore dirty flag | WorkflowEditor resets savedDraft after server restore |
| Thin web dual-surface | Intentional core; web create + conversations/mkdir + **rename/delete** |
| Memory export | CLI `neos memory export` |
| Web project delete/rename | `WebApiClient.updateProject`/`deleteProject` + Projects list UI |
| Audit inventory refresh | `tools/audit/regen.mjs` + updated report/counts |
| Connection probes | Desktop `connectionTest` + Settings UI (ollama/openai/anthropic/cli-agents/url) |
| MCP presets list | Desktop `listMcpPresets` + Settings presets line |
| Domain pack validate/zip | `validateDomainPackManifest` + `installDomainPackFromZip` + DomainPacks UI |

## Corrections vs earlier draft audit

| Prior claim | Current evidence |
|-------------|------------------|
| CORS missing `x-neos-session-id` | **False** — allowHeaders includes it |
| Web `deleteFile` unused | **False** — ProjectDetail wires it |
| Project conversations unused by all FE | **False** — desktop + web now |
| Web write lacks hash validation | **False** — shared parse; UI fail-closed |
| POST /api/media/image\|audio needed | **False** — hard-deleted after Sunset |
| Web cannot create/rename/delete projects | **False** — create + rename + delete on Projects list |

## Method notes

- Backend: Hono `router.method('path')` per mounted var; dual `/api/harness` + `/api/harnesses`; default-import alias (e.g. `pluginsRoute` → `plugins`)
- Frontend: `request`/`requestEnvelope` + `fetch`/`fetchImpl` + variable-URL ternaries; SSE streams included
- Matching: `${qs}`/`${q}` query suffixes stripped; path params → `:param`; splat `files/*`
