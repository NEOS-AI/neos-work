# API surface notes (FE/CLI vs server)

Last updated 2026-08-05 (post-remediation inventory refresh + connection probes).

## Auth-exempt (by design)

See `apps/server/src/lib/auth-paths.ts`:

| Path | Why |
|------|-----|
| `GET /api/health` | Connection probe before token is known |
| `POST /api/webhook/:workflowId` (one segment only) | HMAC-signed trigger |
| `/api/tools/*` | Short-lived agent **tool tokens** (not human Bearer) |
| `GET /api/mcp-servers/oauth/callback`, `GET /api/mcp/oauth/callback` | Browser OAuth redirect (PKCE) |

## Human clients

| Surface | Primary client |
|---------|----------------|
| Desktop | `apps/desktop/src/lib/engine.ts` |
| Web | `apps/web/src/lib/api.ts` (thin: projects lifecycle + detail, settings, collab, runs) |
| CLI | `apps/cli/src/client.ts` |

## Intentional orphans / dual paths

These exist on the server but are **not** product UI entry points (or are superseded):

| Endpoint | Notes |
|----------|--------|
| `GET /api` | Version banner |
| `POST /api/artifacts`, `PUT …`, `GET …/preview` | Created by workflow runs; UI uses list/get/patch/delete/refresh |
| `POST/PUT/DELETE /api/harness` and `/api/harnesses` | Prefer **`/api/workers`**; harness mount is a v0.4 alias |
| ~~`POST /api/media/image`~~, ~~`/audio`~~ | **Removed** after Sunset 2026-04-01 — use **`POST /api/media/generate`** |
| `GET /api/media/jobs` (list) | Clients poll **`GET /api/media/jobs/:id`** when generate returns `jobId` |
| `GET /api/webhook/:workflowId/rate-limit` | Rate limit also embedded in **`GET …/secret`** (UI uses secret path) |
| `POST /api/workflow/migrate` | Ops / dry-run migration |
| `PATCH /api/live-artifacts/:id`, `GET …/preview`, `GET …/refreshes` | Partial live-artifact surface |
| `/api/tools/live-artifacts/*` | **Agent tool-token only** |
| Detail GETs (`/session/:id`, `/models`, `/workers/:id`, …) | List + action routes used; single-resource GET often unused |

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
# or: npm run audit:regen
```
