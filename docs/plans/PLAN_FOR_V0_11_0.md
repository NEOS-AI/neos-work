# PLAN_FOR_V0_11_0 — Agent run→session bind · Lock UX · Tool-path parity · Workers rename

**Status:** **M0–M3 complete** through **0.11.3** (train closed)  
**Baseline:** monorepo **0.11.3**  
**Parent backlog:** next train → [`PLAN_FOR_V0_12_0.md`](./PLAN_FOR_V0_12_0.md) (EngineClient modularization · ops polish)

## One-line

Make agent writers first-class collab citizens when hard-enforce is on: bind runs to presence sessions, surface lock/enforce state in UI, apply the same 423 rules on tool-token file writes, and retire leftover “harness” product naming — without opening CRDT or sticky SSE.

## Why v0.11 now

v0.10 shipped **opt-in agent lock enforce**, multi-replica **lock SSOT**, and harness HTTP **410**. Remaining gaps are product/ops completeness on the same train, not a new collab transport:

| Closed in 0.10.x | Still open (this train) |
|---|---|
| `NEOS_SHARED_EDIT` + `NEOS_SHARED_EDIT_AGENTS` → 423 on agent PUTs | Agents must **manually** pass holder `sessionId` / header (Q31) |
| Collab status fields on server (`sharedEdit`, `agentsHardEnforce`) | Clients rarely explain **why** a write got 423 under agent enforce |
| Lock registry hydrate/list across replicas | Tool-token / agent filesystem paths may not share human lock rules |
| `/api/harness*` → 410 | Desktop still brands **Harnesses** URL/UI while API is Workers |
| Inventory `v10Features` | No `v11Features` / migration / release for the bind train |

## Goals

1. **Run→session bind (M0):** Optional collab `sessionId` on `POST /api/runs` (and related create paths); when agent hard-enforce is on, agent-origin file PUTs **inherit** that session as lock identity  
2. **Lock UX (M1):** Desktop + web surface enforce flags and clearer 423 / holder messaging in Design Project flows  
3. **Tool-path parity (M2):** Agent tool-token writes that mutate project files honor the same hard-enforce rules as `source=agent` REST PUTs  
4. **Workers rename + hygiene (M3):** Product UI “Workers” (keep `/harnesses` alias); docs + `v11Features` + closeout  

## Non-goals

- Full CRDT multi-caret (Q19 / Q22 / Q27 / Q34 remain deferred)  
- Sticky SSE across multi-replica (design note only if needed; no impl)  
- Multi-tenant RBAC / SaaS control plane  
- Expanding web into full Workflow / Domain Pack product  
- Big-bang `EngineClient` merge (optional **debt** slice only if small)  
- Canvas rotate / multi-handle freeform (editor stretch — separate train)

## Train

| M | Theme | Exit | Target version |
|---|---|---|---|
| **M0** | Run→session bind | Create-run accepts session; agent writes inherit under enforce | **done 0.11.0** |
| **M1** | Lock / enforce UX | Status + 423 copy on desktop/web Design Project | **done 0.11.1** |
| **M2** | Tool-path lock parity | Tool filesystem writes → same 423 rules | **done 0.11.2** |
| **M3** | Workers rename · docs · inventory | UI rename + migration + `v11Features` + release | **done 0.11.3** |

---

## Task M0 (0.11.0) — Run → collab session bind (Q35)

**Exit:** A Design Project run created with the human’s collab `sessionId` can complete agent file PUTs under `NEOS_SHARED_EDIT=1` + `NEOS_SHARED_EDIT_AGENTS=1` **without** clients manually attaching session on every write. Runs **without** bind behave as today (must pass session or get 423 when foreign-locked).

### Scope

- [x] Plan file (this document)  
- [x] Wire: optional `sessionId` (and/or `x-neos-session-id`) on `POST /api/runs`  
- [x] Persist bind on run record (in-memory registry field; document not durable across process restart — same as runs today)  
- [x] When agent hard-enforce is on, daemon-mediated agent PUTs (run pipeline / registry spawn tool path that hits `PUT …/files/*` with `source=agent`) inject holder session from run bind if request omits session  
- [x] Public run summary may expose `collabSessionId` (or omit if null) — **no secrets**  
- [x] Desktop + web: pass collab presence session when starting project runs (Edit with AI / run create)  
- [x] Tests:  
  - bind + both flags + foreign lock → agent write as holder **200**  
  - no bind + both flags + foreign lock + no session → **423**  
  - bind session ≠ holder → **423**  
  - agents flag off → bind ignored for enforce (default bypass)  
  - invalid session id (control chars / length) rejected at create  
- [x] ADR 0001: document Q35 (run→session); keep session as collab identity, not auth  
- [x] `docs/implementation/v0.11/v0.11.0.md`  
- [x] Version **0.11.0**  

### M0 acceptance

