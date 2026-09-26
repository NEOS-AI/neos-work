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
| **Web (browser)** | Same product catalog as desktop (v0.26): Projects, Sessions, Workflows, Workers, Packs, Blocks, Templates, Skills, Plugins, Memory, Design systems, Routines, Deployments, Media |
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
| API keys / settings | yes | yes (subset) | env/settings CLI | Web: Anthropic/Google/OpenAI + collab status |
| Workflow editor | **yes** | **yes (v0.27)** | import/export CLI | Web: full palette + per-type config + run history |
| Domain packs / workers UI | **yes** | **yes (v0.25)** | — | Web: lists + pack zip install (v0.26) |
| Plugins / remote marketplace | **yes** | **yes (v0.25/v0.26)** | — | Web: catalog URL + install; desktop keeps plugin-run SSE |
| Blocks | **yes** | **yes (v0.26)** | — | Web: list + create prompt block |
| Templates | **yes** | **yes (v0.26)** | — | Web: instantiate workflow |
| Skills UI | **yes** | **yes** | — | Web + desktop: list/scan/toggle/delete + catalog search/preview/install. Remote delete removes files. Web is thin (no detail/Try/upgrade chrome). |
| Design systems | **yes** | **yes (v0.26)** | list + content/rules/tokens get/put | Web: list + DESIGN.md + RULES.md editors. Promote, prune UX, variants, starters, project Context RULES preview = Desktop only. |
| Media generate UI | **yes** | **yes** (v0.23) | yes | Web: list + generate; Desktop full studio |
| Sessions / workspaces | **yes** | **yes (v0.25)** | — | Web: list/create/chat SSE + workspace CRUD |
| MCP install snippets | yes | yes | `neos mcp serve` | Thin panel on web Settings |
| Memory UI | **yes** | **yes (v0.25)** | `neos memory export` | Web: CRUD + toggle |
| Routines | **yes** | **yes (v0.26)** | — | Web: create/toggle/run now |
| Deployments | **yes** | **yes (v0.26)** | — | Web: preflight + create + refresh |
| Video studio (FFmpeg/FFprobe) | **yes** | — | — | Desktop `/video` without engine connect: probe, transcode, extract, trim, timeline, … Local files only |

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
- Assume web marketplace/catalog install is missing (workflows, plugins, and skills catalog are on web)

Wire conventions: [`skills/api-docs/references/conventions.md`](../../skills/api-docs/references/conventions.md).

---

## Marketplace decision (Q29)

| Choice | Rationale |
|---|---|
| **Desktop-only full marketplace UI** | Trust tiers, zip install, catalog fetch already live on Plugins page (0.6.4) |
| Web | **Catalog + install + catalog URL (v0.25/v0.26)**; skills catalog search/preview/install — plugin-run SSE studio remains desktop |

Revisit plugin-run SSE in the browser only if product pull requires it.

---

## Routes (current)

| App | Routes (approx) |
|---|---|
| Web | Connect · Projects · ProjectDetail · Sessions · Media · Workflows · WorkflowEditor · Workers · Domain packs · Blocks · Templates · Skills · Plugins · Memory · Design systems · Routines · Deployments · Settings |
| Desktop | ModeSelection · Sessions · Workflows · Projects · **Workers** (`/workers`; alias `/harnesses`) · Domain packs · Blocks · Templates · Skills · Memory · Settings · Design systems · Routines · Plugins · Deployments · Media |

---

## Related

- API orphans / dual paths: [`api-surface-notes.md`](./api-surface-notes.md)  
- FE↔BE audit: [`audit/report.md`](../../audit/report.md)  
- Shared-edit ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- Impl: [`docs/implementation/v0.9/v0.9.3.md`](../implementation/v0.9/v0.9.3.md)
