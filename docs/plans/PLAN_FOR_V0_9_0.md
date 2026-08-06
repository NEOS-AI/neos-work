# PLAN_FOR_V0_9_0 — Design Editor completion · Dual-surface parity

**Status:** **M0–M4 complete** through **0.9.4**  
**Baseline:** monorepo **0.9.4**  
**Parent backlog:** CRDT multi-caret (Q19/Q22) deferred until product pull

## One-line

Finish the Design Editor as a product (reorder, default canvas, align tools) and close the largest **web ↔ desktop** gaps for Design Projects — without reopening collab transport or CRDT.

## Why v0.9 now

v0.6–v0.8 delivered collab foundations, multi-replica presence, and canvas tooling.
Contract hardening (0.8.7) and FE/BE audit remediation are green. The remaining
**user-visible** holes are editor completion and dual-surface parity, not more bus plumbing.

| Closed through 0.8.x | Still open (this train) |
|---|---|
| Presence, locks, selection, multi-select collab | Layers **sibling reorder** (DOM order → HTML SSOT) |
| Canvas move / resize / group scale / undo (flagged) | Canvas **default-on** (or durable settings toggle) |
| Desktop preview comments + revisions | Web **preview comments** (API already exists) |
| Desktop project zip import | Web **project zip import/export** |
| Marketplace remote (desktop Plugins) | Explicit dual-surface policy + light web install path |
| FE/BE wire Zod + contract smoke | Shared client helpers to stop envelope drift |

## Goals

1. **Layers complete (M0):** Drag sibling reorder → DOM order patch written through the existing dirty/save path (not free-canvas layout)  
2. **Canvas productized (M1):** Overlay usable without env vars; settings toggle + optional align / distribute / z-order MVP  
3. **Web Design Project parity (M2):** Preview comments + project zip import/export on web; inject comments into runs like desktop  
4. **Dual-surface policy (M3):** Document desktop-only vs shared surfaces; optional thin web marketplace install; reduce EngineClient / WebApiClient drift  
5. Keep **disk file SSOT**, lock+LWW, Bearer daemon auth, and additive migrations only  

## Non-goals

- Full CRDT multi-caret (Q19 / Q22 remain deferred until product pull)  
- Sticky SSE across replicas  
- Multi-tenant RBAC / SaaS control plane  
- Postgres primary store  
- Figma auto-layout engine / vector pen tools  
- Electron rewrite or mobile Tauri  
- Expanding web into full Workflow / Domain Pack product (desktop remains primary for those)  

## Train

| M | Theme | Exit | Target version |
|---|---|---|---|
| **M0** | Layers sibling reorder | Drag reorder → HTML SSOT; unit + editor tests | **done 0.9.0** |
| **M1** | Canvas default + tools | Default-on / settings toggle; align·z-order MVP | **done 0.9.1** |
| **M2** | Web comments + zip | Web preview comments + project import/export | **done 0.9.2** |
| **M3** | Dual-surface + shared client | Policy doc; shared wire helpers; marketplace desktop-only | **done 0.9.3** |
| **M4** | Docs / inventory | Migration + `v09Features` gates + README | **done 0.9.4** |

Post-closeout polish (0.9.5+) may absorb agent lock enforce (`NEOS_SHARED_EDIT_AGENTS`), JSX layers depth, and orphan API triage without opening a new major train.

---

## Architecture rules

```text
  Layers drag reorder ──► parse HTML / rewrite sibling order ──► dirty buffer
  Canvas align / z      ──► inline style / DOM order patch      ──► dirty buffer
  Preview comments      ──► SQLite preview_comments (existing) ──► run prompt inject
  Zip import            ──► existing /api/projects/import.zip   ──► project row + files
                              │
                              ▼
                     PUT /api/projects/:id/files/*   (hash SSOT, lock+LWW)
```

**Rules:**

