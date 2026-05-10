# NEOS Work v0.2.0 — 워크플로우 빌더 구현 계획

> **기준 버전**: v0.1.4 (Audit 완료)
> **작성일**: 2026-05-10
> **목표**: n8n 스타일의 비주얼 워크플로우 빌더를 추가하여 도메인별(금융·코딩) 에이전트 파이프라인을 GUI로 구성하고, 게이팅 노드·메시징 채널·웹 검색을 노드로 추상화한다. 또한 도메인 특화 **기능 블록(Domain Block)** 시스템을 도입해 사전 구현된 분석·처리 단위를 레고 블록처럼 쌓아 워크플로우를 구성할 수 있도록 한다.

---

## 1. 배경 및 목표

v0.1.x에서 NEOS Work는 **단일 세션 → 단일 에이전트** 구조였다. 사용자는 프롬프트를 입력하면 AgentOrchestrator가 계획(Plan) → 단계 실행(Step) → 결과 합성(Synthesize) 순서로 처리했다.

v0.2.0은 여기에 **워크플로우 레이어**와 **에이전트 하네스 레이어**를 추가한다.

| 구분 | v0.1.x | v0.2.0 |
|------|--------|--------|
| 실행 단위 | 세션(Session) | 세션 + 워크플로우(Workflow) |
| 구성 방식 | 프롬프트 입력 | 노드 기반 비주얼 편집 |
| 에이전트 연결 | 단일 에이전트 | 다수 에이전트·노드 체인 |
| 에이전트 역할 정의 | 없음 (시스템 프롬프트만) | 도메인별 하네스로 역할·툴·제약 사전 정의 |
| 도메인 분석 기능 | 없음 | 사전 구현 도메인 블록 (기술적 분석, 기관 추적 등) |
| 커스텀 로직 | 없음 | 프롬프트/스킬 기반 커스텀 블록 |
| 외부 채널 | 없음 | Slack/Discord 메시지 송신 |
| 웹 검색 | 없음 (Tool로 없음) | Web Search 노드 |
| 조건 분기 | 없음 | AND/OR 게이트 노드 |

### 에이전트 하네스(Agent Harness)란?

**에이전트 하네스**는 특정 도메인을 위해 에이전트의 **역할·사용 가능 툴·시스템 프롬프트·제약 조건·출력 포맷**을 미리 묶어놓은 설정 꾸러미다. 사용자가 워크플로우 노드에 에이전트를 배치할 때 하네스를 선택하면, 별도로 시스템 프롬프트를 작성하지 않아도 도메인에 최적화된 에이전트가 즉시 구성된다.

```
하네스 없음:  AgentNode { model, systemPrompt: "..." } ← 사용자가 직접 작성
하네스 있음:  AgentNode { harness: "finance_analyst" } ← 하네스가 나머지를 자동 주입
```

하네스 도입의 핵심 이점:
- **재사용성**: 동일한 역할 정의를 여러 워크플로우에서 공유
- **일관성**: 도메인별 베스트 프랙티스(툴 조합, 출력 스키마)를 표준화
- **가시성**: 에디터 UI에서 "이 에이전트가 어떤 역할을 하는지" 즉시 파악 가능
- **확장성**: 커스텀 하네스 추가로 새 도메인을 플러그인처럼 지원

### 도메인 블록(Domain Block)이란?

**도메인 블록**은 특정 도메인의 반복 작업을 **미리 구현해둔 기능 단위**다. 에이전트 하네스가 "AI의 역할·성격"을 정의하는 반면, 도메인 블록은 "실제로 어떤 작업을 수행할지"를 정의한다. 레고 블록처럼 원하는 블록을 캔버스에 꺼내 연결하면 워크플로우가 완성된다.

```
에이전트 접근:  [금융 분석가 에이전트] → "데이터를 수집하고 분석해줘" (자유 형식)
블록 접근:      [거래량 폭증 찾기] → [RSI 범위 거르기] → [큰손 추적] (구조화된 파이프라인)
```

블록에는 두 가지 종류가 있다:

| 종류 | 설명 | 구현 방식 |
|------|------|-----------|
| **내장 블록 (Built-in)** | 특정 API·라이브러리를 직접 호출하는 사전 구현 블록 | TypeScript 네이티브 코드 |
| **커스텀 블록 (Custom)** | 사용자가 직접 만든 블록 | 프롬프트 또는 스킬 파일 기반 |

커스텀 블록의 구현 방식:

```
prompt 방식:  사용자가 직접 프롬프트 템플릿 작성 → LLM이 inputs를 기반으로 처리
skill 방식:   기존 스킬 파일(.skill.md)을 참조 → AgentOrchestrator가 스킬 지시에 따라 실행
```

v0.2.0 금융 도메인 내장 블록 목록:

| 블록 ID | 이름 | 카테고리 |
|---------|------|----------|
| `finance.box_breakout` | 박스권 돌파 찾기 | 기술적 분석 |
| `finance.volume_surge` | 거래량 폭증 찾기 | 거래량 분석 |
| `finance.rsi_filter` | RSI 범위 거르기 | 기술적 분석 |
| `finance.golden_cross` | 골든 크로스 찾기 | 이동평균 |
| `finance.vsp_pattern` | VSP 패턴 찾기 | 복합 패턴 |
| `finance.big_money_tracker` | 큰손 추적 | 기관·외국인 |

---

## 2. 아키텍처 설계

### 2.1 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                  Desktop App (Tauri v2)                  │
│                                                          │
│  pages/Workflows.tsx  ←→  WorkflowCanvas (React Flow)   │
│       │                                                  │
│       │ HTTP/SSE                                         │
│       ▼                                                  │
│  apps/server/routes/workflow.ts                          │
│       │                                                  │
│       ▼                                                  │
│  packages/workflow-engine/                               │
│  ├── executor.ts      (노드 순서 결정 + 실행)            │
│  ├── graph.ts         (DAG 위상정렬)                     │
│  ├── nodes/                                              │
│  │   ├── agent.ts         (AgentOrchestrator 래퍼)       │
│  │   ├── block.ts         (도메인 블록 실행 노드)         │
│  │   ├── gate.ts          (AND/OR 게이팅 로직)           │
│  │   ├── slack.ts         (Slack Web API)                │
│  │   ├── discord.ts       (Discord Webhook)              │
│  │   └── web-search.ts    (Tavily Search API)            │
│  ├── blocks/                                             │
│  │   ├── registry.ts      (블록 레지스트리)              │
│  │   ├── finance/         (금융 내장 블록 구현체)         │
│  │   │   ├── lib/         (KIS API 클라이언트, 지표 계산) │
│  │   │   ├── box-breakout.ts                             │
│  │   │   ├── volume-surge.ts                             │
│  │   │   ├── rsi-filter.ts                               │
│  │   │   ├── golden-cross.ts                             │
│  │   │   ├── vsp-pattern.ts                              │
│  │   │   └── big-money-tracker.ts                        │
│  │   └── coding/          (코딩 블록 — v0.3.0 예정)      │
│  └── index.ts                                            │
│                                                          │
│  apps/server/db/workflows.ts  (SQLite CRUD)              │
│  apps/server/db/blocks.ts     (커스텀 블록 CRUD)         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 워크플로우 데이터 모델

워크플로우는 **방향성 비순환 그래프(DAG)** 로 표현한다.

```typescript
// packages/shared/src/types/workflow.ts (신규)

export type NodeType =
  | 'trigger'          // 시작점 (수동 트리거 or 예약)
  | 'agent_finance'    // 금융 에이전트
  | 'agent_coding'     // 코딩 에이전트
  | 'block'            // 도메인 블록 (config.blockId로 구체 블록 지정)
  | 'gate_and'         // AND 게이트 (모든 입력 완료 시 통과)
  | 'gate_or'          // OR 게이트 (하나의 입력 완료 시 통과)
  | 'web_search'       // 웹 검색
  | 'slack_message'    // Slack 메시지 전송
  | 'discord_message'  // Discord 웹훅 메시지 전송
  | 'output';          // 최종 출력 (워크플로우 결과 집계)

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };  // 캔버스 좌표
  config: Record<string, unknown>;       // 노드별 설정값
}

export interface WorkflowEdge {
  id: string;
  source: string;   // 출발 노드 id
  target: string;   // 도착 노드 id
  label?: string;   // 조건 레이블 (optional)
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  domain: 'finance' | 'coding' | 'general';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}
```

### 2.3 노드 실행 계약

```typescript
// packages/workflow-engine/src/types.ts (신규)

export interface NodeContext {
  workflowId: string;
  runId: string;
  nodeId: string;
  inputs: Record<string, unknown>;   // 상위 노드 출력 결합
  settings: Record<string, string>;  // API 키 등 (서버 settings DB에서 주입)
  signal?: AbortSignal;
  // LLM 어댑터 주입 방식: AgentNode.execute() 내부에서 settings의
  // ANTHROPIC_API_KEY / GOOGLE_API_KEY / llmProvider 값을 읽어 어댑터를 직접 생성한다.
  // executor.ts에서 어댑터를 미리 생성해 NodeContext에 실어 보내지 않는다.
}

export interface NodeResult {
  ok: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

// ⚠️ packages/shared의 WorkflowNode(그래프 데이터 노드)와 이름 충돌을 피하기 위해
// 실행 가능 노드 인터페이스는 ExecutableNode로 명명한다.
export interface ExecutableNode {
  type: NodeType;
  execute(ctx: NodeContext): Promise<NodeResult>;
}
```

모든 노드는 이 인터페이스를 구현한다. `executor.ts`는 DAG 위상정렬 순서로 노드를 실행하고, 노드 출력을 다음 노드 `inputs`에 전달한다.

### 2.4 에이전트 하네스 데이터 모델

하네스는 에이전트 노드가 실행될 때 주입되는 **정적 설정 번들**이다.

```typescript
// packages/shared/src/types/workflow.ts 에 추가

export interface AgentHarness {
  id: string;                          // 고유 식별자 (예: 'finance_analyst')
  name: string;                        // 표시 이름 (예: '금융 분석가')
  domain: 'finance' | 'coding' | 'general';
  description: string;                 // 하네스 역할 설명
  systemPrompt: string;                // 주입될 시스템 프롬프트
  allowedTools: string[];              // 사용 가능한 Tool 이름 목록
  outputSchema?: Record<string, unknown>; // 기대 출력 JSON 스키마 (옵션)
  constraints?: {
    maxSteps?: number;                 // 최대 에이전트 스텝 수
    maxTokens?: number;                // 최대 출력 토큰
    timeoutMs?: number;                // 실행 타임아웃
  };
  isBuiltIn?: boolean;                 // true이면 내장 하네스 — PUT/DELETE 시 403 반환
  meta?: Record<string, unknown>;      // 도메인별 추가 메타데이터
}
```

#### 내장 하네스 (Built-in Harnesses)

v0.2.0에서 기본으로 제공되는 하네스는 서버 패키지에 정적으로 정의하고, 사용자가 커스텀 하네스를 추가할 수 있는 구조를 열어둔다.

| 하네스 ID | 도메인 | 역할 | 허용 툴 |
|-----------|--------|------|---------|
| `finance_analyst` | finance | 시장·뉴스 데이터 분석 후 인사이트 JSON 생성 | `web_search`, `read_file` |
| `finance_risk` | finance | 포트폴리오/시나리오 리스크 평가 | `web_search`, `read_file`, `write_file` |
| `coding_reviewer` | coding | 코드 품질·버그·보안 리뷰 | `read_file`, `list_files`, `shell` |
| `coding_test_writer` | coding | 주어진 코드에 대한 테스트 케이스 생성 | `read_file`, `write_file`, `shell` |
| `coding_refactor` | coding | 코드 리팩터링 및 개선 제안 | `read_file`, `write_file`, `list_files` |

#### 하네스 주입 흐름

```
WorkflowNode.config.harnessId = 'finance_analyst'
        ↓
executor.ts → resolveHarness(harnessId)
        ↓
AgentNode.execute()에서:
  - systemPrompt ← harness.systemPrompt
  - allowedTools ← harness.allowedTools (툴 필터링)
  - maxSteps     ← harness.constraints.maxSteps
        ↓
AgentOrchestrator.run({ ... })
```

#### 하네스 vs 시스템 프롬프트 우선순위

노드 설정에서 `harnessId`와 `systemPrompt`가 공존할 경우:

```
최종 systemPrompt = harness.systemPrompt + "\n\n---\n" + node.config.systemPrompt
```

하네스가 기반을 제공하고, 노드 레벨 프롬프트가 추가 문맥을 덧붙이는 방식이다.

---

### 2.5 게이팅 노드 동작

