# NEOS Work — 초기 개발 계획서

> **라이선스**: MIT
> **최종 업데이트**: 2026-02-08

## 1. 프로젝트 개요

**NEOS Work**는 Claude Cowork의 오픈소스 대체제로, 사용자가 설정한 목표(Outcome)를 달성하기 위해 AI 에이전트가 자율적으로 다단계 작업을 수행하는 데스크탑 애플리케이션입니다.

### 핵심 원칙

- **"Prompt to Done"** — 답변이 아닌 실제 결과물을 만들어내는 실행 중심
- **Desktop-first, Web-ready** — 데스크탑 앱이 주 타겟이되, 코드 재사용을 통해 웹 배포 가능
- **Open Architecture** — MCP, 플러그인, 스킬 등 확장 가능한 개방형 구조
- **OpenCode 호환** — OpenWork의 OpenPackage/스킬 포맷과 호환

---

## 2. 아키텍처 설계

### 2.1 전체 구조: Client-Server 분리

OpenWork의 Host/Client Mode 패턴을 참고하여, **엔진(Backend)과 UI(Frontend)를 완전히 분리**합니다.

```
┌─────────────────────────────────────────────────────────┐
│                    Desktop App (Tauri v2)                │
│  ┌───────────────────────┐  ┌────────────────────────┐  │
│  │     Frontend (React)  │  │   Local Engine Server   │  │
│  │     - Chat UI         │◄─┤   (Node.js/Hono)       │  │
│  │     - Session Mgmt    │  │   - Agent Orchestrator  │  │
│  │     - File Browser    │  │   - Claude API Client   │  │
│  │     - Settings        │  │   - File Operations     │  │
│  │     - Skills Mgmt     │  │   - MCP Client          │  │
│  └───────────────────────┘  │   - Browser Automation  │  │
│           ▲                 └────────────────────────┘  │
│           │ WebSocket / HTTP                             │
│           ▼                                              │
│  ┌───────────────────────┐                               │
│  │   System Webview      │                               │
│  └───────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
```

### 2.2 왜 이 구조인가

| 결정 | 이유 |
|------|------|
| **엔진/UI 분리** | 동일한 UI를 데스크탑과 웹에서 재사용. 엔진은 로컬 또는 원격에서 실행 가능 |
| **SSE/WebSocket 통신** | 에이전트 실행 중 실시간 스트리밍(중간 단계, 생각 과정)에 필수. OpenCode SDK와 호환을 위해 SSE 우선 |
| **Monorepo** | 공유 타입, 컴포넌트, 로직을 패키지로 분리하여 중복 제거 |

### 2.3 배포 모드

- **Host Mode** — 데스크탑 앱이 로컬에서 엔진 서버를 자동 기동. 모든 작업이 로컬에서 실행.
- **Client Mode** — 원격 엔진 서버에 연결. 다른 머신의 리소스 활용.
- **Web Mode** (향후) — 클라우드 엔진 서버에 연결하는 웹 프론트엔드.

---

## 3. 기술 스택

### 3.1 핵심 기술 선택

| 영역 | 기술 | 선택 이유 |
|------|------|-----------|
| **언어** | TypeScript | 프론트엔드/백엔드 통일, 타입 안정성, Claude SDK 호환 |
| **데스크탑 셸** | Tauri v2 | 시스템 웹뷰 사용(작은 번들), Rust 기반 보안, 크로스 플랫폼 |
| **프론트엔드** | React 19 + Vite | 생태계, 성능, Tauri와 공식 통합 지원 |
| **스타일링** | TailwindCSS v4 + shadcn/ui | 빠른 UI 개발, 다크 테마 기본 지원, 커스텀 디자인 시스템 |
| **백엔드 서버** | Hono (Node.js) | 경량, 빠름, Web Standards 기반, 다양한 런타임 호환 |
| **실시간 통신** | SSE (+ WebSocket 보조) | 에이전트 실행 중 스트리밍 업데이트, OpenCode SDK 호환 |
| **로컬 DB** | SQLite (better-sqlite3) | 세션/대화 이력 저장, 서버 불필요, 성능 우수 |
| **AI SDK** | Anthropic SDK + Google AI SDK | Claude & Gemini 공식 클라이언트 |
| **i18n** | i18next + react-i18next | 업계 표준, React 통합 우수, 다국어 지원 |
| **브라우저 자동화** | Playwright | 웹 데이터 수집, 페이지 조작 |
| **MCP 클라이언트** | @modelcontextprotocol/sdk | MCP 프로토콜 공식 SDK |
| **Monorepo** | pnpm workspaces + Turborepo | 빠른 빌드, 의존성 관리, 캐싱 |

