# NEOS Work v0.3.0 — Open Design 완전 마이그레이션 구현 계획

> **기준 버전**: v0.2.4 (Memory, 다중 LLM, SKILL.md 확장, UX 개선 완료)
> **작성일**: 2026-05-30
> **목표**: v0.2.4에서 후속으로 미룬 Open Design 기능 전체 — Design Context, Routine, 외부 에이전트 CLI, Live Artifact Preview, Plugin, Media Generation, Deploy, MCP OAuth — 을 이번 버전에서 한꺼번에 이식한다. 동시에 neos-work 고유 기능 공백(병렬 브랜치, 코딩 블록, Webhook, 스트리밍, 자동 레이아웃, 버전 이력)도 해소한다.

---

## 0. 마이그레이션 배경 — v0.2.4에서 미룬 항목 전체

| OD 스펙 섹션 | 기능 | v0.2.4 상태 |
|---|---|---|
| §5 Agent Runtime | 외부 CLI spawn (Claude Code, Gemini CLI, Codex …) | ❌ 미포함 |
| §10 Design System | DESIGN.md 기반 Design Context Layer | ❌ 미포함 |
| §11 Plugin | `open-design.json` sidecar, Atom pipeline | ❌ 미포함 |
| §12 Generative UI | Human-in-the-loop form/choice | ❌ 미포함 |
| §13 Media Generation | Image/Video/Audio 생성 노드 | ❌ 미포함 |
| §14.6 MCP OAuth | OAuth 2.0 인증 흐름 | ❌ 미포함 |
| §15 Automation Routine | cron 기반 반복 실행 | ❌ 미포함 |
| §17 Live Artifact | Artifact iframe preview | ❌ 미포함 |
| §18 Import/Export | 프로젝트 ZIP 내보내기/가져오기 | ❌ 미포함 |
| §19 Deploy | Vercel / Cloudflare Pages 배포 | ❌ 미포함 |

neos-work 자체 공백:

| 항목 | 현재 상태 |
|---|---|
| 병렬 브랜치 & OR 게이트 | DAG는 있으나 병렬 실행 없음 |
| 코딩 도메인 내장 블록 | 블록 레지스트리 있으나 coding 블록 없음 |
| Webhook 트리거 | HTTP 트리거 없음 |
| 에이전트 스트리밍 진행상황 | AgentNode 완료 후 한 번에 output |
| 노드 자동 레이아웃 | 수동 배치만 가능 |
| 워크플로우 버전 이력 | 저장 시 덮어쓰기만 |

---

## 1. 배경 및 현재 상태

v0.2.4는 다음을 완료한다.

- Memory 시스템 (파일 기반, AgentNode 주입)
- 다중 LLM 프로바이더 (OpenAI, Ollama)
- SKILL.md 스펙 확장 (triggers, mode, category, featured)
- RunDetailPanel durationMs, Run history 필터/삭제/더 보기
- 워크플로우 이름 인라인 편집, description, useBlocker
- paramDefs 편집 UI

v0.3.0은 이 기반 위에서 OD의 고급 기능 계층 전체를 이식한다.

### 1.1 구현 범위 원칙

이번 버전에서 포함하는 항목을 결정하는 세 가지 원칙:

1. **OD §5, §10~§19를 neos-work 아키텍처에 맞게 이식한다.** OD의 `apps/daemon`에 해당하는 것이 `apps/server`이고, `apps/web`에 해당하는 것이 `apps/desktop`이다. OD의 "project" 개념은 neos-work의 "workflow"와 매핑된다.
2. **CLI tool이 필요한 기능(§5 external CLI)은 실제 설치 여부를 runtime에 감지해서 graceful degradation한다.** CLI가 없어도 BYOK(v0.2.4 OpenAI adapter) 경로로 폴백한다.
3. **Plugin(§11)은 MVP 범위로 제한한다.** Atom pipeline의 모든 atom을 구현하지 않고, `open-design.json` sidecar를 읽고 적용하는 기본 흐름과 4-step 기본 pipeline(discovery → plan → execute → critique)만 구현한다.

---

## 2. 목표와 비목표

### 목표 (14개)

#### Part A — Open Design 이식
1. **Design Context Layer**: `~/.config/neos-work/design-systems/` 스캔, DESIGN.md 파싱, AgentNode에 주입, UI 관리 페이지
2. **Automation Routine**: cron 스케줄 설정, DST 대응, 수동 실행, 실행 이력, crystallize
3. **외부 에이전트 CLI spawn**: PATH 탐색 (Claude Code, Gemini CLI, Codex 우선), spawn → SSE, Settings "감지된 CLI" 섹션
4. **Live Artifact Preview**: 워크플로우 에디터 우측 패널 "Preview" 탭, `<iframe sandbox>` HTML 렌더링, refresh
5. **Plugin (MVP)**: `SKILL.md` + `open-design.json` sidecar 읽기, 4-step pipeline UI, skill → plugin 업그레이드 경로
6. **Generative UI / Human-in-the-loop**: pipeline stage에서 form/choice/confirmation surface 선언 지원
7. **Media Generation 노드**: Image/Audio 생성 노드 (OpenAI DALL-E, TTS), 프로젝트 폴더에 파일 저장, FileViewer
8. **Deploy 노드**: Vercel/Cloudflare Pages 배포 노드, Settings deploy config, 배포 이력
9. **MCP OAuth 2.0**: `POST /api/mcp/oauth/start`, callback, token 저장, spawn context 주입
10. **프로젝트 ZIP 내보내기/가져오기**: 워크플로우 아카이브 ZIP export/import, Claude Design ZIP import

#### Part B — neos-work 자체 개선
11. **병렬 브랜치 & OR 게이트**: `workflow-engine` DAG에 병렬 fan-out/fan-in 실행, OR 게이트 semantics
12. **코딩 도메인 내장 블록**: `code_eval`, `file_read`, `git_diff`, `test_runner` 블록 레지스트리 등록
13. **Webhook 트리거**: `POST /api/webhook/:workflowId` → 워크플로우 실행, HMAC 서명 검증
14. **에이전트 스트리밍 진행상황**: AgentNode 실행 중 LLM 스트리밍 텍스트 → SSE → Run Log 실시간 표시

#### Part C — UX 개선
15. **노드 자동 레이아웃**: "Auto Layout" 버튼 → dagre/d3-dag 기반 계층적 레이아웃
16. **워크플로우 버전 이력**: 저장 전 자동 스냅샷, revision 목록, 특정 revision 복원

### 비목표

