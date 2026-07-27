# NEOS Work v0.5.0 — Open Design Full Parity

> **기준 버전**: v0.4.4 (Domain Workers + workflow schemaVersion 2 안정화)
> **작성일**: 2026-07-27
> **목표**: v0.3에서 **MVP로만** 이식한 Open Design 표면을 **전체 기능 패리티** 수준으로 끌어올린다. NEOS Work는 Claude Cowork 대체제 정체성을 유지하면서, Open Design이 제공하는 **디자인 에이전트 substrate**(file-first project workspace, multi-CLI agent runtime, plugin/marketplace, media, live artifact, CLI headless surface, self-host)를 1급 제품 축으로 완성한다. 여기에 **Design Editor**를 핵심 UX로 둔다: LLM(및 코딩 에이전트 CLI)이 디자인을 **생성**하고, 사용자는 동일 파일 위에서 **수동 편집**·**Figma형 Layers tree**·미리보기·선택 영역 재프롬프트를 반복한다.
> **근거 문서**: [`docs/reference/open-design-repository-spec-ko.md`](../reference/open-design-repository-spec-ko.md), [`PLAN_FOR_V0_3_0.md`](./PLAN_FOR_V0_3_0.md) 비목표 해소, [`PLAN_FOR_V0_4_0.md`](./PLAN_FOR_V0_4_0.md) Domain Pack SDK 후속

---

## 0. 왜 지금 v0.5.0인가

### 0.1 v0.3–v0.4가 남긴 OD 갭

v0.3.0은 Open Design §5, §10–§19를 **neos-work 아키텍처에 맞게 MVP 이식**했다. v0.4.0은 도메인 워커·스키마 v2로 **실행 런타임**을 재설계했다. 그러나 OD 분석 문서 기준 “풀 구현”과는 다음이 남는다.

| OD 축 | v0.4.4 상태 | 풀 패리티 기준 |
|---|---|---|
| 제품 단위 | Workflow 중심 | **Design Project** (파일 작업공간) + Workflow 병존 |
| 디자인 편집 | 산출물 미리보기 수준 (iframe) | **Design Editor**: LLM 생성 + 코드/비주얼 수동 편집 + **Figma형 Layers tree** + 선택 영역 재생성 루프 |
| Agent runtime | 내부 orchestrator + CLI 3종 | CLI-first 옵션 + **확장 레지스트리** (탐지/spawn/stream/cancel) |
| Skill 프로토콜 | flat `*.md` 스캔 | **`SKILL.md` 패키지** (assets/references/examples, shadowing) |
| Plugin | MVP pipeline + HITL | atom registry, snapshot, trust, **local marketplace** |
| Media | OpenAI image/audio | image/video/audio + multi-provider + stub policy |
| Live artifact | HTML preview | refreshable live artifact + **tool-token API** |
| Import | workflow ZIP / Claude Design ZIP | **folder import (`baseDir`)**, working-dir 교체, handoff |
| CLI | 없음 (v0.3 비목표) | **`neos` CLI** (UI 동등 headless surface) |
| Web / self-host | Tauri desktop only | **browser web client** + Docker single-process |
| Security §22 | 부분 hardening | path sandbox, SSRF DNS, media guard, desktop picker gate |
| 카탈로그 | 사용자 홈 디렉터리만 | repo **bundled** skills / design-systems / plugins / templates |
| Pack SDK | v0.4 비목표 | Domain Pack **custom loader** (v0.4 후속) |

### 0.2 v0.5.0 한 줄 정의

> **Open Design의 디자인-에이전트 substrate를 NEOS Work에 완전 이식하고, Domain Workers·Workflow와 하나의 daemon(`apps/server`) 위에서 동등한 1급 진입점(Desktop UI / Web UI / `neos` CLI)으로 제공한다. Design Project의 기본 작업 루프는 “LLM으로 생성 → Design Editor(Code / Preview / **Layers tree** / Inspect)로 수동 편집 → (선택) Layers·선택 영역 기반 LLM 재생성”이다.**

### 0.3 “Full implement”의 공식 정의 (완료 조건)

v0.5.0 완료 시 아래 **Acceptance Gates**를 모두 통과해야 한다.

1. **Protocol gate** — `SKILL.md` / `DESIGN.md` / `open-design.json` / Markdown memory가 OD 호환 로더로 동작 (OD 샘플 fixture import 가능).
2. **Project gate** — 파일 기반 Design Project CRUD, folder import(copy-free `baseDir`), archive export, path sandbox.
3. **Design Editor gate** — LLM/에이전트로 생성된 HTML(및 지원 포맷)을 **Preview · Code · Inspect** 모드에서 수동 편집 저장 가능; **Figma형 Layers tree panel**로 DOM/문서 계층을 탐색·선택·(선택) 가시성/잠금/이름 표시; 저장본이 다음 LLM run의 입력 source of truth; 선택 요소 기반 “Edit with AI” 재프롬프트 가능.
4. **Runtime gate** — 최소 **12+** coding-agent CLI def 등록, detect + spawn + cancel + SSE; BYOK 경로 유지.
5. **Plugin gate** — atom registry + apply/run + snapshot pin + local marketplace inventory; 대표 atom ≥ 12.
6. **Media gate** — image/video/audio surface, ≥ 4 provider 계열, stub 기본 거부.
7. **Live artifact gate** — UI + tool-token 경로, refresh, project 스코프 강제.
8. **CLI gate** — `neos` binary로 project/run/files/media/plugin/memory/mcp/status 등 headless 호출.
9. **Topology gate** — Desktop(Tauri Host) + Web browser client + Docker compose 문서화·스모크.
10. **Security gate** — §22 핵심: path realpath, symlink archive block, SSRF(DNS+private IP), tool-token override 거부, desktop import token.
11. **Regression gate** — v0.4 workflow/workers/domain packs **무회귀**; OD 기능이 기존 Cowork 경로를 깨지 않음.

“Full”은 **open-design 리포 바이트 복제**가 아니다. Electron→Tauri, Express→Hono, Next→Vite React 등 **스택 등가 치환**을 허용하되, **사용자/에이전트 관찰 가능 계약**(파일 형식, API 의미, CLI 능력, 보안 경계)은 OD와 동등해야 한다. 추가로 NEOS 고유 계약으로 **Design Editor generate↔manual-edit loop**가 Acceptance Gate에 포함된다.

---

## 1. 목표와 비목표

### 목표

#### Part A — Design Project Substrate (OD §7, §18)

1. **Design Project 1급 모델**: SQLite metadata + `~/.config/neos-work/projects/<id>/` 또는 imported `baseDir`
2. **파일 레지스트리**: recursive list, entry 감지(`index.html`), archive, hidden/symlink 차단
3. **Folder import / working-dir 교체**: copy-free, realpath, root/data-dir 재진입 차단
4. **Claude Design ZIP + project ZIP** export/import (workflow ZIP과 분리·공존)
5. **Desktop native folder picker gate** (Tauri) + import token

#### Part A2 — Design Editor (생성 + 수동 편집 루프) ★ v0.5 핵심 UX