| Case | Expected |
|---|---|
| both flags on, run has bind = holder, agent PUT no session header | **200** |
| both flags on, run has no bind, agent PUT no session, path locked by peer | **423** + `holder` |
| both flags on, run bind = non-holder | **423** |
| agents flag off, run has bind, foreign lock | **200** (agent bypass) |
| `POST /api/runs` with illegal sessionId | **400** |

### Design notes

- **Q35 default:** bind is **optional** at create; empty means “legacy / headless / CLI without collab”.  
- Prefer header + body channels already used for humans (`sessionId`, `x-neos-session-id`) so proxies and existing clients stay consistent.  
- Do **not** invent a second identity system or map chat `session` rows to collab presence without an explicit decision (out of scope).  
- CLI agent direct disk writes (spawn cwd) remain outside HTTP lock enforce — same as 0.10; only HTTP / tool-token paths that go through project file API are in scope (tool path completed in M2).

---

## Task M1 (0.11.1) — Lock / agent-enforce UX

**Exit:** Operators and users can see whether shared-edit and agent hard-enforce are active, and human/agent 423 failures show actionable holder messaging in Design Project UI (desktop + web).

### Scope

- [x] Collab status panel (desktop Settings ops strip and/or project workspace): show `sharedEdit`, `agentsHardEnforce`, lock registry kind/ready (fields already on `GET /api/collab/status` / locks snapshot)  
- [x] Web Settings collab status parity for the same fields (thin panel)  
- [x] On file write / delete / restore / mkdir failures with **423** + `data.holder`: consistent toast / banner (“Locked by {displayName}”)  
- [x] When agent enforce is on and a run is blocked, surface run error / event copy that mentions lock holder (no host paths)  
- [x] Shared wire parse if needed (`@neos-work/shared`) for status fields used by both clients  
- [x] Tests: status parse + 423 UI handler (unit/component)  
- [x] `docs/implementation/v0.11/v0.11.1.md`  
- [x] Version **0.11.1**  

### M1 acceptance

| Case | Expected |
|---|---|
| Server flags on | Desktop + web status show agent hard-enforce **on** |
| User write 423 | UI shows holder displayName / session short id |
| Agent run 423 under enforce | User-visible failure mentions lock (not silent fail) |

---

## Task M2 (0.11.2) — Tool-path lock parity (Q36)

**Exit:** Project file mutations via agent **tool tokens** (`/api/tools/*` or project tool write path) apply the same hard-enforce rules as REST `source=agent` PUTs when agent enforce is on; tool requests may carry run bind / session like REST.

### Scope

- [x] Inventory tool write entrypoints that touch project files (live-artifacts, tool tokens, any filesystem tool bridge)  
- [x] Apply `shouldHardEnforceWriteSource('agent')` + holder resolution (request session **or** run bind when available)  
- [x] Same **423** + `data.holder` envelope shape as project routes  
- [x] Document tool-token auth remains non-Bearer; sessionId is collab identity only  
- [x] Tests for tool write 423 / holder / bind inheritance  
- [x] Ops + security note cross-link  
- [x] `docs/implementation/v0.11/v0.11.2.md`  
- [x] Version **0.11.2**  

### M2 acceptance

| Case | Expected |
|---|---|
| both flags on, tool write locked path, no session/bind | **423** |
| both flags on, tool write as holder session | **200** |
| agents flag off | tool write not 423’d for locks |

---

## Task M3 (0.11.3) — Workers rename · docs · inventory closeout

**Exit:** Product language matches API (Workers); train docs frozen; inventory gates green.

### Scope

- [x] Desktop: primary nav / page title **Workers** (Domain Workers); keep route alias `/harnesses` for bookmarks (or redirect to `/workers` with alias — prefer **alias keep + title rename** for stability)  
- [x] Rename user-visible strings (`HarnessSelector` labels → Worker); file renames optional (non-blocking if tests heavy)  
- [x] `docs/migration/v0.11.0.md` (bind fields, UX, tool parity, rename)  
- [x] `docs/releases/v0.11.3.md`  
- [x] Inventory catalog `v11Features` + `pnpm inventory:check`  
- [x] README “What’s new in v0.11” + plan/migration links  
- [x] Security doc touch: agent bind + tool parity (`docs/security` or ADR)  
- [x] `docs/implementation/v0.11/v0.11.3.md`  
- [x] Version **0.11.3**  

### Inventory keys (target `v11Features`)

| Key | Surface |
|---|---|
| `planV11` | `docs/plans/PLAN_FOR_V0_11_0.md` |
| `migrationV11` | `docs/migration/v0.11.0.md` |
| `releaseV11` | `docs/releases/v0.11.3.md` |
| `runSessionBind` | run create + inherit session for agent writes |
| `lockEnforceUx` | status fields + 423 holder UX (desktop/web) |
| `toolPathLockParity` | tool-token / agent tool writes hard-enforce |
| `workersUiRename` | desktop Workers product naming |
| `implM0`…`implM3` | `docs/implementation/v0.11/v0.11.{0–3}.md` |