### 3.2 Tauri v2 선택 근거 (vs Electron)

| 비교 항목 | Tauri v2 | Electron |
|-----------|----------|----------|
| 번들 크기 | ~10-15MB | ~150MB+ |
| 메모리 사용 | 낮음 (시스템 웹뷰) | 높음 (Chromium 내장) |
| 보안 | Rust 기반, 샌드박싱 | Node.js 직접 노출 |
| Node.js 통합 | Sidecar로 별도 프로세스 | 네이티브 통합 |
| 크로스 플랫폼 | macOS, Windows, Linux, iOS, Android | macOS, Windows, Linux |

> **트레이드오프**: Tauri는 Node.js를 Sidecar로 실행해야 하므로 초기 설정이 다소 복잡합니다.
> 하지만 엔진 서버가 이미 독립 프로세스로 설계되어 있으므로, Sidecar 패턴이 자연스럽게 맞습니다.
> 엔진 서버를 Tauri가 시작/종료하는 구조로, Host Mode의 "로컬 엔진 자동 기동"과 동일합니다.

### 3.3 백엔드 프레임워크: Hono 선택 근거

- **Web Standards 기반**: Fetch API, Request/Response 객체 사용 → 어떤 런타임에서든 실행 가능
- **Lightweight**: Express 대비 훨씬 가볍고 빠름
- **Multi-runtime**: Node.js, Bun, Deno, Cloudflare Workers 등에서 동일 코드 실행
- **향후 웹 배포 시** Cloudflare Workers나 Vercel Edge Functions에 쉽게 배포 가능

---

## 4. 프로젝트 구조 (Monorepo)

```
neos-work/
├── apps/
│   ├── desktop/                 # Tauri v2 데스크탑 셸
│   │   ├── src-tauri/           #   Rust 코드 (Tauri 설정, 시스템 API)
│   │   ├── src/                 #   React 진입점 (apps/web과 공유 컴포넌트 사용)
│   │   └── tauri.conf.json
│   │
│   ├── server/                  # 엔진 서버 (Hono + Node.js)
│   │   ├── src/
│   │   │   ├── routes/          #   API 라우트
│   │   │   ├── agent/           #   에이전트 오케스트레이터
│   │   │   ├── tools/           #   파일 ops, 브라우저, MCP 등
│   │   │   ├── session/         #   세션/대화 관리
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── web/                     # (향후) 웹 프론트엔드
│       └── ...
│
├── packages/
│   ├── ui/                      # 공유 React 컴포넌트 (디자인 시스템)
│   │   ├── src/
│   │   │   ├── components/      #   Button, Input, Card, Modal, ...
│   │   │   ├── layouts/         #   Sidebar, MainLayout, ChatLayout
│   │   │   └── theme/           #   다크/라이트 테마 설정
│   │   └── package.json
│   │
│   ├── core/                    # 핵심 비즈니스 로직
│   │   ├── src/
│   │   │   ├── agent/           #   에이전트 실행 엔진, 태스크 플래너
│   │   │   ├── llm/             #   LLM 프로바이더 추상화 (Claude, 향후 확장)
│   │   │   ├── tools/           #   도구 정의 (파일, 브라우저, MCP)
│   │   │   └── types/           #   공유 타입 정의
│   │   └── package.json
│   │
│   ├── mcp-client/              # MCP 프로토콜 클라이언트
│   │   └── package.json
│   │
│   └── shared/                  # 공유 유틸리티, 상수, 타입
│       └── package.json
│
├── docs/                        # 문서
├── screenshots/                 # 참조 스크린샷
├── turbo.json                   # Turborepo 설정
├── pnpm-workspace.yaml          # pnpm 워크스페이스 설정
├── package.json                 # 루트 package.json
└── tsconfig.base.json           # 공유 TypeScript 설정
```

