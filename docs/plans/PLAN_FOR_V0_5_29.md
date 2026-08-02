# PLAN_FOR_V0_5_29 — v0.5 Closeout

**Status:** in progress  
**Baseline:** monorepo **0.5.28** (Task 0–17 feature train complete; stretch residuals only)  
**Parent plan:** [`PLAN_FOR_V0_5_0.md`](./PLAN_FOR_V0_5_0.md)  
**Goal:** Close the v0.5 line with a release checklist, acceptance-gate matrix, opt-in live smoke, security doc sync, and repo hygiene — then freeze new v0.5 feature work.

This is **list A** from the post-0.5.28 next-todo stack (close out v0.5 before v0.6).

---

## 0. One-line definition

v0.5.29 ships **release-closeout tooling and docs**, not a new product surface. After gates are checked and tagged, further product work goes to **v0.6**.

---

## 1. Goals / non-goals

### Goals

1. Acceptance Gates 1–11 mapped to evidence (auto / manual / N/A).
2. Repeatable release commands: `test` · `typecheck` · `lint` · `e2e:smoke` · `inventory:check` · opt-in live smoke.
3. `NEOS_LIVE_SMOKE=1` harness for provider reachability (no secrets in CI default).
4. Security model doc covers symlink-root refuse + path redaction + hash file events (0.5.27–0.5.28).
5. Build-artifact hygiene: `*.tsbuildinfo` not tracked.
6. Version bump **0.5.28 → 0.5.29** + `docs/implementation/v0.5/v0.5.29.md`.

### Non-goals (this patch)

- `packages/ui-app` extraction (stretch list B).
- Free-canvas / multiplayer / marketplace (v0.6).
- Full Figma atom suite or Electron parity.
- Forcing live provider keys in default CI.

---

## 2. Acceptance Gate matrix (PLAN §0.3 / §11)

| # | Gate | Auto evidence | Manual | Status |
|---|---|---|---|---|
| 1 | Protocol | `e2e:smoke` catalogs; skill/DS/plugin fixtures | — | **Done** (0.5.x) |
| 2 | Project | server project/files/revision/archive tests | Folder import once | **Done** |
| 3 | Design Editor | design-editor + desktop/web editor tests; Layers/Inspect/Edit-with-AI | generate→edit→Preview loop | **Done** + **manual residual** |
| 4 | Runtime | agent-runtime catalog ≥12; run SSE tests | Optional real CLI | **Done** |
| 5 | Plugin | plugin-runtime atom registry tests | — | **Done** |
| 6 | Media | media route/provider tests; stub default off | — | **Done** |
| 7 | Live artifact | live-artifact + tool-token tests | — | **Done** |
| 8 | CLI | `apps/cli` suite; `neos version/doctor` | — | **Done** |
| 9 | Topology | Docker docs + web/desktop clients | Docker compose health (0.5.29) | **Done** |
| 10 | Security | path-sandbox, ssrf, symlink root refuse, redaction tests | — | **Done** (through 0.5.27) |
| 11 | Regression | workflow-engine / domain pack tests | — | **Done** |

**Release review checkboxes (operator):**

- [x] `pnpm e2e:c5` green (Editor scenario coverage + smoke)  
- [x] `pnpm e2e:smoke` green  
- [x] Optional: `NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke`  
- [x] Docker compose health reachable (`version` 0.5.29)  
- [x] Tag / notes for **0.5.29**  
- [ ] Full monorepo `pnpm test` / `typecheck` / `lint` on CI host (Node 22+)  
- [ ] Optional human Design Editor UX pass (see §4)

---

## 3. Task breakdown

### Task C0 — Plan + matrix (this file)

- [x] Write closeout plan with gate matrix and commands  
- [x] Mark tasks done in implementation note as work lands  

### Task C1 — Live provider smoke (opt-in)