1. Disk files remain SSOT. No parallel scene graph.  
2. Reorder and align write the **same** local buffer used by Code mode; save uses existing `hash` write contract (0.8.7).  
3. Reorder is **DOM sibling order only** — not absolute positioning auto-layout.  
4. Web reuses `@neos-work/design-editor` and existing project REST; do not fork editor packages.  
5. Agent writes stay `source: "agent"`; optional agent lock enforce is **post-train stretch** (ADR 0001).  

---

## Task M0 (0.9.0) — Layers sibling reorder

**Exit:** User can drag a layer above/below siblings; HTML buffer updates; save persists order.

- [x] Plan file (this document)  
- [x] `reorderSiblingInHtml` / `reorderSiblingByNeosId` in `packages/design-editor`  
  - Prefer `data-neos-id` (+ stamp when missing); selector fallback  
  - Fail closed: `locked` / `different-parent` / `not-found` / `no-op`  
- [x] `LayersPanel` drag handles + drop targets (before/after by row mid Y)  
- [x] `DesignEditor` wiring: reorder → dirty buffer → preview reload  
- [x] Multi-select: reorder **primary only**  
- [x] JSX parse path: drag disabled + hint (HTML remains 1급)  
- [x] Tests: unit rewrite + LayersPanel drag + DesignEditor buffer  
- [x] `docs/implementation/v0.9/v0.9.0.md`  
- [x] Version **0.9.0**  


### M0 acceptance

| Case | Expected |
|---|---|
| Drag B above A under same parent | Source HTML sibling order matches; selectors still resolve |
| Drag across different parents | **Rejected** or only same-parent moves (document; default **same parent only**) |
| Dirty buffer + Save | `PUT files` succeeds; reload shows new order |
| Locked layer (`data-neos-locked`) | Cannot reorder locked node (mirror lock toggle semantics) |

---

## Task M1 (0.9.1) — Canvas productized

**Exit:** Canvas tools work for HTML Preview without requiring env vars on fresh install.

- [x] **Default policy (Q23):** canvas overlay **on by default** for HTML-like entry files  
  - Env `VITE_NEOS_CANVAS_OVERLAY=0` / `NEOS_CANVAS_OVERLAY=0` still forces off  
  - User preference key (desktop localStorage / web storage): `neos.canvasOverlay`  
- [x] Settings UI: “Canvas overlay” toggle (desktop Settings + web Settings)  
- [x] Align / distribute MVP (multi-select ≥ 2 / ≥ 3):  
  - Align left / center / right / top / middle / bottom relative to **primary** bbox  
  - Distribute H/V between extremes  
- [x] Z-order MVP: bring forward / send backward / front / back → DOM sibling order  
- [x] DesignEditor toolbar + chrome toggle (i18n en/ko settings keys)  
- [x] Tests: align math + z-order rewrite + default-on  
- [x] `docs/implementation/v0.9/v0.9.1.md`  
- [x] Version **0.9.1**  


### M1 non-goals

- Rotation handles, constraint layout, auto-layout flex solver  
- Making canvas the SSOT over Code mode  

---

## Task M2 (0.9.2) — Web preview comments + project zip

**Exit:** Browser Design Project can annotate + import like desktop for the core loop.

### M2a — Preview comments (web)

Server already exposes:

- `GET/POST /api/projects/:id/preview-comments`  
- `DELETE /api/projects/:id/preview-comments/:commentId`  
- Run assembler `assemblePreviewCommentsPrompt` (agent-runtime)

Desktop already wires list/create/delete in `ProjectWorkspace`.

- [x] `WebApiClient`: `listPreviewComments` / `createPreviewComment` / `deletePreviewComment`  
- [x] `ProjectDetail` UI: comments panel (list / add / delete)  
  - Require selection selector  
  - Scrub control chars in body  
- [x] create-run inject: server already injects via `listPreviewComments` (no web change required)  
- [x] Tests: `api.test.ts` + `ProjectDetail` / `Projects` page tests  
- [x] Web-local English copy (thin web has no i18n package)  

### M2b — Project zip import/export (web)