---

## 5. 핵심 기능 설계

### 5.1 모드 선택 (Mode Selection)

```
[시작 화면]
├── Host Mode  → 로컬 엔진 서버 자동 기동 → 메인 화면으로 이동
└── Client Mode → 원격 서버 주소 입력 → 연결 후 메인 화면으로 이동
```

- Host Mode: Tauri가 엔진 서버를 Sidecar로 시작, `127.0.0.1:{PORT}`에서 실행
- Client Mode: 사용자가 입력한 원격 주소로 HTTP/SSE 연결

### 5.2 세션 & 워크스페이스 관리

- **워크스페이스**: 로컬 폴더 경로와 연결된 작업 공간 (Local/Remote 구분)
- **세션**: 워크스페이스 내의 개별 대화/작업 단위
- **저장**: SQLite에 세션 메타데이터, 대화 이력, 에이전트 실행 로그 저장

### 5.3 채팅 & 에이전트 실행

```
[사용자 메시지] → [에이전트 오케스트레이터]
                        │
                        ├── 태스크 분해 (Planning)
                        ├── 도구 선택 & 실행
                        │   ├── 파일 시스템 도구
                        │   ├── 브라우저 자동화 도구
                        │   ├── MCP 도구
                        │   └── Native Skills (PPT, Word 등)
                        ├── 중간 결과 스트리밍 (SSE)
                        └── 최종 결과 반환
```

- 실시간 스트리밍: 에이전트의 "생각 과정", 도구 사용 단계, 중간 결과를 SSE로 전송
- 도구 실행 단계를 접을 수 있는 UI ("Hide steps" / "Show steps")
- Thinking 모드 표시 ("THINKING: Gathering thoughts")

### 5.4 스킬 & 플러그인 시스템

- **설치**: 원격 패키지 저장소(GitHub 등)에서 스킬 설치
- **로컬 임포트**: `.opencode/skill` 디렉토리에서 로컬 스킬 로드
- **관리**: 설치된 스킬 목록 조회, 활성화/비활성화

### 5.5 파일 시스템 작업

- 사용자가 허용한 폴더에 대한 명시적 권한 부여 (보안)
- 파일 읽기/쓰기/생성/삭제/이름 변경
- 대량 파일 처리 (분류, 일괄 변환 등)

### 5.6 브라우저 자동화

- Playwright 기반 웹 페이지 접근
- 스크린샷 캡처, DOM 스냅샷
- 데이터 수집, 폼 입력, 네비게이션

---

## 6. 개발 로드맵 (Phase별)

### Phase 0: 프로젝트 기반 구축

- [ ] Monorepo 설정 (pnpm + Turborepo)
- [ ] TypeScript 공통 설정
- [ ] ESLint / Prettier 설정
- [ ] Tauri v2 프로젝트 초기화
- [ ] 엔진 서버 초기화 (Hono)
- [ ] CI/CD 기본 설정 (GitHub Actions)

### Phase 1: 셸 & 기본 UI

- [ ] 모드 선택 화면 (Host / Client)
- [ ] 메인 레이아웃 (사이드바 + 콘텐츠 영역)
- [ ] 다크 테마 기본 적용
- [ ] 라우팅 (Dashboard, Sessions, Settings)
- [ ] 엔진 서버 연결/해제 관리
- [ ] Host Mode: Tauri Sidecar로 서버 자동 기동

### Phase 2: 세션 & 채팅 코어

- [ ] 워크스페이스 CRUD
- [ ] 세션 생성/목록/삭제
- [ ] 채팅 인터페이스 (메시지 입력/표시)
- [ ] LLM 프로바이더 추상화 계층 구현
- [ ] Claude API 연결 (Anthropic SDK)
- [ ] Gemini API 연결 (Google AI SDK)
- [ ] 메시지 스트리밍 (SSE)
- [ ] 모델 선택 UI (프로바이더/모델 드롭다운)
- [ ] SQLite 세션 저장
- [ ] i18n 기반 구축 (i18next + 한국어/영어)

### Phase 3: 에이전트 실행 엔진