| 게이트 타입 | 발화 조건 | 활용 예 |
|-------------|-----------|---------|
| **AND** | 모든 입력 엣지의 노드가 완료 | 금융 분석 + 리스크 평가 둘 다 끝난 뒤 보고서 생성 |
| **OR** | 입력 엣지 중 하나라도 완료 | 코딩 에이전트 A 또는 B 중 먼저 완료된 결과 사용 |

> **⚠️ v0.2.0 실행 모델 주의**: 현재 `executor.ts`는 위상정렬 순서대로 **순차 실행**한다. 따라서 OR 게이트에 여러 에이전트가 연결되어 있어도 실제로는 한 번에 하나씩 완료된다. "첫 번째 완료된 입력만 사용"이라는 OR 동작은 **병렬 실행 시나리오를 미리 지원하는 인터페이스**이며, 병렬 실행(Promise.all 기반)은 v0.3.0에서 구현 예정이다. v0.2.0에서는 OR 게이트가 사실상 "가장 상위에 완료된 입력 한 개를 선택"하는 단순 필터로 동작한다.

AND 게이트는 완료 카운터(Map)로 추적하고, OR 게이트는 첫 번째 입력만 선택해 전달한다.

---

### 2.6 도메인 블록 아키텍처

#### 블록 실행 계약

블록은 `ExecutableNode`와 별개로 `NativeBlockExecutor` 인터페이스를 구현한다. `BlockNode`(ExecutableNode)가 블록을 조회하고, 구현 타입에 따라 분기 실행하는 중간자 역할을 한다.

```typescript
// packages/workflow-engine/src/blocks/types.ts

export interface BlockParams {
  [key: string]: unknown;  // 사용자가 NodeConfig 패널에서 입력한 파라미터 값
}

export interface BlockExecutionContext {
  params: BlockParams;
  inputs: Record<string, unknown>;   // 상위 노드 출력
  settings: Record<string, string>;  // API 키 등
  signal?: AbortSignal;
}

export interface BlockResult {
  ok: boolean;
  output: unknown;   // 다음 노드에 전달될 데이터
  error?: string;
  meta?: Record<string, unknown>;  // 디버그용 메타 (실행 중간 지표값 등)
  durationMs: number;
}

// native 블록 구현체가 구현해야 하는 인터페이스
export interface NativeBlockExecutor {
  blockId: string;
  execute(ctx: BlockExecutionContext): Promise<BlockResult>;
}
```

`BlockNode`의 실행 흐름:

```
BlockNode.execute(ctx)
  ↓
blockId = ctx.inputs['blockId'] ← nodeConfig에서 주입
block = resolveBlock(blockId)   ← WorkflowBlock 메타 조회
  ↓
if implementationType === 'native':
  executor = getNativeExecutor(blockId)  ← NativeBlockExecutor 조회
  return executor.execute({ params, inputs, settings, signal })

if implementationType === 'prompt':
  prompt = block.promptTemplate
    .replace('{{params}}', JSON.stringify(params))
    .replace('{{inputs}}', JSON.stringify(inputs))
  return AgentOrchestrator.runSingleTurn(prompt, settings)

if implementationType === 'skill':
  skill = loadSkill(block.skillId)
  return AgentOrchestrator.runWithSkill(skill, inputs, settings)
```

#### 블록 레지스트리

```typescript
// packages/workflow-engine/src/blocks/registry.ts

const builtInRegistry = new Map<string, NativeBlockExecutor>();
const metaRegistry = new Map<string, WorkflowBlock>();

export function registerNativeBlock(meta: WorkflowBlock, executor: NativeBlockExecutor): void {
  metaRegistry.set(meta.id, meta);
  builtInRegistry.set(meta.id, executor);
}

export function resolveBlock(id: string): WorkflowBlock | undefined {
  return metaRegistry.get(id);
}

export function getNativeExecutor(id: string): NativeBlockExecutor | undefined {
  return builtInRegistry.get(id);
}

export function listBlocks(domain?: string): WorkflowBlock[] {
  const all = [...metaRegistry.values()];
  return domain ? all.filter((b) => b.domain === domain) : all;
}
```

#### 내장 금융 블록 상세 명세

모든 금융 내장 블록은 **KIS Developers API (한국투자증권)**를 통해 국내 주식 데이터를 조회한다. `requiredSettings: ['KIS_APP_KEY', 'KIS_APP_SECRET']`가 공통 필수 조건이다. KIS API는 OAuth 2.0 방식이므로, 블록 실행 전 `KIS_APP_KEY` + `KIS_APP_SECRET`로 Access Token을 발급한 뒤 API를 호출한다. 발급된 토큰은 실행 세션 내에서 메모리 캐시한다.

기술 지표 계산은 `technicalindicators` npm 패키지를 사용한다 (RSI, SMA, EMA 등).

| 블록 ID | 이름 | 파라미터 | 출력 형식 |
|---------|------|----------|-----------|
| `finance.box_breakout` | 박스권 돌파 찾기 | `lookbackPeriod`(20), `breakoutPct`(2.0), `universe`('KOSPI200') | `{ symbols: [{ code, name, breakoutPct, price }] }` |
| `finance.volume_surge` | 거래량 폭증 찾기 | `multiplier`(3.0), `lookbackPeriod`(10), `universe`('KOSPI200') | `{ symbols: [{ code, name, volumeRatio, volume }] }` |
| `finance.rsi_filter` | RSI 범위 거르기 | `period`(14), `minRsi`(30), `maxRsi`(70) | `{ symbols: [{ code, name, rsi }] }` |
| `finance.golden_cross` | 골든 크로스 찾기 | `shortPeriod`(5), `longPeriod`(20), `recentDays`(3) | `{ symbols: [{ code, name, crossedAt, shortMa, longMa }] }` |
| `finance.vsp_pattern` | VSP 패턴 찾기 | `volumeMultiplier`(2.0), `priceChangePct`(3.0) | `{ symbols: [{ code, name, volumeRatio, priceChange }] }` |
| `finance.big_money_tracker` | 큰손 추적 | `actor`('both'), `minNetBuying`(1000000000), `lookbackDays`(5) | `{ symbols: [{ code, name, foreignNet, institutionNet }] }` |

#### 커스텀 블록 생성 흐름

```
사용자 입력:
  이름, 도메인, 카테고리, 설명
  ↓
구현 방식 선택:
  [프롬프트 작성] → promptTemplate 필드 입력
                    ({{params}}, {{inputs}} 플레이스홀더 사용)
  [스킬 연결]    → 기존 스킬 목록에서 skillId 선택
  ↓
파라미터 정의 (선택):
  key, label, type, default, min, max 순서로 N개 추가
  ↓
저장 → custom_blocks SQLite 테이블 + 서버 블록 레지스트리에 런타임 등록
```

#### 블록 파이프라인 예시 (금융 주식 스크리닝)

```
[Trigger]
    ↓
[거래량 폭증 찾기]          ← symbols 목록 출력
    ↓
[RSI 범위 거르기]           ← 과매수 종목 제거 (RSI < 70)
    ↓
[골든 크로스 찾기]          ← 추가 모멘텀 확인
    ↓
[큰손 추적]                 ← 기관·외국인 매수 동반 종목만
    ↓
[금융 분석가 에이전트]       ← 필터링 결과 분석 및 인사이트 생성
    ↓
[Slack 전송: #stock-alerts]
```

각 블록의 output은 `{ symbols: [...] }` 형식이며, 다음 블록이 이를 `inputs`로 받아 자체 필터 조건을 추가로 적용한다. 블록 체이닝에서 inputs의 `symbols` 배열이 누적 필터링되는 방식이다.

---

| 영역 | 기술 | 선택 이유 |
|------|------|-----------|
| **노드 캔버스** | React Flow (`@xyflow/react`) | 오픈소스, TSX 우선, 커스텀 노드 API 우수 |
| **웹 검색 API** | Tavily Search API | LLM 친화적 응답 포맷, 무료 티어 제공 |
| **Slack 연동** | `@slack/web-api` | 공식 SDK, chat.postMessage 지원 |
| **Discord 연동** | HTTP Webhook (라이브러리 불필요) | 단방향 전송이므로 Webhook URL만으로 충분 |
| **DAG 정렬** | 자체 구현 (BFS 위상정렬) | 외부 의존성 없이 150줄 이내 구현 가능 |
| **에이전트 하네스** | 정적 정의 + DB 커스텀 | 서버 패키지에 내장 하네스 번들, DB로 사용자 정의 하네스 확장 |
| **주식 데이터 API** | KIS Developers API (한국투자증권) | 국내 주식 OHLCV·거래량·기관·외국인 데이터 공식 제공, OAuth 2.0 |
| **기술 지표 계산** | `technicalindicators` (npm) | RSI, SMA, EMA 등 주요 지표 구현 내장, 외부 API 불필요 |
| **도메인 블록** | 정적 정의(native) + DB 커스텀(prompt/skill) | 내장 블록은 코드로 번들, 커스텀 블록은 DB에 저장 후 런타임 등록 |
| **패키지** | `packages/workflow-engine/` | 서버와의 관심사 분리, 향후 테스트 용이 |

---

