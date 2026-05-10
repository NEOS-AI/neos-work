# v0.1.4 구현 검증 계획 (Implementation Audit)

> **기준 버전**: v0.1.3
> **작성일**: 2026-05-10
> **목적**: v0.1.0 ~ v0.1.3 계획 문서(`docs/plans/`) vs 실제 구현(`docs/implementation/`) vs 현재 소스코드 3자 비교를 통해 누락·불일치·품질 문제를 발견하고 수정한다.

---

## 배경

v0.1.3까지 빠른 속도로 기능을 쌓아왔다. 각 버전 구현 후 `docs/implementation/` 문서에 설계 결정을 기록했지만, 실제 코드가 계획 문서와 100% 일치하는지, 엣지 케이스 처리가 적절한지, 타입 시스템이 일관적인지 등에 대한 **체계적 검증**을 거치지 않았다. v0.1.4는 신규 기능 없이 **감사(Audit) 전용 버전**으로, 코드베이스의 신뢰성을 높이는 데 집중한다.

---

## 검증 범위

| 레이어 | 대상 파일 | 기준 문서 |
|--------|-----------|-----------|
| **Core – Agent** | `packages/core/src/agent/` (4파일) | `PLAN_FOR_V0_1_1.md` § A1/A2, `PLAN_FOR_V0_1_3.md` § Task 3/4 |
| **Core – LLM** | `packages/core/src/llm/` (6파일) | `PLAN_FOR_V0_1_3.md` § Task 1 |
| **Core – Tools** | `packages/core/src/tools/` (5파일) | `PLAN_FOR_V0_1_2.md` § Tier 2 |
| **Core – Skills** | `packages/core/src/skills/` (3파일) | `PLAN_FOR_V0_1_2.md` § Tier 5 |
| **Browser Tool** | `packages/browser-tool/src/` (3파일) | `PLAN_FOR_V0_1_3.md` § Task 5/6 |
| **MCP Client** | `packages/mcp-client/src/` (3파일) | `PLAN_FOR_V0_1_2.md` § Tier 3 |
| **Server – Routes** | `apps/server/src/routes/session.ts` | `PLAN_FOR_V0_1_2.md` § Tier 1, `PLAN_FOR_V0_1_3.md` § Task 2/7 |
| **Server – DB** | `apps/server/src/db/` (6파일) | `PLAN_FOR_V0_1_1.md` § A3/S1 |
| **Desktop – Engine** | `apps/desktop/src/lib/engine.ts` | `PLAN_FOR_V0_1_3.md` § Task 8 |
| **Desktop – Pages** | `apps/desktop/src/pages/Sessions.tsx` | `PLAN_FOR_V0_1_3.md` § Task 9 |
| **Shared** | `packages/shared/src/` | 전 버전 계획 문서 |

---

## 검증 기준 (Checklist Template)

각 대상 파일에 대해 아래 5개 항목을 검토한다.

1. **존재 여부**: 계획 문서에 명시된 파일/클래스/함수가 실제로 존재하는가?
2. **인터페이스 일치**: 계획 문서에 명시된 타입·메서드 시그니처가 실제 코드와 동일한가?
3. **동작 일치**: 계획 문서의 흐름도·설명이 실제 구현 로직과 일치하는가?
4. **엣지 케이스**: 계획/구현 문서에 명시된 엣지 케이스(타임아웃, 취소, 에러 폴백 등)가 코드에 존재하는가?
5. **타입 에러**: `pnpm typecheck` 통과 여부

---

## Task 1: Core Agent 레이어 검증

**검증 대상:**
- `packages/core/src/agent/types.ts`
- `packages/core/src/agent/planner.ts`
- `packages/core/src/agent/orchestrator.ts`
- `packages/core/src/agent/healing.ts`
- `packages/core/src/agent/index.ts`

### 체크리스트

