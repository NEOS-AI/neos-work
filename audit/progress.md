# Audit progress

## Phase 1 inventories — COMPLETE
- [x] `audit/backend-endpoints.md` — **210** endpoints
- [x] `audit/frontend-calls.md` — **227** call sites (web/desktop/cli)
- [x] `audit/components.md` — React `.tsx` exports
- [x] `audit/routes.md` — web + desktop router tables

## Phase 2 cross-reference — COMPLETE
- Orphan endpoints catalogued (see report; many intentional dual-surface / tool-token / OAuth)
- Phantom calls: query-string false positives only after method fix
- Contract issues: CORS header gap, dual-surface gaps, dead client methods
- Dead code: web `deleteFile` unused by UI; desktop `mkdirProjectPath` unused by UI; project conversations API unused

## Phase 3
- [x] `audit/report.md`

## Method notes
- Backend: Hono `router.method('path')` scan + mount map from `apps/server/src/index.ts`
- Frontend: `fetch`/`request`/`requestEnvelope` path extraction
- Matching: path templates normalized; some query-suffix FE URLs need manual verification
