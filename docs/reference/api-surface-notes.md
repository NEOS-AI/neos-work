# API surface notes (FE/CLI vs server)

Last updated with the FE↔BE integration audit (P2 cleanup).

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
| Web | `apps/web/src/lib/api.ts` (thin: projects, settings, collab, runs) |
| CLI | `apps/cli/src/client.ts` |

## Intentional orphans / dual paths

These exist on the server but are **not** product UI entry points (or are superseded):

| Endpoint | Notes |
|----------|--------|
| `GET /api` | Version banner |
| `POST /api/artifacts`, `PUT …`, `GET …/preview` | Created by workflow runs; UI uses list/get/patch/delete/refresh |
| `POST/PUT/DELETE /api/harness` and `/api/harnesses` | Prefer **`/api/workers`**; harness mount is a v0.4 alias |
| `POST /api/media/image`, `POST /api/media/audio` | Prefer **`POST /api/media/generate`** (desktop Media + CLI) |
| `GET /api/media/jobs` (list) | Clients poll **`GET /api/media/jobs/:id`** when generate returns `jobId` |
| `GET /api/memory/export` | CLI: `neos memory export` |
| `POST /api/workflow/migrate` | Ops / dry-run migration |
| `POST /api/domain-packs/install-zip` | Zip install; UI uses install + validate |
| `PATCH /api/live-artifacts/:id`, `GET …/preview`, `GET …/refreshes` | Partial live-artifact surface |
| `/api/tools/live-artifacts/*` | **Agent tool-token only** |

## Deprecations removed from desktop client

- `createHarness` / `updateHarness` / `deleteHarness` aliases removed from `EngineClient` — use `createWorker` / `updateWorker` / `deleteWorker`.
- Removed unused EngineClient methods (tests-only): `deleteSetting`, `listModels`, `listMcpPresets`, `refreshMcpOAuth`, `listNeosMcpTools`, `listProjectRuns`, `getRoutine`, `createProjectToolToken`, `connectionTest`, `getPlugin`, `getWebhookRateLimit`, `getDeployment`, `getDomainPack`, `validateDomainPackManifest`, `mediaFileUrl`.
- Workspace client: **`listWorkspaces`**, **`createWorkspace`**, **`deleteWorkspace`** (blocks deleting `default`).

## Media path deprecations (server still accepts until Sunset)

- `POST /api/media/image` and `POST /api/media/audio` still generate media but respond with:
  - `Deprecation: true`
  - `Sunset: Wed, 01 Apr 2026 00:00:00 GMT`
  - `Link: </api/media/generate>; rel="successor-version"`
  - `data.deprecated: true` + `data.prefer: "POST /api/media/generate"`
- Prefer **`POST /api/media/generate`** (desktop Media UI + CLI).
- Plan: remove legacy routes after the Sunset date if no external callers remain.

## Workspace API

- Server seeds `default` workspace and exposes `/api/workspace` CRUD.
- Desktop Sessions new-session modal: **picker**, **create** (optional home-relative path), **edit name/path**, **delete** (not for `default`).
- Stop control also calls **`cancelSession`** so the daemon stops in-flight chat/agent.
- Server rejects paths outside the user home directory (`validateWorkspacePath`).

## Workflow revisions

- `RevisionPanel` uses **`restoreRevision`** (server persist + pre-restore snapshot), then loads the editor.
- Editor **clears dirty** after a successful server restore (`setSavedDraft`).