- [ ] **1-1. AgentEvent 타입 완전성 확인**

  `types.ts`의 `AgentEvent` 유니온에 `step_healing` 타입이 추가되어 있는지 확인.
  ```
  기대 필드: { type: 'step_healing'; step: AgentStep; strategy: 'retry' | 'reflect' }
  ```
  불일치 시: `PLAN_FOR_V0_1_3.md` § Task 3 Step 1 기준으로 수정.

- [ ] **1-2. HealingStrategy 인터페이스 확인**

  `healing.ts`에 `HealingResult`, `HealingStrategy`, `RetryStrategy`, `ReflectionStrategy` 4개 export 확인.

- [ ] **1-3. ReflectionStrategy 폴백 로직 확인**

  `action` 값이 `retry | skip | abort` 범위를 벗어날 때 `skip`으로 폴백하는 로직이 있는지 확인.
  ```
  기대 코드: const action = (parsed.action === 'retry' || parsed.action === 'abort') ? parsed.action : 'skip';
  ```

- [ ] **1-4. AgentOrchestrator healing 통합 확인**

  `orchestrator.ts`의 step 실행 catch 블록에서:
  1. Attempt 1: `RetryStrategy` (그대로 재실행)
  2. Attempt 2: `ReflectionStrategy` (LLM 반성 → action 결정)
  3. `abort` → 전체 종료, `skip`/재시도 실패 → 다음 step 계속

  위 3단계 흐름이 구현되어 있는지 확인.

- [ ] **1-5. Orchestrator synthesizeResult에 ContextManager 적용 여부 확인**

  `PLAN_FOR_V0_1_3.md` § Task 4 Step 2에서 `synthesizeResult` 내 LLM 호출에도 ContextManager를 적용하도록 명시했는지 계획 문서와 실제 코드를 비교.

- [ ] **1-6. Core 타입체크 통과 확인**

  ```bash
  pnpm --filter @neos-work/core typecheck
  ```
  Expected: 에러 없음. 에러 발생 시 수정 후 재검.

---

## Task 2: Core LLM 레이어 검증

**검증 대상:**
- `packages/core/src/llm/context-manager.ts`
- `packages/core/src/llm/index.ts`
- `packages/core/src/llm/anthropic.ts`
- `packages/core/src/llm/google.ts`
- `packages/core/src/llm/provider.ts`
- `packages/core/src/llm/registry.ts`

### 체크리스트

- [ ] **2-1. ContextManager export 확인**

  `llm/index.ts`에서 `ContextManager`를 export하고 있는지 확인.
  ```typescript
  export { ContextManager } from './context-manager.js';
  ```

- [ ] **2-2. ContextManager 토큰 추정 로직 확인**

  `estimateTokens()` 함수가 `string` content와 `MessageContent[]` 배열 양쪽을 처리하는지 확인.

- [ ] **2-3. ContextManager compress() 경계 조건 확인**

  `messages.length <= RECENT_WINDOW(20)`일 때 그대로 반환하는 조기 탈출 로직이 있는지 확인.

- [ ] **2-4. LLMProviderAdapter 인터페이스 완전성**

  `provider.ts`의 `LLMProviderAdapter` 인터페이스에 `getModels()`, `chat()` 메서드가 모두 선언되어 있는지 확인. `ContextManager`의 `compress()`가 `adapter.getModels()[0]?.id ?? ''` 패턴으로 model ID를 안전하게 추출하는지 확인.

- [ ] **2-5. AnthropicAdapter / GoogleAdapter chat() 스트리밍 확인**

  두 어댑터가 `ChatParams.thinkingMode`, `maxTokens`를 모두 처리하는지 확인.
  불일치 발견 시 `PLAN_FOR_V0_1_2.md` § LLM 어댑터 기준으로 수정.

- [ ] **2-6. LLM 레이어 타입체크 확인**

  ```bash
  pnpm --filter @neos-work/core typecheck
  ```

---