- OD §11 Atom pipeline의 전체 atom 구현 (figma extract, design extract, diff review, handoff 등)
- OD §11.6 Plugin snapshot / replay 완전 재현성
- OD §13 Video 생성 (Volcengine, xAI) — 초기 버전에서는 Image/Audio만
- OD §13 Azure OpenAI media — 기본 OpenAI DALL-E만
- OD §17 Live Artifact agent tool-token 경로 (`/api/tools/live-artifacts/*`)
- OD §22 전체 보안 hardening (SSRF 검사 등 고급 기능)
- Marketplace 서버 / 카탈로그 서비스 (로컬 Plugin 인스톨만)
- Tauri IPC로 native 파일 picker 연동
- `od` CLI (neos-work는 서버가 있으므로 CLI wrapping 불필요)

---

## 3. 제품 설계

### 3.1 Design Context Layer (OD §10)

**개념**: DESIGN.md는 에이전트가 새 결과물을 만들거나 수정할 때 브랜드 규칙(색상, 타이포, 컴포넌트 스타일 등)을 일관되게 따를 수 있도록 시스템 프롬프트 앞에 주입하는 context layer이다.

**파일 구조**:
```text
~/.config/neos-work/design-systems/
└── <name>/
    ├── DESIGN.md          # 필수
    ├── manifest.json      # 선택적
    ├── tokens.css         # 선택적
    └── components.html    # 선택적
```

**API**:
```
GET    /api/design-systems          # 목록
POST   /api/design-systems          # 신규 (이름만 제공하면 템플릿 DESIGN.md 생성)
GET    /api/design-systems/:id      # 단건
PUT    /api/design-systems/:id      # 수정
DELETE /api/design-systems/:id      # 삭제
GET    /api/design-systems/:id/content  # DESIGN.md 원본 텍스트
PUT    /api/design-systems/:id/content  # DESIGN.md 저장
```

**AgentNode 주입 방식**:
- 워크플로우에 `designSystemId` 속성 추가
- AgentNode에서 `ctx.workflow.designSystemId`가 있으면 DESIGN.md를 읽어 시스템 프롬프트 앞에 `<!-- DESIGN CONTEXT -->\n${content}\n<!-- /DESIGN CONTEXT -->` 형태로 삽입

**UI**:
- `apps/desktop/src/pages/DesignSystems.tsx` 신규 — 카드 목록, 신규 생성, 삭제
- `apps/desktop/src/pages/DesignSystemEditor.tsx` 신규 — CodeMirror/textarea로 DESIGN.md 편집
- WorkflowEditor Config 탭에 `designSystemId` `<select>` 추가

**타입**:
```ts
interface DesignSystem {
  id: string;
  name: string;
  description?: string;
  path: string;       // 실제 디렉터리 절대 경로
  hasManifest: boolean;
  hasTokens: boolean;
  hasComponents: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

### 3.2 Automation Routine (OD §15)

**개념**: 특정 워크플로우를 스케줄에 따라 반복 실행. 단순 cron wrapper가 아니라 skill/plugin/memory context를 포함한 실행 단위.

**DB 테이블** (`apps/server/src/db/routines.ts`):
```sql
CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  schedule TEXT NOT NULL,        -- JSON: { kind, time?, timezone?, minute?, weekday? }
  context TEXT,                  -- JSON: { skillIds?, mcpServerIds? }
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL,
  workflow_run_id TEXT,
  status TEXT NOT NULL,          -- queued | running | succeeded | failed
  triggered_by TEXT NOT NULL,    -- schedule | manual
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
```

**스케줄 타입**:
```ts
type Schedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekdays'; time: string; timezone: string }
  | { kind: 'weekly'; time: string; timezone: string; weekday: 0|1|2|3|4|5|6 };
```

**서버 구현**:
- `apps/server/src/lib/routine-scheduler.ts`: `node-cron` 기반 스케줄러, DST 대응 (`Intl.DateTimeFormat` UTC 변환), 중복 실행 방지 (in-memory lock map)
- 서버 시작 시 `initScheduler()` → DB에서 활성 routine 로딩 → 각각 cron 등록

**API** (`apps/server/src/routes/routines.ts`):
```
GET    /api/routines
POST   /api/routines
GET    /api/routines/:id
PATCH  /api/routines/:id
DELETE /api/routines/:id
POST   /api/routines/:id/run          # 수동 즉시 실행
GET    /api/routines/:id/runs         # 실행 이력
POST   /api/routines/:id/runs/:runId/crystallize  # 성공 run → skill 후보 변환
```

**UI**:
- `apps/desktop/src/pages/Routines.tsx` 신규 — 목록, 신규 생성 모달(이름, 워크플로우 선택, 스케줄 설정), 토글, 수동 실행, 실행 이력
- WorkflowEditor 툴바에 "Schedule" 버튼 → 해당 워크플로우에 Routine 연결 shortcut

---

### 3.3 외부 에이전트 CLI Spawn (OD §5)

**개념**: neos-work AgentNode가 내부 LLM adapter 외에 사용자가 설치한 외부 coding agent CLI를 spawn해서 실행할 수 있도록 한다. Open Design은 22개의 CLI를 지원하지만 neos-work v0.3.0은 가장 많이 쓰이는 3개를 우선 지원한다.

**지원 CLI (우선순위 순)**:
| Agent | 바이너리 | detect 방법 |
|---|---|---|
| Claude Code | `claude` | `which claude` |
| Gemini CLI | `gemini` | `which gemini` |
| Codex | `codex` | `which codex` |

**구현 (`apps/server/src/lib/cli-agents.ts`)**:
```ts
interface CliAgentDef {
  id: string;
  name: string;
  binary: string;
  buildArgs: (prompt: string, cwd: string) => string[];
  parseOutput?: (line: string) => string | null;  // JSONL 파싱, 없으면 raw line
}

// detect
async function detectCLIs(): Promise<DetectedCLI[]>

// spawn + SSE stream
async function spawnCliAgent(
  def: CliAgentDef,
  prompt: string,
  cwd: string,
  onEvent: (event: WorkflowSSEEvent) => void,
  signal: AbortSignal
): Promise<string>  // final output
```

**AgentNode 연동**:
- `nodeConfig.provider === 'cli'` 일 때 `spawnCliAgent` 호출
- spawn 전 `workdir` 생성 (`~/.config/neos-work/workspaces/<runId>/`)
- stdout line 단위로 `node.progress` SSE 이벤트 발행
- exit 0 → `node.completed`, exit non-0 → `node.failed`
- AbortController로 취소 지원 (SIGTERM → SIGKILL grace 5s)

**Settings UI 추가**:
- "감지된 CLI 에이전트" 섹션: detect 결과 표시, 수동 경로 입력
- NodeConfigPanel에 provider `<select>`에 `cli-claude`, `cli-gemini`, `cli-codex` 옵션 추가

**환경 변수 주입**:
- spawn 시 `NEOS_SERVER_URL`, `NEOS_AUTH_TOKEN`, `NEOS_WORKFLOW_ID`, `NEOS_RUN_ID` 주입

---

### 3.4 Live Artifact Preview (OD §17)

**개념**: AgentNode output이 HTML이면 WorkflowEditor 우측 패널의 "Preview" 탭에서 `<iframe sandbox>` 로 렌더링. refresh 가능.

**DB 테이블** (`apps/server/src/db/artifacts.ts`):
```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  run_id TEXT,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,    -- 'text/html' | 'text/markdown' | 'image/png' etc
  content TEXT,                  -- 인라인 콘텐츠 (HTML, Markdown)
  file_path TEXT,                -- 파일 경로 (이미지 등)
  node_id TEXT,                  -- 생성한 AgentNode id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**API** (`apps/server/src/routes/artifacts.ts`):