- [ ] 에이전트 오케스트레이터 구현
- [ ] 태스크 플래닝 (자동 하위 단계 생성)
- [ ] 도구 실행 프레임워크
- [ ] 파일 시스템 도구 구현
- [ ] 실행 단계 표시 UI (접기/펼치기)
- [ ] Thinking 상태 표시

### Phase 4: 브라우저 & MCP

- [ ] Playwright 통합 (브라우저 자동화)
- [ ] 브라우저 스크린샷/스냅샷 캡처
- [ ] MCP 클라이언트 구현
- [ ] MCP 서버 연결 관리 UI

### Phase 5: 스킬 & 확장

- [ ] OpenCode 호환 SKILL.md 파서 구현
- [ ] 스킬 디스커버리 (프로젝트/글로벌 경로 탐색)
- [ ] OpenPackage (opkg) 설치 통합
- [ ] 스킬 설치/관리 UI
- [ ] 로컬 스킬 임포트
- [ ] Native Skills: 문서 생성 (PPT, Word, Excel)
- [ ] 템플릿 시스템

### Phase 6: 안정화 & 배포

- [ ] 에러 처리 & 복구 (Self-healing)
- [ ] 보안 감사 (폴더 권한, 네트워크)
- [ ] 성능 최적화
- [ ] macOS / Windows / Linux 빌드 테스트
- [ ] 자동 업데이트 시스템
- [ ] 사용자 문서 작성

---

## 7. API 설계 (서버 ↔ 클라이언트)

### REST API

```
POST   /api/session              # 세션 생성
GET    /api/session              # 세션 목록
GET    /api/session/:id          # 세션 상세
DELETE /api/session/:id          # 세션 삭제

POST   /api/workspace            # 워크스페이스 생성
GET    /api/workspace            # 워크스페이스 목록
PUT    /api/workspace/:id        # 워크스페이스 수정
DELETE /api/workspace/:id        # 워크스페이스 삭제

GET    /api/skill                # 설치된 스킬 목록
POST   /api/skill/install        # 스킬 설치
DELETE /api/skill/:id            # 스킬 삭제

GET    /api/settings             # 설정 조회
PUT    /api/settings             # 설정 업데이트

GET    /api/health               # 서버 상태 확인
```

### SSE (Server-Sent Events) 스트리밍

OpenCode SDK와의 호환성을 위해 SSE를 기본 스트리밍 방식으로 사용합니다.

```
# SSE 구독 엔드포인트
GET /api/session/:id/events    # 세션 이벤트 스트림 구독

# SSE 이벤트 타입 (Server → Client)
event: message.chunk           # AI 응답 청크 (스트리밍)
event: message.complete        # AI 응답 완료
event: agent.step              # 에이전트 실행 단계 업데이트
event: agent.thinking          # 에이전트 사고 과정
event: agent.tool_use          # 도구 사용 알림
event: agent.tool_result       # 도구 실행 결과
event: agent.error             # 에이전트 에러
event: session.status          # 세션 상태 변경

# Client → Server (REST)
POST /api/session/:id/message  # 메시지 전송
POST /api/session/:id/cancel   # 실행 중단
```

---

## 8. 데이터 모델

```sql
-- 워크스페이스
CREATE TABLE workspace (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT,              -- 로컬 폴더 경로
  type        TEXT NOT NULL,     -- 'local' | 'remote'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 세션
CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  title         TEXT,
  provider      TEXT DEFAULT 'anthropic',  -- 'anthropic' | 'google'
  model         TEXT DEFAULT 'claude-opus-4-6',
  thinking_mode TEXT DEFAULT 'medium',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 메시지
CREATE TABLE message (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id),
  role        TEXT NOT NULL,     -- 'user' | 'assistant' | 'system'
  content     TEXT NOT NULL,
  metadata    TEXT,              -- JSON (도구 사용 정보, 파일 참조 등)
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 에이전트 실행 단계
CREATE TABLE agent_step (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES message(id),
  tool_name   TEXT NOT NULL,
  input       TEXT,              -- JSON
  output      TEXT,              -- JSON
  status      TEXT NOT NULL,     -- 'running' | 'completed' | 'error'
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 설치된 스킬
CREATE TABLE skill (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,     -- 패키지 소스 URL
  version     TEXT,
  config      TEXT,              -- JSON
  installed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 설정
CREATE TABLE setting (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL       -- JSON
);
```

