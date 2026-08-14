# PLAN_FOR_V0_27_0 — Web Workflow editor v2

**Status:** **complete** (0.27.0)  
**Baseline:** **0.26.0** → **0.27.0**

Deepen the browser Workflow editor to match desktop core editing: full palette, per-type node config, run history.

## Scope

| Item | Behavior |
|---|---|
| Palette | Desktop node types: control / agent variants / block / delivery (slack, discord, media, deploy) |
| Tabs | Filter palette by pack / group |
| Node config | Agent (worker, mode, provider, model), block, trigger JSON, search, slack/discord, media, deploy |
| Run history | `GET /api/workflow/:id/runs` list + refresh after run |

## Non-goals

- Desktop revision panel / auto-layout / artifact preview
- Plugin-run SSE studio
- Full BlockParamForm for every param def

## Acceptance

- Web palette includes `media`, `block`, `slack_message`, `deploy`
- Agent config can pick a worker from `/api/workers`
- Run history panel lists recent runs
- `pnpm inventory:check` — `v27Features` green