6. **Design Editor workspace**: Project 내 진입점 — **Files | Layers | Preview/Code/Inspect | Chat** 통합 셸
7. **LLM / 에이전트 생성 경로**: 자연어 브리프 → run → 프로젝트 파일에 HTML/CSS/JS(X) 등 산출물 기록 (BYOK 또는 CLI)
8. **수동 편집 경로**: 동일 파일을 사용자가 코드 에디터에서 직접 수정·저장; Preview 즉시 반영
9. **Layers tree panel (Figma-like)**: 현재 문서의 **계층 트리**(DOM 노드 / 섹션 프레임)를 사이드 패널에 표시 — expand/collapse, 클릭 선택, Preview·Code·Inspect와 **양방향 동기화**; 표시 이름(tag + id/class 요약), 검색/필터, 가시성·잠금 토글(HTML: `hidden`/class 또는 data 속성 best-effort)
10. **Inspect / 요소 선택**: Preview iframe 또는 Layers 행에서 요소 선택 → outline, path/selector, 속성 패널; **Edit with AI**로 선택 범위만 재작성
11. **Preview comments / annotations** (OD preview_comments 등가): 요소에 코멘트 → 다음 run context에 주입
12. **파일 단일 진실 공급원(SSOT)**: 디스크 파일이 항상 정본; LLM 출력·수동 편집·패치 모두 `project-files` write API 경유
13. **충돌·동시성 정책**: 편집 중 agent write 시 dirty 감지, 사용자 확인 후 merge/overwrite/diff; revision 스냅샷(최근 N회)
14. **지원 편집 포맷 (v0.5)**: HTML(+inline/linked CSS/JS) 1급; Markdown 미리보기+편집; JSX/TSX는 Code 모드 우선(Layers/Inspect는 best-effort AST 또는 preview DOM)
15. **Design System 연동**: 활성 `DESIGN.md` / tokens를 에디터 사이드패널·생성 프롬프트에 표시·주입

#### Part B — Agent Runtime Full (OD §5, §6)

15. **Runtime registry 패키지**: `packages/agent-runtime` (defs / detection / launch / parse / cancel)
16. **CLI adapter ≥ 12**: Claude, Codex, Gemini, OpenCode, Cursor Agent, Aider, Copilot, Qwen, Kimi, Grok Build, Devin, OpenCode 계열 등 (설치 시 detect, 미설치 graceful skip)
17. **Stream adapters**: plain text, JSONL, ACP/RPC(지원 CLI), SSE → UI/`neos run`
18. **Run registry**: queued|running|succeeded|failed|canceled, event buffer, cancel 우선순위, optional `events.jsonl`
19. **BYOK proxy 경로**: Anthropic/OpenAI/Azure/Google/Ollama stream proxy (외부 agent·CLI가 동일 서버 사용)

#### Part C — Extension Protocols Full (OD §9–§12, §16)

20. **Skill package protocol**: `SKILL.md` + assets/references/examples, shadowing, derived example cards
21. **Bundled catalogs**: `skills/`, `design-systems/`, `plugins/`, `templates/` in-repo + user override roots
22. **Design system full**: manifest, tokens, components, provenance fields, Agent/Project 주입
23. **Plugin full**: atom registry, apply, snapshot, trust/capability metadata, pipeline simulate
24. **GenUI surfaces**: form / choice / confirmation (+ CLI `neos ui respond`)
25. **Memory full**: index file, extraction config, SSE change events, prompt injection policy

#### Part D — Media · Live Artifact · Deploy (OD §13, §17, §19)

26. **Media multi-provider**: OpenAI, Azure-compatible, Google image, xAI image/video, ImageRouter/custom OpenAI-compatible; video surface
27. **Media guards**: path, size, MIME allowlist, duration clamp, stub policy (`NEOS_MEDIA_ALLOW_STUBS`)
28. **Live artifacts**: CRUD, preview, refresh history, tool-token routes
29. **Deploy parity**: preflight, check-link, config mask, project-scoped history (기존 Vercel/CF 강화)

#### Part E — Headless CLI & UI/CLI Parity (OD §20)

30. **`neos` CLI** (`apps/cli` → bin `neos`): daemon launcher + API wrapper
31. Subcommands: `status`, `daemon`, `project`, `files`, `run`, `media`, `plugin`, `skills`, `design-systems`, `memory`, `mcp`, `automation`, `deploy`, `ui`, `doctor`, `version` (+ `files edit` 보조)
32. Agent env injection: `NEOS_BIN`, `NEOS_SERVER_URL`, `NEOS_PROJECT_ID`, `NEOS_PROJECT_DIR`, auth token

#### Part F — Web Client · Self-host · Topology (OD §3, §23)

33. **`apps/web`**: Vite+React 공유 UI 패키지 추출 후 브라우저 클라이언트 (desktop과 동일 화면 공유 최대화; Design Editor 포함)
34. **Docker**: single image 또는 compose (server + optional static web), volume `neos_data`, token env
35. **Dev orchestration**: `pnpm tools-dev` 수준 스크립트 (server/web/desktop lifecycle) — `tools/dev`
36. Server static serving: production에서 빌드된 web 제공 옵션

#### Part G — Security · Observability (OD §22, §24)

37. **SSRF**: URL parse + DNS + private/link-local/metadata block + redirect deny
38. **Archive/path sandbox** 완성, media tool capability
39. **Privacy-light telemetry**: opt-in metrics endpoint (prom-style optional); PostHog 강제 아님 — consent gate만 준비
40. **Connection test** API (provider + local CLI smoke)

#### Part H — Domain Pack SDK (v0.4 후속)

41. Custom Domain Pack loader (manifest + workers/blocks/tools)
42. Pack install from local dir / ZIP (marketplace worker-pack는 local only)

#### Part I — Quality · Docs · Migration

43. OD fixture e2e / contract tests, migration guide `docs/migration/v0.5.0.md`
44. README / README.ko: dual product surface (Cowork workflows + Design Projects + **Design Editor loop**)
45. monorepo `0.5.0`, health banner, User-Agent 동기화
46. Capability inventory 생성 스크립트 (`pnpm inventory`) — agent/skill/plugin/media 목록 drift 방지

### 비목표 (v0.5.0에서 하지 않음)

| 항목 | 이유 |
|---|---|
| open-design 코드 포크/벤더링 | 라이선스·스택 불일치; 계약 호환이 목표 |
| Electron / `apps/packaged` OD 복제 | Tauri Host Mode 유지 |
| 원격 multi-replica Postgres daemon | 로컬/싱글 노드 우선; adapter stub만 허용 |
| 공용 호스티드 Marketplace SaaS | **로컬** registry/inventory만 |
| OpenClaw multi-channel gateway | 별도 로드맵 |
| 전 atom 100% OD 1:1 (Figma 전용 등) | 우선순위 atom 세트 + extension point |
| 유료 provider 실제 키 e2e (CI) | stub/mock + optional live smoke |
| Kubernetes Helm 풀 차트 | Docker compose면 충분; chart는 optional backlog |
| v0.4 workflow 모델 재파괴 | schemaVersion 2 유지, project는 **추가** 축 |
| **Figma급 벡터 캔버스 / 자유 드로잉 / 드래그 리사이즈 레이아웃 엔진** | Design Editor는 **파일(HTML 등) 중심**; **Layers tree는 v0.5 범위**, free-canvas WYSIWYG는 v0.6+ |
| **Figma Auto-layout / Constraints 엔진 재구현** | Layers 트리·선택 동기화만; 레이아웃 솔버 아님 |
| **실시간 multi-user CRDT 공동 편집** | 단일 사용자 local-first; revision만 |
| **바이너리 디자인 포맷(Sketch 등) 네이티브 편집** | 파일 미리보기·export 경로만 허용 |

