# NEOS Work

Claude Cowork의 오픈소스 대안 — **로컬 우선 에이전트 플랫폼**. 두 가지 1급 표면:

| 표면 | 설명 |
|---|---|
| **Workflow** | 자동화 그래프, 도메인 워커, 팩, 게이트 |
| **Design Project** | 파일 작업공간 + **Design Editor** (생성 → 수동 편집 → 재프롬프트) |

**한국어** | **[English](README.md)**

---

## 빠른 시작 — Design Editor 루프 (v0.5)

```bash
pnpm install
pnpm --filter @neos-work/server dev   # NEOS_PORT + NEOS_AUTH_TOKEN 확인
# Desktop: cd apps/desktop && pnpm tauri dev
# 또는 Web: pnpm --filter @neos-work/web dev  → 토큰 붙여넣기
# Design Project 생성 → Editor (Preview / Code / Layers)
# 채팅 브리프 → 에이전트가 HTML 기록 → Code에서 수정 → 저장 → Preview 반영
# Layers에서 선택 → Edit with AI (기본 patch / replace-selection)
```

CLI: `pnpm neos -- doctor` · `neos project list` · `neos mcp serve`

**마이그레이션 (v0.4 → v0.5):** [docs/migration/v0.5.0.md](docs/migration/v0.5.0.md)  
**보안:** [docs/security/v0.5.md](docs/security/v0.5.md)  
**능력 목록:** `pnpm inventory` / `pnpm inventory:check` · 스모크: `pnpm e2e:smoke` · contract: `pnpm e2e:contract` · journey: `pnpm e2e:journey` · browser: `pnpm e2e:browser` · 라이브(옵트인): `NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke`  
**v0.5 클로즈아웃 계획:** [docs/plans/PLAN_FOR_V0_5_29.md](docs/plans/PLAN_FOR_V0_5_29.md)  
**v0.6 마이그레이션:** [docs/migration/v0.6.0.md](docs/migration/v0.6.0.md) · **v0.7 계획:** [docs/plans/PLAN_FOR_V0_7_0.md](docs/plans/PLAN_FOR_V0_7_0.md)  
**v0.7 마이그레이션:** [docs/migration/v0.7.0.md](docs/migration/v0.7.0.md) · **v0.8 계획:** [docs/plans/PLAN_FOR_V0_8_0.md](docs/plans/PLAN_FOR_V0_8_0.md)  
**v0.8 마이그레이션:** [docs/migration/v0.8.0.md](docs/migration/v0.8.0.md) · **Helm:** [deploy/helm/neos-work](deploy/helm/neos-work)  
**v0.9 계획:** [docs/plans/PLAN_FOR_V0_9_0.md](docs/plans/PLAN_FOR_V0_9_0.md) · **v0.9 마이그레이션:** [docs/migration/v0.9.0.md](docs/migration/v0.9.0.md) · **듀얼 서피스:** [docs/reference/dual-surface.md](docs/reference/dual-surface.md)  
**v0.10 계획:** [docs/plans/PLAN_FOR_V0_10_0.md](docs/plans/PLAN_FOR_V0_10_0.md) · **마이그레이션:** [docs/migration/v0.10.0.md](docs/migration/v0.10.0.md) · **릴리스:** [docs/releases/v0.10.3.md](docs/releases/v0.10.3.md) · inventory `v10Features`  
**v0.11 계획:** [docs/plans/PLAN_FOR_V0_11_0.md](docs/plans/PLAN_FOR_V0_11_0.md) · **마이그레이션:** [docs/migration/v0.11.0.md](docs/migration/v0.11.0.md) · **릴리스:** [docs/releases/v0.11.3.md](docs/releases/v0.11.3.md) · inventory `v11Features`  
**v0.12 계획:** [docs/plans/PLAN_FOR_V0_12_0.md](docs/plans/PLAN_FOR_V0_12_0.md) · **마이그레이션:** [docs/migration/v0.12.0.md](docs/migration/v0.12.0.md) · **릴리스:** [docs/releases/v0.12.3.md](docs/releases/v0.12.3.md) · inventory `v12Features`  
**v0.13 계획:** [docs/plans/PLAN_FOR_V0_13_0.md](docs/plans/PLAN_FOR_V0_13_0.md) · **마이그레이션:** [docs/migration/v0.13.0.md](docs/migration/v0.13.0.md) · **릴리스:** [docs/releases/v0.13.3.md](docs/releases/v0.13.3.md) · inventory `v13Features`  
**v0.14 계획:** [docs/plans/PLAN_FOR_V0_14_0.md](docs/plans/PLAN_FOR_V0_14_0.md) · **마이그레이션:** [docs/migration/v0.14.0.md](docs/migration/v0.14.0.md) · **릴리스:** [docs/releases/v0.14.1.md](docs/releases/v0.14.1.md) · inventory `v14Features`  
**v0.15 계획:** [docs/plans/PLAN_FOR_V0_15_0.md](docs/plans/PLAN_FOR_V0_15_0.md) · **마이그레이션:** [docs/migration/v0.15.0.md](docs/migration/v0.15.0.md) · **릴리스:** [docs/releases/v0.15.0.md](docs/releases/v0.15.0.md) · inventory `v15Features`  