```
GET    /api/artifacts?workflowId=...       # 목록
GET    /api/artifacts/:id                  # 단건
GET    /api/artifacts/:id/preview          # HTML content 반환 (text/html)
DELETE /api/artifacts/:id
POST   /api/artifacts/:id/refresh          # 해당 노드 재실행 트리거
PATCH  /api/artifacts/:id                  # name, content 수정
```

**AgentNode output 감지**:
- output이 `<!DOCTYPE html` 또는 `<html` 로 시작하면 자동으로 artifact로 저장
- `run.completed` SSE 이벤트에 `artifactId` 포함

**WorkflowEditor UI**:
- 우측 패널에 "Config" | "Preview" 탭 추가
- Preview 탭: 가장 최근 run의 artifact HTML을 `<iframe sandbox="allow-scripts">` 렌더링
- "Refresh" 버튼: `/api/artifacts/:id/refresh` 호출
- artifact가 없으면 "Run the workflow to see a preview" 안내

**보안**:
- `sandbox="allow-scripts"` — allow-same-origin, allow-top-navigation 제외
- content-type 검증 (HTML만 iframe, Markdown은 별도 렌더러)

---

### 3.5 Plugin / Atom Pipeline (OD §11, MVP)

**개념**: SKILL.md + `open-design.json` sidecar를 조합하면 Plugin이 된다. Plugin은 4-step atom pipeline(discovery → plan → execute → critique)으로 복잡한 작업을 분해한다.

**파일 구조**:
```text
~/.config/neos-work/skills/<plugin-name>/
├── SKILL.md
└── open-design.json   # Plugin 선언
```

**`open-design.json` 스키마 (MVP)**:
```ts
interface PluginManifest {
  schemaVersion: 'od-plugin/v1';
  id: string;
  name: string;
  description?: string;
  version: string;
  pipeline?: PipelineStage[];
  inputFields?: InputField[];
  capabilityGates?: string[];
}

interface PipelineStage {
  id: string;
  name: string;
  kind: 'discovery' | 'plan' | 'execute' | 'critique' | 'form' | 'choice';
  prompt?: string;          // stage별 프롬프트 조각
  outputKey?: string;       // 다음 stage에 넘길 키
  humanInLoop?: boolean;    // true면 사용자 입력 대기
}
```

**서버 구현**:
- `apps/server/src/lib/plugin-store.ts` 신규 — skill 디렉터리를 스캔하면서 `open-design.json`이 있는 것을 plugin으로 분류
- `apps/server/src/routes/plugins.ts` 신규
  ```
  GET  /api/plugins            # 목록
  GET  /api/plugins/:id        # 상세
  POST /api/plugins/:id/run    # pipeline 실행 (단계별 SSE 스트림)
  ```

**Pipeline 실행 엔진**:
- `apps/server/src/lib/plugin-runner.ts` 신규
- 각 stage를 순서대로 실행, `humanInLoop` stage는 SSE로 `plugin.stage.waiting` 이벤트 발행 후 대기
- `/api/plugins/:id/run/:runId/resume` — 사용자 응답 수신 후 다음 stage 진행
- stage output은 다음 stage 프롬프트에 `{{previous.output}}` 형태로 보간

**UI**:
- `apps/desktop/src/pages/Plugins.tsx` 신규 — Plugin과 일반 Skill을 구분해 표시 (배지)
- Plugin 카드에 "Run" 버튼 → Pipeline runner 모달
  - 각 stage 진행 상황 스텝 인디케이터
  - `humanInLoop` stage에서 form/choice 렌더링 (Generative UI, 3.6 참고)

---

### 3.6 Generative UI / Human-in-the-loop (OD §12)

**개념**: Plugin pipeline의 특정 stage에서 사용자 입력을 받는 세 가지 surface를 지원한다.

| Surface | 설명 |
|---|---|
| `form` | key-value 입력 필드 모음 |
| `choice` | 텍스트/이미지 중 선택 |
| `confirmation` | 계속 진행 여부 확인 |

**SSE 이벤트**:
```ts
// 서버 → 클라이언트
{ type: 'plugin.stage.waiting', stageId, surface, schema }

// 클라이언트 → 서버 (POST /api/plugins/:id/run/:runId/resume)
{ stageId, response: Record<string, unknown> }
```

**Schema 예시**:
```ts
// form
{
  surface: 'form',
  fields: [
    { key: 'brandColor', label: 'Brand Color', type: 'text', placeholder: '#3B82F6' },
    { key: 'tone', label: 'Tone', type: 'select', options: ['formal', 'casual', 'playful'] }
  ]
}

// choice
{
  surface: 'choice',
  prompt: 'Which direction do you prefer?',
  options: [
    { label: 'Minimal', previewUrl: '...' },
    { label: 'Bold', previewUrl: '...' }
  ]
}
```

**UI 컴포넌트**:
- `apps/desktop/src/components/workflow/GenUIForm.tsx` 신규
- `apps/desktop/src/components/workflow/GenUIChoice.tsx` 신규
- Pipeline runner 모달에서 waiting stage 감지 시 자동 렌더링

---

### 3.7 Media Generation 노드 (OD §13, Image/Audio MVP)

**개념**: 워크플로우 노드로 이미지/오디오를 생성하고 프로젝트 폴더에 저장.

**지원 provider (v0.3.0)**:
| Surface | Provider | 모델 |
|---|---|---|
| Image | OpenAI DALL-E 3 | `dall-e-3` |
| Audio | OpenAI TTS | `tts-1`, `tts-1-hd` |

**MediaNode 설정**:
```ts
interface MediaNodeConfig {
  surface: 'image' | 'audio';
  provider: 'openai';
  model: string;
  outputPath: string;   // 상대 경로, e.g. "output/banner.png"
  // image
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  // audio
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
}
```

**서버 구현**:
- `apps/server/src/lib/media-generator.ts` 신규
  - `generateImage(prompt, config, workdir)`: OpenAI Images API → 파일 저장
  - `generateAudio(text, config, workdir)`: OpenAI TTS API → 파일 저장
