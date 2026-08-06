# Dual-surface product matrix (Desktop · Web)

**Status:** Active (v0.9.3 / M3)  
**Plan:** [`docs/plans/PLAN_FOR_V0_9_0.md`](../plans/PLAN_FOR_V0_9_0.md) Q25 · Q26 · Q29  
**Clients:** Desktop `apps/desktop` · Web `apps/web` · CLI `apps/cli`  
**Shared editor:** `@neos-work/design-editor`  
**Wire SSOT:** `@neos-work/shared` (types + `schemas/api-envelopes.ts`)

---

## Policy (Q25)

| Surface | Role |
|---|---|
| **Desktop (Tauri)** | Full product: Workflow + Design Project + ops |
| **Web (browser)** | **Design Project loop** only — editor, collab, comments, zip, runs, settings keys |
| **CLI** | Headless / automation (`neos` doctor, project, mcp, memory, …) |

Web is intentionally **not** a clone of every desktop route. Expanding web is a product decision; see gaps below.

---

## Capability matrix

| Capability | Desktop | Web | CLI | Notes |
|---|---|---|---|---|
| Design Project CRUD | yes | yes | list/create subset | Web: create/rename/delete on Projects list |
| Design Editor (Preview/Code/Layers) | yes | yes | — | Shared package |
| Canvas overlay (default on 0.9.1) | yes | yes | — | Pref `neos.canvasOverlay`; env `=0` off |
| Layers sibling reorder | yes | yes | — | HTML SSOT (0.9.0) |
| Align / z-order | yes | yes | — | DesignEditor chrome (0.9.1) |
| Preview comments | yes | yes | — | Server injects into runs (0.9.2 web UI) |
| Project zip import/export | yes | yes | — | 0.9.2 web |
| Collab presence / locks / selection | yes | yes | — | SSE + REST poll; multi-replica bus |
| File revisions list/view/restore | yes | yes | — | Live tip uses **`hash`**; revisions **`contentHash`** |
| Project runs + cancel + SSE | yes | yes | — | Shared run types |
| API keys / settings | yes | yes (subset) | env/settings CLI | Web: Anthropic/Google + collab status |
| Workflow editor | **yes** | **no** | import/export CLI | Intentional |
| Domain packs / workers UI | **yes** | **no** | — | Intentional |
| Plugins / remote marketplace | **yes** | **no** (badge) | — | **Q29:** desktop-only full marketplace (0.9.3) |
| Media generate UI | **yes** | **no** | yes | Desktop Media page + CLI |
| Sessions / workspaces | **yes** | **no** | — | Intentional |
| MCP install snippets | yes | yes | `neos mcp serve` | Thin panel on web Settings |
| Memory UI | **yes** | **no** | `neos memory export` | — |
| Deployments UI | **yes** | **no** | — | — |

---

## Client architecture (Q26)

```text
                    ┌─────────────────────────┐
                    │  @neos-work/shared      │
                    │  types · Zod wire parse │
                    │  normalizeProjectRelPath│
                    └───────────┬─────────────┘
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
   EngineClient          WebApiClient              CLI client
   (desktop mega)        (thin projects)           (headless)
           │                    │
           └────────┬───────────┘
                    ▼
          @neos-work/design-editor
```

**Do:**

- Parse live writes with `parseProjectFileWriteResponse` (**`hash`**)  
- Parse revision lists with `parseFileRevisionListResponse` (**`contentHash`**)  
- Parse preview comments with `parsePreviewCommentListResponse`  
- Normalize paths with `normalizeProjectRelPath`  
- Mutating web calls use non-throwing envelopes (`requestEnvelope`)

**Don't:**

- Big-bang merge into one mega client in 0.9  
- Map revision `contentHash` into live tip `hash` (or the reverse) outside adapter boundaries  
- Assume web can open `/workflows` or marketplace install

Wire conventions: [`skills/api-docs/references/conventions.md`](../../skills/api-docs/references/conventions.md).

---

## Marketplace decision (Q29)

| Choice | Rationale |
|---|---|
| **Desktop-only full marketplace UI** | Trust tiers, zip install, catalog fetch already live on Plugins page (0.6.4) |
| Web | **Badge only** — “Plugins marketplace is desktop-only” on Settings (no catalog install surface in 0.9.3) |

Revisit thin web catalog install only if product pull requires browser-first plugin install.

---

## Routes (current)

| App | Routes (approx) |
|---|---|
| Web | Connect · Projects · ProjectDetail · Settings |
| Desktop | ModeSelection · Sessions · Workflows · Projects · Harnesses · Domain packs · Blocks · Templates · Skills · Memory · Settings · Design systems · Routines · Plugins · Deployments · Media |

---

## Related

- API orphans / dual paths: [`api-surface-notes.md`](./api-surface-notes.md)  
- FE↔BE audit: [`audit/report.md`](../../audit/report.md)  
- Shared-edit ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- Impl: [`docs/implementation/v0.9/v0.9.3.md`](../implementation/v0.9/v0.9.3.md)