---

## 2. 제품 아키텍처

### 2.1 이중 1급 표면 (Dual Surface)

```text
                    ┌─────────────────────────────────────┐
                    │         apps/server (daemon)        │
                    │  auth · SQLite · FS · spawn · SSE   │
                    └───────────────┬─────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
   Design Project surface    Workflow / Worker surface    Headless
   (OD-like)                 (Cowork / v0.4)              neos CLI
          │                         │                         │
   projects, files,          domain packs,                same HTTP
   chat/runs, **editor**,    graphs, workers,             contracts
   live artifacts, media     blocks, routines
          │                         │
   apps/desktop + apps/web (shared packages/ui-app)
```

- **Design Project**: 자연어 브리프 → 파일 산출물 → **Design Editor(수동 편집)** → 재생성/배포  
- **Workflow**: 기존 그래프 자동화, domain workers, finance/coding 블록  
- 둘 다 동일 skill/design-system/memory/MCP/media 인프라 공유

### 2.1.1 Design Editor 생성↔편집 루프 (핵심 사용자 여정)

```text
┌──────────────┐     run (LLM / CLI)      ┌─────────────────┐
│  Chat brief  │ ───────────────────────► │ Project files   │
│  + skill/DS  │                          │ (HTML/CSS/…)    │
└──────────────┘                          └────────┬────────┘
       ▲                                           │
       │                              load / save  │
       │                                           ▼
       │                              ┌────────────────────────┐
       │                              │     Design Editor      │
       │                              │ Layers │ Preview │ Code │
       │                              │        │ Inspect        │
       │                              └────────────┬───────────┘
       │                                           │
       │         manual edit (user)                │
       │◄──────────────────────────────────────────┤
       │         selection + "Edit with AI"        │
       └───────────────────────────────────────────┘
```

원칙:

1. **생성은 에이전트, 소유는 사용자** — 생성 직후부터 파일이 사용자의 편집 대상이다.
2. **디스크 SSOT** — 에디터 버퍼 dirty 상태가 있어도 저장 시 sandbox write; agent write도 동일 API.
3. **재생성은 기본이 “패치/범위 지정”** — 전체 덮어쓰기보다 선택 요소·파일 단위 프롬프트를 기본 UX로 둔다(전체 regenerate는 확인 후).
4. **미리보기는 편집의 피드백** — iframe keep-alive, scroll restore; Code 저장 시 hot reload.

### 2.2 모노레포 목표 지도

```text
neos-work/
├── apps/
│   ├── server/          # daemon (기존 확장) — OD apps/daemon 등가
│   ├── desktop/         # Tauri host
│   ├── web/             # NEW: browser UI
│   └── cli/             # NEW: `neos` binary
├── packages/
│   ├── shared/          # types + contracts
│   ├── core/            # orchestrator / tools (유지)
│   ├── agent-runtime/   # NEW: CLI registry + spawn adapters
│   ├── plugin-runtime/  # NEW: open-design.json + atoms + snapshot
│   ├── workflow-engine/ # 유지
│   ├── mcp-client/      # 유지 + server-expose 옵션
│   ├── browser-tool/    # 유지
│   ├── ui/              # i18n 등
│   ├── ui-app/          # NEW: desktop/web 공유 화면·훅
│   └── design-editor/   # NEW: Preview/Code/Inspect, selection bridge, diff
├── skills/              # NEW: bundled
├── design-systems/      # NEW: bundled
├── plugins/             # NEW: _official + community stubs
├── templates/
├── tools/
│   └── dev/             # NEW: process lifecycle
├── deploy/              # NEW: Docker
├── docs/
└── e2e/                 # NEW: contract + smoke
```

### 2.3 데이터 레이아웃

```text
~/.config/neos-work/   (또는 NEOS_DATA_DIR)
├── data.db              # SQLite (기존 + projects/runs/live_artifacts/…)
├── projects/<id>/       # default project workspace
├── skills/              # user skills (override bundled)
├── design-systems/
├── plugins/
├── memory/
├── media/
├── mcp-tokens/
└── workspaces/          # worker isolation (v0.4)
```

Imported folder project:

```text
projects.row.base_dir = /absolute/user/path   # copy-free
```

### 2.4 API 네이밍 전략

| 전략 | 선택 |
|---|---|
| 신규 Design Project API | `/api/projects/*` (OD 정렬) |
| 기존 workflow | `/api/workflow/*` 유지 |
| OD 별칭 (optional) | 문서화된 compatibility map; 강제 `/api` 1:1 복제 불필요 |
| Tool-token | `/api/tools/*` (media, live-artifacts) |
| Runs | `/api/runs/*` 공용 (project chat run + workflow run 뷰 통합 레이어) |
| Editor | `/api/projects/:id/files/*`, `/api/projects/:id/revisions/*`, `/api/projects/:id/preview-comments/*`, `POST /api/runs` with `editContext` |

---

## 3. 파트별 설계 요약

### 3.1 Design Project (Part A)

**테이블 (예시)**:

```sql
projects (
  id, name, base_dir, entry_file, design_system_id,
  created_at, updated_at, meta_json
)
conversations (id, project_id, title, …)
messages (id, conversation_id, role, content, agent_id, …)
tabs / tabs_state
live_artifacts (…)
file_revisions (id, project_id, path, content_hash, created_at, source)  -- source: user|agent|import
preview_comments (id, project_id, file_path, selector, body, created_at, …)
```

**핵심 라이브러리**:

- `apps/server/src/lib/projects.ts` — path sandbox, list files, archive
- `apps/server/src/routes/projects.ts`
- `apps/server/src/routes/import-export.ts` (folder, claude-design, zip)

**UI**:

- Projects home, Project workspace (files + chat + **Design Editor**)
- Import folder (Tauri dialog → token → POST import)

### 3.1.1 Design Editor (Part A2) — 상세 설계

Design Editor는 “생성만 하는 채팅”과 “배포만 하는 미리보기” 사이의 **작업 공간**이다.

#### 레이아웃

```text
┌──────────┬──────────────┬──────────────────────────────┬─────────────┐
│ Files    │ Layers       │  Editor tabs:                │ Chat / AI   │
│ (project │ (Figma-like  │  [Preview] [Code] [Split]    │ brief,      │
│  tree)   │  tree panel) │                              │ Edit w/ AI, │
│          │  ▼ body      │  iframe  |  CodeMirror       │ run log     │
│ entry ★  │    ▼ header  │  Inspect overlay             │             │
│          │    ▼ main    │                              │ Comments    │
│          │      • h1    ├──────────────────────────────┤ DS context  │
│          │      • …     │ Status: dirty · agent writing│             │
└──────────┴──────────────┴──────────────────────────────┴─────────────┘
```

좌측은 두 트리로 분리한다.

| 패널 | 모델 | 역할 |
|---|---|---|
| **Files** | 프로젝트 FS | 어떤 **파일**을 여는지 |
| **Layers** | 열린 문서의 **요소 계층** (Figma Layers에 대응) | 문서 **안**의 노드 탐색·선택·가시성 |

Files ≠ Layers. Layers는 현재 활성 디자인 파일(기본 `index.html` 등)의 구조 뷰이다.