## v0.15 주요 변경

- **0.15.0** **Browser Design Project E2E** — `pnpm e2e:browser` (Playwright Chromium: Connect → 프로젝트 생성 → Code → Save → Preview; Node 22+; PR CI) ([계획](docs/plans/PLAN_FOR_V0_15_0.md) · [마이그레이션](docs/migration/v0.15.0.md) · [릴리스](docs/releases/v0.15.0.md) · [구현](docs/implementation/v0.15/v0.15.0.md) · inventory `v15Features`)

## v0.14 주요 변경

- **0.14.0** **Process API golden path** — `pnpm e2e:journey` (빌드된 서버 HTTP 골든 패스, Node 22+, PR CI) ([계획](docs/plans/PLAN_FOR_V0_14_0.md) · [구현](docs/implementation/v0.14/v0.14.0.md))  
- **0.14.1** Multi-replica live **L7** agent 423 + 트레인 클로즈아웃 — [마이그레이션](docs/migration/v0.14.0.md) · [릴리스](docs/releases/v0.14.1.md) · inventory `v14Features`  

## v0.13 주요 변경

- **0.13.0** **Contract smoke** — agent 423, run→session bind, tools/files write ([계획](docs/plans/PLAN_FOR_V0_13_0.md) · [구현](docs/implementation/v0.13/v0.13.0.md))  
- **0.13.1** Locks snapshot flags + run `collabSessionId` contract ([구현](docs/implementation/v0.13/v0.13.1.md))  
- **0.13.2** **CI hygiene** — contract case map + shared Zod unit tests ([구현](docs/implementation/v0.13/v0.13.2.md))  
- **0.13.3** 트레인 클로즈아웃 — [마이그레이션](docs/migration/v0.13.0.md) · [릴리스](docs/releases/v0.13.3.md) · inventory `v13Features`  
  

## v0.12 주요 변경