## Task 3: Browser Tool 패키지 검증

**검증 대상:**
- `packages/browser-tool/src/manager.ts`
- `packages/browser-tool/src/tools.ts`
- `packages/browser-tool/src/index.ts`
- `packages/browser-tool/package.json`

### 체크리스트

- [ ] **3-1. BrowserManager 라이프사이클 확인**

  `connect() → getPage() → disconnect()` 패턴이 구현되어 있는지 확인.
  `connect()`에 중복 호출 방어(`if (this.browser?.isConnected()) return`)가 있는지 확인.

- [ ] **3-2. disconnect() 에러 무시 확인**

  `this.browser?.close().catch(() => {})` 패턴으로 close 실패 시 에러를 무시하는지 확인.
  (서버 종료 시 예외 전파를 막기 위한 설계)

- [ ] **3-3. 6개 Tool 완전성 확인**

  `tools.ts`에서 아래 6개 tool이 모두 구현되어 있는지 확인:

  | Tool 이름 | 필수 입력 | 반환 |
  |-----------|----------|------|
  | `browser_navigate` | `url` | `{ title, url }` |
  | `browser_click` | `selector` | `{ success: true }` |
  | `browser_fill` | `selector`, `value` | `{ success: true }` |
  | `browser_screenshot` | `fullPage?` | `{ screenshot: base64 }` |
  | `browser_extract_text` | `selector?` | `{ text }` |
  | `browser_extract_links` | `selector?` | `{ links: {text, href}[] }` |

- [ ] **3-4. 타임아웃 값 확인**

  `browser_navigate`: 30,000ms, `browser_click`/`browser_fill`: 10,000ms 타임아웃이 설정되어 있는지 확인.

- [ ] **3-5. pnpm workspace 등록 확인**

  `pnpm-workspace.yaml`에 `packages/browser-tool`이 포함되어 있는지 확인.
  `apps/server/package.json`에 `@neos-work/browser-tool` 의존성이 있는지 확인.

- [ ] **3-6. Browser tool 타입체크 확인**

  ```bash
  pnpm --filter @neos-work/browser-tool typecheck
  ```

---

## Task 4: Server Session 라우트 검증

**검증 대상:**
- `apps/server/src/routes/session.ts`

### 체크리스트

- [ ] **4-1. ContextManager 채팅 라우트 적용 확인**

  `POST /:id/chat` 내부 while 루프에서 LLM 호출 직전에 아래 패턴이 있는지 확인:
  ```typescript
  if (contextManager.needsCompression(messages)) {
    messages = await contextManager.compress(messages, found.provider, abortSignal);
    await safeSend('context_compressed', ...);
  }
  ```

- [ ] **4-2. messages 변수 선언 방식 확인**

  `let messages: Message[]`로 선언되어 `compress()` 결과를 재할당할 수 있는지 확인.

- [ ] **4-3. BrowserManager 스코프 확인**

  `/agent` 라우트에서 `browserManager`가 `try` 블록 **바깥**에 선언되어 `finally`에서 접근 가능한지 확인.
  ```typescript
  // 올바른 패턴
  const browserManager = new BrowserManager();
  try { ... }
  finally { await browserManager.disconnect(); }
  ```

- [ ] **4-4. agent 라우트 step_healing SSE 이벤트 처리 확인**

  `orchestrator.run()` 이벤트 switch 문에 `case 'step_healing'` 분기가 있고, SSE로 전송하는지 확인.

- [ ] **4-5. loadBrowserTools 에러 무시 확인**

  `loadBrowserTools()`에서 `manager.connect()` 실패 시 에러를 console.error로 기록하고 계속 진행하는지 확인. (Playwright 미설치 환경에서도 서버가 기동되어야 함)

- [ ] **4-6. DESTRUCTIVE_TOOLS 확인 확인**

  `write_file`, `run_command` 에 대해 `tool_pending` SSE → 60초 타임아웃 → 자동 reject 흐름이 있는지 확인.