#### 모드

| 모드 | 역할 | 입력 |
|---|---|---|
| **Preview** | sandbox iframe 렌더, 기기 폭 프리셋 | 저장본 또는 draft preview URL |
| **Code** | 구문 강조 편집 (CodeMirror 6, Q9) | `GET/PUT …/files/*` |
| **Split** | Preview + Code 동시 | 저장 시 preview reload |
| **Inspect** | Preview 위 요소 선택 오버레이 | postMessage bridge → selector + outerHTML snippet |
| **Layers** (패널) | 계층 트리; 모드가 아니라 **상시 사이드 패널** | DOM tree snapshot from iframe bridge |

#### Layers tree panel (Figma-like) — 상세

Figma의 왼쪽 **Layers** 패널에 대응하는 UX. free-canvas(Q12 금지) 없이, **HTML/DOM 계층**을 트리로 보여 선택·조작한다.

**데이터 소스 (우선순위)**

1. Preview iframe이 로드된 뒤 bridge가 보내는 **DOM tree snapshot** (권장, 렌더 결과와 일치)
2. Code 버퍼 파싱 fallback (dirty 미저장 시): HTML partial parse → 근사 트리
3. JSX/TSX: v0.5는 preview DOM 기준 best-effort (소스 AST 풀 파싱은 backlog)

**노드 모델 (개념)**

```ts
type LayerNode = {
  id: string              // stable-ish key (data-neos-id or path hash)
  tag: string             // div, section, h1, …
  name: string            // display: #id, .class 요약, aria-label, 또는 text trunc
  selector: string        // CSS/path for Inspect + editContext
  depth: number
  children: LayerNode[]
  visible: boolean        // computed / toggled
  locked: boolean         // UI lock: block inspect drag-select; still in tree
  sourceRange?: { start: number; end: number }  // map back to Code when possible
}
```

**상호작용 (v0.5 필수)**

| 동작 | 동작 결과 |
|---|---|
| 행 클릭 | 해당 요소 Inspect 선택 + Preview outline + (가능 시) Code 스크롤/하이라이트 |
| Preview에서 클릭 | Layers 트리 expand + scroll-into-view + 행 하이라이트 (**양방향 동기화**) |
| Expand / collapse | 트리 접기; 상태 세션 로컬 유지 |
| 검색 / 필터 | 이름·tag·class 부분 일치 |
| Hover | Preview dim/highlight 대응 요소 |
| 컨텍스트 메뉴 (최소) | Copy selector · Edit with AI · Add comment · Scroll to code |
| Visibility 토글 | `hidden` attr 또는 `data-neos-hidden` / class 토글 → dirty Code 버퍼 (사용자 저장) |
| Lock 토글 | 에디터 UI만 (파일에 `data-neos-locked` optional persist) |

**상호작용 (v0.5 권장 / stretch)**

| 동작 | 노트 |
|---|---|
| 드래그 Reorder siblings | DOM 순서 변경 → HTML rewrite patch; **레이아웃 드래그 리사이즈 아님** (Q12 준수) |
| Rename display label | `data-neos-name` 또는 주석; DOM id 강제 변경 아님 |
| Multi-select | Shift/Cmd 다중 선택 후 일괄 Edit with AI |

**동기화 규칙**

- 단일 `SelectionState` 스토어: `{ filePath, selector, layerId, sourceRange? }`
- Layers · Preview Inspect · Code 하이라이트가 동일 selection을 구독
- Agent/file reload 시 tree rebuild; 가능하면 이전 selector로 re-select

**Q12와의 경계**

| 허용 (Layers) | 금지 (Q12) |
|---|---|
| 계층 트리 UI, 선택 동기화 | 캔버스 위 자유 이동/리사이즈 핸들 |
| sibling reorder (DOM order) | Auto-layout / constraints 엔진 |
| visibility/lock | 벡터 펜·프레임 드로잉 |

#### LLM 생성 경로

1. 사용자가 Chat에 브리프 입력 (skill / design system / memory 자동 부착).
2. `POST /api/runs` — provider = BYOK LLM **또는** coding-agent CLI.
3. 에이전트가 프로젝트 cwd에 파일 write (tool 또는 CLI).
4. 서버가 `file.changed` SSE → Editor가 디스크 기준으로 reload (dirty면 충돌 UI).
5. 사용자는 즉시 Code/Preview에서 수동 수정 후 저장.

#### 수동 편집 경로

1. Code 모드에서 직접 편집 → **Save** (`PUT /api/projects/:id/files/...`) 또는 autosave debounce.
2. 저장 시 `file_revisions`에 `source=user` 스냅샷 (상한 N, 기본 50/파일 또는 용량 캡).
3. Preview hot-reload; scroll position bridge로 스크롤 복원.
4. 미저장 종료 시 `beforeunload` / Tauri close 가드.

#### Edit with AI (선택 영역 재생성)

요청 body 개념:

```ts
{
  projectId: string
  prompt: string
  editContext: {
    filePath: string
    selection?: { startLine: number; endLine: number } | { selector: string }
    snippet?: string          // 선택 outerHTML 또는 코드 슬라이스
    mode: 'patch' | 'replace-file' | 'replace-selection'
  }
}
```

- 기본 `mode: 'patch' | 'replace-selection'` — 사용자 수동 편집 보존 우선.
- `replace-file`은 확인 다이얼로그만.
- 시스템 프롬프트에 “현재 파일 전문 + DESIGN.md + 선택 snippet + 사용자 지시” 조립.

#### 충돌 정책

| 상황 | 동작 |
|---|---|
| 사용자 dirty + agent write | toast: Keep mine / Take agent / Diff merge (3-way simple: base revision + both) |
| 동시 탭 | last-write-wins + revision 복구 |
| run 중 수동 저장 | 허용; 다음 agent tool read는 최신 디스크 |

#### 패키지

- `packages/design-editor`: iframe bridge, Inspect overlay, **Layers tree**, selection store, dirty state machine, diff viewer
- 하위 모듈 예: `layers/tree-model.ts`, `layers/LayersPanel.tsx`, `bridge/dom-snapshot.ts`
- 의존: 기존 project files API, runs SSE, CodeMirror 6 (Q9)

#### 비범위 (Editor)

- 자유 캔버스 드로잉, Figma Auto-layout 엔진, 컴포넌트 마켓 드래그앤드롭 빌더, multiplayer cursors
- (Layers **포함**: tree panel + selection sync + optional sibling reorder)

### 3.2 Agent Runtime (Part B)

`packages/agent-runtime`:

```text
registry.ts
detection.ts
launch.ts
parsers/{text,jsonl,acp}.ts
cancel.ts
defs/*.ts
```

Workflow `AgentNode` CLI provider와 Project chat run이 **동일 registry**를 사용.

Run SSE events (최소):

```ts
run.started | run.stdout | run.stderr | run.tool | run.progress
run.succeeded | run.failed | run.canceled
```

### 3.3 Skills / Plugins (Part C)

**Skill discovery precedence**:

1. project-private (`.neos-work/skills` or project `skills/`)
2. user (`~/.config/neos-work/skills`)
3. bundled (`<repo>/skills` or packaged resources)

**Plugin atom 우선 구현 세트** (≥ 12):

