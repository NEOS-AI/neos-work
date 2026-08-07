# API surface notes (FE/CLI vs server)

Last updated 2026-08-07 (v0.11.2 tool files write + v0.10.2 harness sunset).

**Product matrix:** [`dual-surface.md`](./dual-surface.md) — Desktop full product; Web Design Project loop; marketplace **desktop-only** (Q29).  
**v0.10 M2:** [`docs/implementation/v0.10/v0.10.2.md`](../implementation/v0.10/v0.10.2.md)

## Auth-exempt (by design)

See `apps/server/src/lib/auth-paths.ts`:

| Path | Why |
|------|-----|
| `GET /api/health` | Connection probe before token is known |
| `POST /api/webhook/:workflowId` (one segment only) | HMAC-signed trigger |
| `/api/tools/*` | Short-lived agent **tool tokens** (not human Bearer) — includes `/api/tools/files/write` (v0.11.2, capability `files`) |
| `GET /api/mcp-servers/oauth/callback`, `GET /api/mcp/oauth/callback` | Browser OAuth redirect (PKCE) |

## Human clients

| Surface | Primary client |
|---------|----------------|
| Desktop | `apps/desktop/src/lib/engine.ts` |
| Web | `apps/web/src/lib/api.ts` (thin: projects lifecycle + detail, comments, zip, settings, collab, runs) |
| CLI | `apps/cli/src/client.ts` |
| Shared wire | `@neos-work/shared` Zod parse (`hash` / `contentHash` / preview comments) |

## Breaking: harness HTTP removed (0.10.2)

| Old | New |
|-----|-----|
| `GET/POST /api/harness`, `/api/harnesses` | **`/api/workers`** |
| `GET/PUT/DELETE /api/harness/:id`, `/api/harnesses/:id` | **`/api/workers/:id`** |

Server mounts still exist only to return **HTTP 410 Gone** + `Link: </api/workers>; rel="successor-version"` and
`data.successor` / `data.removedIn`. Desktop `listHarnesses()` is a thin alias of `listWorkers()` (no harness fallback).

UI route `/harnesses` is **desktop URL stability only** — it loads Domain Workers via `/api/workers`.

## Orphan triage (keep / delete / wire)

Decisions for endpoints with no FE/CLI call site (from `audit/report.md` + inventories).  
Regenerate: `pnpm audit:regen`.

### Keep (intentional)

| Endpoint | Decision | Notes |
|----------|----------|--------|
| `GET /api` | **keep** | Ops / version banner |
| `POST/PUT /api/artifacts…`, `GET …/preview` | **keep** | Engine-created; UI uses list/get/patch/delete/refresh subset |
| `/api/tools/live-artifacts/*` | **keep** | Agent tool-token only |
| OAuth callbacks | **keep** | Browser redirect, not client method |
| `POST /api/workflow/migrate` | **keep** | Ops / dry-run migration |
| `GET /api/media/jobs` | **keep** | List jobs; clients poll `/jobs/:id` when needed |
| Detail GETs (`/session/:id`, `/workers/:id`, `/blocks/:id`, `/plugins/:id`, `/routines/:id`, `/memory/:id`, `/deploy/:id`, `/design-systems/:id`) | **keep** | REST completeness; list+action paths used by UI |
| `GET /api/webhook/:workflowId/rate-limit` | **keep** | Also embedded in secret path; optional admin |
| Live-artifact partial (`PATCH`, preview, refreshes) | **keep** | Partial surface; agent tools cover main path |
| `DELETE /api/settings/:key` | **keep** | UI may clear via PUT empty; DELETE valid for scripts |
| `GET /api/models` | **keep** | Optional / future UI; not harmful |

### Removed / gone

| Endpoint | Decision | Notes |
|----------|----------|--------|
| `* /api/harness`, `* /api/harnesses` | **gone (410)** | Use `/api/workers` — **0.10.2** |
| ~~`POST /api/media/image`~~, ~~`/audio`~~ | **deleted** | Sunset 2026-04-01 → `/api/media/generate` |

### Wire (already done or product-optional)

| Endpoint | Decision | Notes |
|----------|----------|--------|
| `POST /api/connection-test` | **wired** | Desktop Settings connection probes |
| `GET /api/mcp-servers/presets` | **wired** | Desktop Settings |
| `POST /api/domain-packs/validate`, `install-zip` | **wired** | Domain Packs UI |
| `GET /api/mcp/tools`, oauth refresh | **optional** | Admin / incomplete OAuth UX — **document-only**, no delete |

No mass deletion of unused detail GETs: low risk, useful for CLI/scripts and future UI.

## Intentional orphans / dual paths (summary)

| Endpoint | Notes |
|----------|--------|
| `GET /api` | Version banner |
| Artifact create/put/preview subset | Engine + partial UI |
| ~~`/api/harness(es)`~~ | **410** → `/api/workers` |
| `/api/tools/*` | Agent tool-token |
| Detail GETs | REST completeness without UI |

## Wired after audit cleanup

| Endpoint / feature | Client / UI |
|--------------------|-------------|
| `POST /api/connection-test` | Desktop `connectionTest` + Settings **Connection probes** |
| `GET /api/mcp-servers/presets` | Desktop `listMcpPresets` + Settings MCP presets line |
| `GET /api/memory/export` | CLI `neos memory export` |
| Web project create / rename / delete | `WebApiClient` + Projects page |
| Media generate | Desktop Media page + CLI; unified `/generate` only |
| `POST /api/domain-packs/validate` | Domain Packs **Validate pack.json…** |
| `POST /api/domain-packs/install-zip` | Domain Packs **Install from zip…** |
| `GET /api/domain-packs/:id` | Desktop `getDomainPack` client (detail) |

## Deprecations removed from desktop client

- `createHarness` / `updateHarness` / `deleteHarness` aliases removed — use `createWorker` / `updateWorker` / `deleteWorker`.
- `listHarnesses` → thin `listWorkers` only (no `/api/harness` HTTP fallback as of **0.10.2**).
- Still unused by UI (no client method or tests-only leftovers): `deleteSetting`, `listModels`, `getRoutine`, `getPlugin`, `getDeployment`, `getWebhookRateLimit` (rate limit via secret), etc.
- **Restored for UI:** `connectionTest`, `listMcpPresets`.
- Workspace client: **`listWorkspaces`**, **`createWorkspace`**, **`deleteWorkspace`** (blocks deleting `default`).

## Media paths (unified only)

- **`POST /api/media/generate`** is the only generate endpoint (image / audio / video via `surface`).
- Legacy `POST /api/media/image` and `POST /api/media/audio` were **removed** after Sunset **2026-04-01**.
- Workflow `MediaNode` and desktop/CLI clients call `/generate` only.

## Workspace API

- Server seeds `default` workspace and exposes `/api/workspace` CRUD.
- Desktop Sessions new-session modal: **picker**, **create** (optional home-relative path), **edit name/path**, **delete** (not for `default`).
- Stop control also calls **`cancelSession`** so the daemon stops in-flight chat/agent.
- Server rejects paths outside the user home directory (`validateWorkspacePath`).

## Workflow revisions

- `RevisionPanel` uses **`restoreRevision`** (server persist + pre-restore snapshot), then loads the editor.
- Editor **clears dirty** after a successful server restore (`setSavedDraft`).

## Audit regen

```bash
node tools/audit/regen.mjs
# or: pnpm audit:regen
```
