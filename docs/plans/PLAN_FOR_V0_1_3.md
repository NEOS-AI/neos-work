# v0.1.3 에이전트 역량 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저 자동화(Playwright), 에이전트 자가 수정(retry + LLM reflection), 컨텍스트 관리(LLM 요약 압축)를 추가해 에이전트가 웹 조작·자기 회복·긴 대화를 처리할 수 있도록 한다.

**Architecture:** Playwright 의존성은 `packages/browser-tool/`에 격리하고 core `Tool` 인터페이스로 노출. Self-healing은 `packages/core/src/agent/healing.ts` 독립 모듈로 분리해 `AgentOrchestrator.run()` catch 블록에 주입. ContextManager는 `packages/core/src/llm/context-manager.ts` 미들웨어로 LLM 호출 직전 메시지 배열을 전처리.

**Tech Stack:** Playwright `^1.50.0`, TypeScript ESM, Hono SSE, React, pnpm workspace

**Design Spec:** `docs/superpowers/specs/2026-04-02-v0.1.3-design.md`

---

## 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| `packages/browser-tool/package.json` | 패키지 메타 (playwright 의존성) |
| `packages/browser-tool/tsconfig.json` | TypeScript 설정 |
| `packages/browser-tool/src/manager.ts` | BrowserManager (Playwright 인스턴스 생명주기) |
| `packages/browser-tool/src/tools.ts` | 6개 브라우저 Tool 정의 |
| `packages/browser-tool/src/index.ts` | 패키지 진입점 |
| `packages/core/src/agent/healing.ts` | HealingResult, HealingStrategy, RetryStrategy, ReflectionStrategy |
| `packages/core/src/llm/context-manager.ts` | ContextManager (토큰 추정 + LLM 요약 압축) |

### 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `packages/core/src/agent/types.ts` | `step_healing` 이벤트 타입 추가 |
| `packages/core/src/agent/orchestrator.ts` | executeStep catch에 healing 통합, synthesizeResult에 ContextManager 적용 |
| `packages/core/src/agent/index.ts` | healing 모듈 export 추가 |
| `packages/core/src/llm/index.ts` | ContextManager export 추가 |
| `apps/server/src/routes/session.ts` | loadBrowserTools(), step_healing SSE, ContextManager in chat route |
| `apps/desktop/src/lib/engine.ts` | AgentChunk에 step_healing 타입 추가 |
| `apps/desktop/src/pages/Sessions.tsx` | 스크린샷 토글 UI, healing 상태 텍스트 |

---

## Task 1: ContextManager 구현

**Files:**
- Create: `packages/core/src/llm/context-manager.ts`
- Modify: `packages/core/src/llm/index.ts`

- [ ] **Step 1: context-manager.ts 작성**

```typescript
// packages/core/src/llm/context-manager.ts
import type { Message } from '@neos-work/shared';
import type { LLMProviderAdapter } from './provider.js';

const DEFAULT_THRESHOLD = 80_000; // 토큰
const RECENT_WINDOW = 20; // 항상 보존할 최근 메시지 수

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ('text' in block) chars += (block as { text: string }).text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

export class ContextManager {
  constructor(private threshold = DEFAULT_THRESHOLD) {}

  needsCompression(messages: Message[]): boolean {
    return estimateTokens(messages) > this.threshold;
  }

  async compress(
    messages: Message[],
    adapter: LLMProviderAdapter,
    signal?: AbortSignal,
  ): Promise<Message[]> {
    if (messages.length <= RECENT_WINDOW) return messages;

    const recent = messages.slice(-RECENT_WINDOW);
    const older = messages.slice(0, -RECENT_WINDOW);

    const summaryText = await this.summarize(older, adapter, signal);

    const summaryMessage: Message = {
      role: 'system',
      content: `[이전 대화 요약]\n${summaryText}`,
    };

    return [summaryMessage, ...recent];
  }

  private async summarize(
    messages: Message[],
    adapter: LLMProviderAdapter,
    signal?: AbortSignal,
  ): Promise<string> {
    const transcript = messages
      .map((m) => {
        const text =
          typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content);
        return `${m.role}: ${text}`;
      })
      .join('\n');

    let summary = '';
    for await (const chunk of adapter.chat({
      model: adapter.getModels()[0]?.id ?? '',
      messages: [
        {
          role: 'user',
          content: `다음 대화를 핵심 사실·결정 사항 위주로 간결하게 요약해줘:\n\n${transcript}`,
        },
      ],
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        summary += chunk.content;
      }
    }
    return summary;
  }
}
```