- [ ] **4-7. 메모리 툴 워크스페이스 스코프 확인**

  `/agent` 라우트에서 `memoryCallbacks`가 `workspaceId`를 클로저로 캡처해 워크스페이스 격리를 보장하는지 확인.

- [ ] **4-8. Server 타입체크 확인**

  ```bash
  pnpm --filter @neos-work/server typecheck
  ```

---

## Task 5: Desktop Engine 및 Sessions.tsx 검증

**검증 대상:**
- `apps/desktop/src/lib/engine.ts`
- `apps/desktop/src/pages/Sessions.tsx`

### 체크리스트

- [ ] **5-1. AgentStep 타입 필드 확인**

  `engine.ts`의 `AgentStep` 인터페이스에 아래 필드가 있는지 확인:
  - `screenshot?: string` (base64 PNG)
  - `healingStatus?: string`

- [ ] **5-2. AgentChunk step_healing 타입 확인**

  `engine.ts`에서 `AgentChunk` 또는 상응하는 타입에 `step_healing` 이벤트가 처리되는지 확인.

- [ ] **5-3. Sessions.tsx step_healing UI 확인**

  `Sessions.tsx`에서 `step_healing` 청크 수신 시 `healingStatus`를 해당 step에 설정하고, UI에 표시하는 코드가 있는지 확인.
  ```
  기대 UI: "재시도 중…" (strategy: 'retry') / "반성 중…" (strategy: 'reflect')
  ```

- [ ] **5-4. ScreenshotToggle 컴포넌트 확인**

  `browser_screenshot` tool 결과가 `AgentStep.screenshot`에 저장되고, `ScreenshotToggle` 컴포넌트가 토글 형태로 base64 이미지를 표시하는지 확인.

- [ ] **5-5. context_compressed 이벤트 처리 확인**

  `Sessions.tsx`의 SSE 이벤트 핸들러에서 `context_compressed` 이벤트를 받아 사용자에게 알림(isCompressSummary 등)을 표시하는지 확인.

- [ ] **5-6. Desktop 타입체크 확인**

  ```bash
  pnpm --filter @neos-work/desktop typecheck
  ```

---

## Task 6: MCP Client 및 Shared 패키지 검증

**검증 대상:**
- `packages/mcp-client/src/client.ts`
- `packages/mcp-client/src/tool-bridge.ts`
- `packages/mcp-client/src/index.ts`
- `packages/shared/src/`

### 체크리스트

- [ ] **6-1. McpClient connect/disconnect 확인**

  `client.ts`에서 `stdio` / `http` transport를 모두 처리하는지 확인.
  연결 실패 시 에러를 throw하는지(서버 라우트에서 catch해 console.error 처리) 확인.

- [ ] **6-2. buildMcpTools 변환 로직 확인**

  `tool-bridge.ts`의 `buildMcpTools()`가 MCP tool 스펙을 `@neos-work/core`의 `Tool` 인터페이스로 올바르게 변환하는지 확인.

- [ ] **6-3. Shared 타입 일관성 확인**

  `packages/shared/src/types/api.ts`, `llm.ts`, `session.ts`, `skill.ts`에 정의된 타입들이 각 패키지에서 일관되게 사용되는지 확인. 특히 `Message`, `MessageContent`, `ChatChunk` 타입.

- [ ] **6-4. ALL_MODELS / THINKING_MODES 상수 확인**

  `packages/shared/src/models.ts`의 `ALL_MODELS` 상수가 서버(`session.ts` 유효성 검사)와 데스크탑(`Sessions.tsx` 모델 선택 드롭다운) 양쪽에서 동일하게 참조되는지 확인.

- [ ] **6-5. MCP Client / Shared 타입체크 확인**

  ```bash
  pnpm --filter @neos-work/mcp-client typecheck
  pnpm --filter @neos-work/shared typecheck
  ```