## 4. 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| `packages/workflow-engine/package.json` | 패키지 메타 |
| `packages/workflow-engine/tsconfig.json` | TypeScript 설정 |
| `packages/workflow-engine/src/types.ts` | NodeContext, NodeResult, ExecutableNode 인터페이스 |
| `packages/workflow-engine/src/graph.ts` | DAG 위상정렬 (BFS Kahn's algorithm) |
| `packages/workflow-engine/src/executor.ts` | 워크플로우 실행 오케스트레이터 |
| `packages/workflow-engine/src/nodes/trigger.ts` | 시작 트리거 노드 (inputs를 그대로 통과) |
| `packages/workflow-engine/src/nodes/output.ts` | 최종 출력 노드 (각 입력을 병합해 반환) |
| `packages/workflow-engine/src/nodes/trigger.ts` | 트리거 노드 (inputs 통과) |
| `packages/workflow-engine/src/nodes/output.ts` | 최종 출력 집계 노드 |
| `packages/workflow-engine/src/nodes/agent.ts` | AgentOrchestrator 래퍼 노드 |
| `packages/workflow-engine/src/nodes/block.ts` | 도메인 블록 실행 노드 (native/prompt/skill 분기) |
| `packages/workflow-engine/src/nodes/gate.ts` | AND/OR 게이팅 노드 |
| `packages/workflow-engine/src/nodes/web-search.ts` | Tavily 웹 검색 노드 |
| `packages/workflow-engine/src/nodes/slack.ts` | Slack Web API 메시지 전송 노드 |
| `packages/workflow-engine/src/nodes/discord.ts` | Discord Webhook 메시지 전송 노드 |
| `packages/workflow-engine/src/blocks/types.ts` | BlockExecutionContext, BlockResult, NativeBlockExecutor 인터페이스 |
| `packages/workflow-engine/src/blocks/registry.ts` | 블록 레지스트리 (등록·조회·목록) |
| `packages/workflow-engine/src/blocks/finance/index.ts` | 금융 내장 블록 일괄 등록 |
| `packages/workflow-engine/src/blocks/finance/lib/kis-client.ts` | KIS Developers API OAuth 클라이언트 |
| `packages/workflow-engine/src/blocks/finance/lib/indicators.ts` | technicalindicators 래퍼 (RSI, SMA, EMA) |
| `packages/workflow-engine/src/blocks/finance/box-breakout.ts` | 박스권 돌파 찾기 구현체 |
| `packages/workflow-engine/src/blocks/finance/volume-surge.ts` | 거래량 폭증 찾기 구현체 |
| `packages/workflow-engine/src/blocks/finance/rsi-filter.ts` | RSI 범위 거르기 구현체 |
| `packages/workflow-engine/src/blocks/finance/golden-cross.ts` | 골든 크로스 찾기 구현체 |
| `packages/workflow-engine/src/blocks/finance/vsp-pattern.ts` | VSP 패턴 찾기 구현체 |
| `packages/workflow-engine/src/blocks/finance/big-money-tracker.ts` | 큰손 추적 구현체 |
| `packages/workflow-engine/src/blocks/coding/index.ts` | 코딩 블록 (v0.2.0은 빈 파일, v0.3.0 확장용) |
| `packages/workflow-engine/src/harness/index.ts` | 내장 하네스 정의 및 레지스트리 |
| `packages/workflow-engine/src/harness/finance.ts` | 금융 도메인 내장 하네스 (analyst, risk) |
| `packages/workflow-engine/src/harness/coding.ts` | 코딩 도메인 내장 하네스 (reviewer, test_writer, refactor) |
| `packages/workflow-engine/src/index.ts` | 패키지 진입점 (export) |
| `packages/shared/src/types/workflow.ts` | 공유 워크플로우 타입 (Workflow, WorkflowNode, WorkflowEdge) |
| `apps/server/src/db/workflows.ts` | 워크플로우 CRUD (SQLite) |
| `apps/server/src/routes/workflow.ts` | 워크플로우 REST + SSE 실행 라우트 |
| `apps/desktop/src/pages/Workflows.tsx` | 워크플로우 목록·빌더 진입 페이지 |
| `apps/desktop/src/pages/WorkflowEditor.tsx` | React Flow 기반 워크플로우 편집기 |
| `apps/desktop/src/components/workflow/NodePalette.tsx` | 좌측 노드 팔레트 (드래그 소스) |
| `apps/desktop/src/components/workflow/nodes/AgentNode.tsx` | 에이전트 노드 커스텀 컴포넌트 |
| `apps/desktop/src/components/workflow/nodes/GateNode.tsx` | AND/OR 게이트 노드 커스텀 컴포넌트 |
| `apps/desktop/src/components/workflow/nodes/SearchNode.tsx` | 웹 검색 노드 커스텀 컴포넌트 |
| `apps/desktop/src/components/workflow/nodes/MessageNode.tsx` | Slack/Discord 노드 커스텀 컴포넌트 |
| `apps/desktop/src/components/workflow/NodeConfig.tsx` | 우측 노드 설정 패널 |
| `apps/desktop/src/components/workflow/RunPanel.tsx` | 워크플로우 실행 결과 패널 |
| `apps/desktop/src/pages/Harnesses.tsx` | 하네스 목록·관리 페이지 |
| `apps/desktop/src/components/workflow/HarnessSelector.tsx` | 노드 설정 패널 내 하네스 선택 드롭다운 |
| `apps/desktop/src/components/workflow/nodes/BlockNode.tsx` | 도메인 블록 노드 커스텀 컴포넌트 |
| `apps/desktop/src/pages/Blocks.tsx` | 블록 목록·관리 페이지 (내장 + 커스텀) |
| `apps/desktop/src/components/workflow/BlockPalette.tsx` | 블록 팔레트 (카테고리별 그룹화, 드래그 소스) |
| `apps/desktop/src/components/workflow/BlockParamForm.tsx` | NodeConfig 내 블록 파라미터 동적 폼 |
| `apps/server/src/db/harnesses.ts` | 커스텀 하네스 CRUD (SQLite) |
| `apps/server/src/routes/harness.ts` | 하네스 REST 라우트 |
| `apps/server/src/db/blocks.ts` | 커스텀 블록 CRUD (SQLite) |
| `apps/server/src/routes/blocks.ts` | 블록 REST 라우트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|---------|
| `packages/shared/src/index.ts` | workflow 타입 재출력 |
| `packages/shared/src/types/api.ts` | 워크플로우 API 타입 추가 |
| `pnpm-workspace.yaml` | `packages/workflow-engine` 등록 확인 |
| `apps/server/src/index.ts` | `/api/workflow` 라우트 마운트 |
| `apps/server/src/db/schema.ts` | `workflows` 테이블 마이그레이션 추가 |
| `apps/server/src/db/settings.ts` | Slack/Discord/Tavily/KIS API 키 읽기 헬퍼 추가 |
| `apps/server/package.json` | `@slack/web-api`, `@neos-work/workflow-engine` 의존성 추가 |
| `packages/workflow-engine/package.json` | `technicalindicators` 의존성 추가 |
| `apps/server/src/index.ts` | `/api/blocks` 라우트 마운트 추가 |
| `apps/desktop/package.json` | `@xyflow/react` 의존성 추가 |
| `apps/desktop/src/App.tsx` | `/workflows` 및 `/workflows/:id` 라우트 추가 |
| `apps/desktop/src/components/Sidebar.tsx` | Workflows 네비게이션 항목 추가 |
| `apps/desktop/src/lib/engine.ts` | 워크플로우 API 클라이언트 메서드 추가 |
| `packages/core/src/tools/web-search.ts` | Tavily 단순 검색 툴 구현 (Tool 인터페이스) |
| `apps/desktop/src/i18n` | workflows 네임스페이스 번역 추가 |

---

## 5. Task 별 구현 계획

---

### Task 1: 공유 타입 및 DB 스키마 정의

**Files:**
- Create: `packages/shared/src/types/workflow.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/types/api.ts`
- Modify: `apps/server/src/db/schema.ts`

- [ ] **Step 1: workflow.ts 타입 작성**

  ```typescript
  // packages/shared/src/types/workflow.ts
  export type NodeType =
    | 'trigger'
    | 'agent_finance'
    | 'agent_coding'
    | 'block'
    | 'gate_and'
    | 'gate_or'
    | 'web_search'
    | 'slack_message'
    | 'discord_message'
    | 'output';

  export interface WorkflowNode {
    id: string;
    type: NodeType;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
  }

  export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
  }

  export interface Workflow {
    id: string;
    name: string;
    description?: string;
    domain: 'finance' | 'coding' | 'general';
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    createdAt: string;
    updatedAt: string;
  }

  export interface WorkflowRun {
    id: string;
    workflowId: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    nodeResults: Record<string, NodeRunResult>;
    startedAt: string;
    completedAt?: string;
    error?: string;
  }

  export interface NodeRunResult {
    nodeId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    output?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }

  // ──────────────────────────────────────────────────────
  // 도메인 블록 타입
  // ──────────────────────────────────────────────────────

  export type BlockImplementationType = 'native' | 'prompt' | 'skill';

  export interface BlockParamDef {
    key: string;
    label: string;
    type: 'number' | 'string' | 'boolean' | 'select';
    description?: string;
    default?: unknown;
    options?: string[];   // select 타입에서 사용
    min?: number;
    max?: number;
  }

  export interface WorkflowBlock {
    id: string;                          // 고유 식별자 (예: 'finance.box_breakout')
    name: string;                        // 표시 이름 (예: '박스권 돌파 찾기')
    domain: 'finance' | 'coding' | 'general';
    category: string;                    // 카테고리 (예: 'technical_analysis')
    description: string;                 // 블록 기능 설명
    isBuiltIn: boolean;                  // true이면 내장 블록 (수정·삭제 불가)
    implementationType: BlockImplementationType;
    paramDefs: BlockParamDef[];          // 사용자 설정 가능한 파라미터 정의
    inputDescription: string;            // 이 블록이 기대하는 upstream inputs 설명
    outputDescription: string;           // 이 블록이 반환하는 output 설명
    requiredSettings?: string[];         // 필요한 외부 API 설정 키 (native 블록)
    // prompt/skill 블록 전용
    promptTemplate?: string;             // {{params}}·{{inputs}} 플레이스홀더 포함 프롬프트
    skillId?: string;                    // 참조할 스킬 ID
  }
  ```

- [ ] **Step 2: API 타입 추가 (`api.ts`)**

  ```typescript
  // 워크플로우 CRUD
  export interface CreateWorkflowRequest {
    name: string;
    description?: string;
    domain: 'finance' | 'coding' | 'general';
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  }

  export interface UpdateWorkflowRequest {
    name?: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
  }

  // 실행 결과 SSE 이벤트
  export type WorkflowSSEEvent =
    | { type: 'run.started'; runId: string }
    | { type: 'node.started'; nodeId: string; nodeType: NodeType }
    | { type: 'node.completed'; nodeId: string; output: unknown }
    | { type: 'node.failed'; nodeId: string; error: string }
    | { type: 'run.completed'; runId: string; duration: number }
    | { type: 'run.failed'; runId: string; error: string };
  ```

- [ ] **Step 3: SQLite 스키마 추가 (`schema.ts`)**

  `workflows` 테이블:

  | 컬럼 | 타입 | 설명 |
  |------|------|------|
  | `id` | TEXT PK | UUID |
  | `name` | TEXT NOT NULL | 표시 이름 |
  | `description` | TEXT | 설명 |
  | `domain` | TEXT | 'finance' / 'coding' / 'general' |
  | `nodes_json` | TEXT | WorkflowNode[] JSON |
  | `edges_json` | TEXT | WorkflowEdge[] JSON |
  | `created_at` | TEXT | ISO 8601 |
  | `updated_at` | TEXT | ISO 8601 |

  `workflow_runs` 테이블:

  | 컬럼 | 타입 | 설명 |
  |------|------|------|
  | `id` | TEXT PK | UUID |
  | `workflow_id` | TEXT FK | workflows.id |
  | `status` | TEXT | running / completed / failed / cancelled |
  | `node_results_json` | TEXT | Record<nodeId, NodeRunResult> JSON |
  | `started_at` | TEXT | ISO 8601 |
  | `completed_at` | TEXT | 종료 시각 |
  | `error` | TEXT | 실패 이유 |

---

### Task 2: `packages/workflow-engine` 패키지 구현

**Files:**
- Create: `packages/workflow-engine/package.json`
- Create: `packages/workflow-engine/tsconfig.json`
- Create: `packages/workflow-engine/src/types.ts`
- Create: `packages/workflow-engine/src/graph.ts`
- Create: `packages/workflow-engine/src/executor.ts`
- Create: `packages/workflow-engine/src/nodes/agent.ts`
- Create: `packages/workflow-engine/src/nodes/gate.ts`
- Create: `packages/workflow-engine/src/nodes/web-search.ts`
- Create: `packages/workflow-engine/src/nodes/slack.ts`
- Create: `packages/workflow-engine/src/nodes/discord.ts`
- Create: `packages/workflow-engine/src/index.ts`
- Modify: `pnpm-workspace.yaml` (packages/* glob으로 자동 포함되므로 확인만)

#### Step 1: 패키지 메타 파일

  ```json
  // packages/workflow-engine/package.json
  {
    "name": "@neos-work/workflow-engine",
    "version": "0.2.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
      "build": "tsc",
      "dev": "tsc --watch",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@neos-work/core": "workspace:*",
      "@neos-work/shared": "workspace:*",
      "@slack/web-api": "^7.0.0"
    },
    "devDependencies": {
      "typescript": "catalog:"
    }
  }
  ```

#### Step 2: `graph.ts` — DAG 위상정렬

  Kahn's Algorithm을 사용해 실행 순서를 결정한다. 싸이클 감지 시 `Error('Workflow contains a cycle')` 를 throw한다.

  ```typescript
  // packages/workflow-engine/src/graph.ts
  import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';

  export function topologicalSort(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): WorkflowNode[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adj.set(node.id, []);
    }
    for (const edge of edges) {
      adj.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    const queue = nodes.filter((n) => inDegree.get(n.id) === 0);
    const sorted: WorkflowNode[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);
      for (const neighbor of adj.get(node.id) ?? []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(nodes.find((n) => n.id === neighbor)!);
        }
      }
    }

    if (sorted.length !== nodes.length) {
      throw new Error('Workflow contains a cycle');
    }
    return sorted;
  }
  ```

#### Step 3: 게이팅 노드 (`nodes/gate.ts`)

  ```typescript
  // packages/workflow-engine/src/nodes/gate.ts
  import type { NodeContext, NodeResult, ExecutableNode } from '../types.js';

  export class TriggerNode implements ExecutableNode {
    type = 'trigger' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      // 트리거 노드는 워크플로우 시작점 — inputs를 그대로 통과시킨다.
      return { ok: true, output: ctx.inputs, durationMs: 0 };
    }
  }

  export class OutputNode implements ExecutableNode {
    type = 'output' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      // 출력 노드는 모든 상위 노드 출력을 병합해 최종 결과로 반환한다.
      const merged = Object.assign({}, ...Object.values(ctx.inputs).map((v) =>
        typeof v === 'object' && v !== null ? v : { value: v },
      ));
      return { ok: true, output: merged, durationMs: 0 };
    }
  }

  export class AndGateNode implements ExecutableNode {
    type = 'gate_and' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();
      // 모든 상위 노드 입력이 전달되어야 이 노드가 실행되므로
      // executor.ts에서 AND 조건을 보장하고 호출한다.
      // 이 노드 자체는 입력을 그대로 병합해서 다음 노드로 전달.
      const merged = Object.assign({}, ...Object.values(ctx.inputs));
      return { ok: true, output: merged, durationMs: Date.now() - start };
    }
  }

  export class OrGateNode implements ExecutableNode {
    type = 'gate_or' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();
      // executor.ts에서 OR 조건(첫 번째 완료 입력)을 선택해서 호출.
      const firstInput = Object.values(ctx.inputs)[0];
      return { ok: true, output: firstInput, durationMs: Date.now() - start };
    }
  }
  ```

#### Step 4: 에이전트 노드 (`nodes/agent.ts`)

  기존 `AgentOrchestrator`를 래핑한다. `harnessId`가 설정에 있으면 하네스를 주입하고, 없으면 `config.systemPrompt`를 직접 사용한다. 아래 코드가 최종 구현이며 별도의 "하네스 통합 버전"으로 교체하지 않는다.

  ```typescript
  // packages/workflow-engine/src/nodes/agent.ts
  import { AgentOrchestrator, type AgentEvent } from '@neos-work/core';
  import type { NodeContext, NodeResult, ExecutableNode } from '../types.js';
  import { resolveHarness } from '../harness/index.js';

  export class AgentNode implements ExecutableNode {
    constructor(
      public type: 'agent_finance' | 'agent_coding',
      private nodeConfig?: Record<string, unknown>,
    ) {}

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();

      const harnessId = this.nodeConfig?.['harnessId'] as string | undefined;
      const harness = harnessId ? resolveHarness(harnessId) : undefined;

      // 하네스 시스템 프롬프트를 기반으로, 노드 레벨 프롬프트를 추가 문맥으로 덧붙인다.
      const systemPrompt = harness
        ? [harness.systemPrompt, this.nodeConfig?.['systemPrompt']].filter(Boolean).join('\n\n---\n')
        : String(this.nodeConfig?.['systemPrompt'] ?? '');

      const maxSteps = harness?.constraints?.maxSteps ?? Number(this.nodeConfig?.['maxSteps'] ?? 20);

      // 하네스가 있으면 allowedTools 화이트리스트를 툴 레지스트리에 전달해 필터링한다.
      const toolFilter = harness?.allowedTools;

      // LLM 어댑터: settings에서 provider/apiKey를 읽어 내부 생성 (NodeContext 주석 참고).
      const userMessage = JSON.stringify(ctx.inputs);
      const events: AgentEvent[] = [];
      const orchestrator = new AgentOrchestrator({ settings: ctx.settings, toolFilter, maxSteps });

      try {
        for await (const event of orchestrator.run({
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            { role: 'user' as const, content: userMessage },
          ],
          signal: ctx.signal,
        })) {
          events.push(event);
        }
        const result = events.find((e) => e.type === 'result');
        return {
          ok: true,
          output: result ? result.result : null,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          ok: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        };
      }
    }
  }
  ```

#### Step 5: 웹 검색 노드 (`nodes/web-search.ts`)

  Tavily Search API를 직접 `fetch`로 호출한다. 외부 라이브러리 불필요.

  ```typescript
  // packages/workflow-engine/src/nodes/web-search.ts
  import type { NodeContext, NodeResult, ExecutableNode } from '../types.js';

  interface TavilyResult {
    title: string;
    url: string;
    content: string;
    score: number;
  }

  export class WebSearchNode implements ExecutableNode {
    type = 'web_search' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();
      const apiKey = ctx.settings['TAVILY_API_KEY'];
      if (!apiKey) {
        return { ok: false, output: null, error: 'TAVILY_API_KEY not set', durationMs: 0 };
      }

      const query = String(ctx.inputs['query'] ?? ctx.inputs['text'] ?? '');
      if (!query) {
        return { ok: false, output: null, error: 'No query provided', durationMs: 0 };
      }

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          output: null,
          error: `Tavily API error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      const data = await res.json() as { results: TavilyResult[] };
      return {
        ok: true,
        output: data.results,
        durationMs: Date.now() - start,
      };
    }
  }
  ```

#### Step 6: Slack 메시지 노드 (`nodes/slack.ts`)

  ```typescript
  // packages/workflow-engine/src/nodes/slack.ts
  import { WebClient } from '@slack/web-api';
  import type { NodeContext, NodeResult, ExecutableNode } from '../types.js';

  export class SlackMessageNode implements ExecutableNode {
    type = 'slack_message' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();
      const token = ctx.settings['SLACK_BOT_TOKEN'];
      if (!token) {
        return { ok: false, output: null, error: 'SLACK_BOT_TOKEN not set', durationMs: 0 };
      }

      const channel = String(ctx.inputs['channel'] ?? '');
      const text = String(ctx.inputs['text'] ?? JSON.stringify(ctx.inputs));
      if (!channel) {
        return { ok: false, output: null, error: 'Slack channel not specified', durationMs: 0 };
      }

      const client = new WebClient(token);
      const result = await client.chat.postMessage({ channel, text });

      return {
        ok: Boolean(result.ok),
        output: { ts: result.ts, channel: result.channel },
        durationMs: Date.now() - start,
      };
    }
  }
  ```

#### Step 7: Discord 메시지 노드 (`nodes/discord.ts`)

  Discord는 Webhook URL만으로 메시지 전송이 가능하므로 별도 SDK 불필요.

  ```typescript
  // packages/workflow-engine/src/nodes/discord.ts
  import type { NodeContext, NodeResult, ExecutableNode } from '../types.js';

  export class DiscordMessageNode implements ExecutableNode {
    type = 'discord_message' as const;

    async execute(ctx: NodeContext): Promise<NodeResult> {
      const start = Date.now();
      const webhookUrl = ctx.settings['DISCORD_WEBHOOK_URL'];
      if (!webhookUrl) {
        return { ok: false, output: null, error: 'DISCORD_WEBHOOK_URL not set', durationMs: 0 };
      }

      const content = String(ctx.inputs['text'] ?? JSON.stringify(ctx.inputs));

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        return {
          ok: false,
          output: null,
          error: `Discord webhook error: ${res.status}`,
          durationMs: Date.now() - start,
        };
      }

      return { ok: true, output: { sent: true }, durationMs: Date.now() - start };
    }
  }
  ```

  > **보안 주의**: `webhookUrl`은 서버 settings DB에 암호화 저장(`crypto.ts` 활용)하고 절대 클라이언트에 노출하지 않는다.

#### Step 8: 하네스 레지스트리 (`harness/`)

  내장 하네스는 코드로 정적 정의하고, 런타임에 `harnessId`로 조회한다.

  ```typescript
  // packages/workflow-engine/src/harness/finance.ts
  import type { AgentHarness } from '@neos-work/shared';

  export const FINANCE_HARNESSES: AgentHarness[] = [
    {
      id: 'finance_analyst',
      name: '금융 분석가',
      domain: 'finance',
      isBuiltIn: true,
      description: '시장·뉴스 데이터를 수집하고 투자 인사이트 JSON을 생성합니다.',
      systemPrompt: `당신은 금융 전문 AI 에이전트입니다.
주어진 데이터(뉴스, 시장 지표, 재무제표)를 분석하여 다음 형식의 JSON으로 결과를 반환하세요:
{
  "summary": "종합 요약",
  "insights": ["인사이트 1", "인사이트 2"],
  "sentiment": "bullish | bearish | neutral",
  "confidence": 0.0~1.0
}
사실에 근거하지 않은 추측은 명확히 구분하세요.`,
      allowedTools: ['web_search', 'read_file'],
      outputSchema: {
        type: 'object',
        required: ['summary', 'insights', 'sentiment', 'confidence'],
      },
      constraints: { maxSteps: 10, timeoutMs: 120_000 },
    },
    {
      id: 'finance_risk',
      name: '리스크 평가관',
      domain: 'finance',
      isBuiltIn: true,
      description: '포트폴리오 및 시나리오별 리스크를 평가하고 보고서를 작성합니다.',
      systemPrompt: `당신은 금융 리스크 관리 전문가 AI 에이전트입니다.
제공된 포트폴리오 또는 시나리오 데이터를 기반으로 리스크를 평가하고 다음 형식으로 반환하세요:
{
  "riskLevel": "low | medium | high | critical",
  "factors": [{ "name": "리스크 요인", "impact": "high | medium | low", "description": "..." }],
  "mitigations": ["완화 방안 1", "완화 방안 2"],
  "recommendation": "최종 권고 사항"
}`,
      allowedTools: ['web_search', 'read_file', 'write_file'],
      outputSchema: {
        type: 'object',
        required: ['riskLevel', 'factors', 'mitigations', 'recommendation'],
      },
      constraints: { maxSteps: 12, timeoutMs: 150_000 },
    },
  ];
  ```

  ```typescript
  // packages/workflow-engine/src/harness/coding.ts
  import type { AgentHarness } from '@neos-work/shared';

  export const CODING_HARNESSES: AgentHarness[] = [
    {
      id: 'coding_reviewer',
      name: '코드 리뷰어',
      domain: 'coding',
      isBuiltIn: true,
      description: '코드 품질·버그·보안 취약점을 리뷰하고 개선안을 제안합니다.',
      systemPrompt: `당신은 시니어 소프트웨어 엔지니어 AI 에이전트입니다.
주어진 코드를 검토하고 다음 형식으로 결과를 반환하세요:
{
  "score": 0~100,
  "issues": [{ "severity": "critical|high|medium|low", "line": 번호, "description": "..." }],
  "suggestions": ["개선 제안 1", "개선 제안 2"],
  "summary": "종합 평가"
}
OWASP Top 10 보안 취약점을 반드시 확인하세요.`,
      allowedTools: ['read_file', 'list_files', 'shell'],
      outputSchema: {
        type: 'object',
        required: ['score', 'issues', 'suggestions', 'summary'],
      },
      constraints: { maxSteps: 15, timeoutMs: 180_000 },
    },
    {
      id: 'coding_test_writer',
      name: '테스트 작성자',
      domain: 'coding',
      isBuiltIn: true,
      description: '주어진 코드에 대한 단위·통합 테스트를 생성합니다.',
      systemPrompt: `당신은 테스트 엔지니어 AI 에이전트입니다.
주어진 코드를 분석하여 테스트 케이스를 생성하고 파일로 저장하세요.
- 경계값, 정상 케이스, 엣지 케이스를 모두 포함
- 테스트 파일명은 [원본파일].test.[ext] 형식
- 생성된 테스트 파일 경로 목록을 JSON 배열로 반환`,
      allowedTools: ['read_file', 'write_file', 'shell'],
      constraints: { maxSteps: 20, timeoutMs: 240_000 },
    },
    {
      id: 'coding_refactor',
      name: '리팩터링 에이전트',
      domain: 'coding',
      isBuiltIn: true,
      description: '코드 구조 개선, 중복 제거, 가독성 향상을 수행합니다.',
      systemPrompt: `당신은 리팩터링 전문 AI 에이전트입니다.
코드를 분석하고 다음 원칙에 따라 개선하세요:
- SOLID 원칙 준수
- DRY(중복 제거), KISS(단순함 유지)
- 기능 변경 없이 구조만 개선
리팩터링 후 변경 사항 요약을 JSON으로 반환하세요.`,
      allowedTools: ['read_file', 'write_file', 'list_files'],
      constraints: { maxSteps: 25, timeoutMs: 300_000 },
    },
  ];
  ```

  ```typescript
  // packages/workflow-engine/src/harness/index.ts
  import type { AgentHarness } from '@neos-work/shared';
  import { FINANCE_HARNESSES } from './finance.js';
  import { CODING_HARNESSES } from './coding.js';

  const BUILT_IN_HARNESSES: AgentHarness[] = [
    ...FINANCE_HARNESSES,
    ...CODING_HARNESSES,
  ];

  const registry = new Map<string, AgentHarness>(
    BUILT_IN_HARNESSES.map((h) => [h.id, h]),
  );

  export function resolveHarness(id: string): AgentHarness | undefined {
    return registry.get(id);
  }

  export function listHarnesses(domain?: string): AgentHarness[] {
    const all = [...registry.values()];
    return domain ? all.filter((h) => h.domain === domain) : all;
  }

  export function registerHarness(harness: AgentHarness): void {
    registry.set(harness.id, harness);
  }
  ```

#### Step 9: `executor.ts` 워크플로우 실행 오케스트레이터
  // packages/workflow-engine/src/executor.ts

  export interface ExecutorOptions {
    workflow: Workflow;
    settings: Record<string, string>;
    onEvent: (event: WorkflowSSEEvent) => void;
    signal?: AbortSignal;
  }

  export async function executeWorkflow(options: ExecutorOptions): Promise<void> {
    const { workflow, settings, onEvent, signal } = options;
    const runId = crypto.randomUUID();
    const runStartMs = Date.now();

    onEvent({ type: 'run.started', runId });

    // 1. DAG 위상정렬
    const sorted = topologicalSort(workflow.nodes, workflow.edges);

    // 2. 노드 결과 저장소
    const nodeOutputs = new Map<string, unknown>();

    // 3. AND/OR 게이트 대기 카운터
    const gateInputCount = new Map<string, number>();   // 수신된 입력 수
    const gateInputNeeded = new Map<string, number>();  // 필요한 입력 수

    for (const edge of workflow.edges) {
      const targetNode = workflow.nodes.find((n) => n.id === edge.target);
      if (targetNode?.type === 'gate_and' || targetNode?.type === 'gate_or') {
        gateInputNeeded.set(edge.target, (gateInputNeeded.get(edge.target) ?? 0) + 1);
      }
    }

    // 4. 각 노드 순서대로 실행
    for (const node of sorted) {
      if (signal?.aborted) break;

      // 입력 수집
      const incomingEdges = workflow.edges.filter((e) => e.target === node.id);
      const inputs: Record<string, unknown> = {};
      for (const edge of incomingEdges) {
        inputs[edge.source] = nodeOutputs.get(edge.source);
      }

      // AND 게이트: 모든 입력이 준비되어야 실행
      // 참고: Kahn's 위상정렬은 in-degree가 0이 될 때만 노드를 큐에 넣으므로
      // 이 시점에서 이미 모든 상위 노드가 완료된 상태다.
      // 아래 카운터 체크는 추후 병렬 실행 도입 시를 대비한 안전 장치다.
      if (node.type === 'gate_and') {
        const received = (gateInputCount.get(node.id) ?? 0) + incomingEdges.length;
        gateInputCount.set(node.id, received);
        if (received < (gateInputNeeded.get(node.id) ?? 0)) continue; // 아직 대기
      }

      // OR 게이트: 첫 번째 입력만 사용
      if (node.type === 'gate_or') {
        const firstKey = Object.keys(inputs)[0];
        if (firstKey) {
          Object.keys(inputs).forEach((k) => { if (k !== firstKey) delete inputs[k]; });
        }
      }

      onEvent({ type: 'node.started', nodeId: node.id, nodeType: node.type });

      const nodeImpl = resolveNode(node.type);
      const ctx: NodeContext = {
        workflowId: workflow.id,
        runId,
        nodeId: node.id,
        inputs,
        settings,
        signal,
      };

      const result = await nodeImpl.execute(ctx);
      nodeOutputs.set(node.id, result.output);

      if (result.ok) {
        onEvent({ type: 'node.completed', nodeId: node.id, output: result.output });
      } else {
        onEvent({ type: 'node.failed', nodeId: node.id, error: result.error ?? 'Unknown error' });
      }
    }

    onEvent({ type: 'run.completed', runId, duration: Date.now() - runStartMs });
  }

  function resolveNode(type: NodeType, nodeConfig?: Record<string, unknown>): ExecutableNode {
    switch (type) {
      case 'trigger':        return new TriggerNode();
      case 'agent_finance':  return new AgentNode('agent_finance', nodeConfig);
      case 'agent_coding':   return new AgentNode('agent_coding', nodeConfig);
      case 'gate_and':       return new AndGateNode();
      case 'gate_or':        return new OrGateNode();
      case 'web_search':     return new WebSearchNode();
      case 'slack_message':  return new SlackMessageNode();
      case 'discord_message':return new DiscordMessageNode();
      case 'output':         return new OutputNode();
      default:               throw new Error(`Unknown node type: ${type}`);
    }
  }
  ```

  `AgentNode`는 `nodeConfig.harnessId`가 있으면 `resolveHarness()`로 하네스를 로드하고, 없으면 `nodeConfig.systemPrompt`를 직접 사용한다. 하네스가 있을 경우 `allowedTools`로 툴을 필터링하고, `constraints.maxSteps`로 실행을 제한한다. 구체적인 구현은 Task 2 Step 4의 `agent.ts` 코드를 그대로 사용한다.

---

### Task 3: 서버 DB 및 라우트 구현

**Files:**
- Create: `apps/server/src/db/workflows.ts`
- Create: `apps/server/src/routes/workflow.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/settings.ts`
- Modify: `apps/server/package.json`
- Create: `apps/server/src/db/harnesses.ts`
- Create: `apps/server/src/routes/harness.ts`

- [ ] **Step 1: `workflows.ts` DB CRUD**

  기존 `sessions.ts` 패턴을 동일하게 따른다.
  - `createWorkflow(input: CreateWorkflowRequest): Workflow`
  - `listWorkflows(): Workflow[]`
  - `getWorkflow(id: string): Workflow | undefined`
  - `updateWorkflow(id: string, input: UpdateWorkflowRequest): Workflow | undefined`
  - `deleteWorkflow(id: string): void`
  - `saveRun(run: WorkflowRun): void`
  - `getRun(runId: string): WorkflowRun | undefined`

  `nodes_json`과 `edges_json`은 `JSON.stringify`/`JSON.parse`로 처리한다.

- [ ] **Step 2: `workflow.ts` 라우트**

  ```
  GET    /api/workflow           → listWorkflows()
  POST   /api/workflow           → createWorkflow()
  GET    /api/workflow/:id       → getWorkflow()
  PUT    /api/workflow/:id       → updateWorkflow()
  DELETE /api/workflow/:id       → deleteWorkflow()
  POST   /api/workflow/:id/run   → SSE 실행 스트림
  GET    /api/workflow/:id/runs  → 실행 이력 목록
  ```

  SSE 실행 엔드포인트 (`POST /api/workflow/:id/run`):
  1. DB에서 워크플로우 로드
  2. settings DB에서 API 키 일괄 로드 (`TAVILY_API_KEY`, `SLACK_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, Claude/Google 키)
  3. `workflow_runs` 테이블에 `status: 'running'` 레코드 삽입
  4. SSE 스트림 열기
  5. `executeWorkflow()` 호출 → `onEvent` 콜백에서 SSE 이벤트 전송
  6. 완료 시 `workflow_runs` 상태를 `completed`/`failed`로 업데이트

- [ ] **Step 3: `settings.ts` API 키 헬퍼 추가**

  ```typescript
  export function getWorkflowSecrets(db: Database): Record<string, string> {
    return {
      TAVILY_API_KEY: getSetting(db, 'TAVILY_API_KEY') ?? '',
      SLACK_BOT_TOKEN: getSetting(db, 'SLACK_BOT_TOKEN') ?? '',
      DISCORD_WEBHOOK_URL: getSetting(db, 'DISCORD_WEBHOOK_URL') ?? '',
      // 기존 LLM 키도 포함
      ANTHROPIC_API_KEY: getSetting(db, 'ANTHROPIC_API_KEY') ?? '',
      GOOGLE_API_KEY: getSetting(db, 'GOOGLE_API_KEY') ?? '',
    };
  }
  ```

- [ ] **Step 4: `index.ts` 라우트 마운트**

  ```typescript
  import workflowRoute from './routes/workflow.js';
  import harnessRoute from './routes/harness.js';
  app.route('/api/workflow', workflowRoute);
  app.route('/api/harness', harnessRoute);
  ```

- [ ] **Step 5: `harness.ts` 라우트 구현**

  ```
  GET  /api/harness           → 내장 + 커스텀 하네스 전체 목록 반환
  GET  /api/harness/:id       → 단일 하네스 조회
  POST /api/harness           → 커스텀 하네스 생성 (DB 저장)
  PUT  /api/harness/:id       → 커스텀 하네스 수정 (내장 하네스는 403)
  DELETE /api/harness/:id     → 커스텀 하네스 삭제 (내장 하네스는 403)
  ```

  내장 하네스는 `workflow-engine`의 `listHarnesses()`로 읽고, 커스텀 하네스는 `custom_harnesses` SQLite 테이블에서 읽어 병합해서 반환한다.

  `custom_harnesses` 테이블:

  | 컬럼 | 타입 | 설명 |
  |------|------|------|
  | `id` | TEXT PK | 사용자 정의 고유 ID |
  | `name` | TEXT | 표시 이름 |
  | `domain` | TEXT | finance / coding / general |
  | `description` | TEXT | 설명 |
  | `system_prompt` | TEXT | 시스템 프롬프트 |
  | `allowed_tools_json` | TEXT | string[] JSON |
  | `constraints_json` | TEXT | HarnessConstraints JSON |
  | `created_at` | TEXT | ISO 8601 |
  | `updated_at` | TEXT | ISO 8601 |

---

### Task 4: 데스크탑 — 워크플로우 목록 페이지 (`Workflows.tsx`)

**Files:**
- Create: `apps/desktop/src/pages/Workflows.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/Sidebar.tsx`
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: `engine.ts` 워크플로우 클라이언트 메서드 추가**

  ```typescript
  // 기존 ApiClient 클래스에 추가
  listWorkflows(): Promise<ApiResponse<Workflow[]>>
  createWorkflow(input: CreateWorkflowRequest): Promise<ApiResponse<Workflow>>
  getWorkflow(id: string): Promise<ApiResponse<Workflow>>
  updateWorkflow(id: string, input: UpdateWorkflowRequest): Promise<ApiResponse<Workflow>>
  deleteWorkflow(id: string): Promise<ApiResponse<void>>
  runWorkflow(id: string, onEvent: (e: WorkflowSSEEvent) => void): () => void
  ```

  `runWorkflow`는 SSE 스트림을 열고 콜백으로 이벤트를 전달하며, 반환값은 취소 함수다.

- [ ] **Step 2: `Workflows.tsx` 목록 페이지**

  - 워크플로우 목록 카드 그리드 (도메인 태그, 노드 수, 최근 실행 시각 표시)
  - "새 워크플로우" 버튼 → `/workflows/new` 이동
  - 워크플로우 카드 클릭 → `/workflows/:id` 이동

- [ ] **Step 3: 사이드바에 Workflows 항목 추가**

  ```typescript
  { id: 'workflows', path: '/workflows', icon: WorkflowIcon }
  ```

  WorkflowIcon은 SVG 인라인 컴포넌트로 정의한다 (기존 아이콘 패턴과 동일).

- [ ] **Step 4: `App.tsx` 라우트 추가**

  ```typescript
  <Route path="/workflows" element={<Workflows />} />
  <Route path="/workflows/:id" element={<WorkflowEditor />} />
  ```

---

### Task 5: 데스크탑 — 워크플로우 에디터 (`WorkflowEditor.tsx`)

**Files:**
- Create: `apps/desktop/src/pages/WorkflowEditor.tsx`
- Create: `apps/desktop/src/components/workflow/NodePalette.tsx`
- Create: `apps/desktop/src/components/workflow/nodes/AgentNode.tsx`
- Create: `apps/desktop/src/components/workflow/nodes/GateNode.tsx`
- Create: `apps/desktop/src/components/workflow/nodes/SearchNode.tsx`
- Create: `apps/desktop/src/components/workflow/nodes/MessageNode.tsx`
- Create: `apps/desktop/src/components/workflow/NodeConfig.tsx`
- Create: `apps/desktop/src/components/workflow/RunPanel.tsx`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: `@xyflow/react` 설치**

  ```bash
  pnpm --filter @neos-work/desktop add @xyflow/react
  ```

- [ ] **Step 2: `WorkflowEditor.tsx` 레이아웃**

  ```
  ┌────────────────────────────────────────────────────────────────┐
  │  [← 뒤로]  워크플로우 이름  [저장]  [▶ 실행]                  │
  ├──────────┬─────────────────────────────────┬───────────────────┤
  │ NodePalette │       React Flow 캔버스        │  NodeConfig / RunPanel │
  │  (180px) │         (flex-1)               │     (280px)       │
  └──────────┴─────────────────────────────────┴───────────────────┘
  ```

  - 상단: 이름 편집, 저장 버튼, 실행 버튼
  - 좌측 패널: 드래그 가능한 노드 팔레트
  - 중앙: React Flow 캔버스 (`ReactFlow` 컴포넌트)
  - 우측 패널: 선택된 노드 설정 (`NodeConfig`) 또는 실행 결과 (`RunPanel`)

- [ ] **Step 3: 커스텀 노드 컴포넌트 정의**

  각 노드 컴포넌트는 React Flow의 `NodeProps`를 받아 커스텀 렌더링한다.

  | 컴포넌트 | 적용 nodeType | 표시 내용 |
  |----------|---------------|-----------|
  | `AgentNode` | agent_finance, agent_coding | 도메인 아이콘 + 레이블 + 상태 배지 |
  | `GateNode` | gate_and, gate_or | AND/OR 텍스트 + 입력 포트 수 표시 |
  | `SearchNode` | web_search | 검색 아이콘 + 쿼리 미리보기 |
  | `MessageNode` | slack_message, discord_message | 채널 아이콘 + 채널명 |

  노드 색상 코드:
  - 금융 에이전트: 에메랄드(#10b981)
  - 코딩 에이전트: 블루(#3b82f6)
  - AND 게이트: 앰버(#f59e0b)
  - OR 게이트: 오렌지(#f97316)
  - 웹 검색: 퍼플(#8b5cf6)
  - Slack: 초록(#4CAF50)
  - Discord: 인디고(#5865F2)

- [ ] **Step 4: `NodePalette.tsx` — 드래그 앤 드롭 소스**

  React Flow의 `onDragStart` + `setNodeType` 패턴으로 구현.
  도메인 섹션별로 그룹화:
  - **에이전트**: 금융 에이전트, 코딩 에이전트
  - **제어 흐름**: AND 게이트, OR 게이트
  - **데이터**: 웹 검색
  - **메시징**: Slack 전송, Discord 전송

- [ ] **Step 5: `NodeConfig.tsx` — 노드 설정 패널**

  선택된 노드 타입에 따라 동적으로 설정 폼을 렌더링한다.

  | 노드 타입 | 설정 필드 |
  |-----------|-----------|
  | `agent_finance` | **하네스 선택** (드롭다운), 추가 시스템 프롬프트 (선택적 오버라이드), 사용 모델 (드롭다운), 최대 스텝 수 |
  | `agent_coding` | **하네스 선택** (드롭다운), 추가 시스템 프롬프트 (선택적 오버라이드), 사용 모델 (드롭다운), 워크스페이스 경로 |
  | `gate_and` / `gate_or` | 레이블만 편집 가능 |
  | `web_search` | 검색 쿼리 (입력 노드 출력에서 자동 추출 여부 토글) |
  | `slack_message` | 채널명 (예: `#general`) |
  | `discord_message` | (설정 없음, Webhook URL은 전역 설정에서 관리) |

  에이전트 노드 NodeConfig의 하네스 선택 UI 구조:

  ```
  ┌─────────────────────────────────┐
  │  에이전트 설정                  │
  ├─────────────────────────────────┤
  │  하네스                         │
  │  ┌───────────────────────────┐  │
  │  │ [금융 분석가           ▼] │  │  ← HarnessSelector
  │  └───────────────────────────┘  │
  │  finance_analyst                │
  │  "시장·뉴스 데이터를 수집..."  │  ← 하네스 설명 미리보기
  │  허용 툴: web_search, read_file │
  ├─────────────────────────────────┤
  │  추가 지시 (선택)               │
  │  ┌───────────────────────────┐  │
  │  │ (비워두면 하네스 기본값)  │  │
  │  └───────────────────────────┘  │
  ├─────────────────────────────────┤
  │  모델                           │
  │  ┌───────────────────────────┐  │
  │  │ [claude-3-7-sonnet     ▼] │  │
  │  └───────────────────────────┘  │
  └─────────────────────────────────┘
  ```

- [ ] **Step 6: `RunPanel.tsx` — 실행 결과 패널**

  실행 버튼 클릭 시 SSE 스트림을 열고, 이벤트를 실시간으로 표시한다.

  ```
  ┌─────────────────────────────┐
  │  ▶ 실행 중... (00:13)       │
  ├─────────────────────────────┤
  │ ✅ trigger        0ms       │
  │ ✅ web_search     1.2s      │
  │ 🔄 agent_finance  진행 중   │
  │ ⬜ slack_message  대기 중   │
  └─────────────────────────────┘
  ```

  - 각 노드 행: 아이콘(상태) + 노드 이름 + 소요 시간
  - 완료 후 최종 output JSON 접기/펼치기 (토글)

---

### Task 6: 도메인 템플릿 (금융·코딩 스타터)

- [ ] **Step 1: 금융 에이전트 워크플로우 기본 템플릿**

  사용자가 "새 워크플로우"를 만들 때 도메인을 선택하면 해당 템플릿이 캔버스에 로드된다.

  금융 템플릿 구조:
  ```
  [Trigger] → [Web Search: 최신 뉴스 수집]
                        ↓
              [Agent Finance: 뉴스 분석]
                        ↓
              [Agent Finance: 리스크 평가]
                        ↓
              [AND Gate] ←──────────┘
                        ↓
              [Slack 전송: #investment-alerts]
  ```

  금융 에이전트 시스템 프롬프트 기본값:
  > *(하네스 `finance_analyst`가 자동 주입 — 별도 입력 불필요)*

  각 에이전트 노드의 `config.harnessId` 기본값:
  - 뉴스 분석 노드: `finance_analyst`
  - 리스크 평가 노드: `finance_risk`

- [ ] **Step 2: 코딩 에이전트 워크플로우 기본 템플릿**

  코딩 템플릿 구조:
  ```
  [Trigger] ──────────────────────────────────┐
       │                                       │
       ▼                                       ▼
  [Agent Coding: 코드 리뷰]        [Agent Coding: 테스트 생성]
       │                                       │
       └───────────────┬───────────────────────┘
                       ▼
                  [OR Gate]
                       │
                       ▼
            [Discord 전송: #code-review]
  ```

  > **참고**: v0.2.0은 순차 실행이므로 Trigger → 코드 리뷰 → 테스트 생성 → OR Gate 순으로 실행된다.
  > OR Gate는 위상정렬상 마지막에 완료된 에이전트(테스트 생성)의 결과를 선택해 전달한다.
  > "둘 중 빠른 쪽 결과 사용"은 v0.3.0 병렬 실행 이후에 지원된다.

  코딩 에이전트 시스템 프롬프트 기본값:
  > *(하네스가 자동 주입 — 별도 입력 불필요)*

  각 에이전트 노드의 `config.harnessId` 기본값:
  - 코드 리뷰 노드: `coding_reviewer`
  - 테스트 생성 노드: `coding_test_writer`

- [ ] **Step 3: 템플릿을 `WorkflowEditor.tsx`에서 적용**

  `/workflows/new?domain=finance` 또는 `/workflows/new?domain=coding` URL 파라미터로 도메인을 받아 초기 노드/엣지를 설정한다.

---

### Task 7: 설정 페이지에 워크플로우 API 키 섹션 추가

**Files:**
- Modify: `apps/desktop/src/pages/Settings.tsx`
- Modify: `apps/server/src/routes/settings.ts`

- [ ] **Step 1: `Settings.tsx`에 "워크플로우 통합" 섹션 추가**

  기존 API 키 섹션 아래에 새 섹션을 추가한다:

  | 필드 | 키 이름 | 설명 |
  |------|---------|------|
  | Tavily API Key | `TAVILY_API_KEY` | 웹 검색 노드에 사용 |
  | Slack Bot Token | `SLACK_BOT_TOKEN` | Slack 메시지 노드에 사용. `xoxb-` 접두사 |
  | Discord Webhook URL | `DISCORD_WEBHOOK_URL` | Discord 메시지 노드에 사용 |

  값은 마스킹 처리(`*****`)해서 표시하고, 수정 버튼 클릭 시 입력 필드 활성화.

- [ ] **Step 2: 서버 settings 라우트 확인**

  기존 `GET/PUT /api/settings`가 임의의 키를 저장하므로 수정 불필요. 단, 클라이언트에서 반환 시 값 마스킹이 적용되어 있는지 확인.

- [ ] **Step 3: "하네스 관리" 링크 추가**

  Settings 페이지 하단 또는 "워크플로우 통합" 섹션 내에 "하네스 관리 →" 링크 버튼을 추가해 `/harnesses` 페이지로 이동할 수 있도록 한다. 이를 통해 사이드바에 별도 항목 없이도 하네스 관리 페이지 접근 경로를 확보한다.

---

### Task 8: Web Search Tool을 Core Tool로 통합

**Files:**
- Modify: `packages/core/src/tools/web-search.ts`
- Modify: `packages/core/src/tools/index.ts`

> **역할 구분**: `workflow-engine/src/nodes/web-search.ts`(WebSearchNode)와 `packages/core/src/tools/web-search.ts`(webSearchTool)는 **서로 독립적으로 공존**하며, 각각 다른 레이어에서 사용된다.
> - **WebSearchNode**: 워크플로우 그래프의 독립 노드로, 검색 결과를 다음 노드의 `inputs`로 전달한다.
> - **webSearchTool**: AgentOrchestrator 내부에서 에이전트가 추론 중 자율적으로 호출하는 Tool이다. `coding_reviewer` 등 하네스가 `allowedTools`에 `web_search`를 포함하면 이 Tool이 활성화된다.
> 두 구현이 동일한 Tavily API를 호출하므로, 실제 fetch 로직은 공통 헬퍼 함수(`lib/tavily.ts`)로 추출해 재사용하는 것을 권장한다.

현재 `packages/core/src/tools/web-search.ts`가 존재하지만 실제 검색 구현이 없다고 가정한다. Tavily API를 사용해 실제 검색 기능을 완성한다.

- [ ] **Step 1: `web-search.ts` Tool 구현**

  ```typescript
  // packages/core/src/tools/web-search.ts
  import type { Tool, ToolResult } from './base.js';

  export const webSearchTool: Tool = {
    name: 'web_search',
    description: '웹에서 최신 정보를 검색합니다. 실시간 데이터, 뉴스, 기술 문서 검색에 사용하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '검색 쿼리',
        },
      },
      required: ['query'],
    },
    async execute(input: { query: string }, settings?: Record<string, string>): Promise<ToolResult> {
      const apiKey = settings?.['TAVILY_API_KEY'] ?? process.env['TAVILY_API_KEY'];
      if (!apiKey) {
        return { success: false, error: 'TAVILY_API_KEY not configured' };
      }

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query: input.query, max_results: 5 }),
      });

      if (!res.ok) {
        return { success: false, error: `Search API error: ${res.status}` };
      }

      const data = await res.json() as { results: unknown[] };
      return { success: true, output: JSON.stringify(data.results, null, 2) };
    },
  };
  ```

- [ ] **Step 2: `tools/index.ts`에 export 추가**

  `webSearchTool`을 기본 툴셋에 포함한다.

---

### Task 9: i18n 번역 추가

**Files:**
- Modify: `packages/ui/src/i18n/locales/ko/`
- Modify: `packages/ui/src/i18n/locales/en/`

- [ ] **Step 1: 한국어 워크플로우 번역 추가**

  신규 파일 `packages/ui/src/i18n/locales/ko/workflows.json` 생성:

  ```json
  {
    "nav": {
      "workflows": "워크플로우"
    },
    "workflows": {
      "title": "워크플로우",
      "new": "새 워크플로우",
      "empty": "아직 워크플로우가 없습니다",
      "domain": {
        "finance": "금융",
        "coding": "코딩",
        "general": "일반"
      },
      "nodes": {
        "trigger": "트리거",
        "agent_finance": "금융 에이전트",
        "agent_coding": "코딩 에이전트",
        "gate_and": "AND 게이트",
        "gate_or": "OR 게이트",
        "web_search": "웹 검색",
        "slack_message": "Slack 메시지",
        "discord_message": "Discord 메시지",
        "output": "출력"
      },
      "run": {
        "start": "실행",
        "running": "실행 중...",
        "completed": "완료",
        "failed": "실패",
        "cancelled": "취소됨"
      }
    }
  }
  ```

---

## 6. 구현 순서 및 의존성

```
Task 1 (공유 타입 + DB 스키마)                  ← 기반
    ↓
Task 2 (workflow-engine 패키지 + 하네스 레지스트리)
    │                                           Task 8 (Core Web Search Tool) ← Task 2와 병렬 가능
    ↓
Task 3 (서버 라우트 + 하네스 라우트)
    │
    ├── Task 11 (블록 공유 타입 + DB 스키마 + /api/blocks) ← Task 1/3 이후 병렬 가능
    │       ↓
    │   Task 12 (KIS API 클라이언트 + 6개 내장 금융 블록)
    │       ↓
    │   Task 13 (BlockNode + resolveNode() 통합)
    │
    ↓
Task 4 (데스크탑 목록 페이지)
    ↓
Task 5 (워크플로우 에디터 + HarnessSelector UI)
    │
    ├── Task 14 (BlockNode.tsx + BlockPalette) ← Task 5 이후, Task 13과 병렬
    │
    ↓
Task 6 (도메인 템플릿 — 하네스 기본값 포함)
    ↓
Task 10 (하네스 관리 페이지)
    │
    ├── Task 15 (Blocks.tsx 블록 관리 페이지) ← Task 10과 병렬
    │
    ↓
Task 7 (설정 페이지 API 키 — KIS_APP_KEY/SECRET 포함)
    ↓
Task 9 (i18n)
```

**병렬 실행 가능한 작업 쌍:**
- Task 2 ↔ Task 8
- Task 11~13 (블록 엔진) ↔ Task 4~6 (워크플로우 UI) — 단, Task 14는 Task 5·13 모두 완료 후
- Task 10 ↔ Task 15

---

### Task 10: 하네스 관리 페이지 (`Harnesses.tsx`)

**Files:**
- Create: `apps/desktop/src/pages/Harnesses.tsx`
- Create: `apps/desktop/src/components/workflow/HarnessSelector.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: `engine.ts` 하네스 클라이언트 메서드 추가**

  ```typescript
  listHarnesses(domain?: string): Promise<ApiResponse<AgentHarness[]>>
  getHarness(id: string): Promise<ApiResponse<AgentHarness>>
  createHarness(input: CreateHarnessRequest): Promise<ApiResponse<AgentHarness>>
  updateHarness(id: string, input: Partial<AgentHarness>): Promise<ApiResponse<AgentHarness>>
  deleteHarness(id: string): Promise<ApiResponse<void>>
  ```

- [ ] **Step 2: `Harnesses.tsx` 하네스 목록 페이지**

  레이아웃:
  ```
  ┌────────────────────────────────────────────────────────┐
  │  하네스  [+ 새 하네스]     [도메인 필터: 전체 ▼]        │
  ├────────────────────────────────────────────────────────┤
  │  [내장]  금융 분석가         finance  read-only  [사용] │
  │  [내장]  리스크 평가관       finance  read-only  [사용] │
  │  [내장]  코드 리뷰어         coding   read-only  [사용] │
  │  [내장]  테스트 작성자       coding   read-only  [사용] │
  │  [내장]  리팩터링 에이전트   coding   read-only  [사용] │
  │  [커스텀] 내 금융 분석가     finance  [수정] [삭제]      │
  └────────────────────────────────────────────────────────┘
  ```

  - 내장 하네스: 읽기 전용, 배지로 구분 (`[내장]`)
  - 커스텀 하네스: 수정·삭제 가능
  - "사용" 버튼: 클릭 시 워크플로우 목록으로 이동하며 새 워크플로우 생성 시 해당 하네스를 기본 선택으로 전달

- [ ] **Step 3: 하네스 생성/수정 폼**

  `Harnesses.tsx` 내 슬라이드오버 패널(사이드 드로어)로 구현:

  | 필드 | 타입 | 설명 |
  |------|------|------|
  | 이름 | text | 표시 이름 |
  | 도메인 | select | finance / coding / general |
  | 설명 | textarea | 한 줄 설명 |
  | 시스템 프롬프트 | textarea (tall) | 에이전트 역할 정의 |
  | 허용 툴 | multi-checkbox | web_search, read_file, write_file, list_files, shell |
  | 최대 스텝 수 | number | 기본값 20 |
  | 타임아웃(ms) | number | 기본값 120000 |

- [ ] **Step 4: `HarnessSelector.tsx` — NodeConfig 내 드롭다운**

  ```typescript
  interface HarnessSelectorProps {
    domain: 'finance' | 'coding' | 'general';
    value?: string;  // 현재 선택된 harnessId
    onChange: (harnessId: string | undefined) => void;
  }
  ```

  - API에서 도메인별 하네스 목록을 로드해 드롭다운으로 표시
  - 선택된 하네스의 설명·허용 툴을 인라인으로 미리보기
  - "없음 (직접 입력)" 옵션으로 하네스 미사용 모드 지원

- [ ] **Step 5: `App.tsx` 라우트 추가**

  ```typescript
  <Route path="/harnesses" element={<Harnesses />} />
  ```

  사이드바에는 별도 항목을 추가하지 않고, 설정(Settings) 페이지 또는 워크플로우 편집기의 "하네스 관리" 링크에서 접근한다 (네비게이션 오염 방지).

---

### Task 11: 블록 공유 타입 · DB 스키마 · REST 라우트

**Files:**
- Modify: `packages/shared/src/types/workflow.ts` — `WorkflowBlock`, `BlockParamDef`, `BlockImplementationType` 이미 §2.2에서 정의됨, export 확인
- Create: `apps/server/src/db/blocks.ts` — 커스텀 블록 CRUD
- Create: `apps/server/src/routes/blocks.ts` — 블록 REST 라우트
- Modify: `apps/server/src/index.ts` — `/api/blocks` 마운트

- [ ] **Step 1: `blocks.ts` DB 스키마 + CRUD**

  ```typescript
  // apps/server/src/db/blocks.ts
  import Database from 'better-sqlite3';

  // custom_blocks 테이블 (내장 블록은 코드에 번들)
  export function ensureBlocksTable(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_blocks (
        id TEXT PRIMARY KEY,                  -- 사용자 정의 ID (예: 'custom.my_filter')
        name TEXT NOT NULL,
        domain TEXT NOT NULL,                 -- 'finance' | 'coding' | 'general'
        category TEXT NOT NULL DEFAULT 'custom',
        description TEXT NOT NULL DEFAULT '',
        implementation_type TEXT NOT NULL,    -- 'prompt' | 'skill'
        param_defs_json TEXT NOT NULL DEFAULT '[]',
        input_description TEXT NOT NULL DEFAULT '',
        output_description TEXT NOT NULL DEFAULT '',
        prompt_template TEXT,
        skill_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  export function listCustomBlocks(db: Database.Database): WorkflowBlock[] { ... }
  export function getCustomBlock(db: Database.Database, id: string): WorkflowBlock | undefined { ... }
  export function createCustomBlock(db: Database.Database, input: Omit<WorkflowBlock, 'isBuiltIn'>): WorkflowBlock { ... }
  export function updateCustomBlock(db: Database.Database, id: string, input: Partial<WorkflowBlock>): WorkflowBlock { ... }
  export function deleteCustomBlock(db: Database.Database, id: string): void { ... }
  ```

- [ ] **Step 2: `/api/blocks` 라우트**

  ```
  GET    /api/blocks            — 내장 + 커스텀 전체 목록 (domain 쿼리 파라미터로 필터)
  GET    /api/blocks/:id        — 단일 블록 조회
  POST   /api/blocks            — 커스텀 블록 생성 (isBuiltIn: false만 허용)
  PUT    /api/blocks/:id        — 커스텀 블록 수정 (내장 블록 PUT → 403)
  DELETE /api/blocks/:id        — 커스텀 블록 삭제 (내장 블록 DELETE → 403)
  ```

  `GET /api/blocks` 응답:
  ```typescript
  {
    builtIn: WorkflowBlock[];   // workflow-engine 레지스트리에서 조회
    custom: WorkflowBlock[];    // DB에서 조회
  }
  ```

---

### Task 12: KIS API 클라이언트 + 6개 내장 금융 블록

**Files:**
- Create: `packages/workflow-engine/src/blocks/finance/lib/kis-client.ts`
- Create: `packages/workflow-engine/src/blocks/finance/lib/indicators.ts`
- Create: `packages/workflow-engine/src/blocks/finance/box-breakout.ts`
- Create: `packages/workflow-engine/src/blocks/finance/volume-surge.ts`
- Create: `packages/workflow-engine/src/blocks/finance/rsi-filter.ts`
- Create: `packages/workflow-engine/src/blocks/finance/golden-cross.ts`
- Create: `packages/workflow-engine/src/blocks/finance/vsp-pattern.ts`
- Create: `packages/workflow-engine/src/blocks/finance/big-money-tracker.ts`
- Create: `packages/workflow-engine/src/blocks/finance/index.ts`

- [ ] **Step 1: `kis-client.ts` — OAuth + REST 클라이언트**

  ```typescript
  // packages/workflow-engine/src/blocks/finance/lib/kis-client.ts

  interface KisAuth {
    appKey: string;
    appSecret: string;
  }

  let _tokenCache: { token: string; expiresAt: number } | null = null;

  async function getAccessToken(auth: KisAuth): Promise<string> {
    if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
      return _tokenCache.token;
    }
    // POST https://openapi.koreainvestment.com:9443/oauth2/tokenP
    const res = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: auth.appKey,
        appsecret: auth.appSecret,
      }),
    });
    const data = await res.json();
    _tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,  // 60초 여유
    };
    return _tokenCache.token;
  }

  // 주요 API: 일별 OHLCV, 거래량, 기관·외국인 순매수
  export async function fetchDailyOHLCV(auth: KisAuth, symbol: string, days: number) { ... }
  export async function fetchInstitutionForeignFlow(auth: KisAuth, symbol: string, days: number) { ... }
  export async function fetchKOSPI200Symbols(auth: KisAuth): Promise<{ code: string; name: string }[]> { ... }
  ```

  > **보안**: `appKey`·`appSecret`은 `BlockExecutionContext.settings`에서만 주입받으며, 로그에 출력하지 않는다.

- [ ] **Step 2: `indicators.ts` — technicalindicators 래퍼**

  ```typescript
  import { RSI, SMA, EMA } from 'technicalindicators';

  export function calcRSI(closes: number[], period: number): number[] { ... }
  export function calcSMA(closes: number[], period: number): number[] { ... }
  export function calcEMA(closes: number[], period: number): number[] { ... }
  ```

- [ ] **Step 3: 6개 내장 블록 구현**

  각 파일은 `NativeBlockExecutor` 인터페이스를 구현하고, `finance/index.ts`에서 `registerNativeBlock`으로 등록한다.

  ```typescript
  // packages/workflow-engine/src/blocks/finance/index.ts
  import { registerNativeBlock } from '../registry';
  import { boxBreakoutMeta, boxBreakoutExecutor } from './box-breakout';
  // ... 나머지 5개
  export function registerFinanceBlocks(): void {
    registerNativeBlock(boxBreakoutMeta, boxBreakoutExecutor);
    // ...
  }
  ```

  블록별 inputs 처리 방식:
  - 이전 블록 output의 `symbols` 배열이 있으면 그 종목 목록으로 필터링 (파이프라인 체이닝)
  - `symbols`가 없으면 `params.universe` 기준으로 종목 목록 자체 조회

---

### Task 13: `BlockNode` 구현 + `resolveNode()` 통합

**Files:**
- Create: `packages/workflow-engine/src/nodes/block.ts`
- Modify: `packages/workflow-engine/src/executor.ts`

- [ ] **Step 1: `block.ts` — BlockNode**

  ```typescript
  // packages/workflow-engine/src/nodes/block.ts
  import { ExecutableNode, NodeContext, NodeResult } from '../types';
  import { resolveBlock, getNativeExecutor } from '../blocks/registry';
  import { WorkflowBlock } from '@neos-work/shared';

  export class BlockNode implements ExecutableNode {
    async execute(ctx: NodeContext): Promise<NodeResult> {
      const blockId = ctx.config?.blockId as string | undefined;
      if (!blockId) throw new Error('blockId is required for block nodes');

      const block = resolveBlock(blockId);
      if (!block) throw new Error(`Block not found: ${blockId}`);

      const params = (ctx.config?.params as Record<string, unknown>) ?? {};
      const execCtx = {
        params,
        inputs: ctx.inputs,
        settings: ctx.settings,
        signal: ctx.signal,
      };

      if (block.implementationType === 'native') {
        const executor = getNativeExecutor(blockId);
        if (!executor) throw new Error(`Native executor not found: ${blockId}`);
        const result = await executor.execute(execCtx);
        return { ok: result.ok, output: result.output, error: result.error };
      }

      if (block.implementationType === 'prompt') {
        // promptTemplate → LLM single turn
        const prompt = (block.promptTemplate ?? '')
          .replace('{{params}}', JSON.stringify(params))
          .replace('{{inputs}}', JSON.stringify(ctx.inputs));
        // AgentOrchestrator.runSingleTurn 호출 (ctx.settings에서 LLM 키 주입)
        return runPromptBlock(prompt, ctx.settings, ctx.signal);
      }

      if (block.implementationType === 'skill') {
        // 스킬 기반 실행 (AgentOrchestrator + skill)
        return runSkillBlock(block.skillId!, ctx.inputs, ctx.settings, ctx.signal);
      }

      throw new Error(`Unknown implementationType: ${block.implementationType}`);
    }
  }
  ```

- [ ] **Step 2: `executor.ts`의 `resolveNode()`에 `'block'` 케이스 추가**

  ```typescript
  case 'block':
    return new BlockNode();
  ```

---

### Task 14: BlockNode UI + BlockPalette

**Files:**
- Create: `apps/desktop/src/components/workflow/nodes/BlockNode.tsx`
- Create: `apps/desktop/src/components/workflow/BlockPalette.tsx`
- Create: `apps/desktop/src/components/workflow/BlockParamForm.tsx`
- Modify: `apps/desktop/src/components/workflow/NodeConfig.tsx`
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: `engine.ts` 블록 클라이언트 메서드**

  ```typescript
  listBlocks(domain?: string): Promise<ApiResponse<{ builtIn: WorkflowBlock[]; custom: WorkflowBlock[] }>>
  getBlock(id: string): Promise<ApiResponse<WorkflowBlock>>
  createBlock(input: Omit<WorkflowBlock, 'isBuiltIn'>): Promise<ApiResponse<WorkflowBlock>>
  updateBlock(id: string, input: Partial<WorkflowBlock>): Promise<ApiResponse<WorkflowBlock>>
  deleteBlock(id: string): Promise<ApiResponse<void>>
  ```

- [ ] **Step 2: `BlockNode.tsx` — 캔버스 상의 블록 노드 컴포넌트**

  ```tsx
  // 표시 정보: 블록 이름, 도메인 배지, 카테고리 배지
  // 핸들: 상단(입력), 하단(출력)
  // 선택 시 우측 NodeConfig 패널에서 BlockParamForm 렌더링
  ```

- [ ] **Step 3: `BlockPalette.tsx` — 블록 팔레트**

  ```
  ┌─────────────────────────────────────────────────────┐
  │  블록 팔레트          [🔍 검색]                       │
  ├─────────────────────────────────────────────────────┤
  │  ▼ 금융 — 기술 지표                                  │
  │    [📦 박스권 돌파 찾기]  ← 드래그하여 캔버스에 추가  │
  │    [📦 거래량 폭증 찾기]                             │
  │    [📦 RSI 범위 거르기]                              │
  │    [📦 골든 크로스 찾기]                             │
  │  ▼ 금융 — 패턴                                       │
  │    [📦 VSP 패턴 찾기]                                │
  │  ▼ 금융 — 기관                                       │
  │    [📦 큰손 추적]                                    │
  │  ▼ 커스텀                                            │
  │    [⚙ 내 필터 블록]                                  │
  │    [+ 새 커스텀 블록]                                │
  └─────────────────────────────────────────────────────┘
  ```

  - 내장 블록: 📦 아이콘, 카테고리별 그룹화
  - 커스텀 블록: ⚙ 아이콘, "커스텀" 그룹
  - 드래그 소스: `onDragStart`에서 `type: 'block'`, `blockId` 전달

- [ ] **Step 4: `BlockParamForm.tsx` — NodeConfig 내 파라미터 입력 폼**

  ```tsx
  // BlockParamDef 배열을 기반으로 동적 폼 렌더링
  // type: 'number' → <input type="number" min max />
  // type: 'string' → <input type="text" />
  // type: 'boolean' → <Checkbox />
  // type: 'select' → <Select options={def.options} />
  // 변경 시 WorkflowNode.config.params 업데이트
  ```

---

### Task 15: 블록 관리 페이지 (`Blocks.tsx`)

**Files:**
- Create: `apps/desktop/src/pages/Blocks.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: `Blocks.tsx` — 블록 목록 + 커스텀 블록 관리**

  레이아웃:
  ```
  ┌────────────────────────────────────────────────────────┐
  │  블록  [+ 새 커스텀 블록]    [도메인 필터: 전체 ▼]     │
  ├────────────────────────────────────────────────────────┤
  │  [내장]  박스권 돌파 찾기    finance/technical_analysis  │
  │          lookbackPeriod(20), breakoutPct(2%)           │
  │  [내장]  거래량 폭증 찾기    finance/volume             │
  │  [내장]  RSI 범위 거르기     finance/technical_analysis  │
  │  [내장]  골든 크로스 찾기    finance/technical_analysis  │
  │  [내장]  VSP 패턴 찾기       finance/pattern            │
  │  [내장]  큰손 추적           finance/institutional      │
  │  ─────────────────────────────────────────────────────  │
  │  [커스텀] 내 RSI 변형 필터  finance/custom  [수정][삭제]│
  └────────────────────────────────────────────────────────┘
  ```

  - 내장 블록: 읽기 전용 (`[내장]` 배지), 파라미터 기본값 표시
  - 커스텀 블록: 수정·삭제 가능

- [ ] **Step 2: 커스텀 블록 생성/수정 폼 (슬라이드오버)**

  | 필드 | 설명 |
  |------|------|
  | 이름 | 블록 표시 이름 |
  | ID | `custom.xxx` 형식 자동 생성 또는 직접 입력 |
  | 도메인 | finance / coding / general |
  | 카테고리 | 자유 텍스트 |
  | 설명 | 한 줄 설명 |
  | 구현 방식 | 프롬프트 / 스킬 |
  | 프롬프트 템플릿 | `{{params}}`, `{{inputs}}` 플레이스홀더 안내 포함 textarea |
  | 스킬 선택 | 기존 스킬 목록 드롭다운 (구현 방식: 스킬 선택 시 활성화) |
  | 파라미터 정의 | 동적 추가/삭제 (key, label, type, default, min, max) |

- [ ] **Step 3: `App.tsx` 라우트 추가**

  ```typescript
  <Route path="/blocks" element={<Blocks />} />
  ```

  Settings 페이지에 "블록 관리 →" 링크 추가 (하네스 관리 링크와 동일 패턴).

---

## 7. 보안 고려 사항

| 항목 | 대응 방안 |
|------|-----------|
| Slack Bot Token | 서버 settings DB에 암호화 저장 (기존 `crypto.ts` 활용). 클라이언트에 절대 노출 금지 |
| Discord Webhook URL | 동일하게 암호화 저장. 플레인텍스트로 응답 반환 금지 |
| Tavily API Key | 동일하게 암호화 저장 |
| Discord Webhook URL 검증 | `https://discord.com/api/webhooks/` 도메인만 허용. 임의 URL 방지 (SSRF 방어) |
| 워크플로우 DAG 사이클 | `topologicalSort()`에서 즉시 오류 반환, 클라이언트 저장 차단 |
| node_results_json | 외부 출력 데이터를 DB에 저장할 때 크기 제한 (최대 1MB per 실행). `apps/server/src/routes/workflow.ts`의 SSE 완료 핸들러에서 직렬화 크기를 검사해 초과 시 각 노드 output을 잘라내고 `truncated: true` 플래그를 붙여 저장 |
| Workflow 실행 취소 | `AbortController`로 SSE 연결 끊기 시 하위 노드 실행 취소 |
| 커스텀 하네스 시스템 프롬프트 | 서버 DB에 저장되므로 XSS 위험 없음. 단, LLM에 주입되는 프롬프트이므로 prompt injection 가능성 존재 — 관리자만 커스텀 하네스 생성 가능하도록 향후 인증 레이어 고려 |
| 하네스 허용 툴 필터링 | `allowedTools`에 없는 툴이 에이전트 실행 중 호출되면 거부. 화이트리스트 방식으로 구현 |
| 내장 하네스 불변성 | `AgentHarness.isBuiltIn === true` 플래그로 판별. PUT/DELETE 라우트에서 `harness.isBuiltIn`을 확인해 403 반환. `meta` 필드 우회 없이 타입 레벨에서 명시적으로 관리 |
| KIS API 키 보호 | `KIS_APP_KEY`, `KIS_APP_SECRET`은 settings DB에 암호화 저장. Access Token은 서버 메모리 캐시에만 보관, DB/클라이언트에 절대 저장 금지 |
| KIS 토큰 만료 관리 | 토큰 캐시에 `expiresAt` 저장, 매 블록 실행 전 유효성 검사 후 만료 시 자동 재발급. 만료 60초 전에 갱신 처리 |
| 커스텀 블록 프롬프트 주입 | 커스텀 블록의 `promptTemplate`은 관리자가 작성하지만 `{{inputs}}`가 상위 노드의 LLM 출력을 포함할 수 있으므로 간접 prompt injection 위험. inputs 주입 전 길이 제한(4096자) 적용 |
| 블록 파라미터 검증 | 서버에서 `BlockParamDef` 기반으로 파라미터 타입·범위 검증. `min`/`max`를 벗어나는 값은 실행 거부 |
| 내장 블록 불변성 | `WorkflowBlock.isBuiltIn === true`인 블록의 PUT/DELETE → 403 반환. 레지스트리에 번들된 native 블록만 `isBuiltIn: true`가 가능 |

---

## 8. 엣지 케이스 처리

| 케이스 | 처리 방법 |
|--------|-----------|
| 워크플로우에 노드가 없음 | 빌더 저장 시 trigger + output 노드 최소 요구 검증 |
| 고립된 노드 (연결 없음) | 위상정렬 후 unreachable 노드는 `skipped` 상태로 처리 |
| 에이전트 노드 API 키 없음 | NodeResult `ok: false`, error 메시지로 RunPanel에 표시 |
| SSE 연결 도중 클라이언트 종료 | Hono의 연결 종료 감지 → AbortController.abort() 호출 |
| 동일 워크플로우 중복 실행 | 현재 실행 중인 runId 존재 시 409 응답 (단순 방어) |
| Slack API rate limit | `@slack/web-api` SDK의 내장 rate limit 처리 활용 |
| KIS API 서비스 불가 | KIS API 호출 실패(5xx, timeout) 시 NodeResult `ok: false`, error 메시지 표시. 재시도 없음 (블록 실행은 1회) |
| 종목 코드 유효하지 않음 | KIS API 응답 404/빈 결과 → `{ symbols: [] }` 반환, 에러 대신 빈 결과로 처리 |
| 블록 결과 빈 배열 | 다음 블록의 inputs에 `{ symbols: [] }` 전달 → 다음 블록도 빈 결과 반환 (파이프라인 정상 완료) |
| 커스텀 블록 LLM 실패 | 프롬프트 기반 블록에서 LLM API 오류 발생 시 NodeResult `ok: false`, error 전파 |
| 블록 파라미터 범위 초과 | 실행 전 `BlockParamDef.min/max` 기반 검증 실패 시 즉시 NodeResult `ok: false` (API 호출 없이 조기 종료) |
| 체이닝 블록 inputs 형식 불일치 | 상위 블록 output이 `{ symbols: [...] }` 형식이 아닐 때, 다음 블록이 `params.universe` 기준으로 자체 조회 (degraded mode) |

---

## 9. 알려진 제한 사항 및 v0.3.0 이월

다음 기능은 v0.2.0 스코프에서 제외하고 이후 버전에서 다룬다:

| 기능 | 이유 |
|------|------|
| 워크플로우 스케줄러 (cron) | cron 실행 데몬 추가 필요, 스코프 초과 |
| 워크플로우 버전 관리 | 스냅샷 저장 구조 별도 설계 필요 |
| 멀티 에이전트 병렬 실행 | Promise.all 병렬화는 AND/OR 게이트와 상호작용 복잡도 증가 |
| 워크플로우 공유/내보내기 | JSON export 버튼은 단순하나 import 검증 로직 필요 |
| 에이전트 간 대화 (A2A) | 현재 에이전트가 서로 통신하는 구조 미설계 |
| Slack 수신 (slash command) | 양방향 채널 연결은 OAuth 앱 설정 필요 |

---

## 10. 완료 기준 (Definition of Done)

- [ ] `pnpm typecheck` — 모든 패키지에서 타입 오류 0개
- [ ] 워크플로우 CRUD (생성·목록·수정·삭제) 정상 동작
- [ ] 금융 에이전트 워크플로우 템플릿으로 엔드-투-엔드 실행 성공
- [ ] 코딩 에이전트 워크플로우 템플릿으로 엔드-투-엔드 실행 성공
- [ ] AND/OR 게이트 동작 검증 (각 게이트 유형별 시나리오 1건 이상)
- [ ] 웹 검색 노드: Tavily API 응답을 다음 에이전트 노드 입력으로 전달
- [ ] Slack 메시지 노드: 실제 채널에 메시지 전송 확인 (또는 mock 테스트)
- [ ] Discord 메시지 노드: Webhook으로 메시지 전송 확인
- [ ] 설정 페이지에서 Tavily/Slack/Discord 키 저장 및 마스킹 표시
- [ ] 5개 내장 하네스 (`finance_analyst`, `finance_risk`, `coding_reviewer`, `coding_test_writer`, `coding_refactor`) 정상 로드 및 목록 반환
- [ ] 커스텀 하네스 생성·수정·삭제 CRUD 정상 동작
- [ ] `HarnessSelector`에서 하네스 선택 시 NodeConfig에 설명·허용 툴 미리보기 표시
- [ ] 금융 워크플로우 템플릿 실행 시 `finance_analyst` 하네스가 자동 주입된 시스템 프롬프트로 에이전트 동작 확인
- [ ] 코딩 워크플로우 템플릿 실행 시 `coding_reviewer` 하네스의 `allowedTools` 필터링 동작 확인
- [ ] 내장 하네스 수정·삭제 시도 시 403 응답 확인
- [ ] **[블록]** `GET /api/blocks` — 6개 내장 금융 블록 전체 목록 반환 확인
- [ ] **[블록]** 박스권 돌파 찾기(`finance.box_breakout`) 단독 실행 — 결과 `{ symbols: [...] }` 형식 반환
- [ ] **[블록]** 거래량 폭증 → RSI 거르기 체이닝 실행 — 파이프라인 빈 배열 포함 정상 완료
- [ ] **[블록]** 커스텀 블록(프롬프트 방식) 생성 · 실행 성공 (LLM 응답 반환)
- [ ] **[블록]** `BlockPalette`에서 블록 드래그 → 캔버스에 `BlockNode` 추가 확인
- [ ] **[블록]** `BlockParamForm`에서 파라미터 수정 → 실행 시 변경값 반영 확인
- [ ] **[블록]** 내장 블록 PUT/DELETE 시도 시 403 응답 확인
- [ ] **[블록]** KIS API 키 없을 때 블록 실행 → `ok: false`, 에러 메시지 표시 확인
- [ ] `docs/implementation/v0.2.0.md` 작성 완료