- `apps/server/src/routes/media.ts` 신규
  ```
  GET   /api/media/config
  PUT   /api/media/config
  POST  /api/media/generate     # prompt, surface, model, outputPath
  GET   /api/media/files        # 생성된 파일 목록
  ```

**보안**:
- `outputPath`는 project-relative path만 허용 (path traversal 검증)
- 확장자 allowlist: `png`, `jpg`, `jpeg`, `webp`, `mp3`, `opus`, `aac`, `flac`, `wav`
- 이미지 최대 크기 16 MB

**workflow-engine 연동**:
- `packages/workflow-engine/src/nodes/media.ts` 신규 — `MediaNode` 구현
- `WorkflowNode.type: 'media'` 추가

**UI**:
- NodeConfigPanel에 media 노드 설정 패널 추가
- 실행 후 output 파일 경로 표시 + 이미지 썸네일

---

### 3.8 Deploy 노드 (OD §19)

**개념**: 워크플로우의 마지막 노드로 생성된 HTML/파일을 Vercel 또는 Cloudflare Pages에 배포.

**DeployNode 설정**:
```ts
interface DeployNodeConfig {
  provider: 'vercel' | 'cloudflare-pages';
  projectName: string;
  sourcePath: string;   // 배포할 파일/디렉터리 (project-relative)
}
```

**서버 구현**:
- `apps/server/src/lib/deploy.ts` 신규
  - `deployToVercel(config, sourcePath, authToken)`: Vercel Deploy API v13
  - `deployToCloudflare(config, sourcePath, apiToken, accountId)`: Cloudflare Pages API
- `apps/server/src/routes/deploy.ts` 신규
  ```
  GET  /api/deploy/config?provider=vercel|cloudflare-pages
  PUT  /api/deploy/config
  GET  /api/workflows/:id/deployments
  POST /api/workflows/:id/deploy
  POST /api/workflows/:id/deploy/preflight     # 배포 가능성 사전 검사
  ```

**DB 테이블** (`apps/server/src/db/deployments.ts`):
```sql
CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  run_id TEXT,
  provider TEXT NOT NULL,
  project_name TEXT,
  url TEXT,
  deployment_id TEXT,
  status TEXT NOT NULL,          -- pending | deploying | success | failed
  status_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Settings UI**:
- "Deploy" 섹션 추가 — Vercel API Token, Cloudflare API Token + Account ID 입력

**UI**:
- DeployNode 설정 패널
- 실행 완료 후 배포 URL 링크 표시
- `apps/desktop/src/pages/Deployments.tsx` 신규 — 배포 이력 전체 목록

---

### 3.9 MCP OAuth 2.0 (OD §14.6)

**개념**: 외부 MCP 서버가 OAuth 2.0 인증이 필요한 경우의 인증 흐름. Tauri `shell.open` API로 시스템 브라우저에서 authorization URL 열고, callback을 로컬 서버에서 수신.

**흐름**:
```
Settings에서 "Connect" 클릭
  → POST /api/mcp/oauth/start { serverId, redirectUri }
  → 서버: state + code_verifier 생성, auth URL 반환
  → Tauri shell.open(authUrl)
  → 사용자: 브라우저에서 승인
  → GET /api/mcp/oauth/callback?code=...&state=...
  → 서버: token exchange, ~/.config/neos-work/mcp-tokens/<serverId>.json 저장
  → SSE 이벤트 'mcp.oauth.success' → UI 업데이트
```

**구현**:
- `apps/server/src/routes/mcp.ts`에 OAuth endpoint 추가
  ```
  POST   /api/mcp/oauth/start
  GET    /api/mcp/oauth/callback
  POST   /api/mcp/oauth/:serverId/refresh
  DELETE /api/mcp/oauth/:serverId      # revoke
  GET    /api/mcp/oauth/:serverId/status
  ```
- PKCE (S256) 사용, state는 `crypto.randomBytes(32)` hex
- token 파일: `{ accessToken, refreshToken?, expiresAt, scope, serverId }`, key는 UI에 tail만 노출
- spawn context 주입: agent 실행 시 `NEOS_MCP_TOKEN_<SERVER_ID>=<token>` env 추가

**UI**:
- Settings MCP 섹션에 각 서버별 OAuth status badge (connected / disconnected)
- "Connect" / "Disconnect" 버튼

---

### 3.10 프로젝트 ZIP 내보내기/가져오기 (OD §18)

**내보내기 (Export)**:
- `GET /api/workflows/:id/export` → ZIP 파일 다운로드
- ZIP 내용: `workflow.json` (노드/엣지/메타) + `runs/` (최근 10개 run JSON) + `artifacts/` (생성된 파일)
- dot file 및 내부 sidecar 제외

**가져오기 (Import)**:
- `POST /api/workflows/import` → multipart/form-data, `file=<zip>`
- 동작: ZIP 추출 → `workflow.json` 파싱 → 새 workflow id 생성 → 저장
- 동일 이름이면 "Copy of ..." suffix 자동 추가

**Claude Design ZIP Import**:
- `.zip` 내 `index.html` 또는 `*.html` 파일 감지
- 새 workflow 생성 + HTML을 artifact로 저장

**UI**:
- Workflows 목록 페이지: "Import" 버튼 + 파일 picker
- Workflow 카드 메뉴: "Export" 버튼
- WorkflowEditor 툴바: "Export" 버튼

---

### 3.11 병렬 브랜치 & OR 게이트 (neos-work 자체)

**현재 상태**: `workflow-engine` DAG executor는 topological sort로 순차 실행. fan-out은 없음.

**설계**:
- `WorkflowNode.type: 'parallel-start'` — 여러 브랜치를 동시 시작하는 게이트 노드
- `WorkflowNode.type: 'parallel-end'` — 모든 브랜치 완료를 기다리는 join 노드 (AND 게이트)
- `WorkflowNode.type: 'or-gate'` — 첫 번째로 완료된 브랜치 결과를 채택 (OR 게이트)

**executor 변경** (`packages/workflow-engine/src/executor.ts`):
- ready 노드 계산 시 "모든 선행 노드 완료" 조건 유지
- `parallel-start` 노드 완료 → 후속 브랜치 노드들을 동시에 `Promise.all`로 실행
- `parallel-end` 노드: 모든 선행 완료 대기 (`Promise.all`)
- `or-gate` 노드: `Promise.race` + 나머지 브랜치 취소 (AbortController)

**WorkflowEditor UI**:
- 노드 팔레트에 "Parallel Start", "Parallel End", "OR Gate" 노드 추가
- parallel branch를 시각적으로 구분하는 컬러 레인 (선택적, MVP에서는 색상만)

---

### 3.12 코딩 도메인 내장 블록

**구현 위치**: `packages/workflow-engine/src/blocks/coding.ts`

| 블록 id | 입력 | 출력 | 설명 |
|---|---|---|---|
| `code_eval` | `code: string`, `language: 'js'\|'ts'\|'python'` | `result: string`, `error?: string` | 코드 실행 (Node vm.runInNewContext 또는 Python subprocess) |
| `file_read` | `path: string` | `content: string` | 파일 읽기 (project-relative path) |
| `file_write` | `path: string`, `content: string` | `success: boolean` | 파일 쓰기 |
| `git_diff` | `repoPath?: string` | `diff: string` | `git diff HEAD` 결과 |
| `test_runner` | `command: string`, `cwd?: string` | `output: string`, `exitCode: number` | 테스트 명령 실행 |

**보안**:
- `code_eval`: `vm.runInNewContext` (Node built-in sandbox), 타임아웃 5초, 허용 모듈 allowlist
- `file_read`/`file_write`: path traversal 검증, `~/.config/neos-work/workspaces/` 하위만 쓰기 허용
- `git_diff`: 읽기 전용, `exec` 대신 `spawn`
- `test_runner`: 허용 명령어 prefix (`npm`, `pnpm`, `yarn`, `pytest`, `go test`, `cargo test`)

---

### 3.13 Webhook 트리거 (neos-work 자체)

**API**:
```
POST /api/webhook/:workflowId
  Headers: X-Neos-Signature: sha256=<hmac>
  Body: arbitrary JSON → workflow inputs로 전달