- [x] `e2e/live-smoke/run.mjs`  
  - Default (no env): **skip exit 0** with clear message  
  - `NEOS_LIVE_SMOKE=1`: inventory sanity + public endpoint probes (no response bodies/keys)  
  - Optional daemon path: `NEOS_SERVER_URL` + `NEOS_AUTH_TOKEN` → `POST /api/connection-test` for `cli-agents` / `openai` / `anthropic` / `ollama`  
- [x] Root scripts: `e2e:live-smoke`  
- [x] Document in README + this plan  

### Task C2 — Security doc sync

- [x] Update `docs/security/v0.5.md` for 0.5.27–0.5.28 controls  
  - Root symlink refuse (projects/workspaces/skills/media/memory/domain-packs/…)  
  - Absolute path redaction on list/API surfaces  
  - Hash-based project file change events  

### Task C3 — Repo hygiene

- [x] Ensure `*.tsbuildinfo` gitignored (already) and **untracked**  
- [x] Document Node **22+** (engines already; local Node 20 warns)  

### Task C4 — Version + implementation note

- [x] Bump monorepo + packages + health/CLI/MCP/UA to **0.5.29**  
- [x] `docs/implementation/v0.5/v0.5.29.md`  
- [x] Refresh `pnpm inventory:write` if inventory embeds version  

### Task C5 — Acceptance residual (automated where possible)

- [x] Design Editor scenarios via `pnpm e2e:c5` (design-editor + desktop/web workspace tests + smoke)  
- [x] Docker compose smoke (`deploy/Dockerfile` prod-deps fix; health `0.5.29`)  
- [x] Git tag **v0.5.29** after release commit  
- [ ] Optional human UX pass in real Desktop/Web UI (not blocking)  

### Deferred to list B / v0.6

| Item | Target |
|---|---|
| Thin `packages/ui-app` | List B |
| Desktop MCP Settings install UI | List B |
| Web dirty/SSE banner polish | List B |
| Free-canvas, multiplayer, marketplace | v0.6 plan |

---

## 4. Manual Design Editor scenarios

1. Create Design Project → open Editor.  
2. Chat brief → agent writes HTML (BYOK or CLI).  
3. Code: change a CSS color → save → Preview reflects.  
4. Layers: hierarchy → click selects Preview outline → Preview click highlights Layers.  
5. Visibility toggle dirties Code.  
6. Select element → Edit with AI (patch) → unrelated manual edits preserved.  
7. Dirty buffer + agent write → conflict banner (Keep / Take disk).

---

## 5. Commands

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm e2e:smoke
pnpm inventory:check

# Opt-in live probes (no keys required for public reachability)
NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke

# Optional: against a running daemon
NEOS_LIVE_SMOKE=1 \
  NEOS_SERVER_URL=http://127.0.0.1:3000 \
  NEOS_AUTH_TOKEN=… \
  pnpm e2e:live-smoke
```

---

## 6. Success metrics

- [x] Tasks C0–C4 implemented and documented under v0.5.29  
- [x] Gate matrix status frozen for release review  
- [x] Live smoke skip path safe for default CI; opt-in path documented  
- [x] No tracked `*.tsbuildinfo`  
- [ ] Next product plan is **v0.6**, not further v0.5 feature creep (after tag)  

---

## 7. Implementation order

1. C0 plan (this file)  
2. C1 live-smoke script + package scripts  
3. C2 security doc  
4. C3 untrack tsbuildinfo  
5. C4 version bump + implementation note + inventory write  
6. C5 operator (human)

---

## 8. References

- [`PLAN_FOR_V0_5_0.md`](./PLAN_FOR_V0_5_0.md) §0.3 gates, §9 tests, §11 metrics, §13 v0.6 backlog  
- [`docs/implementation/v0.5/v0.5.28.md`](../implementation/v0.5/v0.5.28.md)  
- [`docs/security/v0.5.md`](../security/v0.5.md)  
- [`docs/migration/v0.5.0.md`](../migration/v0.5.0.md)  
