# PLAN_FOR_V0_24_0 — OS keyring + web Workflow editor

**Status:** **complete** (0.24.0)  
**Baseline:** **0.23.0** → **0.24.0**  
**Method:** parallel subagents + TDD; Tauri keyring closeout in parent

## Tracks

| Track | Theme | Impl |
|---|---|---|
| **OS** | Native keyring (keytar + Tauri `keyring`) | [`v0.24.0`](../implementation/v0.24/v0.24.0.md) |
| **WF** | Full web Workflow list + React Flow editor | [`v0.24.1`](../implementation/v0.24/v0.24.1.md) |

## Acceptance

- `NEOS_SECRETS_KEY_BACKEND=os` uses OS keychain when available  
- Tauri commands `get/set/delete_master_key` registered  
- Web `/workflows` + `/workflows/:id` with React Flow save/run  
- Dual-surface: Workflow editor web = yes  
- `v24Features` inventory green  