- [ ] **Step 2: llm/index.ts에 export 추가**

```typescript
// packages/core/src/llm/index.ts
export { type LLMProviderAdapter } from './provider.js';
export { ProviderRegistry } from './registry.js';
export { AnthropicAdapter } from './anthropic.js';
export { GoogleAdapter } from './google.js';
export { ContextManager } from './context-manager.js';  // 추가
```

- [ ] **Step 3: 빌드 확인**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$HOME/Library/pnpm:$PATH"
cd /Users/ywsung/Desktop/neos-work
pnpm --filter @neos-work/core typecheck
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add packages/core/src/llm/context-manager.ts packages/core/src/llm/index.ts
git commit -m "feat(core): add ContextManager for LLM message compression"
```

---

## Task 2: ContextManager를 채팅 라우트에 적용

**Files:**
- Modify: `apps/server/src/routes/session.ts`

현재 채팅 라우트에서 `messages` 배열을 LLM에 그대로 전달한다. ContextManager로 전처리한다.

- [ ] **Step 1: session.ts import에 ContextManager 추가**

파일 상단 import 블록에서:
```typescript
// 기존
import {
  ProviderRegistry,
  AnthropicAdapter,
  GoogleAdapter,
  ToolRegistry,
  createFilesystemTools,
  createWebSearchTool,
  createShellTool,
  createMemoryTools,
  AgentOrchestrator,
} from '@neos-work/core';