- [x] Wire `POST /api/projects/import.zip` + `GET …/export.zip`  
- [x] Projects list: Import zip + per-row Export; detail header Export  
- [x] Size / content-type validation UX (50 MiB client cap)  
- [x] Tests with mock `fetch`  

- [x] `docs/implementation/v0.9/v0.9.2.md`  
- [x] Version **0.9.2**  

### M2 explicit non-goals

- Web Workflow editor, Domain Packs UI, Media studio  
- Folder-path import token flow (desktop Tauri-only)  

---

## Task M3 (0.9.3) — Dual-surface policy + shared client

**Exit:** Clear product matrix; less FE/BE field drift; optional web marketplace install.

### M3a — Dual-surface matrix

- [x] `docs/reference/dual-surface.md`  

| Capability | Desktop | Web | Notes |
|---|---|---|---|
| Design Project CRUD | yes | yes | |
| Design Editor | yes | yes | shared package |
| Preview comments | yes | yes (M2) | |
| Project zip I/E | yes | yes (M2) | |
| Canvas overlay | yes | yes | default-on M1 |
| Collab presence/locks | yes | yes | 0.8.x |
| Workflow editor | yes | **no** | intentional |
| Domain packs / plugins marketplace | yes | **badge only** | Q29 desktop-only |
| Media generate UI | yes | **no** | CLI/desktop |
| Sessions / workspaces | yes | **no** | |

### M3b — Shared wire helpers

- [x] Preview-comment Zod + parse helpers in `@neos-work/shared`  
- [x] Web revisions + comments use shared parse (`contentHash` / comment schema)  
- [x] Live write already uses `parseProjectFileWriteResponse` (`hash`)  
- [x] Documented in `skills/api-docs/references/conventions.md`  
- [x] No mega EngineClient merge (Q26)  

### M3c — Web marketplace (thin)

- [x] **Q29 locked:** full marketplace remains **desktop-only**  
- [x] Web Settings **Desktop-only surfaces** badge (marketplace + workflow/media/…)  
- [x] Tests: shared parsers + Settings badge  
- [x] `docs/implementation/v0.9/v0.9.3.md`  
- [x] Version **0.9.3**  

---

## Task M4 (0.9.4) — Docs · inventory · closeout

**Exit:** Train is discoverable and gated like v0.7/v0.8.

- [x] `docs/migration/v0.9.0.md` (additive; no auto data migration)  
- [x] Inventory `scanV09Features` + `requireV09Features` gate:  
  - `planV09`, `migrationV09`  
  - `layersReorder`, `canvasDefault`  
  - `webPreviewComments`, `webProjectZip`  
  - `dualSurfaceDoc`, `sharedPreviewCommentParse`  
  - `implM0`…`implM4` under `docs/implementation/v0.9/`  
- [x] README: “What’s new in v0.9”, plan + migration links, canvas default note  
- [x] `docs/releases/v0.9.4.md`  
- [x] QA: `pnpm inventory:check` · targeted package tests · inventory unit tests  
- [x] Manual checklist documented in migration  
- [x] Version **0.9.4**  

---

## Decisions

| ID | Question | Default | Status |
|---|---|---|---|
| **Q23** | Canvas overlay default | **On** for HTML-like files; env `=0` forces off; user toggle persists | **locked (M1)** |
| **Q24** | Layers reorder scope | **Same-parent siblings only**; primary selection only when multi-select | **locked (M0)** |
| **Q25** | Web product scope | Design Project loop parity (editor, comments, zip, collab); **not** full workflow desktop clone | **locked (M3)** |
| **Q26** | Shared client strategy | Prefer `@neos-work/shared` wire helpers; avoid big-bang EngineClient merge in 0.9 | **locked (M3)** |
| **Q27** | CRDT / multi-caret | **Still deferred** (Q19/Q22); lock+LWW remains (ADR 0001) | locked (carry-forward) |
| Q28 | Agent lock enforce | Stretch post-M4: optional `NEOS_SHARED_EDIT_AGENTS=1` | deferred |
| **Q29** | Web marketplace depth | **Desktop-only** full marketplace UI; web badge only | **locked (M3)** |