| atom | 용도 |
|---|---|
| discovery.form | GenUI form |
| direction.choice | GenUI choice |
| todo.write | 계획 체크리스트 |
| file.read / file.write | 프로젝트 FS |
| research.search | 웹/검색 툴 브리지 |
| media.image | 이미지 생성 |
| live_artifact.upsert | live artifact |
| critique.theater | critique stage |
| code.import | 코드 컨텍스트 |
| design.extract | DESIGN.md 추출 |
| rewrite.plan | 리라이트 계획 |
| patch.edit | 패치 적용 (Editor selection과 연동) |
| editor.apply_patch | Design Editor 범위 지정 패치 atom |
| handoff.export | handoff 패키지 |
| deploy.preflight | 배포 전 검사 |

Plugin run은 **기본 coding-agent spawn** (설정된 CLI); BYOK LLM stage는 fallback.

Snapshot: `appliedPluginSnapshotId` on run → prompt fragments + tool gates 고정.

### 3.4 Media & Live Artifact (Part D)

통합 contract:

```bash
neos media generate --surface image|video|audio --model … --output <project-rel> --prompt …
```

Live artifact:

- source template + inputs 분리
- `POST …/refresh`
- tool routes derive projectId from token only

### 3.5 `neos` CLI (Part E)

```text
neos                  # start daemon + open UI (desktop or web URL)
neos daemon start|stop|status
neos project list|create|import|export
neos files ls|read|write
neos files revise …          # optional: list/restore file revisions
neos run create|status|events|cancel   # --edit-context for selection refine
neos plugin list|apply|run
neos media generate
neos memory list|add
neos mcp …
neos doctor
```

Recoverable exit codes 문서화 (daemon down, project missing, capability denied, GenUI waiting, …).

### 3.6 Web & Docker (Part F)

- `apps/web`: Vite, 기존 desktop pages를 `packages/ui-app`으로 추출 후 재사용
- Auth: bearer token (QR/copy from server log or settings); remote deploy 시 reverse proxy 권장 문서
- `deploy/Dockerfile` + `docker-compose.yml` + volume + `NEOS_API_TOKEN`

### 3.7 Security (Part G)

체크리스트 (구현 필수):

- [ ] project-relative path + realpath containment
- [ ] symlink out-of-root deny (archive & read)
- [ ] SSRF resolver on BYOK base URL & asset URL
- [ ] tool-token cannot override projectId/runId
- [ ] desktop import token nonce single-use
- [ ] secret masking in API responses
- [ ] media size/MIME/duration clamps

---

## 4. 릴리스 트레인 (v0.5.0 내부 마일스톤)

한 메이저 계획 안에서 구현 순서를 고정한다. 중간 패치 버전(v0.5.0-alpha 태그 또는 문서상 M1–M5)으로 관리 가능.

| Milestone | 테마 | 주요 산출물 | 예상 의존 |
|---|---|---|---|
| **M1** | Foundation | `projects` model, path sandbox, file API, revisions, shared contracts | 없음 |
| **M2** | Runtime + Runs + **Editor shell** | `agent-runtime`, multi-CLI, `/api/runs`, project chat SSE, **Design Editor Preview/Code + save/reload** | M1 |
| **M3** | Protocols + **Inspect / Layers / Edit with AI** | Skills/plugins, GenUI, **Inspect bridge, Figma-like Layers tree, selection refine runs, preview comments**, dirty conflict UI | M2 |
| **M4** | Media + Live + Deploy polish | multi-provider media, live-artifact tool API, deploy check-link | M1–M2 |
| **M5** | CLI + Web + Docker + Security | `neos` CLI, `apps/web`(Editor 포함), deploy/, SSRF, e2e, docs, 0.5.0 bump | M1–M4 |

**권장 완료 순서**: M1 → M2 (Editor MVP) → M3 (Editor full + protocols) → M4 ∥ (M5 CLI early stub) → M5 full.

Domain Pack SDK (Part H)는 M3 이후 병렬 가능.

**Design Editor 완료 슬라이스**:

| Slice | 내용 | Milestone |
|---|---|---|
| E0 | Files API + revision + chat write → disk | M1 |
| E1 | Preview iframe + Code editor + save/hot-reload | M2 |
| E2 | Split mode, dirty guard, agent write conflict | M2–M3 |
| E3 | Inspect selection + **Layers tree (read + select sync)** + Edit with AI + comments | M3 |
| E4 | Layers visibility/lock/(optional) sibling reorder, Diff/restore revision, DESIGN.md side panel | M3 |

---

## 5. Task 분해 (구현 체크리스트)

### Task 0 — 계획 고정 및 계약 스케치

- [ ] OD 스펙 섹션 ↔ NEOS 모듈 매핑 표 확정 (본 문서 §8)
- [ ] `packages/shared`에 Project / Run / LiveArtifact / PluginSnapshot / **EditContext** / **FileRevision** / **PreviewComment** 타입 초안
- [ ] Design Editor UX wireframe (Preview/Code/Inspect/Chat) 합의
- [ ] API route 목록 ADR 짧은 메모 (`docs/plans/adr/v0.5-api-map.md` optional)
- [ ] fixture 디렉터리 `e2e/fixtures/od-samples/` + sample `index.html` for editor tests

### Task 1 — Design Project + FS (M1)

- [ ] DB migration: `projects`, `conversations`, `messages`, tabs, **`file_revisions`**, **`preview_comments`** (필요 시)
- [ ] `lib/path-sandbox.ts` — realpath, root deny, data-dir deny
- [ ] `lib/project-files.ts` — list/read/write/mkdir/archive + **revision on write**
- [ ] `routes/projects.ts` — CRUD, files, working-dir, **revisions list/restore**
- [ ] `routes/import-export.ts` — folder import, zip export, claude-design
- [ ] Desktop: Projects pages + workspace shell (files tree + **editor host slot**)
- [ ] Tauri folder picker + import token endpoint
- [ ] Tests: path traversal, symlink, archive, revision cap

### Task 1b — Design Editor MVP (M2, E1–E2) ★

- [ ] 패키지 `@neos-work/design-editor` scaffold (iframe preview, code pane, bridge types)
- [ ] Code editor 통합 (CodeMirror 6 권장 — 번들 무게; Monaco optional flag)
- [ ] `Preview` 모드: sandbox iframe, entry file 로드, device width presets
- [ ] `Code` 모드: open file, dirty state, Save / autosave debounce → `PUT files`
- [ ] `Split` 모드: 저장 후 preview reload + scroll restore bridge
- [ ] `file.changed` SSE 구독 — agent write 시 reload 또는 conflict banner
- [ ] Dirty close guard (web beforeunload + desktop)
- [ ] Chat 패널 연동: generate run 완료 → 변경 파일 탭 자동 오픈
- [ ] i18n 키 (en/ko): editor chrome
- [ ] Tests: dirty state machine, save/reload, conflict Keep/Take/Diff (unit)
- [ ] Component tests: Preview+Code smoke with mock file API

### Task 1c — Design Editor Inspect + Layers tree + Edit with AI (M3, E3–E4) ★