// 변경
import {
  ProviderRegistry,
  AnthropicAdapter,
  GoogleAdapter,
  ToolRegistry,
  createFilesystemTools,
  createWebSearchTool,
  createShellTool,
  createMemoryTools,
  AgentOrchestrator,
  ContextManager,
} from '@neos-work/core';
```

- [ ] **Step 2: 채팅 라우트의 LLM 호출 직전에 압축 적용**

`session.post('/:id/chat', ...)` 내부, `const MAX_TOOL_ITERATIONS = 10;` 줄 바로 뒤에 ContextManager 인스턴스 생성을 추가하고, `messages` 배열을 루프 안에서 사용하기 전에 압축을 적용한다.

루프 시작(`while (iteration < MAX_TOOL_ITERATIONS)`) 직전에 추가:

```typescript
const contextManager = new ContextManager();
```

현재 session.ts의 `const messages: Message[] = ...` 선언을 `let`으로 변경한다:

```typescript
// 변경 전
const messages: Message[] = messageRows.map(...);
// 변경 후
let messages: Message[] = messageRows.map(...);
```

루프 내부에서 `adapter.chat({` 호출 직전에 삽입:

```typescript
// 컨텍스트 압축 (토큰 임계값 초과 시)
if (contextManager.needsCompression(messages)) {
  messages = await contextManager.compress(messages, found.provider, abortSignal);
}
```

- [ ] **Step 3: 압축 발생 시 SSE 알림 전송**

컨텍스트 압축 직후에 추가:

```typescript
if (contextManager.needsCompression(messages)) {
  messages = await contextManager.compress(messages, found.provider, abortSignal);
  await safeSend('context_compressed', JSON.stringify({ type: 'context_compressed' }));
}
```

- [ ] **Step 4: 서버 빌드 확인**

```bash
pnpm --filter @neos-work/server typecheck
```
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add apps/server/src/routes/session.ts
git commit -m "feat(server): apply ContextManager to chat route before LLM call"
```

---

## Task 3: step_healing 이벤트 타입 + HealingStrategy + RetryStrategy

**Files:**
- Modify: `packages/core/src/agent/types.ts`
- Create: `packages/core/src/agent/healing.ts`

- [ ] **Step 1: types.ts에 step_healing 추가**

```typescript
// packages/core/src/agent/types.ts
// 기존 AgentEvent에 step_healing 추가

export type AgentEvent =
  | { type: 'plan'; steps: AgentStep[] }
  | { type: 'step_start'; step: AgentStep }
  | { type: 'step_complete'; step: AgentStep }
  | { type: 'step_error'; step: AgentStep; error: string }
  | { type: 'step_healing'; step: AgentStep; strategy: 'retry' | 'reflect' }  // 추가
  | { type: 'text'; content: string }
  | { type: 'done'; task: AgentTask }
  | { type: 'error'; error: string };
```

- [ ] **Step 2: healing.ts 작성 (인터페이스 + RetryStrategy)**

```typescript
// packages/core/src/agent/healing.ts
import type { AgentStep } from './types.js';

export interface HealingResult {
  /** 취할 행동 */
  action: 'retry' | 'skip' | 'abort';
  /** retry 시 LLM이 제안한 수정 내용 */
  revisedStep?: Partial<Pick<AgentStep, 'description' | 'toolName' | 'input'>>;
}

export interface HealingStrategy {
  heal(
    step: AgentStep,
    error: string,
    history: AgentStep[],
    signal?: AbortSignal,
  ): Promise<HealingResult>;
}

/**
 * 단순 재시도 전략.
 * 실패한 step을 그대로 1회 재실행하도록 'retry'를 반환한다.
 * 재시도 실패 여부 판단은 orchestrator가 담당한다.
 */
export class RetryStrategy implements HealingStrategy {
  async heal(): Promise<HealingResult> {
    return { action: 'retry' };
  }
}
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter @neos-work/core typecheck
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add packages/core/src/agent/types.ts packages/core/src/agent/healing.ts
git commit -m "feat(core): add step_healing event type and HealingStrategy with RetryStrategy"
```

---

## Task 4: ReflectionStrategy + AgentOrchestrator healing 통합

**Files:**
- Modify: `packages/core/src/agent/healing.ts` (ReflectionStrategy 추가)
- Modify: `packages/core/src/agent/orchestrator.ts` (healing 통합)
- Modify: `packages/core/src/agent/index.ts` (export 추가)

- [ ] **Step 1: healing.ts에 ReflectionStrategy 추가**

`RetryStrategy` 클래스 아래에 추가:

```typescript
import type { LLMProviderAdapter } from '../llm/provider.js';

/**
 * LLM 반성 전략.
 * 실패 원인과 히스토리를 LLM에 전달해 대안 행동을 결정한다.
 */
export class ReflectionStrategy implements HealingStrategy {
  constructor(private adapter: LLMProviderAdapter) {}

  async heal(
    step: AgentStep,
    error: string,
    history: AgentStep[],
    signal?: AbortSignal,
  ): Promise<HealingResult> {
    const historyStr = history
      .map(
        (s) =>
          `[${s.status}] ${s.description}${s.error ? ` (에러: ${s.error})` : ''}`,
      )
      .join('\n');

    const prompt = `에이전트 step이 실패했습니다.

목표: ${step.description}
${step.toolName ? `툴: ${step.toolName}` : ''}
${step.input ? `입력: ${JSON.stringify(step.input)}` : ''}
에러: ${error}

완료된 이전 steps:
${historyStr || '(없음)'}

아래 JSON 형식으로만 응답하세요:
{
  "action": "retry" | "skip" | "abort",
  "revisedDescription": "string (optional, retry 시 수정된 목표)",
  "revisedToolName": "string (optional, retry 시 다른 툴)",
  "revisedInput": {} (optional, retry 시 수정된 입력)
}`;

    let response = '';
    for await (const chunk of this.adapter.chat({
      model: this.adapter.getModels()[0]?.id ?? '',
      messages: [{ role: 'user', content: prompt }],
      signal,
    })) {
      if (chunk.type === 'text' && chunk.content) {
        response += chunk.content;
      }
    }

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { action: 'skip' };

      const parsed = JSON.parse(jsonMatch[0]) as {
        action?: string;
        revisedDescription?: string;
        revisedToolName?: string;
        revisedInput?: Record<string, unknown>;
      };

      const action = (parsed.action === 'retry' || parsed.action === 'abort')
        ? parsed.action
        : 'skip';

      const result: HealingResult = { action };
      if (action === 'retry') {
        result.revisedStep = {
          description: parsed.revisedDescription ?? step.description,
          toolName: parsed.revisedToolName ?? step.toolName,
          input: parsed.revisedInput ?? step.input,
        };
      }
      return result;
    } catch {
      return { action: 'skip' };
    }
  }
}
```

- [ ] **Step 2: orchestrator.ts — healing 통합**

`AgentOrchestrator` 클래스 상단에 healing 전략 필드와 import 추가:

```typescript
// 파일 상단 import에 추가
import { RetryStrategy, ReflectionStrategy } from './healing.js';
import type { HealingStrategy } from './healing.js';
```

클래스 필드 추가 (기존 `private maxIterations` 아래):

```typescript
private retryStrategy: HealingStrategy;
private reflectionStrategy: HealingStrategy;
```

`constructor` 내부 끝에 추가:

```typescript
this.retryStrategy = new RetryStrategy();
this.reflectionStrategy = new ReflectionStrategy(adapter);
```

`run()` 메서드 내부 Phase 2 실행 루프의 catch 블록 전체를 아래로 교체:

```typescript
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  let healed = false;

  // Healing attempt 1: retry
  if (!signal?.aborted) {
    step.status = 'running';
    yield { type: 'step_healing', step: { ...step }, strategy: 'retry' };
    try {
      const result = await this.executeStep(step, conversationHistory, signal);
      step.output = result;
      step.status = 'completed';
      conversationHistory.push({
        role: 'assistant',
        content: `Step ${step.index + 1} (${step.description}): ${JSON.stringify(result)}`,
      });
      yield { type: 'step_complete', step: { ...step } };
      healed = true;
    } catch {
      // retry도 실패 → reflection으로 진행
    }
  }

  // Healing attempt 2: reflection
  if (!healed && !signal?.aborted) {
    yield { type: 'step_healing', step: { ...step }, strategy: 'reflect' };
    const reflectResult = await this.reflectionStrategy.heal(
      step, error, task.steps, signal,
    );

    if (reflectResult.action === 'abort') {
      task.status = 'failed';
      yield { type: 'error', error: `Agent aborted: step ${step.index + 1} failed after reflection` };
      return;
    }

    if (reflectResult.action === 'retry' && reflectResult.revisedStep) {
      Object.assign(step, reflectResult.revisedStep);
      step.status = 'running';
      try {
        const result = await this.executeStep(step, conversationHistory, signal);
        step.output = result;
        step.status = 'completed';
        conversationHistory.push({
          role: 'assistant',
          content: `Step ${step.index + 1} (${step.description}): ${JSON.stringify(result)}`,
        });
        yield { type: 'step_complete', step: { ...step } };
        healed = true;
      } catch (finalErr) {
        // revised step도 실패 → skip으로 처리
      }
    }
  }

  if (!healed) {
    const finalError = err instanceof Error ? err.message : String(err);
    step.status = 'error';
    step.error = finalError;
    yield { type: 'step_error', step: { ...step }, error: finalError };
    // Non-fatal: 다음 step 계속
  }
}
```

- [ ] **Step 3: agent/index.ts에 healing export 추가**

```typescript
// packages/core/src/agent/index.ts
export * from './types.js';
export { Planner } from './planner.js';
export { AgentOrchestrator } from './orchestrator.js';
export { RetryStrategy, ReflectionStrategy } from './healing.js';  // 추가
export type { HealingStrategy, HealingResult } from './healing.js'; // 추가
```

- [ ] **Step 4: 빌드 확인**

```bash
pnpm --filter @neos-work/core typecheck
```
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/agent/healing.ts packages/core/src/agent/orchestrator.ts packages/core/src/agent/index.ts
git commit -m "feat(core): implement ReflectionStrategy and integrate self-healing into AgentOrchestrator"
```

---

## Task 5: browser-tool 패키지 scaffolding

**Files:**
- Create: `packages/browser-tool/package.json`
- Create: `packages/browser-tool/tsconfig.json`
- Create: `packages/browser-tool/src/index.ts`

- [ ] **Step 1: package.json 생성**

```json
// packages/browser-tool/package.json
{
  "name": "@neos-work/browser-tool",
  "version": "0.1.3",
  "private": true,
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@neos-work/core": "workspace:*",
    "playwright": "^1.50.0"
  },
  "devDependencies": {
    "typescript": "^5.8.2"
  }
}
```

- [ ] **Step 2: tsconfig.json 생성**

```json
// packages/browser-tool/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: src/index.ts 임시 파일 생성**

```typescript
// packages/browser-tool/src/index.ts
// populated in subsequent tasks
export {};
```

- [ ] **Step 4: 의존성 설치**

```bash
pnpm install
```
Expected: `packages/browser-tool/node_modules/playwright` 설치됨

- [ ] **Step 5: Playwright 브라우저 바이너리 설치**

```bash
cd packages/browser-tool && pnpm exec playwright install chromium
```
Expected: Chromium 바이너리 다운로드 완료

- [ ] **Step 6: 커밋**

```bash
cd /Users/ywsung/Desktop/neos-work
git add packages/browser-tool/
git commit -m "feat(browser-tool): scaffold new package with Playwright dependency"
```

---

## Task 6: BrowserManager 구현

**Files:**
- Create: `packages/browser-tool/src/manager.ts`

- [ ] **Step 1: manager.ts 작성**

```typescript
// packages/browser-tool/src/manager.ts
import { chromium, type Browser, type Page } from 'playwright';

/**
 * 세션 스코프 Playwright 브라우저 관리자.
 * 세션당 하나의 Chromium 인스턴스와 Page를 재사용한다.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async connect(): Promise<void> {
    if (this.browser?.isConnected()) return;
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
  }

  async disconnect(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error('BrowserManager not connected. Call connect() first.');
    }
    return this.page;
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}
```

- [ ] **Step 2: 빌드 확인**

```bash
pnpm --filter @neos-work/browser-tool typecheck
```
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add packages/browser-tool/src/manager.ts
git commit -m "feat(browser-tool): implement BrowserManager with Chromium lifecycle"
```

---

## Task 7: Browser Tools 6개 구현

**Files:**
- Create: `packages/browser-tool/src/tools.ts`
- Modify: `packages/browser-tool/src/index.ts`

- [ ] **Step 1: tools.ts 작성**

```typescript
// packages/browser-tool/src/tools.ts
import type { Tool } from '@neos-work/core';
import type { BrowserManager } from './manager.js';

/**
 * BrowserManager 인스턴스를 받아 6개 브라우저 Tool을 반환한다.
 * Tool 인터페이스: { name, description, inputSchema, execute(input) }
 */
export function createBrowserTools(manager: BrowserManager): Tool[] {
  return [
    {
      name: 'browser_navigate',
      description: '지정한 URL로 웹 페이지를 탐색합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '이동할 URL (http:// 또는 https:// 포함)' },
        },
        required: ['url'],
      },
      async execute(input) {
        const { url } = input as { url: string };
        const page = manager.getPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return { success: true, output: { title: await page.title(), url: page.url() } };
      },
    },
    {
      name: 'browser_click',
      description: 'CSS 셀렉터에 해당하는 요소를 클릭합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS 셀렉터' },
        },
        required: ['selector'],
      },
      async execute(input) {
        const { selector } = input as { selector: string };
        const page = manager.getPage();
        await page.click(selector, { timeout: 10_000 });
        return { success: true, output: { success: true } };
      },
    },
    {
      name: 'browser_fill',
      description: '폼 필드에 텍스트를 입력합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS 셀렉터' },
          value: { type: 'string', description: '입력할 값' },
        },
        required: ['selector', 'value'],
      },
      async execute(input) {
        const { selector, value } = input as { selector: string; value: string };
        const page = manager.getPage();
        await page.fill(selector, value, { timeout: 10_000 });
        return { success: true, output: { success: true } };
      },
    },
    {
      name: 'browser_screenshot',
      description: '현재 페이지의 스크린샷을 base64 PNG로 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          fullPage: {
            type: 'boolean',
            description: '전체 페이지 스크린샷 여부 (기본: false)',
          },
        },
      },
      async execute(input) {
        const { fullPage = false } = input as { fullPage?: boolean };
        const page = manager.getPage();
        const buffer = await page.screenshot({ fullPage });
        return { success: true, output: { screenshot: buffer.toString('base64') } };
      },
    },
    {
      name: 'browser_extract_text',
      description: '페이지 전체 또는 특정 요소의 텍스트를 추출합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 셀렉터 (생략 시 body 전체)',
          },
        },
      },
      async execute(input) {
        const { selector } = input as { selector?: string };
        const page = manager.getPage();
        const text = selector
          ? await page.locator(selector).innerText({ timeout: 10_000 })
          : await page.evaluate(() => document.body.innerText);
        return { success: true, output: { text } };
      },
    },
    {
      name: 'browser_extract_links',
      description: '페이지 또는 특정 영역의 링크(텍스트 + href) 목록을 반환합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 셀렉터 (생략 시 전체 페이지)',
          },
        },
      },
      async execute(input) {
        const { selector } = input as { selector?: string };
        const page = manager.getPage();
        const links = await page.evaluate((sel: string | null) => {
          const container: Element | Document = sel
            ? (document.querySelector(sel) ?? document)
            : document;
          return Array.from(container.querySelectorAll('a[href]')).map((a) => ({
            text: (a as HTMLAnchorElement).innerText.trim(),
            href: (a as HTMLAnchorElement).href,
          }));
        }, selector ?? null);
        return { success: true, output: { links } };
      },
    },
  ];
}
```

- [ ] **Step 2: index.ts 업데이트**

```typescript
// packages/browser-tool/src/index.ts
export { BrowserManager } from './manager.js';
export { createBrowserTools } from './tools.js';
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter @neos-work/browser-tool typecheck
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add packages/browser-tool/src/tools.ts packages/browser-tool/src/index.ts
git commit -m "feat(browser-tool): implement 6 browser tools (navigate, click, fill, screenshot, extract_text, extract_links)"
```

---

## Task 8: 서버 통합 — loadBrowserTools + step_healing SSE + ContextManager in agent route

**Files:**
- Modify: `apps/server/src/routes/session.ts`

- [ ] **Step 1: browser-tool import 추가**

`apps/server/package.json`에 의존성 추가:
```json
"@neos-work/browser-tool": "workspace:*"
```

그 다음 session.ts 상단 import에 추가:
```typescript
import { BrowserManager, createBrowserTools } from '@neos-work/browser-tool';
```

- [ ] **Step 2: loadBrowserTools 함수 추가**

`loadMcpTools` 함수 바로 아래에 추가:

```typescript
async function loadBrowserTools(
  toolRegistry: ToolRegistry,
  manager: BrowserManager,
): Promise<void> {
  try {
    await manager.connect();
    for (const tool of createBrowserTools(manager)) {
      toolRegistry.register(tool);
    }
  } catch (err) {
    console.error('Failed to initialize browser tools:', err);
  }
}
```

- [ ] **Step 3: 에이전트 라우트에 브라우저 툴 추가**

`session.post('/:id/agent', ...)` 내부 `streamSSE` 콜백의 `try` 블록에서, `const orchestrator = ...` 줄 앞에 추가:

```typescript
const browserManager = new BrowserManager();
await loadBrowserTools(toolRegistry, browserManager);
```

같은 `try` 블록의 `finally` 절에 추가 (기존 `activeChats.delete(sessionId)` 아래):

```typescript
await browserManager.disconnect();
```

- [ ] **Step 4: step_healing SSE 이벤트 처리**

에이전트 라우트의 `for await (const event of orchestrator.run(...))` switch 문에 case 추가:

```typescript
case 'step_healing': {
  const rowId = stepDbIds.get(event.step.id);
  if (rowId) {
    agentStepsDb.updateAgentStep(rowId, { status: 'running', data: event.step });
  }
  await safeSend('step_healing', JSON.stringify({
    step: event.step,
    strategy: event.strategy,
  }));
  break;
}
```

- [ ] **Step 5: 의존성 설치 및 빌드 확인**

```bash
cd /Users/ywsung/Desktop/neos-work
pnpm install
pnpm --filter @neos-work/server typecheck
```
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/server/package.json apps/server/src/routes/session.ts
git commit -m "feat(server): integrate browser tools and step_healing SSE event into agent route"
```