```

**보안**:
- 워크플로우마다 독립 `webhookSecret` (32 bytes hex, 서버 시작 시 생성)
- `X-Neos-Signature` HMAC-SHA256 검증 (constant-time compare)
- rate limit: 같은 workflowId에 60초 내 최대 60회

**DB 변경**:
- `workflows` 테이블에 `webhook_secret TEXT` 컬럼 추가

**UI**:
- WorkflowEditor Config 탭에 "Webhook" 섹션 추가
  - URL 표시: `http://localhost:<port>/api/webhook/<workflowId>`
  - Secret 표시 (눈 아이콘으로 숨김/표시)
  - "Regenerate Secret" 버튼

---

### 3.14 에이전트 스트리밍 진행상황 (neos-work 자체)

**현재 상태**: AgentNode는 LLM 호출 완료 후 `node.completed` 이벤트 하나만 발행.

**설계**:
- LLM streaming call 사용 (`stream: true`)
- stream chunk 수신 시마다 `node.progress` SSE 이벤트 발행:
  ```ts
  { type: 'node.progress', nodeId, chunk: string, accumulated: string }
  ```
- Run Log 패널에서 `node.progress` 이벤트를 누적해서 실시간 스크롤 표시
- 완료 시 `node.completed` (기존 동일)

**변경 파일**:
- `packages/workflow-engine/src/nodes/agent.ts` — stream mode로 변경
- `packages/shared/src/types/index.ts` — `WorkflowSSEEvent`에 `node.progress` 타입 추가
- `apps/desktop/src/components/workflow/RunLogPanel.tsx` — progress 누적 렌더링

---

### 3.15 노드 자동 레이아웃 (neos-work 자체)

**의존성**: `dagre` (이미 `@xyflow/react` 생태계에서 널리 쓰임)

**구현** (`apps/desktop/src/lib/layout.ts`):
```ts
import dagre from '@dagrejs/dagre';

export function autoLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] }
```

**UI**:
- WorkflowEditor 툴바에 "Auto Layout" 버튼 (⚡ 또는 격자 아이콘)
- 버튼 클릭 → `autoLayout(nodes, edges)` → `setNodes(layouted)` 호출
- 레이아웃 적용 후 `fitView()` 호출

---

### 3.16 워크플로우 버전 이력

**DB 테이블** (`apps/server/src/db/workflow-revisions.ts`):
```sql
CREATE TABLE workflow_revisions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,   -- JSON.stringify({ nodes, edges, name, description })
  label TEXT,               -- 수동 레이블 (선택적)
  created_at TEXT NOT NULL
);
```

**자동 스냅샷 정책**:
- `PUT /api/workflows/:id` (저장) 호출 전 현재 상태 스냅샷 저장
- 최대 50개 revision 유지 (오래된 것 자동 삭제)
- 마지막 저장으로부터 변경이 없으면 스냅샷 생략 (중복 방지)

**API**:
```
GET    /api/workflows/:id/revisions             # 목록 (id, label, createdAt)
GET    /api/workflows/:id/revisions/:revId      # 단건 (snapshot 포함)
POST   /api/workflows/:id/revisions/:revId/restore  # 해당 revision으로 복원
DELETE /api/workflows/:id/revisions/:revId      # 수동 삭제
PATCH  /api/workflows/:id/revisions/:revId      # label 수정
```

**UI**:
- WorkflowEditor 툴바에 "History" 버튼 (시계 아이콘)
- 슬라이드인 패널: revision 목록 (날짜, label, 노드 수)
- "Restore" 버튼 → dirty state 경고 → 복원

---

## 4. 파일 맵

### 4.1 신규 파일 (서버)

| 파일 | 설명 |
|---|---|
| `apps/server/src/db/routines.ts` | routines, routine_runs 테이블 |
| `apps/server/src/db/artifacts.ts` | artifacts 테이블 |
| `apps/server/src/db/deployments.ts` | deployments 테이블 |
| `apps/server/src/db/workflow-revisions.ts` | workflow_revisions 테이블 |
| `apps/server/src/lib/design-system-store.ts` | DESIGN.md 스캔/파싱/저장 |
| `apps/server/src/lib/routine-scheduler.ts` | cron 스케줄러, DST 대응 |
| `apps/server/src/lib/cli-agents.ts` | 외부 CLI detect/spawn |
| `apps/server/src/lib/media-generator.ts` | DALL-E, TTS 생성 |
| `apps/server/src/lib/deploy.ts` | Vercel, Cloudflare deploy |
| `apps/server/src/lib/plugin-store.ts` | Plugin 스캔 및 관리 |
| `apps/server/src/lib/plugin-runner.ts` | Atom pipeline 실행 엔진 |
| `apps/server/src/routes/design-systems.ts` | Design System API |
| `apps/server/src/routes/routines.ts` | Routine API |
| `apps/server/src/routes/artifacts.ts` | Artifact API |
| `apps/server/src/routes/media.ts` | Media Generation API |
| `apps/server/src/routes/deploy.ts` | Deploy API |
| `apps/server/src/routes/plugins.ts` | Plugin API |
| `apps/server/src/routes/webhooks.ts` | Webhook 트리거 |
| `apps/server/src/routes/workflow-revisions.ts` | Revision API |