- **0.12.0** Desktop **EngineClient 분리** — `engine-transport` + `engine-project` (Design Project/collab API); `engine.js` import 호환 ([계획](docs/plans/PLAN_FOR_V0_12_0.md) · [구현](docs/implementation/v0.12/v0.12.0.md))  
- **0.12.1** **Workflow 클라이언트 추출** — `engine-workflow` (workflows / webhook / revisions / deployments) ([구현](docs/implementation/v0.12/v0.12.1.md))  
- **0.12.2** **Ops 문서** — [sticky SSE 설계 노트](docs/ops/sticky-sse.md) (미구현) + multi-replica [file SSOT / `NEOS_DATA_DIR`](docs/ops/multi-replica-collab.md#file-content-ssot-neos_data_dir) ([구현](docs/implementation/v0.12/v0.12.2.md))  
- **0.12.3** 트레인 클로즈아웃 — [마이그레이션](docs/migration/v0.12.0.md) · [릴리스](docs/releases/v0.12.3.md) · inventory `v12Features`  


---

## v0.9 주요 변경

- **0.9.0** Layers **형제 순서 재배치** (같은 부모 drag → HTML SSOT)  
- **0.9.1** Canvas **기본 ON** + 정렬 / distribute / z-order + 설정 토글  
- **0.9.2** Web **프리뷰 코멘트** + 프로젝트 zip import/export  
- **0.9.3** 듀얼 서피스 정책 + 공유 wire 파서; 마켓플레이스 **데스크톱 전용** — [매트릭스](docs/reference/dual-surface.md)  
- **0.9.4** 트레인 클로즈아웃 — [마이그레이션](docs/migration/v0.9.0.md) · [릴리스](docs/releases/v0.9.4.md) · inventory `v09Features`

---

## v0.11 주요 변경

- **0.11.0** **Run → collab session bind** — `POST /api/runs`에 optional `sessionId`; 에이전트 PUT은 `runId` / `x-neos-run-id`로 상속 ([계획](docs/plans/PLAN_FOR_V0_11_0.md) · [구현](docs/implementation/v0.11/v0.11.0.md))  
- **0.11.1** **Lock / agent-enforce UX** — collab status에 locks + shared-edit/agents 플래그; 일관된 423 holder 메시지; 프로젝트 배지 + run lock 실패 표시 ([구현](docs/implementation/v0.11/v0.11.1.md))  
- **0.11.2** **Tool-path lock parity** — `POST /api/tools/files/write` (tool token `files`)가 agent PUT과 동일한 423 규칙; CLI/MCP run/session env 전달 ([구현](docs/implementation/v0.11/v0.11.2.md))  
- **0.11.3** 트레인 클로즈아웃 — 기본 **`/workers`** (별칭 `/harnesses`); [마이그레이션](docs/migration/v0.11.0.md) · [릴리스](docs/releases/v0.11.3.md) · inventory `v11Features`  

## v0.10 주요 변경

- **0.10.0** 선택적 **에이전트 lock hard-enforce** — `NEOS_SHARED_EDIT=1` + `NEOS_SHARED_EDIT_AGENTS=1`  
- **0.10.1** 멀티 레플리카 **공유 lock 레지스트리** — `NEOS_COLLAB_LOCKS=auto` (presence와 동일한 Redis 패턴)  
- **0.10.2** **Harness HTTP 제거** — `/api/harness(es)` → **410 Gone**; `/api/workers` 사용  
- **0.10.3** 트레인 클로즈아웃 — [마이그레이션](docs/migration/v0.10.0.md) · [릴리스](docs/releases/v0.10.3.md) · inventory `v10Features`  

---

## v0.5 주요 변경

- **Design Project** + path sandbox, 리비전, 폴더 import
- **Design Editor**: Preview · Code · Layers · Inspect · Edit with AI
- **Agent runtime** (≥12 CLI def), runs/SSE/`editContext`
- Skill 패키지, 플러그인 atom, 미디어 multi-provider, live artifact
- **`neos` CLI**, **web** 클라이언트, **Docker** 셀프호스트
- Domain Pack **커스텀 로더**, NEOS **MCP 서버** (`neos mcp serve`)

v0.4 Domain Workers / schemaVersion **2** 워크플로우는 그대로 유지됩니다.

---

## v0.4.0 주요 변경

v0.4.0은 **도메인 워커(Domain Workers)** 와 워크플로우 **schemaVersion 2** 를
중심으로 에이전트·워크플로우 런타임을 재설계한 **브레이킹 변경** 입니다.

- 통합 노드: `agent` + `workerId` (`agent_finance` / `agent_coding` 대체)
- 내장 **Domain Pack**: finance, coding, research, general
- **코디네이터** 모드 (`spawn_worker` / `await_workers`) — 별도 노드 타입 없음
- API: **`/api/workers`**, **`/api/domain-packs`** (`/api/harness` 는 **0.10.2** 에서 410 Gone)
- Typed ports MVP (기본 경고; `strictPorts=1` 이면 하드 실패)

**마이그레이션:** 기존 워크플로우는 로드 시 자동 변환됩니다. 전체 브레이킹
목록과 체크리스트는 [docs/migration/v0.4.0.md](docs/migration/v0.4.0.md) 를
참고하세요.

---

## 로컬 실행 방법

### 사전 요구사항

- **Node.js** 22 이상
- **pnpm** 10 이상
- **Rust** (Tauri 데스크탑 앱 빌드용) — [rustup](https://rustup.rs) 으로 설치

### 설치

```bash
pnpm install
```

### 개발 서버 실행

#### 서버만 실행 (백엔드 API)

```bash
cd apps/server
pnpm dev
```

서버는 `127.0.0.1`의 랜덤 포트에서 시작됩니다. 시작 시 터미널에 `NEOS_PORT=<포트번호>` 형태로 포트가 출력됩니다.

#### 데스크탑 앱 실행 (Tauri + Vite)

```bash
cd apps/desktop
pnpm tauri dev
```

Vite 개발 서버(`http://localhost:1420`)와 Tauri 앱이 함께 시작됩니다.

#### 전체 워크스페이스 동시 실행 (Turborepo)

루트에서 실행하면 모든 패키지를 빌드 후 개발 서버를 시작합니다:

```bash
pnpm dev
```

### 빌드

```bash
pnpm build
```

## 설정 (API 키 및 환경 변수)

### API 키 설정

NEOS Work는 `.env` 파일을 사용하지 않습니다. API 키 등 민감한 설정값은 **앱 UI의 Settings 페이지**에서 입력하며, `~/.neos-work/data.db` SQLite DB에 AES-256-GCM으로 암호화되어 저장됩니다.

지원하는 주요 설정 키:

| 키 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API 키 |
| `GOOGLE_API_KEY` | Google Gemini API 키 |
| `TAVILY_API_KEY` | Tavily 웹 검색 API 키 |
| `SLACK_BOT_TOKEN` | Slack 봇 토큰 |
| `DISCORD_WEBHOOK_URL` | Discord 웹훅 URL |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | 한국투자증권 API 키 |

API로 직접 설정하려면:

```bash
curl -X PUT http://127.0.0.1:<PORT>/api/settings/ANTHROPIC_API_KEY \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d '{"value": "sk-ant-..."}'
```

> `PORT`와 `AUTH_TOKEN`은 서버 시작 시 콘솔에 출력됩니다.

### 서버 환경 변수

셸에서 변수를 직접 내보내거나 인라인으로 전달해 서버 동작을 제어할 수 있습니다:

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 랜덤 | 서버 바인딩 포트 (미설정 시 OS가 자동 할당) |

**예시** (포트를 고정해 서버를 단독 실행):

```bash
cd apps/server
PORT=3000 pnpm dev
```

> 서버는 `.env` 파일을 자동으로 읽지 않습니다. `.env`를 사용하려면 `dotenv-cli` 등으로 변수를 주입하세요:
> ```bash
> npx dotenv-cli -e .env -- pnpm dev
> ```

### 기타 명령어

| 명령어 | 설명 |
|---|---|
| `pnpm lint` | ESLint 검사 |
| `pnpm typecheck` | TypeScript 타입 검사 |
| `pnpm format` | Prettier 포맷팅 |
| `pnpm inventory` | 능력 카탈로그 JSON 덤프 (agents/skills/plugins/…) |
| `pnpm inventory:check` | 게이트 미달 시 실패 |
| `pnpm inventory:write` | `docs/generated/capability-inventory.json` 기록 |
| `pnpm e2e:smoke` | fixture + inventory 계약 스모크 |
| `NEOS_LIVE_SMOKE=1 pnpm e2e:live-smoke` | 옵트인 프로바이더 도달성 스모크 (기본 CI 스킵) |
| `pnpm clean` | 빌드 산출물 및 node_modules 제거 |

## 셀프호스트 (Docker)

단일 프로세스 엔진 + 영구 볼륨 (v0.5.19 / Task 13):

```bash
cp deploy/.env.example deploy/.env
# NEOS_AUTH_TOKEN 설정 (openssl rand -hex 32)
docker compose -f deploy/docker-compose.yml up -d --build
curl -s http://127.0.0.1:3000/api/health
```

자세한 내용은 [deploy/README.md](deploy/README.md)를 참고하세요.

### 로컬 tools/dev

```bash
node tools/dev/dev.mjs start
node tools/dev/dev.mjs status
node tools/dev/dev.mjs stop
```

