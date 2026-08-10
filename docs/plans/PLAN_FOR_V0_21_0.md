# PLAN_FOR_V0_21_0 — Durable run event log + multi-replica e2e L9/L10

**Status:** **complete** (Track 1 + Track 2 shipped in **0.21.0**)  
**Baseline:** monorepo **0.20.0** → **0.21.0**  
**Parent:** [`PLAN_FOR_V0_20_0.md`](./PLAN_FOR_V0_20_0.md) · run events [`v0.19.1`](../implementation/v0.19/v0.19.1.md)

## One-line

Deepen multi-replica run reliability: **durable JSONL event log** on shared data
volume, and **live e2e gates** for cross-pod run GET/events + disk persistence.

## Goals

### Track 1 — Durable run event log

1. Append-only `{NEOS_DATA_DIR}/runs/{id}/events.jsonl`  
2. Env `NEOS_RUN_EVENT_LOG=auto|on|off`  
3. Wire into `dualWriteRunEvent` / `appendRunEvent`  
4. GET/SSE events fall back to JSONL when shared buffer empty  

### Track 2 — Multi-replica e2e

1. Live engines set `NEOS_RUN_REGISTRY=auto` + `NEOS_RUN_EVENT_LOG=on`  
2. **L9** dry-run on A → GET run + events on B  
3. **L10** durable `events.jsonl` on shared data dir  
4. Structural checks for ops doc + module  

## Non-goals

- Postgres warehouse / long-term analytics  
- Sticky LB implementation  
- Changing client modularization  

## Acceptance

| Case | Expected |
|---|---|
| Owner append | Local + shared buffer + JSONL (when log on) |
| Non-owner GET events | Shared buffer or durable JSONL |
| `NEOS_RUN_EVENT_LOG=off` | No disk write |
| `pnpm e2e:multi-replica` structural | includes L9/L10 contracts |
| Live `--live` | L9 + L10 green with Redis |
| `pnpm inventory:check` | `v21Features` ok |

## References

- Impl 1: [`v0.21.0`](../implementation/v0.21/v0.21.0.md)  
- Impl 2: [`v0.21.1`](../implementation/v0.21/v0.21.1.md)  
- Ops: [`multi-replica-collab.md`](../ops/multi-replica-collab.md)  