### 4.2 신규 파일 (데스크탑)

| 파일 | 설명 |
|---|---|
| `apps/desktop/src/pages/DesignSystems.tsx` | Design System 목록 |
| `apps/desktop/src/pages/DesignSystemEditor.tsx` | DESIGN.md 편집 |
| `apps/desktop/src/pages/Routines.tsx` | Routine 목록/관리 |
| `apps/desktop/src/pages/Plugins.tsx` | Plugin 목록/실행 |
| `apps/desktop/src/pages/Deployments.tsx` | 배포 이력 |
| `apps/desktop/src/components/workflow/GenUIForm.tsx` | Human-in-loop form |
| `apps/desktop/src/components/workflow/GenUIChoice.tsx` | Human-in-loop choice |
| `apps/desktop/src/components/workflow/PipelineRunner.tsx` | Plugin pipeline 모달 |
| `apps/desktop/src/components/workflow/ArtifactPreview.tsx` | iframe preview 패널 |
| `apps/desktop/src/components/workflow/RevisionPanel.tsx` | 버전 이력 슬라이드인 |
| `apps/desktop/src/lib/layout.ts` | dagre 자동 레이아웃 |

### 4.3 신규 파일 (workflow-engine)

| 파일 | 설명 |
|---|---|
| `packages/workflow-engine/src/nodes/media.ts` | MediaNode |
| `packages/workflow-engine/src/nodes/deploy.ts` | DeployNode |
| `packages/workflow-engine/src/blocks/coding.ts` | 코딩 내장 블록 4종 |

### 4.4 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `apps/server/src/index.ts` | 신규 route 등록, scheduler init, webhook route |
| `apps/server/src/db/workflows.ts` | `webhook_secret` 컬럼 추가 |
| `apps/desktop/src/App.tsx` | 신규 페이지 route 등록 |
| `apps/desktop/src/components/Sidebar.tsx` | DesignSystems, Routines, Plugins, Deployments 메뉴 추가 |
| `apps/desktop/src/lib/engine.ts` | 신규 API 메서드 추가 |
| `apps/desktop/src/pages/WorkflowEditor.tsx` | Preview 탭, History 버튼, Auto Layout 버튼, Webhook 섹션 |
| `apps/desktop/src/pages/Settings.tsx` | CLI 감지 섹션, Deploy config 섹션, MCP OAuth 섹션, Media config 섹션 |
| `apps/desktop/src/components/workflow/NodeConfigPanel.tsx` | CLI provider, MediaNode, DeployNode 설정 패널 |
| `packages/shared/src/types/index.ts` | `node.progress` SSE 이벤트, DesignSystem, Routine, Artifact, Plugin 타입 |
| `packages/workflow-engine/src/nodes/agent.ts` | 스트리밍 mode, CLI spawn 연동, designSystem 주입 |
| `packages/workflow-engine/src/executor.ts` | 병렬 브랜치, OR 게이트 |
| `packages/workflow-engine/src/types.ts` | `parallel-start`, `parallel-end`, `or-gate`, `media`, `deploy` 노드 타입 추가 |
| `packages/ui/src/i18n/locales/en/common.json` | 신규 i18n 키 |
| `packages/ui/src/i18n/locales/ko/common.json` | 신규 i18n 번역 |

---

## 5. Task별 구현 계획

### Task 1: Design Context Layer

- [ ] `apps/server/src/lib/design-system-store.ts` — `listDesignSystems()`, `getDesignSystem(id)`, `createDesignSystem(name)`, `getContent(id)`, `saveContent(id, markdown)`, `deleteDesignSystem(id)` 구현
- [ ] `apps/server/src/routes/design-systems.ts` — Hono router 구현
- [ ] `apps/server/src/index.ts`에 route 등록
- [ ] `packages/shared/src/types/index.ts`에 `DesignSystem` 타입 추가
- [ ] `apps/desktop/src/lib/engine.ts`에 design-system 메서드 추가
- [ ] `packages/workflow-engine/src/nodes/agent.ts`에 `designSystemId` 주입 로직 추가
- [ ] `apps/desktop/src/pages/DesignSystems.tsx` 구현
- [ ] `apps/desktop/src/pages/DesignSystemEditor.tsx` 구현
- [ ] `WorkflowEditor.tsx` Config 탭에 designSystemId select 추가
- [ ] Sidebar에 "Design Systems" 메뉴 추가
- [ ] `pnpm typecheck` 통과

---

### Task 2: Automation Routine

- [ ] `apps/server/src/db/routines.ts` — 테이블 생성 + CRUD 함수
- [ ] `apps/server/src/lib/routine-scheduler.ts` — `node-cron` 스케줄러 + DST 대응
- [ ] `apps/server/src/routes/routines.ts` — API 구현
- [ ] 서버 시작 시 `initScheduler()` 호출
- [ ] `packages/shared/src/types/index.ts`에 `Routine`, `RoutineRun`, `Schedule` 타입 추가
- [ ] `apps/desktop/src/lib/engine.ts`에 routine 메서드 추가
- [ ] `apps/desktop/src/pages/Routines.tsx` 구현
  - 목록, 신규 생성 모달 (이름 + 워크플로우 선택 + 스케줄 설정 4종)
  - 토글, 수동 실행, 실행 이력 탭
  - crystallize 버튼 (성공 run → skill 저장)
- [ ] WorkflowEditor 툴바에 "Schedule" 버튼 추가 (해당 workflow Routine 바로 생성)
- [ ] `pnpm typecheck` 통과

---

### Task 3: 외부 에이전트 CLI Spawn

- [ ] `apps/server/src/lib/cli-agents.ts` — `detectCLIs()`, `spawnCliAgent()` 구현
- [ ] `apps/server/src/routes/cli-agents.ts` — `GET /api/cli-agents` (감지 결과)
- [ ] `packages/workflow-engine/src/nodes/agent.ts`에 CLI provider 분기 추가
  - `config.provider === 'cli-claude'` | `'cli-gemini'` | `'cli-codex'`
  - `node.progress` 이벤트 발행 (chunk 단위)
  - AbortSignal → SIGTERM → SIGKILL
- [ ] Settings 페이지에 "감지된 CLI 에이전트" 섹션 추가
- [ ] NodeConfigPanel에 CLI provider 옵션 추가
- [ ] `pnpm typecheck` 통과

---

### Task 4: Live Artifact Preview

- [ ] `apps/server/src/db/artifacts.ts` — 테이블 생성 + CRUD
- [ ] `apps/server/src/routes/artifacts.ts` — API 구현
- [ ] AgentNode에서 HTML output 감지 → artifact 자동 저장
- [ ] `run.completed` SSE 이벤트에 `artifactId` 포함
- [ ] `apps/desktop/src/components/workflow/ArtifactPreview.tsx` — `<iframe sandbox>` 렌더링
- [ ] WorkflowEditor 우측 패널에 "Config" | "Preview" 탭 추가
- [ ] "Refresh" 버튼 → `/api/artifacts/:id/refresh`
- [ ] `pnpm typecheck` 통과

