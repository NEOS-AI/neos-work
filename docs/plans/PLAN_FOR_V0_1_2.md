# NEOS Work v0.1.2 — 기능 확장 계획

> **기준 버전**: v0.1.1
> **작성일**: 2026-03-18
> **참고 자료**: [OpenClaw GitHub](https://github.com/openclaw/openclaw), [docs/reference/openclaw.md](./reference/openclaw.md), [docs/implementation/v0.1.1.md](./implementation/v0.1.1.md)

---

## 1. OpenClaw 분석 요약

OpenClaw는 "personal AI orchestration OS"다. 단순 챗앱이 아니라 **Gateway WebSocket 제어 평면**을 중심으로 채널·에이전트·툴·디바이스를 통합 관리하는 self-hosted 플랫폼이다.

### 1.1 핵심 기능 목록

| 영역 | OpenClaw 기능 |
|------|-------------|
| **채널** | WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Matrix 등 20+ |
| **에이전트** | Pi SDK 임베디드 실행, 서브에이전트 스폰, ReAct 루프, 모델 페일오버 |
| **툴** | browser control, canvas, cron, web-search, image-gen, memory, pdf, webhook, Gmail 등 |
| **스킬** | 52개 플러그인 — notion, obsidian, github, spotify, whisper, TTS, weather 등 |
| **Plugin SDK** | ChannelRuntime, AgentRuntime, ToolRuntime 등 173개 파일 |
| **메모리** | memory plugin (저장/검색) + context engine (모델 입력 조립) |
| **디바이스** | macOS menu bar, iOS/Android companion node |
| **음성** | Voice Wake(macOS/iOS), Talk Mode(Android), ElevenLabs + 시스템 TTS |
| **보안** | DM pairing 기본 정책, execution approval, allowlist, SSRF 방어 |
| **UI** | Vite + Lit 기반 Control UI, Live Canvas (A2UI) |

### 1.2 neos-work와 구조 비교

| 항목 | OpenClaw | neos-work (현재) |
|------|---------|----------------|
| 서버 계층 | Gateway (WS 제어 평면) + HTTP | Hono REST + SSE |
| 채널 | 20+ 메시징 채널 | 데스크탑 UI 단일 채널 |
| 에이전트 | 임베디드 Pi SDK, 서브에이전트 | AgentOrchestrator (API 미노출) |
| 툴 | browser, cron, search, memory 등 다수 | filesystem 3개 (read/write/list) |
| 스킬 | 52개 + ClawHub 마켓플레이스 | Skills 페이지만 있고 구현 없음 |
| 메모리 | 독립 memory plugin + context engine | 없음 (메시지 히스토리만) |
| 확장성 | Plugin SDK 계약 인터페이스 | LLMProviderAdapter + Tool 인터페이스 |
| 디바이스 | iOS/Android/macOS companion | Tauri 데스크탑 전용 |

---

## 2. v0.1.2 기능 로드맵

### Tier 1 — v0.1.1 이월 항목 완성 (최우선)

v0.1.1 Known Issues에 명시된 최고 우선도 항목. 에이전트 파이프라인이 core 패키지에만 존재하고 실제로 호출할 방법이 없다.

#### A5: 서버 에이전트 라우트

- **목적**: `AgentOrchestrator`를 HTTP SSE로 노출
- **엔드포인트**: `POST /api/session/:id/agent`
- **동작**: `AgentEvent` 스트림을 SSE로 전송, `agent_step` 테이블에 단계별 기록
- **수정 파일**:
  - `apps/server/src/routes/session.ts` — 라우트 추가
  - `apps/server/src/db/agent-steps.ts` — 기존 CRUD 활용
- **SSE 이벤트 형식**:
  ```
  event: plan
  data: { "steps": [...] }

  event: step_start
  data: { "step": { "id": "...", "description": "...", ... } }

  event: step_complete
  data: { "step": { ... } }

  event: text
  data: { "content": "..." }

  event: done
  data: { "task": { ... } }
  ```
- **취소**: 기존 `activeChats` Map 재활용 (`POST /api/session/:id/cancel` 동일)

#### A6: 에이전트 실행 UI

- **목적**: Sessions.tsx에서 AgentEvent 스트림을 시각적으로 표시
- **수정 파일**: `apps/desktop/src/pages/Sessions.tsx`, `apps/desktop/src/lib/engine.ts`
- **표시 요소**:
  - 플랜 단계 목록 (접기/펼치기)
  - 단계별 진행 상태 (pending → running → completed/error)
  - 툴 실행 입력/출력 인라인 표시
  - 최종 합성 응답

---

### Tier 2 — 툴 확장 (OpenClaw 스킬 → neos-work 툴화)

OpenClaw는 52개 스킬을 통해 에이전트 역량을 크게 확장한다. neos-work는 현재 filesystem 3개 툴만 있어 에이전트가 할 수 있는 일이 매우 제한적이다.

#### T1: Web Search Tool

- **OpenClaw 대응**: `web-search` 스킬
- **목적**: 에이전트가 최신 정보 검색 가능
- **구현 파일**: `packages/core/src/tools/web-search.ts` (신규)
- **인터페이스**:
  ```typescript
  // Tool: web_search
  // Input: { query: string; maxResults?: number }
  // Output: { results: { title, url, snippet }[] }
  ```
- **백엔드**: DuckDuckGo Instant Answer API (키 불필요) 또는 Brave Search API (키 선택)
- **보안**: SSRF 방어 — `localhost`, `10.x`, `172.16.x`, `192.168.x` 도메인 블록
- **설정**: `apps/server/src/db/settings.ts`에 `apiKey.brave` 선택적 추가

#### T2: Shell Execution Tool

- **OpenClaw 대응**: `bash-tools` + `tmux` 스킬
- **목적**: 에이전트가 시스템 명령 실행 (코드 빌드, 파일 변환, 데이터 처리 등)
- **구현 파일**: `packages/core/src/tools/shell.ts` (신규)
- **인터페이스**:
  ```typescript
  // Tool: run_command
  // Input: { command: string; cwd?: string; timeout?: number }
  // Output: { stdout: string; stderr: string; exitCode: number }
  ```
- **보안 제약**:
  - `cwd`는 workspace 루트 이내로 샌드박스
  - 타임아웃 기본 30초, 최대 120초
  - 금지 명령 패턴: `rm -rf /`, `sudo`, `chmod 777`, 네트워크 변경 명령 등
  - **Destructive 승인 필요**: `rm`, `mv`, `dd` 등 포함 시 기존 write_file과 동일한 confirm 플로우
- **수정 파일**: `apps/server/src/routes/session.ts` (destructive 툴 목록 확장)

#### T3: File Search Tool

- **OpenClaw 대응**: 파일 브라우저 + grep 기능
- **목적**: 에이전트가 workspace 내 파일 검색 (glob, 내용 검색)
- **구현 파일**: `packages/core/src/tools/filesystem.ts` 확장 (기존 파일에 추가)
- **신규 툴**:
  ```typescript
  // Tool: search_files
  // Input: { pattern: string; directory?: string; type?: 'glob' | 'content' }
  // Output: { matches: string[] }  // 파일 경로 목록 또는 매칭 라인

  // Tool: move_file
  // Input: { source: string; destination: string }
  // Output: { success: boolean }
  ```

---

### Tier 3 — MCP 클라이언트

- **OpenClaw 대응**: Plugin SDK (`packages/plugin-sdk/`, 173 파일)
- **목적**: Model Context Protocol을 통해 외부 서비스(DB, 파일시스템, API, GitHub 등)를 동적으로 툴로 등록

#### 구현 범위

**`packages/mcp-client/`** (신규 패키지):
```
packages/mcp-client/
├── src/
│   ├── client.ts        — MCP 서버 연결 (stdio / HTTP SSE 전송)
│   ├── discovery.ts     — 설정 파일에서 MCP 서버 목록 로드
│   ├── tool-bridge.ts   — MCP 툴 → ToolRegistry Tool 변환
│   └── index.ts
├── package.json
└── tsconfig.json
```

**DB 변경** (`apps/server/src/db/schema.ts`):
```sql
CREATE TABLE IF NOT EXISTS mcp_server (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  transport   TEXT NOT NULL,  -- 'stdio' | 'http'
  command     TEXT,           -- stdio: 실행 명령
  args        TEXT,           -- JSON array
  url         TEXT,           -- http: 서버 URL
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

**설정 UI** (`apps/desktop/src/pages/Settings.tsx`):
- MCP 서버 추가/제거/활성화 토글
- 연결 상태 표시 (connected / disconnected / error)
- 연결된 툴 목록 미리보기

**서버 통합** (`apps/server/src/routes/session.ts`):
- 채팅 시작 시 활성화된 MCP 서버의 툴을 ToolRegistry에 동적 등록

---

### Tier 4 — 메모리 시스템

- **OpenClaw 대응**: Memory plugin (저장/검색) + Context engine (모델 입력 조립)
- **목적**: 에이전트가 워크스페이스 수준의 영구 메모리를 갖도록 해 반복 작업 효율화

#### 구현 범위

**DB 변경** (`apps/server/src/db/schema.ts`):
```sql
CREATE TABLE IF NOT EXISTS memory (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,      -- 메모리 식별자 (사용자 지정 또는 자동)
  content      TEXT NOT NULL,      -- 기억 내용
  tags         TEXT,               -- JSON array (태그 기반 검색)
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idx_memory_workspace_id ON memory(workspace_id);
```

**메모리 툴** (`packages/core/src/tools/memory.ts` 신규):
```typescript
// Tool: remember
// Input: { key: string; content: string; tags?: string[] }
// Output: { success: boolean }

// Tool: recall
// Input: { query: string; tags?: string[]; limit?: number }
// Output: { memories: { key, content, tags }[] }

// Tool: forget
// Input: { key: string }
// Output: { success: boolean }
```

**컨텍스트 주입**: 에이전트 실행 시 워크스페이스 메모리 상위 N개를 시스템 프롬프트에 자동 포함

**DB CRUD** (`apps/server/src/db/memory.ts` 신규):
- `createMemory`, `getMemory`, `searchMemory`, `deleteMemory`, `listMemories`

---

### Tier 5 — 스킬 시스템

- **OpenClaw 대응**: 52개 스킬 + ClawHub 마켓플레이스
- **목적**: `apps/desktop/src/pages/Skills.tsx`가 현재 더미 상태 — 실제 스킬 로드/관리/실행 구현

#### 구현 범위

**스킬 파서** (`packages/core/src/skills/parser.ts` 신규):
- YAML frontmatter + 마크다운 본문 파싱
- 기존 `SkillManifest` 타입 활용 (`packages/shared/src/types/skill.ts`)

**스킬 디스커버리** (`packages/core/src/skills/discovery.ts` 신규):
- 경로 탐색: `{workspace}/.neos-work/skills/`, `~/.config/neos-work/skills/`
- `InstalledSkill[]` 반환

**API 엔드포인트** (`apps/server/src/routes/session.ts` 또는 신규 `skills.ts`):
- `GET /api/skills` — 설치된 스킬 목록
- `POST /api/skills/install` — URL 또는 로컬 경로에서 스킬 설치

**Skills UI** (`apps/desktop/src/pages/Skills.tsx`):
- 설치된 스킬 카드 목록
- 활성화/비활성화 토글
- 스킬 상세 (설명, 버전, 라이선스)

**DB 변경** (`apps/server/src/db/schema.ts`):
```sql
CREATE TABLE IF NOT EXISTS skill (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  source       TEXT NOT NULL,  -- 'local' | 'global'
  path         TEXT NOT NULL,
  version      TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT DEFAULT (datetime('now'))
);
```

---

## 3. OpenClaw 기능 중 v0.1.2 제외 항목

| OpenClaw 기능 | 제외 사유 |
|-------------|---------|
| 멀티채널 메시징 (WhatsApp/Telegram 등) | neos-work는 데스크탑 로컬 전용. 채널 추상화 레이어 전체를 추가해야 해 범위 초과 |
| iOS/Android 컴패니언 노드 | Tauri 데스크탑 앱 범위 외. 별도 모바일 앱 프로젝트 필요 |
| 음성 기능 (Voice Wake, Talk Mode) | 구현 복잡도 대비 우선순위 미해당 |
| DM pairing 보안 모델 | 외부 채널이 없는 로컬 전용 앱에서 불필요 |
| Live Canvas / A2UI | 복잡한 UI 워크스페이스 — 현재 단계에서 범위 초과 |
| Gateway WebSocket 제어 평면 | neos-work의 REST + SSE 모델이 현재 요구사항에 충분 |
| 실행 환경 Docker 샌드박싱 | Shell tool에 명령 필터링으로 대체 |

---

## 4. 아키텍처 영향 요약

### 신규 패키지

```
packages/
└── mcp-client/          # Tier 3 — MCP 클라이언트 (신규)
```

### 수정 파일

| 파일 | 변경 내용 | Tier |
|------|---------|------|
| `apps/server/src/routes/session.ts` | 에이전트 라우트, MCP 동적 등록 | 1, 3 |
| `apps/server/src/db/schema.ts` | `mcp_server`, `memory`, `skill` 테이블 추가 | 3, 4, 5 |
| `apps/desktop/src/pages/Sessions.tsx` | AgentEvent UI, 툴 실행 표시 | 1 |
| `apps/desktop/src/pages/Settings.tsx` | MCP 서버 관리 UI | 3 |
| `apps/desktop/src/pages/Skills.tsx` | 스킬 목록/관리 UI 구현 | 5 |
| `apps/desktop/src/lib/engine.ts` | 에이전트 라우트 호출 메서드 추가 | 1 |

### 신규 파일

| 파일 | 용도 | Tier |
|------|------|------|
| `packages/core/src/tools/web-search.ts` | Web search 툴 | 2 |
| `packages/core/src/tools/shell.ts` | Shell 실행 툴 | 2 |
| `packages/core/src/tools/memory.ts` | 메모리 툴 | 4 |
| `packages/core/src/skills/parser.ts` | SKILL.md 파서 | 5 |
| `packages/core/src/skills/discovery.ts` | 스킬 디스커버리 | 5 |
| `apps/server/src/db/memory.ts` | 메모리 CRUD | 4 |
| `packages/mcp-client/src/client.ts` | MCP 연결 클라이언트 | 3 |
| `packages/mcp-client/src/tool-bridge.ts` | MCP → ToolRegistry 변환 | 3 |

---

## 5. 검증 방법

| 항목 | 검증 방법 |
|------|---------|
| A5 에이전트 라우트 | `POST /api/session/:id/agent` 호출 후 SSE 스트림으로 plan → step_start → step_complete → done 이벤트 수신 확인 |
| A6 에이전트 UI | Sessions.tsx에서 에이전트 모드로 메시지 전송 시 단계 목록 및 진행 상태 표시 확인 |
| T1 Web Search | `web_search` 툴 실행 시 DuckDuckGo 결과 반환, localhost 도메인 블록 확인 |
| T2 Shell Exec | `run_command` 툴로 `echo hello` 실행, workspace 외 `cwd` 거부 확인 |
| T3 File Search | `search_files` 툴로 `*.md` glob 실행 후 결과 확인 |
| M1 MCP Client | `filesystem` MCP 서버 연결 후 툴 목록에 MCP 툴 동적 등록 확인 |
| Mem1 메모리 | `remember` 툴로 저장 → `recall` 툴로 검색 → `forget`으로 삭제 확인 |
| K1 스킬 파서 | 로컬 SKILL.md 파일 파싱 후 `SkillManifest` 타입 정확성 확인 |
