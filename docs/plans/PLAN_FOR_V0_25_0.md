# PLAN_FOR_V0_25_0 — Web ops + Cowork skills + collab reconnect + shared draft

**Status:** **complete** (0.25.0)  
**Baseline:** **0.24.0** → **0.25.0**  
**Method:** TDD; four sequential tracks (A → B → C → D)

## Tracks

| Track | Theme | Impl |
|---|---|---|
| **A** | Web ops surface (sessions, memory, plugins catalog, workers, packs) | [`v0.25.0`](../implementation/v0.25/v0.25.0.md) |
| **B** | Cowork skills (pptx/docx) + Design Project new file | [`v0.25.1`](../implementation/v0.25/v0.25.1.md) |
| **C** | Collab SSE reconnect + web workflow leave-blocker (CRDT still deferred) | [`v0.25.2`](../implementation/v0.25/v0.25.2.md) |
| **D** | Share `workflow-draft` in `@neos-work/shared` | [`v0.25.3`](../implementation/v0.25/v0.25.3.md) |

## Non-goals

- Full CRDT multi-caret (ADR 0001 still lock + LWW)
- Sticky SSE at the load balancer
- Mega-merge of `EngineClient` + `WebApiClient`
- Desktop-complete marketplace trust/zip install on web
- Deployments / routines / design-system editor on web

## Acceptance

- Web routes: `/sessions` `/memory` `/plugins` `/workers` `/domain-packs`
- Dual-surface matrix updated (sessions, memory, plugins catalog, workers, packs = yes)
- `skills/pptx-deck` and `skills/docx-report` discovered
- Web ProjectDetail **New file**
- Collab SSE reconnect policy in `@neos-work/shared`
- `buildWorkflowDraft` lives in `@neos-work/shared`
- `pnpm inventory:check` — `v25Features` green