- [ ] Inspect overlay script inject (sandbox-safe postMessage protocol)
- [ ] 요소 선택 → selector, tag, outerHTML snippet, bounding box UI
- [ ] 속성 패널 (read-only MVP; class/text 간단 편집 optional)
- [ ] **Layers tree panel (Figma-like)**
  - [ ] DOM snapshot bridge → `LayerNode[]` 트리 빌드
  - [ ] expand/collapse, display name (tag + id/class/text trunc)
  - [ ] 행 클릭 ↔ Preview Inspect **양방향 선택 동기화**
  - [ ] 트리 scroll-into-view / hover highlight
  - [ ] 검색·필터 (tag/name/class)
  - [ ] visibility 토글 → Code dirty 버퍼 반영 후 저장 경로
  - [ ] lock 토글 (UI; optional `data-neos-locked` persist)
  - [ ] 컨텍스트 메뉴: Copy selector · Edit with AI · Add comment · Reveal in code
  - [ ] (stretch) sibling reorder via drag → DOM order patch (not canvas resize)
- [ ] 통합 `SelectionState` 스토어 (Layers + Inspect + Code highlight)
- [ ] **Edit with AI**: selection / layer row → `editContext` 포함 `POST /api/runs`
- [ ] 기본 mode `replace-selection` / `patch`; full-file regenerate confirm
- [ ] Preview comments: create/list/delete + inject into next run system context
- [ ] Revision timeline UI: list + restore file version
- [ ] DESIGN.md / tokens side panel (read-only context strip)
- [ ] atom `editor.apply_patch` 연동 (plugin pipeline)
- [ ] E2E smoke: generate mock HTML → **Layers select** → manual edit save → selection AI run mock
- [ ] Tests: editContext validation, comment injection, inspect message schema, **layer tree build + selection sync**

### Task 2 — Agent Runtime Registry (M2)

- [ ] 패키지 `@neos-work/agent-runtime` scaffold
- [ ] def 스키마 + 최소 12 CLI def
- [ ] detect + version probe + path overrides (settings)
- [ ] launch policies (argv vs stdin, Windows budget)
- [ ] parsers + cancel
- [ ] `routes/cli-agents.ts` 확장 (list detailed, test connection)
- [ ] Workflow AgentNode가 registry 사용하도록 리팩터 (3 CLI → N)
- [ ] Tests: mock spawn, detection overrides

### Task 3 — Run System (M2)

- [ ] in-memory run registry + optional events.jsonl
- [ ] `POST /api/runs`, `GET …/events`, `POST …/cancel`, tool-result
- [ ] Project chat UI → runs
- [ ] **`editContext` 지원**: selection/snippet/mode를 prompt assembler에 주입
- [ ] run 완료 시 변경 파일 목록 이벤트 (`run.files_changed`)
- [ ] SSE reconnect (`Last-Event-ID` / `after`)
- [ ] Workflow run 이벤트와 스키마 정렬 (adapter)
- [ ] Tests: cancel, buffer TTL, terminal replay, editContext assembly

### Task 4 — Skill Protocol Full (M3)

- [ ] `packages/core` skill parser → package root `SKILL.md`
- [ ] discovery precedence + shadowing
- [ ] example card derivation
- [ ] bundled `skills/` 샘플 ≥ 5
- [ ] Skills UI: package view, enable, open folder
- [ ] Tests: OD-compatible frontmatter fixtures

### Task 5 — Design System Full (M3)

- [ ] manifest schema `od-design-system-project/v1` 호환 로더
- [ ] provenance fields, tokens/components preview
- [ ] Project + Agent 주입 경로 통일
- [ ] bundled design-systems ≥ 2
- [ ] Tests: manifest fallback chain

### Task 6 — Plugin Runtime Full (M3)

- [ ] `packages/plugin-runtime` (store/apply/snapshot/trust)
- [ ] atom registry + 우선 atom 12+
- [ ] run: prefer CLI agent spawn over bare HTTP stage
- [ ] snapshot pin on run
- [ ] local marketplace: list/search/install from `plugins/` + user dir
- [ ] UI: marketplace page, pipeline runner, trust prompts
- [ ] GenUI + `neos ui` subcommands
- [ ] Tests: snapshot stable, HITL resume, capability deny

### Task 7 — Memory Full (M3)

- [ ] MEMORY index + type model 정렬 (user/feedback/project/reference + neos session/skill 호환)
- [ ] extraction config + optional LLM extract
- [ ] SSE memory events
- [ ] prompt injection for project chat + agent nodes
- [ ] Tests: slug, CJK fallback, enable filter

### Task 8 — Media Multi-Provider (M4)

- [ ] provider interface + catalog API
- [ ] OpenAI image/audio (기존), Azure-compatible, Google image, xAI image/video, custom base URL
- [ ] video surface + async poll state machine
- [ ] stub policy default off
- [ ] project-relative output only
- [ ] Settings UI multi-provider
- [ ] workflow MediaNode provider 선택 확장
- [ ] Tests: guards, mock providers

### Task 9 — Live Artifact Full (M4)

- [ ] DB + file sidecar model
- [ ] UI CRUD/preview/refresh
- [ ] `/api/tools/live-artifacts/*` tool-token
- [ ] projectId override → 403
- [ ] Tests: token scope, refresh

### Task 10 — Deploy Polish (M4)

- [ ] check-link, richer preflight
- [ ] project-scoped deployments (workflow-scoped 유지)
- [ ] secret mask audit
- [ ] Tests: provider mock

### Task 11 — `neos` CLI (M5)

- [ ] `apps/cli` package, bin `neos`
- [ ] daemon start/discover port/token
- [ ] wrap critical HTTP APIs (incl. **files write**, **run with editContext**)
- [ ] recoverable exit codes
- [ ] agent env injection helpers
- [ ] Tests: CLI unit + integration against test server

### Task 12 — Web Client + Static Serve (M5)

- [ ] extract `packages/ui-app` from desktop pages/hooks
- [ ] Design Editor를 `ui-app` / `design-editor` 경유로 web·desktop 공유
- [ ] `apps/web` Vite app
- [ ] server option to serve `web/dist`
- [ ] CORS / token UX for browser
- [ ] Smoke: core pages + **editor open/save** against server

### Task 13 — Docker + tools-dev (M5)

- [ ] `deploy/Dockerfile`, `docker-compose.yml`, `.env.example`
- [ ] volume + token + port docs
- [ ] `tools/dev` — start/stop/status/logs
- [ ] README self-host section

### Task 14 — Security Hardening (M5, 병행 가능)

- [ ] SSRF module shared
- [ ] connection test route
- [ ] desktop import gate e2e
- [ ] archive symlink tests
- [ ] threat model short doc `docs/security/v0.5.md`

### Task 15 — Domain Pack SDK (Part H)

- [ ] pack manifest schema
- [ ] load from dir/ZIP
- [ ] register workers/blocks
- [ ] UI install + enable
- [ ] Tests: invalid pack reject

### Task 16 — MCP Server Expose (보강)

- [ ] NEOS를 MCP server로 노출 (project files, live artifact tools)
- [ ] install-info snippet API
- [ ] optional Codex `mcp add` helper (OD §14.4 등가)

### Task 17 — Docs · Inventory · Release

- [ ] `docs/migration/v0.5.0.md`
- [ ] README / README.ko 이중 표면 설명
- [ ] `pnpm inventory` capability dump
- [ ] e2e smoke suite
- [ ] version bump 0.5.0 + implementation note `docs/implementation/v0.5/v0.5.0.md`

---

## 6. 파일/패키지 변경 예상 지도

