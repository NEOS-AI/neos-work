# PLAN_FOR_V0_14_0 — Process E2E journey (PR) · Multi-replica lock depth (nightly)

**Status:** **M1 + M3 complete** through **0.14.1** (train closed for selected milestones)  
**Baseline:** monorepo **0.14.1**  
**Parent backlog:** [`PLAN_FOR_V0_13_0.md`](./PLAN_FOR_V0_13_0.md) (train closed)

## One-line

Prove the **running engine** (not only in-process Hono) can complete the Design Project
golden path on every PR, and deepen **nightly multi-replica** coverage with shared lock
hard-enforce (user + agent) — without browser UI automation or CRDT.

## Why v0.14 now

v0.13 locked shared-edit **wire shapes** into `pnpm e2e:contract`. That suite never boots
a real `dist` server and never exercises Bearer auth, listen ports, or SQLite under a
process boundary. Named “e2e” scripts (`e2e:smoke`, structural multi-replica) are mostly
static. Operators still cannot treat a green PR as “the product HTTP path works.”

## Scope choice (user-selected)

| Milestone | Ship | Notes |
|---|---|---|
| **M1** | **Yes** | Process API golden path in PR CI |
| **M3** | **Yes** | Nightly multi-replica depth + train closeout |
| M0 (taxonomy-only rename) | Folded into M1 docs | Suite tier table lives in migration |
| **M2** (Playwright browser) | **Deferred** | Explicit non-goal this train |

## Goals

1. **M1:** `pnpm e2e:journey` boots built server → health → project create → file write `hash` → collab join → lock 409 → hard-enforce user **423** → dry-run create/cancel  
2. **M1 CI:** GitHub Actions builds server deps and runs journey on every PR  
3. **M3:** Live multi-replica asserts cross-node lock list + user **423** + agent **423** (with `NEOS_SHARED_EDIT_AGENTS`)  
4. **M3 closeout:** migration · release · inventory `v14Features` · README  

## Non-goals

- Playwright / browser Design Editor loop (M2 deferred)  
- Sticky SSE implementation  
- Shared durable run registry  
- CRDT multi-caret  
- Real LLM / coding-agent CLI in CI  
- Desktop Tauri window automation  

## Train

| M | Theme | Exit | Target |
|---|---|---|---|
| **M1** | Process API golden path | `e2e:journey` green in PR CI | **done 0.14.0** |
| **M3** | Nightly lock depth + closeout | Live multi-replica agent 423 + docs/inventory | **done 0.14.1** |

---

## Task M1 (0.14.0) — API golden path (`e2e:journey`)

**Exit:** `pnpm e2e:journey` starts `apps/server/dist/index.js` with ephemeral
`NEOS_DATA_DIR` + `NEOS_AUTH_TOKEN`, then asserts:

| # | Step | Expected |
|---|---|---|
| 1 | Node engines | Fail fast if Node major &lt; 22 (native modules) |
| 2 | `GET /api/health` | **200** with Bearer |
| 3 | `POST /api/projects` | **201** + `data.id` |
| 4 | `PUT …/files/index.html` | **200** + body `hash` (not only `contentHash`) |
| 5 | Collab SSE `ready` | `sessionId` for two peers |
| 6 | Lock acquire A + B same path | **409** + holder for second |
| 7 | `NEOS_SHARED_EDIT=1` foreign user PUT | **423** + holder |
| 8 | Holder user PUT | **200** |
| 9 | Dry-run `POST /api/runs` + cancel | create ok; second cancel **409** if terminal |

- [x] `e2e/journey/run.mjs`  
- [x] Root script `e2e:journey`  
- [x] CI: build server filter + `pnpm e2e:journey`  
- [x] Impl note + version **0.14.0**  

### M1 acceptance

| Case | Expected |
|---|---|
| Missing server dist | Clear rebuild hint, exit 1 |
| Node &lt; 22 | Clear engines message, exit 1 |
| All journey steps | exit 0 |

---

## Task M3 (0.14.1) — Multi-replica lock depth + closeout

**Exit:** `pnpm e2e:multi-replica:live` (nightly) covers user **and** agent hard-enforce
across replicas; train docs + `v14Features` complete.

### Live case map (additive)

| # | Case | Status |
|---|---|---|
| L1 | Dual health + redis bus | existing |
| L2 | Shared data project visible on B | existing |
| L3 | Cross-replica peers | existing |
| L4 | Selection fan-out A→B | existing |
| L5 | Lock acquire A → list on B | existing (0.10.1) |
| L6 | Foreign **user** PUT on B → **423** | existing |
| L7 | Foreign **agent** PUT on B → **423** when agents flag on | **new 0.14.1** |
| L8 | Collab status `locks.kind` present | existing |

- [x] Expand `e2e/multi-replica/run.mjs` for agent 423 (L7)  
- [x] `docs/migration/v0.14.0.md` · `docs/releases/v0.14.1.md`  
- [x] Inventory `v14Features` + gate  
- [x] README pointers  
- [x] Impl notes **0.14.0** / **0.14.1**  
- [x] Version **0.14.1**  

### M3 acceptance

| Case | Expected |
|---|---|
| Live L7 | agent PUT without holder session → **423** on replica B |
| `pnpm inventory:check` | `v14Features` ok |
| PR CI | still runs journey + contract; live stays nightly |

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q42** | True process E2E in PR? | Yes — boot `dist` server | **locked (M1)** |
| **Q43** | Browser E2E this train? | No — defer M2 | **locked** |
| **Q44** | Multi-replica agent 423 live? | Yes on nightly | **locked (M3)** |

---

## Suite tiers (operator map)

| Tier | Command | When | Proves |
|---|---|---|---|
| T0 Static | `e2e:smoke`, `inventory:check` | PR | Catalogs / docs |
| T1 Wire | `e2e:contract` | PR | In-process shared-edit shapes |
| **T2 Process** | **`e2e:journey`** | **PR (new)** | Real server HTTP golden path |
| T3 UI browser | (deferred M2) | — | Web Connect → editor |
| T4 Topology | `e2e:multi-replica:live` | Nightly | Dual engine + Redis + locks |
| T5 Live providers | `e2e:live-smoke` | Opt-in | Keys / reachability |

---

## References

- Parent: [`PLAN_FOR_V0_13_0.md`](./PLAN_FOR_V0_13_0.md)  
- ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- Ops: [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- Journey: `e2e/journey/run.mjs`  
- Multi-replica: `e2e/multi-replica/run.mjs`  