---

## Task 9: engine.ts AgentChunk 타입 업데이트

**Files:**
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: AgentChunk에 step_healing 추가**

```typescript
// apps/desktop/src/lib/engine.ts
// 기존 AgentChunk 타입에 추가

export type AgentChunk =
  | { type: 'plan'; steps: AgentStep[] }
  | { type: 'step_start'; step: AgentStep }
  | { type: 'step_complete'; step: AgentStep }
  | { type: 'step_error'; step: AgentStep; error: string }
  | { type: 'step_healing'; step: AgentStep; strategy: 'retry' | 'reflect' }  // 추가
  | { type: 'text'; content: string }
  | { type: 'done'; task: AgentTask }
  | { type: 'error'; error: string };
```

- [ ] **Step 2: 빌드 확인**

```bash
pnpm --filter @neos-work/desktop typecheck
```
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add apps/desktop/src/lib/engine.ts
git commit -m "feat(desktop): add step_healing type to AgentChunk"
```

---

## Task 10: Sessions.tsx UI — 스크린샷 토글 + healing 상태 표시

**Files:**
- Modify: `apps/desktop/src/pages/Sessions.tsx`

- [ ] **Step 1: AgentStep 타입에 screenshot 필드 추가**

`engine.ts`의 `AgentStep` 인터페이스에 필드 추가:

```typescript
export interface AgentStep {
  id: string;
  index: number;
  description: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  toolName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  screenshot?: string;    // 추가: base64 PNG (browser_screenshot 결과)
  healingStatus?: string; // 추가: healing 진행 중 텍스트
}
```

- [ ] **Step 2: handleSendAgent에서 step_healing 처리 추가**

Sessions.tsx의 `chunk.type` switch 문에 case 추가 (기존 `step_error` case 아래):

```tsx
} else if (chunk.type === 'step_healing') {
  setMessages((prev) =>
    prev.map((msg) => {
      if (!msg.agentPlan) return msg;
      return {
        ...msg,
        agentPlan: msg.agentPlan.map((s) =>
          s.id === chunk.step.id
            ? {
                ...s,
                healingStatus:
                  chunk.strategy === 'retry' ? '재시도 중...' : '대안 탐색 중...',
              }
            : s,
        ),
      };
    }),
  );
```

- [ ] **Step 3: step_complete 처리에서 screenshot 추출**

기존 `chunk.type === 'step_complete'` 처리 부분에서 step output에 screenshot이 있으면 step에 저장:

```tsx
} else if (chunk.type === 'step_complete') {
  setMessages((prev) =>
    prev.map((msg) => {
      if (!msg.agentPlan) return msg;
      return {
        ...msg,
        agentPlan: msg.agentPlan.map((s) => {
          if (s.id !== chunk.step.id) return s;
          // browser_screenshot output에서 base64 추출
          const output = chunk.step.output as Record<string, unknown> | undefined;
          const screenshot =
            output && typeof output === 'object' && 'screenshot' in output
              ? (output.screenshot as string)
              : undefined;
          return {
            ...chunk.step,
            status: 'completed' as const,
            screenshot,
            healingStatus: undefined,
          };
        }),
      };
    }),
  );
```

- [ ] **Step 4: AgentPlanCard step 렌더링에 스크린샷 토글 + healing 상태 추가**

`AgentPlanCard` 함수 내부, 각 step을 렌더링하는 `plan.map((step, i) => ...)` 블록 안에서:

기존:
```tsx
{step.error && (
  <span className="ml-1 text-red-400">{step.error}</span>
)}
```

아래로 교체:
```tsx
{step.healingStatus && (
  <span className="ml-1 italic" style={{ color: 'var(--text-muted)' }}>
    {step.healingStatus}
  </span>
)}
{step.error && (
  <span className="ml-1 text-red-400">{step.error}</span>
)}
{step.screenshot && <ScreenshotToggle screenshot={step.screenshot} />}
```

- [ ] **Step 5: ScreenshotToggle 컴포넌트 추가**

`AgentPlanCard` 함수 선언 바로 위에 추가:

```tsx
function ScreenshotToggle({ screenshot }: { screenshot: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ml-1 inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] underline"
        style={{ color: 'var(--text-muted)' }}
      >
        {open ? '스크린샷 닫기 ▲' : '스크린샷 보기 ▼'}
      </button>
      {open && (
        <div className="mt-1">
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="browser screenshot"
            className="max-w-xs rounded border"
            style={{ borderColor: 'var(--border-primary)' }}
          />
        </div>
      )}
    </span>
  );
}
```

- [ ] **Step 6: context_compressed SSE 이벤트 처리 추가**

Sessions.tsx의 채팅 SSE 파싱 부분(chat route용 `chunk.type` 분기)에 추가:

```tsx
} else if (chunk.type === 'context_compressed') {
  // 압축 알림 메시지를 채팅 스레드에 삽입
  setMessages((prev) => [
    ...prev,
    {
      id: crypto.randomUUID(),
      role: 'system' as const,
      content: '이전 대화 요약됨',
      isCompressSummary: true,
    },
  ]);
```

`DisplayMessage` 타입에 `isCompressSummary?: boolean` 필드 추가 후, 메시지 렌더링 부분에서 `isCompressSummary`가 true이면 구분선 + 배지 스타일로 렌더링:

```tsx
{msg.isCompressSummary && (
  <div className="my-2 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
    <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-primary)' }} />
    <span className="rounded px-2 py-0.5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
      이전 대화 요약됨
    </span>
    <div className="h-px flex-1" style={{ backgroundColor: 'var(--border-primary)' }} />
  </div>
)}
```

- [ ] **Step 7: 빌드 확인**

```bash
pnpm --filter @neos-work/desktop typecheck
```
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add apps/desktop/src/lib/engine.ts apps/desktop/src/pages/Sessions.tsx
git commit -m "feat(desktop): add screenshot toggle, healing status, and context compression UI"
```

