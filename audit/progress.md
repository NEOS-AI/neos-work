# Audit progress

## Phase 1 inventories — COMPLETE (regenerated 2026-08-05)

- [x] `audit/backend-endpoints.md` — **211** endpoints
- [x] `audit/frontend-calls.md` — **220** call sites (web=24, desktop=170, cli=26)
- [x] `audit/components.md` — **132** component-like symbols
- [x] `audit/routes.md` — web **5** + desktop **19** = **24**

## Phase 2 cross-reference — COMPLETE

- Orphans: 23 verified after query-template false-positive removal (`_orphans_verified.json`)
- Phantoms: none confirmed (query-string template artifacts only)
- Contract: CORS `x-neos-session-id` **present** in allowHeaders (stale prior finding withdrawn)
- Product gaps: media generate UI missing; mkdir UI missing; web conversations missing
- Dead client methods catalogued (engine methods tests-only)
- Bare buttons/forms: 0
- Dual-surface web thin client confirmed

## Phase 3

- [x] `audit/report.md`

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
| Media Sunset | image/audio: Deprecation + Sunset 2026-04-01 + body.prefer |
| Restore dirty flag | WorkflowEditor resets savedDraft after server restore |
| Thin web dual-surface | Intentional; no change |

## Corrections vs earlier draft audit

| Prior claim | Current evidence |
|-------------|------------------|
| CORS missing `x-neos-session-id` | **False** — `index.ts:94` includes it |
| Web `deleteFile` unused | **False** — `ProjectDetail.tsx:720` wires it |
| Project conversations unused by all FE | **False for desktop** — `ProjectWorkspace.tsx` uses API; **true for web** |
| Web write lacks hash validation | Partially outdated — `writeFile` uses `parseProjectFileWriteResponse`; UI still has soft contentHash fallback |

## Method notes

- Backend: Hono `router.method('path')` + dual harness mount expansion
- Frontend: fetch/request path extraction; SSE fetch streams included
- Matching: template normalization; query suffixes verified manually
