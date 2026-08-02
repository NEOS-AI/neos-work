# PLAN_FOR_V0_6_0 — Collaboration · Canvas · Marketplace

**Status:** M0–M3 shipped through **0.6.3**; M4+ open  
**Baseline:** monorepo **0.6.3**
**Parent:** [`PLAN_FOR_V0_5_0.md`](./PLAN_FOR_V0_5_0.md) §13 backlog  
**One-line:** Open the **v0.6 train** with multiplayer *foundations*, opt-in free-canvas *spikes*, and marketplace *hosting* — without regressing v0.5 Design Editor / dual-surface contracts.

---

## 0. Why v0.6 now

v0.5 delivered OD-parity Design Projects + Editor (Layers, Edit-with-AI, file SSE, security closeout). Explicitly deferred:

| Deferred in v0.5 (Q12 etc.) | v0.6 stance |
|---|---|
| Free-canvas / drag-resize WYSIWYG | **Spike → gated MVP** (not full Figma) |
| Realtime multiplayer CRDT | **Presence first → ops later** |
| Hosted marketplace | **Local remains default**; remote registry optional |
| JSX/TSX Layers AST parity | **Incremental** with HTML still 1급 |
| Postgres multi-replica / Helm / mobile Tauri | **Ops track** (P2) |

---

## 1. Goals / non-goals

### Goals

1. **Collab M0–M1:** Project presence + awareness channel; then shared-edit ops protocol (CRDT/OT TBD after spike).
2. **Canvas M1–M2:** Optional free-canvas *overlay* on Preview (select/move frames) without replacing file-SSOT Code path.
3. **Marketplace M2:** Remote pack/plugin catalog install (opt-in URL) while local catalogs stay primary.
4. **JSX M1+:** Best-effort Layers for common JSX/TSX patterns (no full Babel product).
5. Keep **local-first**, Bearer daemon auth, path sandbox, and dual surface (Workflow + Design).

### Non-goals (v0.6)

- Full Figma auto-layout engine / vector pen tools  
- Multi-tenant RBAC / SaaS control plane  
- Electron rewrite  
- Replacing Tauri desktop  

---

## 2. Architecture sketch

```text
                    ┌─────────────────────────────┐
  Desktop / Web ──► │  Project collab SSE + REST  │
                    │  presence · (later) ops     │
                    └─────────────┬───────────────┘
                                  │ in-process hub (M0)
                                  │ → optional Redis/WS fanout (later)
                    ┌─────────────▼───────────────┐
                    │  Design file SSOT on disk    │
                    │  + revisions (v0.5)          │
                    └─────────────────────────────┘
```

**Rule:** Disk files remain SSOT. Collab never bypasses `project-files` write API. Presence is ephemeral (memory).

---

## 3. Release train

| Milestone | Theme | Exit criteria |
|---|---|---|
| **M0** | Foundation | Presence hub + SSE; token log hygiene; plan + 0.6.0 tag |
| **M1** | Awareness UX + JSX layers | Peers chip in Editor; JSX tree best-effort; collab protocol draft |
| **M2** | Canvas overlay MVP | Preview-frame drag for selected element → CSS/patch write |
| **M3** | Shared edit ops | Single-file awareness locks or Yjs/Loro spike behind flag |
| **M4** | Marketplace remote | Opt-in catalog URL + install; trust UI |
| **M5** | Polish / ops | Helm snippet optional; inventory gates; docs |

---

## 4. Task breakdown

### Task 0 — Plan lock (this file)

- [x] Write PLAN_FOR_V0_6_0  
- [ ] Lock Q14–Q16 after user feedback (defaults below)

### Task 1 — M0 Project presence (this release)

- [x] `lib/project-collab.ts` — join/leave/list, max peers/project  
- [x] `GET /api/projects/:id/collab/stream` — SSE presence.sync / join / leave  
- [x] Unit + route tests  
- [x] Web + desktop client subscribe when project open (presence count)  
- [x] Do not print full `NEOS_AUTH_TOKEN` when set via env  

### Task 2 — M1 Awareness UX

- [x] Peer avatars / count in Design Editor chrome (`PresencePeersBar`)  
- [x] Optional displayName query (sanitized) + colorHint  
- [x] Presence idle timeout (90s) + heartbeat + peers REST  

### Task 3 — M1 JSX Layers best-effort

- [x] Parse common JSX return trees → LayerNode (`jsx-layers.ts`)  
- [x] Fallback badge when incomplete (`JSX~`)  

### Task 4 — M2 Canvas overlay

- [x] Preview overlay hit-targets for selected layer (`CanvasOverlay`)  
- [x] Drag → update inline style / write via existing save path  
- [x] Feature flag `NEOS_CANVAS_OVERLAY=1` / `VITE_NEOS_CANVAS_OVERLAY` (0.6.2)  

### Task 5 — M3 Shared ops (spike)

- [x] ADR: Yjs vs Loro vs lock+LWW → **lock+LWW** ([0001](../adr/0001-shared-edit-strategy.md))  
- [x] Flagged experimental **file locks** + optional hard enforce (`NEOS_SHARED_EDIT=1`) (0.6.3)  

### Task 6 — M4 Remote marketplace

- [ ] Catalog schema + signature/trust tier  
- [ ] Settings UI install from URL  

### Task 7 — Docs · version · inventory

- [x] `docs/implementation/v0.6/v0.6.0.md`  
- [x] monorepo **0.6.0**  
- [ ] migration note if any breaking (expect additive)

---

## 5. Decision defaults (Q14–Q16)

| ID | Question | Default | Status |
|---|---|---|---|
| Q14 | Collab transport | **SSE + in-process hub** first; WebSocket later if needed | recommended |
| Q15 | Free-canvas scope | **Overlay on HTML Preview only**; Code remains SSOT | recommended |
| Q16 | Marketplace remote | **Opt-in catalog URL**; never replace bundled local | recommended |

---

## 6. Security

- Presence payloads: no absolute host paths, no tokens, scrub displayName  
- Collab SSE requires same Bearer auth as project routes  
- Cap peers per project / connection lifetime (mirror file SSE 30m)  
- Env-provided auth token **never** logged in full  

---

## 7. Success metrics (v0.6.0 ship)

- [x] M0 presence hub + SSE + client peer chip  
- [x] Server collab unit + route tests green  
- [x] Web / desktop Project workspace tests green  
- [x] Token log hygiene when `NEOS_AUTH_TOKEN` set  
- [ ] Manual: two clients on same project see peer count ≥ 1  
- [ ] Full monorepo `pnpm test` / e2e:c5 on Node 22+ CI host  

---

## 8. References

- [`PLAN_FOR_V0_5_0.md`](./PLAN_FOR_V0_5_0.md) §13  
- [`docs/security/v0.5.md`](../security/v0.5.md)  
- [`docs/implementation/v0.5/v0.5.30.md`](../implementation/v0.5/v0.5.30.md)  