| 영역 | 신규 | 주요 수정 |
|---|---|---|
| apps/server | projects, runs, import-export, tools/*, connection-test, **revisions, preview-comments** | index route mount, db schema, media, plugins, mcp, **prompt assembler + editContext** |
| apps/desktop | Projects workspace, **Design Editor shell**, Marketplace, import gate | App routes, Sidebar, Settings |
| apps/web | 전체 신규 (Editor 포함) | — |
| apps/cli | 전체 신규 | — |
| packages/agent-runtime | 전체 신규 | — |
| packages/plugin-runtime | 전체 신규 | server plugin-store/runner 이전 |
| packages/design-editor | **전체 신규** (Preview/Code/Inspect/**Layers tree**) | — |
| packages/ui-app | 전체 신규 | desktop 추출 + editor 라우트 |
| packages/core | skill package discovery | orchestrator 연동 유지 |
| packages/workflow-engine | CLI registry 연동 | agent node |
| packages/shared | Project/Run/Plugin/**EditContext** 계약 | types export |
| skills/, design-systems/, plugins/, templates/ | 카탈로그 | — |
| deploy/, tools/dev/, e2e/ | 운영·품질 | editor e2e fixtures |

---

## 7. 호환성 · 마이그레이션

### 7.1 Breaking?

| 항목 | 정책 |
|---|---|
| workflow schemaVersion 2 | **유지** (v0.4) |
| 기존 `/api/workflow`, workers, domain-packs | **유지** |
| skill flat `.md` | **호환 유지** + package `SKILL.md` 선호 |
| memory types | 확장; 기존 row/file 마이그레이션 스크립트 |
| settings keys | 기존 유지; media/CLI 키 추가 |
| DB | additive migrations only (drop 금지) |

### 7.2 사용자 데이터

- 기존 `~/.config/neos-work` 그대로 사용
- 최초 v0.5 부팅 시: skill 인덱스 재스캔, design-system 재스캔
- workflow → design project 자동 변환 **없음** (수동 export/import 가이드)

### 7.3 API deprecations

- 없음 강제; 문서에 “Design Project vs Workflow 언제 쓰나” 가이드

---

## 8. OD 스펙 섹션 매핑 (구현 추적표)

| OD § | 제목 | v0.5 Task | 완료 기준 |
|---|---|---|---|
| 1 | 제품 정의 | 전체 | dual surface + **generate↔edit loop** 문서화 |
| 2 | 모노레포 | Task 12–13, monorepo map | apps/web,cli,tools,deploy, **design-editor** 존재 |
| 3 | 런타임 아키텍처 | Task 12–13 | web↔server, docker |
| 4 | 핵심 앱 | Task 1, **1b, 1c**, 12 | project UI + **Design Editor** + daemon |
| 4* | Preview / Editor UX | Task 1b–1c | Preview/Code/Inspect/**Layers tree**, iframe pool, comments |
| 5 | Agent Runtime | Task 2 | ≥12 defs, spawn/cancel |
| 6 | Run/Chat/SSE | Task 3 | runs API + SSE + **editContext** |
| 7 | Project/Artifact FS | Task 1 | files+archive+sandbox+**revisions** |
| 8 | SQLite | Task 1,3,9 | projects/runs/live tables |
| 9 | Skill | Task 4 | package protocol |
| 10 | Design System | Task 5 | manifest+inject |
| 11 | Plugin/Marketplace | Task 6 | atoms+snapshot+local market |
| 12 | GenUI | Task 6,11 | UI+CLI respond |
| 13 | Media | Task 8 | multi-provider+video |
| 14 | MCP | Task 16 + existing OAuth | client+server expose |
| 15 | Routine | 기존 + project target 옵션 | schedule+crystallize |
| 16 | Memory | Task 7 | index+SSE+extract |
| 17 | Live Artifact | Task 9 | tool-token+refresh |
| 18 | Import/Export | Task 1 | folder+zip+claude |
| 19 | Deploy | Task 10 | preflight+check-link |
| 20 | CLI | Task 11 | `neos` parity subset |
| 21 | BYOK | Task 2–3 | proxy+connection test |
| 22 | Security | Task 14 | SSRF+sandbox+token |
| 23 | Docker | Task 13 | compose up smoke |
| 24 | Privacy/telemetry | Task 14 | opt-in only |

---

## 9. 테스트 전략

| 층 | 내용 |
|---|---|
| Unit | path-sandbox, skill parser, plugin snapshot, SSRF, media guards, CLI args, **editor dirty/conflict, editContext, layer tree model** |
| Integration | Hono routes with temp data dir + mock spawn + **file write/revision** |
| Contract | OD fixture skills/design-systems/plugins load |
| E2E smoke | server boot → project create → **LLM/mock generate → Layers select → manual edit save → preview** → optional selection refine |
| Component | Design Editor Preview/Code/Inspect/**Layers** with mock APIs |
| Regression | v0.4 workflow migrate/execute, workers, domain-packs |
| Manual | real Claude CLI optional, Docker compose, **keyboard editing UX** |

CI 기본: unit + integration + contract. Live provider/CLI는 `NEOS_LIVE_SMOKE=1` opt-in.

---

## 10. 리스크와 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| 범위 과다로 v0.5 미완료 | 일정 | M1–M5 게이트; M5 전에 M1–M4 merge 필수; Editor는 E0→E4 슬라이스 |
| Design Editor 범위 팽창 (Figma **캔버스**화) | 일정·품질 | Q12 유지; **Layers tree는 허용**, free-canvas/auto-layout 금지 |
| Layers ↔ DOM 불일치 | UX 혼란 | preview snapshot 우선; dirty 시 parse fallback 표시 배지 |
| 대형 DOM 트리 성능 | UI 버벅임 | virtualized tree list, depth/node cap, collapse default |
| Agent write vs 수동 편집 충돌 | 데이터 손실 | dirty 감지, revision, Keep/Take/Diff; 기본 patch mode |
| iframe Inspect / Layers bridge 보안 | XSS/escape | sandbox flags, postMessage origin check, no privileged parent APIs |
| Code editor 번들 비대 | 성능 | CodeMirror 6 기본; Monaco lazy optional |
| desktop/web 추출 비용 | UI 회귀 | `ui-app` + `design-editor` 점진 추출, desktop 먼저 유지 |
| 다수 CLI adapter 유지비 | 품질 | def 스키마 통일, smoke matrix, 미설치 skip |
| Plugin trust 남용 | 보안 | capability deny default, snapshot pin, no auto-network atoms |
| 이중 표면 UX 혼란 | 사용성 | Sidebar: **Work** vs **Design**; Project 열면 Editor가 기본 랜딩 |
| OD API 1:1 집착 | 낭비 | 의미 동등 + 매핑 표; 경로 복제 강제 안 함 |
| Windows spawn/budget | 버그 | launch policy + CI windows optional later |

---

## 11. 성공 메트릭 (릴리스 리뷰)

- [ ] Acceptance Gates 1–11 전부 체크 (포함: **Design Editor gate**)
- [ ] `pnpm test` / `typecheck` / `lint` 통과
- [ ] `neos doctor` clean on fresh install
- [ ] Docker compose 5분 내 UI reachable
- [ ] OD sample skill + design-system + plugin fixture 로드
- [ ] **수동 편집 시나리오**: generate → edit CSS color in Code → save → Preview reflects; agent refine selection does not wipe unrelated manual edits (patch mode)
- [ ] **Layers 시나리오**: open HTML → Layers shows hierarchy → click layer selects Preview outline → Preview click highlights Layers row → visibility toggle dirties Code
- [ ] 기존 v0.4 workflow 골든 테스트 통과
- [ ] README에 Design Project + **Editor loop** 퀵스타트 15줄 이내

---

## 12. 구현 우선순위 한눈에

```text
P0 (차단)  M1 Project FS + revisions → M2 Runtime+Runs + Editor Preview/Code
P1 (제품)  M3 Inspect/**Layers**/Edit-with-AI + Skills/Plugins/Memory → M4 Media/LiveArtifact
P2 (진입)  M5 CLI + Web + Docker + Security closeout
P3 (확장)  Pack SDK, MCP server expose, inventory
```

---

## 13. v0.5 이후 백로그 (비범위)

- Hosted marketplace service
- Postgres multi-replica
- Helm chart / Nix
- Full Figma atom suite
- **Figma급 비주얼 WYSIWYG / 자유 캔버스 / Auto-layout 엔진** (Layers tree는 v0.5에 **포함**)
- **Realtime multiplayer design editing**
- Electron packaged parity
- Langfuse/PostHog deep analytics
- Mobile Tauri targets
- JSX/TSX full visual Inspect + Layers source-AST parity

---

## 14. 결정 잠금

> **상태**:  
> - **Q9–Q12**: 2026-07-27 사용자 확인으로 **LOCKED**.  
> - **Q13** (Layers tree): 2026-07-27 사용자 요청으로 계획에 **포함·권장 잠금** — 구현 시 기본 가정. 별도 번복 없으면 LOCKED와 동일하게 취급.  
> Q1–Q8은 계획 작성 시 권장값(아직 별도 확인 없음). 변경 시 본 절과 영향 Task만 갱신한다.

| ID | 질문 | 결정 | 상태 |
|---|---|---|---|
| Q1 | Electron으로 desktop 재작성? | **No** — Tauri 유지 | recommended |
| Q2 | API 경로를 OD와 바이트 동일하게? | **No** — 의미 동등 + 매핑 | recommended |
| Q3 | Workflow를 Project 하위로 종속? | **No** — 병존 1급 | recommended |
| Q4 | CLI 이름 | **`neos`** (`od` alias optional later) | recommended |
| Q5 | 최소 CLI adapter 수 | **12** detect defs (모두 설치 강제 아님) | recommended |
| Q6 | Marketplace | **Local only** in v0.5 | recommended |
| Q7 | Web 프레임워크 | **Vite+React** (Next 아님) | recommended |
| Q8 | Bundled catalogs in npm package? | **Yes** — repo folders, desktop resource copy | recommended |
| **Q9** | Design Editor 코드 엔진 | **CodeMirror 6** 기본 (Monaco는 선택적 lazy 로드만; 기본 경로 아님) | **LOCKED** |
| **Q10** | LLM 재생성 기본 모드 | **`replace-selection` / `patch`** 기본. full-file `replace-file`은 **명시 확인 UI 후에만** | **LOCKED** |
| **Q11** | 생성 엔진 기본값 | **BYOK LLM + 도구 write** 가 기본 생성 경로. 사용자가 설정한 경우 **CLI agent** spawn 사용 | **LOCKED** |
| **Q12** | 시각적 드래그 리사이즈 레이아웃 / free-canvas | **No in v0.5** — 캔버스 WYSIWYG 없음. Inspect + Code + AI + **Layers tree(Q13)** | **LOCKED** |
| **Q13** | Figma-like Layers tree panel | **Yes in v0.5** — DOM/문서 계층 트리 패널 필수. Files 트리와 분리. 선택 양방향 동기화 필수. visibility/lock 필수. sibling reorder는 stretch | **LOCKED** (요청 반영) |

### 14.1 Q9–Q13 잠금 함의 (구현 제약)

| 잠금 | 구현·테스트에 강제되는 것 | 하지 말 것 |
|---|---|---|
| **Q9 CodeMirror 6** | `@neos-work/design-editor` Code 모드는 CodeMirror 6; syntax highlighting, dirty state, undo 로컬 버퍼 | Monaco를 기본 번들에 넣거나 필수 peer로 두지 않음 |
| **Q10 patch-first** | `editContext.mode` 기본값 `replace-selection` 또는 `patch`; full-file 시 confirm; 수동 편집 보존 시나리오 e2e | 선택 영역 AI 호출이 기본으로 전체 파일 덮어쓰기 |
| **Q11 BYOK 기본** | Project chat / Design Editor “Generate” 기본 provider = settings LLM keys + file tools; CLI는 Settings/노드에서 opt-in | CLI 미설치 시 생성 자체가 불가능하게 만들기 |
| **Q12 no free-canvas** | 캔버스 핸들·벡터 드로잉·auto-layout 솔버 없음 | “Figma 복제”를 이유로 Q12를 열어 free-canvas 넣기 |
| **Q13 Layers tree** | 좌측 **Layers** 패널; DOM snapshot 트리; Preview/Inspect와 선택 동기화; 검색; visibility/lock; virtualized list for large trees | Layers를 Files 트리에 섞기; Layers 없이 Inspect-only로 Design Editor gate 통과 처리 |

**Q12 vs Q13**: Q13의 Layers는 Figma **패널 UX** 차용이지 Figma **캔버스 엔진**이 아니다. sibling DOM reorder(stretch)는 허용, 화면상 드래그 리사이즈는 금지.

잠금 해제·변경이 필요하면 이 절을 먼저 개정한 뒤 Task 1b/1c/3 체크리스트를 맞춘다.

---

## 15. 참고

- [`docs/reference/open-design-repository-spec-ko.md`](../reference/open-design-repository-spec-ko.md)
- [`docs/plans/PLAN_FOR_V0_3_0.md`](./PLAN_FOR_V0_3_0.md) — MVP 이식 및 비목표
- [`docs/plans/PLAN_FOR_V0_4_0.md`](./PLAN_FOR_V0_4_0.md) — Domain Workers
- Upstream: [nexu-io/open-design](https://github.com/nexu-io/open-design)

---

## 16. 결론

v0.5.0은 NEOS Work를 “OD 기능을 일부 닮은 Cowork 앱”에서 **Open Design substrate를 완전히 갖춘 local-first 에이전트 플랫폼**(Workflow + Design Project + **Design Editor**)으로 올리는 버전이다.

차별화의 중심은 다음 루프이다.

1. **LLM / coding agent로 디자인 파일 생성**  
2. **Design Editor에서 사용자가 직접 수정** (Code + Preview + Inspect + **Figma-like Layers tree**)  
3. **Layers/Inspect 선택·코멘트 기반 AI 재생성**으로 수동 편집을 지우지 않고 개선  
4. Deploy / export / live artifact로 산출

완료의 정의는 코드 복제가 아니라 **Acceptance Gates**(프로토콜·프로젝트·**에디터(Layers 포함)**·런타임·플러그인·미디어·라이브 아티팩트·CLI·토폴로지·보안·회귀)이다. M1→M5와 Editor 슬라이스 E0–E4를 지키면 v0.4 자산 위에서 통제 가능하게 도달할 수 있다.
