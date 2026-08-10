# PLAN_FOR_V0_22_0 — Run log retention + durable summary + nightly live e2e

**Status:** **complete** (M0 + M1 + M2 shipped in **0.22.0**)  
**Baseline:** monorepo **0.21.0** → **0.22.0**  
**Parent:** [`PLAN_FOR_V0_21_0.md`](./PLAN_FOR_V0_21_0.md)

## One-line

Productionize durable run logs: **retention/GC**, **summary.json** next to events,
and **nightly live multi-replica e2e** (Redis service + L11).

## Train map

| M | Theme | Exit | Status |
|---|---|---|---|
| **M0** | Retention | `pruneRunEventLogs`, env caps, startup GC | **done** |
| **M1** | Durable summary | `summary.json` write + GET hydrate | **done** |
| **M2** | Nightly live e2e | workflow Redis service, retry, L11 structural | **done** |

## Env (additions)

| Variable | Default |
|---|---|
| `NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS` | `168` |
| `NEOS_RUN_EVENT_LOG_MAX_RUNS` | `500` |
| `NEOS_RUN_EVENT_LOG_MAX_FILE_BYTES` | `8388608` |

## Acceptance

| Case | Expected |
|---|---|
| Startup with old run dirs | Pruned by age/count |
| dualWriteRunRecord | Writes `summary.json` |
| GET run after shared TTL | Hydrates from `summary.json` |
| Live e2e L11 | `summary.json` on shared data dir |
| Nightly workflow | schedule + `e2e:multi-replica:live` + Redis service |
| `pnpm inventory:check` | `v22Features` ok |

## References

- Impl M0: [`v0.22.0`](../implementation/v0.22/v0.22.0.md)  
- Impl M1: [`v0.22.1`](../implementation/v0.22/v0.22.1.md)  
- Impl M2: [`v0.22.2`](../implementation/v0.22/v0.22.2.md)  
