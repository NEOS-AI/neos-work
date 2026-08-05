---
name: api-docs
description: Draft or improve REST/OpenAPI-oriented API documentation for NEOS Work daemon APIs.
version: 1.1.0
mode: agent
category: code
triggers: API docs, OpenAPI, endpoint docs, hash contentHash, envelope, NEOS_SHARED_EDIT
example-prompt: Document the /api/projects routes for external consumers
---
# API documentation (NEOS Work)

Produce clear endpoint documentation from routes or shared wire schemas.

## Always read first

1. **Wire conventions:** [references/conventions.md](./references/conventions.md)  
   - Live file **`hash`** vs revision **`contentHash`**  
   - Mutate vs read **envelope** policy  
   - Collab session / hard-enforce headers  
2. **Schemas:** `packages/shared/src/schemas/api-envelopes.ts` (+ OpenAPI fragments)  
3. **Types:** `packages/shared/src/types/project.ts`  
4. **Routes:** `apps/server/src/routes/*.ts`  
5. **ADR shared-edit:** `docs/adr/0001-shared-edit-strategy.md` when documenting locks

## Structure

- Overview and auth (`Authorization: Bearer <NEOS_AUTH_TOKEN>`)
- Endpoints: method, path, request, response, errors
- Examples (curl or fetch) — **no real secrets**
- Versioning / monorepo version notes when relevant

## Hard rules (do not invent)

| Domain | Field | Never |
|---|---|---|
| Live file read / write / file SSE | **`hash`** | Do not document success as `contentHash` |
| Revision list / get / restore records | **`contentHash`** | Do not rename to `hash` in revision rows |
| Mutating HTTP (POST/PUT/PATCH/DELETE) clients | Return full envelope `{ ok, data?, error? }` | Do not document “throw on every 4xx” for web mutates |
| Hard lock conflict | **HTTP 423** + `data.holder` | Not only 409 (409 is collab lock *acquire* conflict) |

## When documenting project files / collab

Include:

- Session identity for hard-enforce: body `sessionId` and/or `x-neos-session-id`
- `NEOS_SHARED_EDIT=1` surface (user PUT, DELETE, restore, mkdir; agent bypass)
- Dual hash domains with a one-line example of each

## Output quality

- Prefer tables for method/path and status codes  
- Link to `pnpm e2e:contract` / inventory when claiming FE/BE parity  
- Keep examples free of real tokens and absolute user data dirs  