---

## 9. 보안 고려사항

### 9.1 파일 시스템 접근 제어
- 사용자가 명시적으로 허용한 폴더에 대해서만 접근 가능 (Tauri의 scope 기능 활용)
- 허용된 경로 외부로의 접근 시도는 차단 및 로깅

### 9.2 API 키 관리
- Anthropic / Google AI API 키는 시스템 키체인에 저장 (Tauri의 keychain 플러그인)
- 평문으로 설정 파일에 저장하지 않음
- 각 프로바이더별 독립적인 키 관리

### 9.3 엔진 서버 보안
- Host Mode: 로컬호스트(127.0.0.1)에서만 바인드
- Client Mode: TLS 연결 필수, 인증 토큰 사용
- 모든 API 요청에 인증 미들웨어 적용

### 9.4 MCP 서버 보안
- MCP 서버 연결 시 사용자 명시적 승인 필요
- 도구 실행 전 권한 확인

---

## 10. LLM 프로바이더 (Claude + Gemini)

초기부터 **Claude(Anthropic)와 Gemini(Google)**를 지원하며, 프로바이더 추상화를 통해 향후 확장 가능하도록 설계합니다.

### 10.1 프로바이더 인터페이스

```typescript
interface LLMProvider {
  id: string;                    // 'anthropic' | 'google'
  name: string;                  // 'Anthropic' | 'Google AI'
  models: Model[];
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  countTokens(messages: Message[]): Promise<number>;
}

interface Model {
  id: string;                    // 'claude-opus-4-6', 'gemini-2.0-flash' 등
  name: string;
  contextWindow: number;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
}
```

### 10.2 지원 모델 (초기)

| 프로바이더 | 모델 | 용도 |
|-----------|------|------|
| **Anthropic** | Claude Opus 4.6 | 고급 추론, 복잡한 에이전트 작업 |
| **Anthropic** | Claude Sonnet 4.5 | 일반 대화, 빠른 응답 |
| **Anthropic** | Claude Haiku 4.5 | 경량 작업, 분류, 요약 |
| **Google** | Gemini 2.0 Flash | 빠른 응답, 멀티모달 |
| **Google** | Gemini 2.0 Pro | 고급 추론 |

### 10.3 인증 방식

**API 키 직접 입력** 방식을 채택합니다 (향후 OAuth 추가 가능).

- 설정 화면에서 각 프로바이더별 API 키 입력
- API 키는 **시스템 키체인**에 암호화 저장 (Tauri keychain 플러그인)
- 평문 설정 파일에 저장하지 않음
- API 키 유효성 검증 후 저장

```
[Settings > API Keys]
├── Anthropic API Key: sk-ant-...  [Verify] [Save]
└── Google AI API Key: AIza...     [Verify] [Save]
```

---

## 11. 스킬 & 플러그인 포맷 (OpenCode 호환)

OpenWork/OpenCode의 스킬 포맷과 **호환**되도록 설계합니다. 이를 통해 기존 OpenCode 생태계의 스킬을 NEOS Work에서도 바로 사용할 수 있습니다.

### 11.1 SKILL.md 포맷

각 스킬은 디렉토리 안에 `SKILL.md` 파일로 정의됩니다.

```yaml
---
name: git-release
description: "Create consistent releases and changelogs following semantic versioning"
license: MIT
compatibility: opencode
metadata:
  version: "1.0.0"
  author: "neos-ai"
  audience: maintainers
---

# Git Release Skill

이 스킬은 일관된 릴리즈와 체인지로그를 생성합니다.

## 사용법
...
```

**필수 필드:**
- `name`: 1-64자, 소문자 영숫자 + 하이픈 (`^[a-z0-9]+(-[a-z0-9]+)*$`), 디렉토리 이름과 일치
- `description`: 20-1024자, 스킬 목적 및 사용 시점 설명

**선택 필드:**
- `license`: 라이선스 식별자 (기본: MIT)
- `compatibility`: 호환성 선언 (`opencode`, `neos-work`)
- `metadata`: 추가 키-값 메타데이터 (version, author 등)

### 11.2 스킬 디렉토리 구조