---

### Task 5: Plugin / Atom Pipeline (MVP)

- [ ] `apps/server/src/lib/plugin-store.ts` — skill 디렉터리 스캔 중 `open-design.json` 감지
- [ ] `apps/server/src/lib/plugin-runner.ts` — stage 순차 실행, `humanInLoop` 대기/재개
- [ ] `apps/server/src/routes/plugins.ts` — 목록, 상세, 실행, resume API
- [ ] `packages/shared/src/types/index.ts`에 `PluginManifest`, `PipelineStage` 타입 추가
- [ ] `apps/desktop/src/components/workflow/PipelineRunner.tsx` — 스텝 인디케이터 모달
- [ ] `apps/desktop/src/pages/Plugins.tsx` — Skill 목록에 Plugin 배지 구분
- [ ] Sidebar에 "Plugins" 메뉴 추가 (또는 Skills 탭 내 통합)
- [ ] `pnpm typecheck` 통과

---

### Task 6: Generative UI / Human-in-the-loop

- [ ] `WorkflowSSEEvent`에 `plugin.stage.waiting` 이벤트 타입 추가
- [ ] `apps/desktop/src/components/workflow/GenUIForm.tsx` 구현
- [ ] `apps/desktop/src/components/workflow/GenUIChoice.tsx` 구현
- [ ] PipelineRunner 모달에서 waiting 이벤트 감지 → GenUI 렌더링
- [ ] resume API `POST /api/plugins/:id/run/:runId/resume` 호출 연동
- [ ] `pnpm typecheck` 통과

---

### Task 7: Media Generation 노드

- [ ] `apps/server/src/lib/media-generator.ts` — `generateImage()`, `generateAudio()` 구현
- [ ] `apps/server/src/routes/media.ts` — API 구현
- [ ] `packages/workflow-engine/src/nodes/media.ts` — MediaNode 구현
- [ ] `packages/workflow-engine/src/types.ts`에 `media` 노드 타입 추가
- [ ] Settings 페이지에 Media config 섹션 추가
- [ ] NodeConfigPanel에 MediaNode 설정 패널 추가
- [ ] `pnpm typecheck` 통과

---

### Task 8: Deploy 노드

- [ ] `apps/server/src/db/deployments.ts` — 테이블 생성 + CRUD
- [ ] `apps/server/src/lib/deploy.ts` — `deployToVercel()`, `deployToCloudflare()` 구현
- [ ] `apps/server/src/routes/deploy.ts` — API 구현
- [ ] `packages/workflow-engine/src/nodes/deploy.ts` — DeployNode 구현
- [ ] Settings 페이지에 Deploy config 섹션 추가
- [ ] NodeConfigPanel에 DeployNode 설정 패널 추가
- [ ] `apps/desktop/src/pages/Deployments.tsx` 구현
- [ ] Sidebar에 "Deployments" 메뉴 추가
- [ ] `pnpm typecheck` 통과

---

### Task 9: MCP OAuth 2.0

- [ ] `apps/server/src/routes/mcp.ts`에 OAuth endpoint 추가 (start, callback, refresh, revoke, status)
- [ ] PKCE (S256) + state 검증 구현
- [ ] token 파일 `~/.config/neos-work/mcp-tokens/<serverId>.json` 저장
- [ ] agent spawn context에 MCP token 주입 (`apps/server/src/lib/cli-agents.ts`)
- [ ] Settings MCP 섹션에 OAuth status badge + Connect/Disconnect 버튼
- [ ] `pnpm typecheck` 통과

---

### Task 10: ZIP 내보내기/가져오기

- [ ] `apps/server/src/routes/workflows.ts`에 export/import endpoint 추가
  - `GET /api/workflows/:id/export` → ZIP 스트림
  - `POST /api/workflows/import` → multipart
- [ ] ZIP 생성: `archiver` 패키지 사용 (`pnpm add archiver @types/archiver --filter @neos-work/server`)
- [ ] ZIP 추출: `unzipper` 패키지 사용 (`pnpm add unzipper @types/unzipper --filter @neos-work/server`)
- [ ] Claude Design ZIP import: HTML 파일 감지 → artifact 저장
- [ ] Workflows 페이지: "Import" 버튼
- [ ] WorkflowEditor 툴바: "Export" 버튼
- [ ] `pnpm typecheck` 통과

---

### Task 11: 병렬 브랜치 & OR 게이트

- [ ] `packages/workflow-engine/src/types.ts`에 `parallel-start`, `parallel-end`, `or-gate` 노드 타입 추가
- [ ] `packages/workflow-engine/src/executor.ts` 개선
  - ready 노드 그룹 분리 (sequential vs parallel)
  - `parallel-start` → `Promise.all` 분기 실행
  - `parallel-end` → all 브랜치 완료 대기
  - `or-gate` → `Promise.race` + 나머지 AbortController 취소
- [ ] `packages/workflow-engine/src/executor.test.ts`에 병렬 실행 테스트 추가
- [ ] NodeConfigPanel에 parallel 노드 설정 패널 추가
- [ ] `pnpm test` 통과

---

### Task 12: 코딩 도메인 내장 블록

- [ ] `packages/workflow-engine/src/blocks/coding.ts` 구현
  - `code_eval` (Node.js vm sandbox, 5초 타임아웃)
  - `file_read` (path 검증)
  - `file_write` (workspaces/ 하위만 허용)
  - `git_diff` (spawn git)
  - `test_runner` (명령어 allowlist)
- [ ] `packages/workflow-engine/src/blocks/index.ts`에 CODING_BLOCKS 등록
- [ ] 단위 테스트 추가
- [ ] `pnpm test` 통과

---

### Task 13: Webhook 트리거

- [ ] `apps/server/src/db/workflows.ts`에 `webhook_secret` 컬럼 추가 + migration
- [ ] `apps/server/src/routes/webhooks.ts` — HMAC 검증 + 워크플로우 실행 트리거
- [ ] rate limit 미들웨어 추가 (60req/60s per workflowId)
- [ ] WorkflowEditor Config 탭에 Webhook 섹션 추가 (URL 표시, Secret 표시/재생성)
- [ ] `pnpm typecheck` 통과

---

### Task 14: 에이전트 스트리밍 진행상황

- [ ] `packages/shared/src/types/index.ts`에 `node.progress` 이벤트 타입 추가
- [ ] `packages/workflow-engine/src/nodes/agent.ts` — streaming call + chunk마다 `node.progress` 발행
  - Anthropic: `streamMessage` (SDK stream API)
  - OpenAI: stream mode `true`
  - Ollama: stream mode `true`
