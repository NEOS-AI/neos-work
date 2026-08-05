# NEOS Work API wire conventions

Source of truth for agent-written docs and client code. Prefer these over ad-hoc
field names in older notes.

**Schemas:** `packages/shared/src/schemas/api-envelopes.ts`  
**Types:** `packages/shared/src/types/project.ts`  
**Contract smoke:** `pnpm e2e:contract` (`apps/server/src/routes/contract-fe-be.test.ts`)

---

## 1. Envelope shape

Every JSON API response is an envelope:

```ts
{ ok: boolean; data?: T; error?: string }
```

| Client | Mutates (POST/PUT/PATCH/DELETE) | Reads (GET) |
|---|---|---|
| **Web** (`WebApiClient`) | **`requestEnvelope`** — never throws on HTTP 4xx/5xx; caller checks `res.ok` and may read `data` (e.g. `holder`) | May throw `ApiError` with optional `data` |
| **Desktop** (`EngineClient`) | Always `{ ok, data?, error? }` via `readApiResponse` | Same |
| **CLI** | Typically throws if `!res.ok \|\| !envelope.ok` | Same |

**Why mutates must preserve envelopes:** lock **409** / hard-enforce **423** carry
`data.holder` (`sessionId`, `displayName`, optional `path`). Throwing and dropping
`data` breaks “Locked by …” UX.

Network / abort failures still reject the promise on all clients.

---

## 2. Live file `hash` vs revision `contentHash`

These are **different domains**. Do not mix them in docs or client mapping.

| Surface | Field | Where |
|---|---|---|
| **Live file** | **`hash`** | `PUT/GET …/files/*` success `data`, `file.changed` / `file.created` SSE payload |
| **Revision record** | **`contentHash`** | `GET …/revisions`, `GET …/revisions/:id`, revision list items |

### Live write success (example)

```json
{
  "ok": true,
  "data": {
    "path": "index.html",
    "hash": "a1b2c3…",
    "bytes": 128,
    "created": false
  }
}
```

### Revision list item (example)

```json
{
  "id": "rev-…",
  "path": "index.html",
  "contentHash": "deadbeef…",
  "source": "user",
  "createdAt": "2026-08-01T12:00:00.000Z"
}
```

### Client pitfalls

- Web save must update editor tip from **`data.hash`** (optional fallback to
  `contentHash` only for legacy mistakes — prefer hash).
- CLI MCP adapters may map server **`hash` → adapter `contentHash`** only at the
  adapter boundary, not in REST docs.
- Zod: `parseProjectFileWriteResponse` requires `hash`; revision schemas require
  `contentHash`.

---

## 3. Collab session identity (hard enforce)

When `NEOS_SHARED_EDIT=1` (or `true`) and a lock exists on the target path,
user mutations must identify the collab **presence session** (from SSE `ready`):

| Transport | Name |
|---|---|
| JSON body | `sessionId` |
| Header | `x-neos-session-id` |

Either is enough; **clients should send both**. Header survives proxies that strip
DELETE bodies.

Mismatch / missing while another peer holds the lock → **HTTP 423**:

```json
{
  "ok": false,
  "error": "File locked by Alice",
  "data": {
    "holder": {
      "sessionId": "…",
      "displayName": "Alice",
      "path": "index.html"
    }
  }
}
```

Contrast: **POST …/collab/locks** acquire conflict is **HTTP 409** + `data.holder`
(advisory lock already held). Do not document 423 and 409 as interchangeable.

### Hard-enforce surface

| Method | Path | Hard-enforced when |
|---|---|---|
| `PUT` | `/api/projects/:id/files/*` | `source` is `user` (default); lock on path |
| `DELETE` | `/api/projects/:id/files/*` | lock on path |
| `POST` | `/api/projects/:id/revisions/:id/restore` | lock on revision’s path |
| `POST` | `/api/projects/:id/mkdir` | lock on mkdir target path |

### Agent bypass (intentional)

| Writer | Hard-enforce |
|---|---|
| Human / UI (`source: "user"`) | Yes |
| Agent / run pipeline (`source: "agent"` or daemon run writes) | **No** — agents remain project-level writers |
| Import | Not via hard-enforce path above |

Rationale: peer locks constrain multi-human clients; the agent runtime is
daemon-mediated and must still apply tool writes while a human holds an
advisory/hard lock. See ADR 0001.

---

## 4. Project-relative paths

Use `@neos-work/shared` **`normalizeProjectRelPath`** (web, desktop, server collab).

- Posix `/`, strip leading `/`
- Reject `..`, `~/`, drive paths, control chars, length > 500

---

## 5. Runs

| Endpoint | Notes |
|---|---|
| `POST /api/runs` | Create; envelope on web |
| `GET /api/runs/:id` | Summary status |
| `GET /api/runs/:id/events` | History (`?after=`) |
| `GET /api/runs/:id/events/stream` | SSE until terminal (~10 min) |
| `POST /api/runs/:id/cancel` | **409** if already terminal |

Prefer SSE for live UX; poll events + GET as fallback (web + desktop).

Terminal statuses (canonical + aliases): `succeeded`, `failed`, `canceled` /
`cancelled`, `error` — use `isTerminalRunStatus` from shared.

---

## 6. Auth

```http
Authorization: Bearer <NEOS_AUTH_TOKEN>
```

Do not put real tokens in examples. Prefer placeholder `YOUR_TOKEN`.

---

## 7. Doc checklist for new endpoints

- [ ] Envelope fields and HTTP status for success + main errors  
- [ ] `hash` vs `contentHash` if files/revisions involved  
- [ ] Mutate path documents non-throwing client pattern where applicable  
- [ ] Collab: session header/body if mutation can hit hard-enforce  
- [ ] Example curl without secrets  
- [ ] Link ADR / migration if env flags change behavior  