---

## 최종 통합 검증

- [ ] **전체 빌드**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$HOME/Library/pnpm:$PATH"
cd /Users/ywsung/Desktop/neos-work
pnpm build
```
Expected: 모든 패키지 빌드 성공

- [ ] **브라우저 자동화 검증**

앱 실행 후 에이전트 모드에서:
```
"example.com에 접속해서 스크린샷을 찍어줘"
```
Expected: AgentPlanCard에 `browser_navigate` → `browser_screenshot` step 순서로 실행, "스크린샷 보기 ▼" 버튼 표시

- [ ] **자가 수정 검증**

에이전트 모드에서:
```
"존재하지 않는 CSS 셀렉터 #no-such-element 를 클릭해줘"
```
Expected: `step_healing {strategy: 'retry'}` → `step_healing {strategy: 'reflect'}` 순서로 AgentPlanCard에 healing 상태 텍스트 표시

- [ ] **컨텍스트 압축 검증**

`ContextManager` 생성 시 threshold를 임시로 낮게 설정(예: `new ContextManager(500)`)하고 긴 대화 진행 후 "이전 대화 요약됨" 배지 확인. 검증 후 기본값(`80_000`)으로 복원.

- [ ] **릴리즈 커밋**

```bash
git add .
git commit -m "release: v0.1.3"
```

---

## v0.1.3 제외 항목

| 항목 | 사유 |
|------|------|
| 브라우저 실행 승인 게이트 | 풀 자동화 선택으로 제외. v0.1.4 검토 |
| Templates 페이지 | 에이전트 역량 강화 집중 릴리즈에서 제외 |
| OpenPackage 스킬 마켓플레이스 | 별도 릴리즈 |
| CI/CD 파이프라인 | 별도 릴리즈 |
| Ollama / 로컬 LLM | 별도 릴리즈 |