- [ ] `apps/desktop/src/components/workflow/RunLogPanel.tsx` — `node.progress` 누적 표시
  - 같은 nodeId의 progress chunk를 하나의 블록으로 누적
  - auto-scroll
- [ ] `pnpm typecheck` 통과

---

### Task 15: 노드 자동 레이아웃

- [ ] `pnpm add @dagrejs/dagre @types/dagre --filter @neos-work/desktop`
- [ ] `apps/desktop/src/lib/layout.ts` — `autoLayout(nodes, edges, direction)` 구현
- [ ] WorkflowEditor 툴바에 "Auto Layout" 버튼 추가
- [ ] 버튼 클릭 → `autoLayout` → `setNodes` → `fitView()`
- [ ] `pnpm typecheck` 통과

---

### Task 16: 워크플로우 버전 이력

- [ ] `apps/server/src/db/workflow-revisions.ts` — 테이블 생성 + CRUD + 50개 제한 GC
- [ ] `apps/server/src/routes/workflow-revisions.ts` — API 구현
- [ ] `PUT /api/workflows/:id` 저장 시 자동 스냅샷 (`apps/server/src/routes/workflows.ts` 수정)
- [ ] `apps/desktop/src/components/workflow/RevisionPanel.tsx` — 슬라이드인 이력 패널
- [ ] WorkflowEditor 툴바에 "History" 버튼 추가
- [ ] 복원 시 dirty state 경고 (useBlocker 재사용)
- [ ] `pnpm typecheck` 통과

---

## 6. 의존성 추가 목록

```bash
# 서버
pnpm add node-cron @types/node-cron --filter @neos-work/server
pnpm add archiver @types/archiver --filter @neos-work/server
pnpm add unzipper @types/unzipper --filter @neos-work/server

# 데스크탑
pnpm add @dagrejs/dagre --filter @neos-work/desktop
```

---

## 7. 검증 기준

### Part A — Open Design 이식

| 항목 | 검증 방법 |
|---|---|
| Design Context 주입 | `~/.config/neos-work/design-systems/test/DESIGN.md` 생성 → 워크플로우에 연결 → 실행 → 시스템 프롬프트에 DESIGN.md 내용 포함 확인 |
| Routine 스케줄 | 1분 뒤 실행되는 routine 생성 → 1분 후 `routine_runs` 테이블에 성공 레코드 |
| Routine 수동 실행 | "Run Now" 클릭 → 즉시 워크플로우 실행 |
| CLI 감지 | Claude Code 설치된 환경에서 Settings → "claude" 감지 표시 |
| CLI spawn | NodeConfigPanel에서 `cli-claude` 선택 → 에이전트 노드 실행 → Run Log에 실시간 출력 |
| Artifact Preview | HTML 생성 에이전트 노드 실행 → "Preview" 탭에서 iframe 렌더링 |
| Plugin 실행 | `open-design.json`이 있는 skill → Plugins 페이지에 Plugin 배지 → "Run" 클릭 → 4-stage pipeline 진행 |
| GenUI form | pipeline stage `humanInLoop: true`, `surface: 'form'` → 폼 렌더링 → 제출 → 다음 stage 진행 |
| Media 이미지 생성 | MediaNode에 DALL-E 설정, OpenAI key 있음 → 실행 → `~/.config/neos-work/workspaces/<runId>/output.png` 생성 |
| Deploy | DeployNode에 Vercel token 설정 → 실행 → 배포 URL 반환 |
| MCP OAuth | Settings MCP 섹션 → "Connect" → 브라우저 열림 → 승인 → status badge "Connected" |
| ZIP Export | 워크플로우 Export → ZIP 다운로드 → 다른 인스턴스에서 Import → 동일 워크플로우 로드 |

### Part B — neos-work 자체 개선

| 항목 | 검증 방법 |
|---|---|
| 병렬 브랜치 | `parallel-start` → 2개 AgentNode → `parallel-end` 워크플로우 실행 → 두 노드가 동시에 `running` 상태 |
| OR 게이트 | `parallel-start` → 2개 AgentNode → `or-gate` → 첫 번째 완료 노드 output이 채택됨 |
| `code_eval` 블록 | JS 코드 `return 1+1` → output `2` |
| `file_read` 블록 | 존재하는 파일 경로 → 파일 내용 반환 |
| Webhook 트리거 | `curl -X POST -H "X-Neos-Signature: sha256=..." http://localhost:3001/api/webhook/<id>` → 워크플로우 실행 |
| Webhook HMAC 검증 실패 | 잘못된 signature → 401 |
| 스트리밍 진행상황 | AgentNode 실행 중 Run Log에 LLM 텍스트 실시간 누적 표시 |
| 자동 레이아웃 | 노드가 겹친 상태에서 "Auto Layout" → 계층적 정렬 |
| 버전 이력 | 저장 3회 → History 패널 열면 3개 revision → 특정 revision Restore → 해당 snapshot으로 복원 |

### 공통 검증

| 항목 | 검증 방법 |
|---|---|
| 타입체크 | `pnpm typecheck` — 0 type errors |
| 테스트 | `pnpm test` — 모든 테스트 통과 |
| 빌드 | `pnpm build` — successful |

---

## 8. 구현 권장 순서

기능 간 의존성을 고려한 권장 순서:

```
Task 14 (스트리밍) → Task 3 (CLI spawn)  ← 둘 다 agent.ts 수정 → 한 번에
Task 11 (병렬 브랜치) → Task 12 (코딩 블록) ← executor 먼저
Task 1 (Design Context) → Task 5 (Plugin) ← context 주입 공통 패턴
Task 4 (Artifact Preview) → Task 7 (Media) ← artifact 저장 공통 패턴
Task 2 (Routine) 독립
Task 6 (GenUI) → Task 5 (Plugin) 이후
Task 8 (Deploy) 독립
Task 9 (MCP OAuth) 독립
Task 10 (ZIP) 독립
Task 13 (Webhook) 독립
Task 15 (자동 레이아웃) 독립
Task 16 (버전 이력) 독립
```

**최적 순서 (병렬 가능 그룹)**:

| 라운드 | Tasks |
|---|---|
| 1 | Task 11 + Task 13 + Task 15 + Task 16 (독립 기반 개선) |
| 2 | Task 14 + Task 3 (agent.ts 동시 수정) |
| 3 | Task 1 + Task 4 (서버 lib 패턴 공유) |
| 4 | Task 5 + Task 6 (Plugin + GenUI) |
| 5 | Task 7 + Task 8 (Media + Deploy) |
| 6 | Task 2 + Task 9 + Task 10 + Task 12 (나머지) |