Lock Q23–Q26 on first implementation PR of each milestone if product disagrees; update this table and only the affected Task section.

---

## Security

- Preview comment bodies: no `\0`; length caps already on server — keep web client aligned  
- Zip import: existing size / content-type checks; do not weaken  
- Reorder/align rewrites must not escape project path sandbox (still go through file API)  
- Collab hard-enforce (`NEOS_SHARED_EDIT`) unchanged: user mutations require holder session; agents still bypass unless Q28  
- Do not log `NEOS_AUTH_TOKEN` in full  
- Web remains Bearer-in-browser model from v0.5 security note (self-host / trusted LAN assumption)  

---

## Success metrics (train)

- [ ] M0: sibling reorder green on HTML fixture; design-editor tests pass  
- [ ] M1: fresh `pnpm --filter @neos-work/web dev` gets canvas tools without env; toggle works  
- [ ] M2: web can create comment on selection and import a project zip in UI tests  
- [ ] M3: dual-surface doc published; no new hash/`contentHash` client drift in contract tests  
- [ ] M4: `pnpm inventory:check` includes `v09Features`; migration + README updated  
- [ ] No regression: `pnpm e2e:smoke` · `pnpm e2e:contract` · collab unit tests  

---

## Stretch (after 0.9.4, not train blockers)

| Item | Notes |
|---|---|
| `NEOS_SHARED_EDIT_AGENTS=1` | ADR 0001 future; bind run→session optional |
| JSX/TSX reorder + deeper Layers AST | Still best-effort; HTML first |
| Canvas rotate / multi-handle resize NW–SE | Only if product pull |
| Shared lock store for multi-replica | Ops gap; separate ops train |
| Orphan endpoint delete/wire | Audit 45 orphans — product triage |
| Sunset `/api/harness*` | After deprecation notice |
| Extract `packages/client-project` | Only if M3b proves shared helpers insufficient |

---

## Suggested sprint order (≈2 weeks for M0–M2)

| Days | Focus |
|---|---|
| 1 | Plan review; M0 rewrite helper spike |
| 2–4 | M0 Layers drag + tests → **0.9.0** |
| 5–7 | M1 default canvas + align/z-order → **0.9.1** |
| 8–11 | M2 web comments + zip → **0.9.2** |
| 12–14 | M3 policy + helpers (+ optional marketplace) → start M4 docs |

---

## Verify commands (all milestones)

```bash
# Node 22 recommended
pnpm install
pnpm inventory:check   # after M4 includes v09Features
pnpm typecheck
pnpm test
pnpm e2e:smoke
pnpm e2e:contract

# Targeted
pnpm --filter @neos-work/design-editor test
pnpm --filter @neos-work/web test
pnpm --filter @neos-work/desktop exec vitest run src/pages/ProjectWorkspace.test.tsx
```

---

## References

- Parent train: [`PLAN_FOR_V0_8_0.md`](./PLAN_FOR_V0_8_0.md) · migration [`docs/migration/v0.8.0.md`](../migration/v0.8.0.md)  
- Layers origin: [`PLAN_FOR_V0_5_0.md`](./PLAN_FOR_V0_5_0.md) Q13 + sibling reorder stretch  
- Shared-edit ADR: [`docs/adr/0001-shared-edit-strategy.md`](../adr/0001-shared-edit-strategy.md)  
- API surface / dual-surface notes: [`docs/reference/api-surface-notes.md`](../reference/api-surface-notes.md) · [`audit/report.md`](../../audit/report.md)  
- Wire conventions: [`skills/api-docs/references/conventions.md`](../../skills/api-docs/references/conventions.md)  
- Ops multi-replica (unchanged this train): [`docs/ops/multi-replica-collab.md`](../ops/multi-replica-collab.md)  
- Impl notes (create as shipped): `docs/implementation/v0.9/v0.9.0.md` … `v0.9.4.md`  