---

## Task 7: 전체 빌드 + 통합 검증

### 체크리스트

- [ ] **7-1. 전체 워크스페이스 타입체크**

  ```bash
  export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$HOME/Library/pnpm:$PATH"
  cd /Users/ywsung/Desktop/neos-work
  pnpm typecheck
  ```
  Expected: 모든 패키지 에러 없음.

- [ ] **7-2. 전체 빌드**

  ```bash
  pnpm build
  ```
  의존성 순서: `shared → core → browser-tool → mcp-client → server → desktop`
  Expected: 빌드 에러 없음.

- [ ] **7-3. pnpm-workspace.yaml 등록 완전성 확인**

  `pnpm-workspace.yaml`에 아래 5개 패키지 경로가 모두 포함되어 있는지 확인:
  - `packages/shared`
  - `packages/core`
  - `packages/browser-tool`
  - `packages/mcp-client`
  - `apps/server`
  - `apps/desktop`

- [ ] **7-4. 계획 vs 구현 문서 트리플 매핑 요약 작성**

  검증 완료 후 아래 표 형식으로 `docs/implementation/v0.1.4.md`에 결과 기록:

  | 항목 | 계획 문서 | 구현 문서 | 코드 상태 | 불일치 여부 |
  |------|-----------|-----------|-----------|-------------|
  | step_healing 이벤트 | PLAN_V0_1_3 Task 3 | impl v0.1.3 §2 | ✅ 존재 | 없음 |
  | BrowserManager 스코프 | PLAN_V0_1_3 Task 5 | impl v0.1.3 §1 | 확인 필요 | - |
  | ... | ... | ... | ... | ... |

---

## 발견된 불일치 수정 원칙

1. **계획 문서 우선**: 계획 문서(`docs/plans/`)에 명시된 스펙이 정확하다고 간주하고, 코드가 이를 따르도록 수정한다.
2. **구현 문서 우선 예외**: `docs/implementation/`에 "설계 변경" 또는 "주의" 섹션으로 명시된 의도적 변경은 구현 문서를 정답으로 본다.
3. **수정 범위 최소화**: 불일치 수정은 해당 파일 최소 범위에 국한하고, 관련 없는 리팩터링은 포함하지 않는다.
4. **수정 후 타입체크 통과**: 각 수정 후 해당 패키지 `typecheck`를 반드시 재실행한다.

---

## 예상 발견 영역 (사전 가설)

아래는 코드를 사전 검토한 결과 점검이 필요할 가능성이 높은 항목들이다.

| # | 항목 | 근거 |
|---|------|------|
| H-1 | `orchestrator.ts`의 `synthesizeResult`에 ContextManager가 적용되어 있는지 | 계획 문서 Task 4 Step 2에 언급됐으나 chat route 중점으로 구현됐을 가능성 |
| H-2 | `Sessions.tsx`의 `context_compressed` 이벤트 처리 | 서버는 전송하나 클라이언트 핸들러가 없을 가능성 |
| H-3 | `browser_extract_links` Tool의 반환 타입 | `{text, href}[]` 형식이 실제 코드와 일치하는지 |
| H-4 | `healing.ts` import 순서 | `LLMProviderAdapter` import가 파일 상단에 있어야 하나 클래스 내부에서만 참조할 경우 순환 참조 위험 |
| H-5 | `loadBrowserTools`의 `finally` 보장 | `/agent` 라우트에서 예외 발생 시 `browserManager.disconnect()`가 항상 호출되는지 |

---

## 완료 기준

- [ ] 모든 Task(1~7)의 체크리스트 항목이 ✅ 상태
- [ ] `pnpm typecheck` 전체 통과
- [ ] `pnpm build` 전체 통과
- [ ] `docs/implementation/v0.1.4.md`에 검증 결과 요약 작성
- [ ] 발견된 불일치 건수 및 수정 내용 기록