```
.neos-work/skills/<skill-name>/
├── SKILL.md          # 필수: 스킬 정의 (YAML frontmatter + 마크다운 지침)
├── scripts/          # 선택: 실행 가능한 스크립트
├── references/       # 선택: 참조 문서
└── assets/           # 선택: 출력에 사용되는 파일
```

### 11.3 스킬 디스커버리 경로 (우선순위 순)

```
1. .neos-work/skills/<name>/SKILL.md     (프로젝트 로컬)
2. ~/.config/neos-work/skills/<name>/     (글로벌)
3. .opencode/skills/<name>/SKILL.md      (OpenCode 호환 - 프로젝트)
4. ~/.config/opencode/skills/<name>/     (OpenCode 호환 - 글로벌)
```

### 11.4 스킬 설치 & 관리

```
# OpenPackage를 통한 설치 (OpenCode 호환)
npx opkg install <package-name>

# GitHub 저장소에서 직접 설치
neos-work skill install github:<owner>/<repo>

# 로컬 스킬 임포트
neos-work skill import ./path/to/skill
```

---

## 12. 다국어 지원 (i18n)

초기부터 **한국어/영어** 다국어를 지원하며, i18next를 사용합니다.

### 12.1 기술 구성

- **i18next**: 핵심 i18n 프레임워크
- **react-i18next**: React 통합 (useTranslation 훅, Trans 컴포넌트)
- **i18next-browser-languagedetector**: 시스템 언어 자동 감지

### 12.2 번역 파일 구조

```
packages/ui/src/i18n/
├── index.ts              # i18next 초기화 설정
└── locales/
    ├── en/
    │   ├── common.json   # 공통 UI 텍스트
    │   ├── chat.json     # 채팅 관련
    │   ├── settings.json # 설정 관련
    │   └── skills.json   # 스킬 관련
    └── ko/
        ├── common.json
        ├── chat.json
        ├── settings.json
        └── skills.json
```

### 12.3 사용 패턴

```typescript
// 컴포넌트에서 사용
const { t } = useTranslation('chat');
return <h1>{t('title')}</h1>;

// Namespace 기반 분리
// chat.json: { "title": "Ask NEOS Work...", "send": "Send" }
// chat.json (ko): { "title": "NEOS Work에게 질문하기...", "send": "전송" }
```

### 12.4 지원 언어 (로드맵)

| 우선순위 | 언어 | 코드 |
|---------|------|------|
| 1 | 영어 | `en` |
| 2 | 한국어 | `ko` |
| 향후 | 일본어, 중국어 등 | `ja`, `zh` |

---

## 13. 참고 리소스

- [Tauri v2 공식 문서](https://v2.tauri.app/)
- [Hono 공식 문서](https://hono.dev/)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Google AI TypeScript SDK](https://github.com/google-gemini/generative-ai-js)
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [shadcn/ui](https://ui.shadcn.com/)
- [Turborepo](https://turbo.build/repo)
- [Playwright](https://playwright.dev/)
- [i18next](https://www.i18next.com/)
- [OpenWork (참조 구현)](https://github.com/different-ai/openwork)
- [OpenCode Skills 문서](https://opencode.ai/docs/skills/)

---

## 14. 확정된 결정사항

| 항목 | 결정 | 비고 |
|------|------|------|
| **LLM 프로바이더** | Claude (Anthropic) + Gemini (Google) | 프로바이더 추상화로 향후 확장 가능 |
| **인증 방식** | API 키 직접 입력 | 시스템 키체인 저장, 향후 OAuth 추가 가능 |
| **스킬 포맷** | OpenCode/OpenPackage 호환 | SKILL.md + YAML frontmatter |
| **라이선스** | MIT | |
| **다국어** | i18next 기반, 한국어/영어 초기 지원 | |
| **데스크탑 프레임워크** | Tauri v2 | OpenWork도 동일 스택 사용 확인 |
| **프론트엔드** | React 19 + Vite + TailwindCSS | |
| **백엔드** | Hono (Node.js) | |
| **실시간 통신** | SSE (Server-Sent Events) 우선, WebSocket 보조 | OpenWork가 SSE 사용 확인 |
| **Monorepo** | pnpm workspaces + Turborepo | OpenWork도 pnpm workspaces 사용 |