Exact inventory probe strings live in `tools/inventory/inventory.mjs` (add in M3; keys above are the contract).

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q35** | Run→session bind | Optional `sessionId` on run create; inherited for agent HTTP writes when agent hard-enforce on | **locked (M0)** |
| **Q36** | Tool-path enforce | Same rules as REST `source=agent` when agent hard-enforce on | **locked (M2)** |
| **Q37** | Harnesses UI | Rename to Workers; keep `/harnesses` URL alias | **locked (M3)** |
| **Q38** | Chat session vs collab session | **No merge** — collab presence id only; chat `session` rows stay separate | **locked (carry-forward)** |
| Q34 / CRDT | Multi-caret CRDT | Still deferred | locked (carry-forward) |
| Sticky SSE | Multi-replica sticky connections | Still deferred | locked (carry-forward) |
| Q30–Q33 | Agent enforce / lock registry / harness 410 | Unchanged from v0.10 | locked |

Lock Q35–Q38 on first implementation PR of each milestone if product disagrees; update this table and only the affected Task section.

---

## Security

- Session bind is **collab identity**, not authentication — Bearer / tool-token auth unchanged  
- Clients must not treat `sessionId` as a capability to escalate; hard-enforce only compares to lock **holder**  
- Reject control characters and overlong session ids at run create (same caps as presence join)  
- Do not log full `NEOS_AUTH_TOKEN` or tool tokens  
- 423 responses must not include absolute host paths  
- Default remains **agent bypass** when `NEOS_SHARED_EDIT_AGENTS` is off — edit-with-AI under human lock stays ergonomic  
- Tool tokens stay project-scoped; bind inheritance must not allow cross-project lock spoofing  

---

## Success metrics (train)

- [x] M0: acceptance table green in unit/route tests; desktop/web pass session on run create  
- [x] M1: collab status shows agent enforce; 423 holder visible on web + desktop  
- [x] M2: tool write path tests for 423 / holder / bind  
- [x] M3: `pnpm inventory:check` includes `v11Features`; migration + README + release published  
- [ ] No regression: `pnpm e2e:smoke` · `pnpm e2e:contract` · collab / projects / runs unit tests  
- [ ] Multi-replica structural e2e still green (`pnpm e2e:multi-replica`)  

---

## Stretch (after 0.11.3, not train blockers)

| Item | Notes |
|---|---|
| Sticky SSE design note | Ops-only; no implementation |
| Split `apps/desktop/src/lib/engine.ts` | Debt; extract project/collab client modules |
| `packages/client-project` | Only if web/desktop project helpers keep diverging |
| JSX/TSX Layers reorder | Editor train |
| Web media / memory depth | Dual-surface product pull |
| MCP OAuth refresh UX complete | Partial surface today |
| Orphan endpoint delete pass | Keep REST completeness unless product says delete |

---

## Suggested sprint order (≈2 weeks for M0–M3)

| Days | Focus |
|---|---|
| 1 | Plan review; lock Q35–Q38; spike run registry field |
| 2–4 | M0 bind + tests + client pass-session → **0.11.0** |
| 5–7 | M1 status + 423 UX desktop/web → **0.11.1** |
| 8–10 | M2 tool-path parity + tests → **0.11.2** |
| 11–14 | M3 Workers rename + migration + inventory + release → **0.11.3** |

---

## Verify commands (all milestones)

```bash
# Node 22+
pnpm install
pnpm inventory:check   # after M3 includes v11Features
pnpm typecheck
pnpm test
pnpm e2e:smoke
pnpm e2e:contract
pnpm e2e:multi-replica

# Targeted
pnpm --filter @neos-work/server exec vitest run src/routes/runs.test.ts src/routes/projects.test.ts
pnpm --filter @neos-work/web test
pnpm --filter @neos-work/desktop exec vitest run src/pages/ProjectWorkspace.test.tsx src/pages/Settings.test.tsx
```

---

## References

- Parent train: [`PLAN_FOR_V0_10_0.md`](./PLAN_FOR_V0_10_0.md) · release [`docs/releases/v0.10.3.md`](../releases/v0.10.3.md)  
- Migration baseline: [`docs/migration/v0.10.0.md`](../migration/v0.10.0.md)  
- ADR shared-edit: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- Ops multi-replica: [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- Dual-surface: [`docs/reference/dual-surface.md`](../reference/dual-surface.md)  
- API orphans: [`docs/reference/api-surface-notes.md`](../reference/api-surface-notes.md) · [`audit/report.md`](../../audit/report.md)  
- Wire conventions: [`skills/api-docs/references/conventions.md`](../../skills/api-docs/references/conventions.md)  
