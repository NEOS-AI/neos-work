# PLAN_FOR_V0_26_0 — Remaining desktop surfaces on web (all modes)

**Status:** **complete** (0.26.0)  
**Baseline:** **0.25.0** → **0.26.0**

Bring every remaining desktop-only product surface to the browser so Host, Client, and Web modes share the same ops catalog.

## Surfaces

| Surface | Web |
|---|---|
| Blocks | list + create prompt block + delete custom |
| Templates | list + instantiate workflow |
| Skills | list + scan + toggle + delete |
| Design systems | list + create + editor (DESIGN.md) |
| Routines | list + create + toggle + run now + delete |
| Deployments | list + preflight + create + refresh + delete |
| Domain pack zip | install zip on web |
| Marketplace catalog URL | get/set on Plugins |

## Non-goals

- Desktop plugin-run SSE studio clone
- Host-mode local process spawn in the browser
- CRDT / sticky SSE

## Acceptance

- Web routes match desktop nav (minus Dashboard / ModeSelection)
- Dual-surface matrix: remaining rows = yes (v0.26)
- `pnpm inventory:check` — `v26Features` green
