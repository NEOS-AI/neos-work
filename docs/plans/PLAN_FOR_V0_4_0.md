# NEOS Work v0.4.0 — Domain Worker Agents & Workflow Runtime 재설계

> **기준 버전**: v0.3.186 (Open Design 이식 + 장기 polish 완료)
> **작성일**: 2026-07-26
> **결정 잠금**: 2026-07-26 (Q1–Q5 확정 — §14)
> **목표**: v0.3.x에서 누적된 워크플로우 모델의 구조적 한계(도메인 하드코딩 노드 타입, 단일 에이전트 루프, 하네스=프롬프트 묶음 수준)를 **의도적 브레이킹 체인지**로 정리하고, **도메인 워커 에이전트(Domain Worker Agents)** 를 1급 런타임 단위로 도입한다. 그래프 워크플로우와 멀티에이전트 조율(coordinator → workers)이 같은 추상화 위에 동작하도록 맞춘다.

---

## 0. 왜 지금 v0.4.0인가

### 0.1 v0.3.x가 남긴 것

v0.3.0 계획(Open Design 이식 + 병렬 브랜치 + 코딩 블록 + Routine/Webhook/CLI/Plugin/Media/Deploy 등)은 v0.3.186까지 구현·보안 하드닝이 이어졌다. 제품 기능 표면은 넓어졌지만, **에이전트·도메인·워크플로우의 핵심 데이터 모델은 여전히 v0.2.0 설계**에 묶여 있다.

| 영역 | 현재 (v0.3.186) | 문제 |
|---|---|---|
| 에이전트 노드 타입 | `agent_finance` \| `agent_coding` | 구현은 동일 `AgentNode`인데 타입이 도메인에 고정. general/research/새 도메인 추가 시 타입·UI·필터·마이그레이션이 폭발 |
| 도메인 enum | `finance` \| `coding` \| `general` | 서버·하네스·블록·템플릿·UI 전역에 하드코딩. 새 도메인 = 전 스택 수정 |
| 하네스 | 시스템 프롬프트 + allowedTools 묶음 | "역할 카드" 수준. 격리 워크스페이스·권한 프로필·전용 툴셋·서브에이전트 스폰 없음 |
| 오케스트레이터 | 단일 plan → step 루프 | 노드 내부에서 워커를 띄우거나 병렬 리서치/구현 분담 불가. 그래프 병렬(`parallel_*`)과 에이전트 내부 병렬이 분리됨 |
| 블록 vs 에이전트 | 블록=결정적, 에이전트=자율 | 도메인 전문성은 둘로 갈라져 있고, "이 도메인의 권장 파이프라인"이 패키지로 묶이지 않음 |
| 그래프 계약 | `config: Record<string, unknown>`, free-form I/O | 노드 간 스키마·포트 없음. 실패는 런타임에만 드러남 |
| 워크플로우 스키마 버전 | 없음 | 브레이킹 마이그레이션 경로가 공식화되어 있지 않음 |

### 0.2 v0.4.0의 한 줄 정의

> **도메인 워커를 1급 실행 단위로 만들고, 워크플로우 노드·코디네이터 서브에이전트·블록 팩이 같은 Domain Pack 위에 조립되도록 런타임을 재설계한다. 이를 위해 노드 타입·도메인 모델·하네스 API를 깨뜨린다.**

역사적 메모: `PLAN_FOR_V0_2_4`가 적어 둔 "v0.4.0 = CLI/Artifact" 로드맵은 **v0.3.0에서 이미 흡수**되었다. 본 문서는 그 예정을 대체하며, v0.4.0의 실제 테마를 **Worker Agents + Workflow 재설계**로 재정의한다.

---

## 1. 목표와 비목표

### 목표

#### Part A — Breaking: 워크플로우 모델 정리

1. **통합 `agent` 노드**: `agent_finance` / `agent_coding` 제거 → 단일 `agent` + `workerId` (또는 `domain` + `role`)
2. **워크플로우 스키마 버전**: `schemaVersion: 2` 도입, 로드 시 v1 → v2 자동 마이그레이션
3. **Domain Pack 모델**: 하드코딩 enum 대신 등록 가능한 도메인 팩 (built-in + 향후 custom)
4. **게이트/병렬 타입 정리**: `gate_or` vs `or_gate` 중복 의미 문서화·정규화 (호환 alias 유지 기간 명시)
5. **노드 I/O 계약 (typed ports MVP, Q5 잠금)**: 노드 `inputs`/`outputs` 선언 + 에디터 경고 + 런타임 검증 옵션 — **v0.4.0 필수**
6. **마이그레이션 경로**: DB 워크플로우, revision snapshot, export ZIP, templates 일괄 변환; **`harnesses` → `workers` rename (Q1)**

#### Part B — Domain Worker Agents

7. **Worker 1급 타입**: `DomainWorker` (id, domain, role, tools, constraints, workspace policy, spawn policy)
8. **Built-in Domain Packs (4 packs, Q4 research 포함)**:
   - `finance` — analyst / risk / chart / portfolio
   - `coding` — reviewer / implementer / test_writer / refactor
   - `research` — web / synthesizer (**v0.4 확정 포함**)
   - `general` — coordinator / generalist
9. **Coordinator 모드 (Q3)**: 별도 노드 타입 없음 — `agent` + `mode: coordinator`; 리더가 `spawn_worker` / `await_workers`로 위임·합성
10. **Worker 실행 경로 통합**: (a) 워크플로우 노드로 직접 배치 (b) 코디네이터 서브에이전트로 동적 스폰 — 동일 런타임
11. **워크스페이스 격리**: 워커별 workdir (`~/.config/neos-work/workspaces/<runId>/<workerRunId>/`), 툴 권한 프로필
12. **워커 이벤트 스트림**: `worker.started` / `worker.progress` / `worker.completed` / `worker.failed` SSE → Run Log UI

#### Part C — 도메인 팩 확장 표면

13. **Pack 레지스트리 API**: `GET /api/domain-packs`, `GET /api/workers`, `GET /api/workers/:id`
14. **Pack 단위 블록·하네스·템플릿 묶음**: 기존 built-in blocks/harnesses를 pack 소속으로 재배치
15. **커스텀 워커 CRUD**: 기존 custom harness API를 worker API로 승격 (브레이킹 rename + alias 기간)
16. **에디터 UX**: 노드 팔레트를 Domain Pack 기준으로 그룹, Worker 선택기, Coordinator 배지

#### Part D — 품질/운영

17. **회귀 테스트**: v1 워크플로우 fixture → v2 마이그레이션 golden tests
18. **문서**: README / README.ko 업데이트, migration guide, breaking changelog
19. **버전 범프**: monorepo `0.4.0`, health/banner/User-Agent 동기화

### 비목표

- 원격 멀티테넌트 worker cluster / 큐 시스템 (로컬 서버 프로세스 내 실행만)
- 임의 사용자 정의 Domain Pack 플러그인 로더 (v0.4는 built-in packs + custom workers; pack SDK는 v0.5+)
- 완전 정적 타입 그래프 검증기 / 컴파일 타임 워크플로우 언어
- Marketplace에 worker pack 배포
- Video gen, 신규 media provider, 신규 deploy target
- OpenClaw 수준의 multi-channel gateway 통합
- 기존 Plugin/Routine/MCP OAuth/CLI spawn 기능 제거 (호환 유지; agent 노드 스키마만 교체)

---

## 2. 현재 아키텍처 → 목표 아키텍처

### 2.1 현재

```
Workflow.domain ∈ {finance, coding, general}
     │
     ├─ nodes: agent_finance | agent_coding | block | gate_* | …
     │            │
     │            └─ AgentNode + resolveHarness(harnessId)
     │                   │
     │                   └─ AgentOrchestrator (single loop)
     │
     └─ blocks registry (finance/* , coding/*)
```

### 2.2 목표 (v0.4.0)

```
DomainPackRegistry
  finance | coding | research | general
     │
     ├─ workers[]     (DomainWorker definitions)
     ├─ blocks[]      (native/prompt/skill)
     ├─ tools[]       (optional domain tool factories)
     └─ templates[]

Workflow { schemaVersion: 2, domainPackIds?: string[], … }
     │
     ├─ nodes: agent | block | gate_* | parallel_* | …
     │            │
     │            └─ AgentNode { workerId, mode: 'solo' | 'coordinator' }
     │                   │
     │                   ├─ solo        → WorkerRuntime.run(worker)
     │                   └─ coordinator → Leader + spawn_worker tools
     │                                        │
     │                                        └─ WorkerRuntime (isolated)
     │
     └─ SSE: run.* | node.* | worker.*
```

핵심 원칙:

1. **Worker가 진실의 원천** — harness는 worker의 하위 호환 뷰(또는 deprecated alias).
2. **그래프 병렬과 워커 병렬은 다른 층** — 그래프는 파이프라인 구조, 워커 스폰은 에이전트 자율 분담. 둘 다 지원하되 이벤트로 구분.
3. **도메인은 타입 문자열이 아니라 Pack** — 새 도메인 추가는 pack 등록으로 끝나야 한다 (코어 NodeType 수정 없이).

---

## 3. Breaking Changes 카탈로그

> 마이너 버전 0.3 → 0.4 점프의 근거. 각 항목에 **영향 범위 / 마이그레이션 / 호환 기간**을 명시한다.

### BC-1. 노드 타입 통합

| Before | After |
|---|---|
| `agent_finance`, `agent_coding` | `agent` |

- `AgentNode` 생성자: `type: 'agent'` 고정
- `config.workerId` 필수(또는 기본 `general/generalist`)
- 레거시 타입은 **로드 시 변환**, 저장 시 v2만 기록
- UI palette / templates / tests 전부 갱신

**호환**: 서버가 v1 JSON을 받으면 메모리/DB 저장 전에 migrate. API 응답은 항상 v2.

### BC-2. `schemaVersion` 필수

```ts
interface Workflow {
  schemaVersion: 1 | 2; // 저장 시 항상 2
  // …
}
```

- 없으면 `1`로 간주 후 마이그레이션
- revision snapshot도 동일 규칙

### BC-3. Domain enum → Domain Pack IDs

| Before | After |
|---|---|
| `domain: 'finance' \| 'coding' \| 'general'` | API/JSON `primaryDomain: string` (pack id) + optional `domainPackIds: string[]` |

- 멀티 도메인 워크플로우 허용 (예: research → coding)
- 알 수 없는 pack id는 로드 가능하되 실행 시 missing-pack 에러
- **잠금(Q2)**: API/JSON 필드명은 `primaryDomain`. SQLite 컬럼명은 기존 `domain` 유지(값은 primary pack id). 신규 컬럼 `domain_pack_ids_json` optional

### BC-4. Harness API → Worker API

| Before | After |
|---|---|
| `GET/POST /api/harnesses` | `GET/POST /api/workers` |
| `AgentHarness` | `DomainWorker` (superset) |

- `/api/harnesses`는 **v0.4.x 동안 308/호환 프록시** (deprecate 헤더). v0.5에서 제거 예고
- built-in harness id (`finance_analyst` 등)는 worker id로 **그대로 유지** (문자열 안정성)

### BC-5. NodeContext / SSE 확장

```ts
// 신규 SSE (additive지만 클라이언트가 exhaustiveness 체크하면 break)
| { type: 'worker.started'; nodeId: string; workerId: string; workerRunId: string }
| { type: 'worker.progress'; nodeId: string; workerRunId: string; chunk: string }
| { type: 'worker.completed'; nodeId: string; workerRunId: string; output: unknown }
| { type: 'worker.failed'; nodeId: string; workerRunId: string; error: string }
```

- desktop Run Log / engine client 이벤트 유니온 갱신 필수

### BC-6. 게이트 타입 정규화 (soft break)

| 현재 | v0.4 정규 이름 | 비고 |
|---|---|---|
| `gate_and` | `gate_and` | 유지 |
| `gate_or` | `gate_or` | 논리 OR (모든 입력이 조건) — 의미 문서 고정 |
| `or_gate` | `or_gate` | 레이스 채택 (첫 성공 출력) — **이름 유지**, 문서에서 `gate_or`와 구분 강조 |
| `parallel_start` / `parallel_end` | 동일 | 유지 |

의도적 이름 변경은 하지 않는다 (불필요한 break 방지). 대신 **에디터 라벨/툴팁을 명확화**하고, 잘못된 혼용 템플릿을 수정한다.

### BC-7. 설정 키 / provider 필드 정리

- Agent 노드 config에서 `provider` / `llmProvider` 이중 키 → **`llmProvider` 단일화** (`provider`는 migrate 시 rename)
- CLI 값은 `cli-claude` 등 유지

### BC-8. 패키지 public export

- `@neos-work/shared`: `AgentHarness` → `DomainWorker` (+ deprecated type alias `AgentHarness = DomainWorker`)
- `@neos-work/workflow-engine`: `resolveHarness` → `resolveWorker` (+ alias)
- `@neos-work/core`: `WorkerRuntime` / coordinator tools export

---

## 4. 제품 설계 — Domain Worker

### 4.1 DomainWorker 타입

```ts
/** packages/shared/src/types/worker.ts */

export type WorkerMode = 'solo' | 'coordinator';

export type WorkspacePolicy =
  | { kind: 'none' }
  | { kind: 'run'; subdir?: string }           // ~/.config/neos-work/workspaces/<runId>/
  | { kind: 'isolated' };                     // .../<runId>/<workerRunId>/

export type ToolPermissionProfile =
  | 'read_only'      // read/list/search only
  | 'read_write'     // + write
  | 'execute'        // + shell / code_eval
  | 'network'        // + web_search / http
  | 'full';          // all registered tools (still filtered by allowedTools if set)

export interface DomainWorker {
  id: string;                     // e.g. 'finance_analyst', 'coding_implementer'
  name: string;
  domain: string;                 // pack id
  description: string;
  systemPrompt: string;
  /** Explicit tool allowlist; empty/undefined → profile defaults */
  allowedTools?: string[];
  permissionProfile: ToolPermissionProfile;
  workspace: WorkspacePolicy;
  outputSchema?: Record<string, unknown>;
  constraints?: {
    maxSteps?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxSpawnedWorkers?: number;   // coordinator only
  };
  /** solo = 직접 작업, coordinator = spawn_worker 툴 보유·직접 파일 수정 최소화 */
  defaultMode?: WorkerMode;
  isBuiltIn?: boolean;
  /** Optional: domain blocks this worker is encouraged to call via tools */
  preferredBlockIds?: string[];
  meta?: Record<string, unknown>;
}
```

기존 `AgentHarness` 필드는 전부 포함 superset. 마이그레이션 시 기본값:

- `permissionProfile`: coding write 계열 → `read_write`/`execute`, finance 분석 → `network`+read
- `workspace`: coding → `isolated`, 그 외 → `run`
- `defaultMode`: `general_coordinator`만 `coordinator`, 나머지 `solo`

### 4.2 Domain Pack

```ts
export interface DomainPack {
  id: string;              // 'finance' | 'coding' | 'research' | 'general'
  name: string;
  description: string;
  workers: DomainWorker[];
  /** Block ids owned by this pack (registry still global, pack filters UI) */
  blockIds: string[];
  icon?: string;
  isBuiltIn: boolean;
}
```

등록 위치:

```
packages/workflow-engine/src/packs/
  index.ts              # registry
  finance/index.ts      # workers + block id list (blocks 구현은 기존 blocks/finance 재export)
  coding/index.ts
  research/index.ts
  general/index.ts
```

서버 부팅 시 `registerBuiltInPacks()` → worker registry + (기존) block registry 연동.

### 4.3 Built-in Workers (v0.4 범위)

**잠금(Q3)**: coordinator는 별도 `NodeType`이 아니다. 항상 `type: 'agent'` + `config.mode: 'solo' | 'coordinator'` (워커 `defaultMode`로 기본값).

**잠금(Q4)**: `research` pack은 v0.4.0 범위에 포함 (MVP 2 workers: `research_web`, `research_synthesizer`).

#### finance

| id | 역할 | profile | 비고 |
|---|---|---|---|
| `finance_analyst` | 시장·뉴스 인사이트 | network | 기존 harness 승격 |
| `finance_risk` | 리스크 평가 | network | 기존 |
| `finance_chart_analyst` | 차트/TV MCP | network | 기존 |
| `finance_portfolio` | 포트폴리오 요약·리밸런스 제안 | network | **신규** (blocks: portfolio_summary, risk_report 연계) |

#### coding

| id | 역할 | profile | 비고 |
|---|---|---|---|
| `coding_reviewer` | 코드 리뷰 | read_only + shell(read) | 기존 |
| `coding_test_writer` | 테스트 작성 | execute | 기존 |
| `coding_refactor` | 리팩터 | read_write | 기존 |
| `coding_implementer` | 기능 구현 | execute | **신규** — write+shell, isolated workspace |

#### research (신규 pack)

| id | 역할 | profile | 비고 |
|---|---|---|---|
| `research_web` | 웹 조사·출처 수집 | network | web_search 중심 |
| `research_synthesizer` | 다수 조사 결과 합성 | read_only | coordinator 하위 합성 단계용 |

#### general

| id | 역할 | profile | 비고 |
|---|---|---|---|
| `general_generalist` | 범용 솔로 | full (filtered) | 기본 agent 노드 폴백 |
| `general_coordinator` | 리더 전용 | read_only + spawn tools | **신규** — 직접 구현 최소화 프롬프트 |

### 4.4 WorkerRuntime

위치: `packages/core/src/agent/worker-runtime.ts` — **core에 두고** `workflow-engine` / server가 소비한다.

```ts
interface WorkerRunRequest {
  worker: DomainWorker;
  goal: string;
  inputs?: Record<string, unknown>;
  mode?: WorkerMode;
  parent?: { nodeId: string; runId: string; workerRunId?: string };
  settings: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (e: WorkerRuntimeEvent) => void;
  /** Coordinator: factory to start child workers */
  spawnWorker?: (req: WorkerRunRequest) => Promise<WorkerRunResult>;
}

interface WorkerRunResult {
  ok: boolean;
  workerRunId: string;
  output: unknown;
  error?: string;
  durationMs: number;
}
```

내부:

1. permission profile → ToolRegistry 구성 (기존 tools + 선택적 domain tools)
2. workspace policy → cwd / filesystem tool root
3. system prompt + memory/design context 주입 (현 AgentNode 로직 이전)
4. mode === `coordinator` → spawn 툴 등록, 구현 계열 툴 축소
5. `AgentOrchestrator.run` (또는 후속 tool-calling loop) 실행
6. 이벤트 브리지 → workflow SSE

**CLI provider 경로**: solo worker + `llmProvider: cli-*` 일 때만 기존 `cliSpawn` 유지. coordinator는 내장 루프 필수 (CLI 중첩 스폰은 비목표).

### 4.5 Coordinator 툴

```ts
// packages/core/src/tools/worker-spawn.ts

spawn_worker:
  input: {
    workerId: string;       // must exist in registry / allowed list
    goal: string;
    inputs?: object;
  }
  output: { workerRunId, status, output? }

await_workers:
  input: { workerRunIds: string[]; timeoutMs?: number }
  output: { results: Array<{ workerRunId, ok, output, error? }> }

list_workers:
  input: { domain?: string }
  output: { workers: Array<{ id, name, domain, description }> }
```

제약:

- `maxSpawnedWorkers` (default 4, hard cap 8)
- 중첩 coordinator 금지 (child worker mode force `solo`)
- 동일 run 내 동시 실행 상한 (semaphore)
- goal/inputs 크기 캡 (현 orchestrator 한도와 동일 계열)

### 4.6 Agent 노드 config (v2)

```ts
interface AgentNodeConfig {
  workerId: string;                 // required after migrate
  /** Q3 locked: no separate coordinator NodeType */
  mode?: 'solo' | 'coordinator';    // default from worker.defaultMode
  llmProvider?: string;             // anthropic | openai | ollama | google | cli-*
  model?: string;
  systemPrompt?: string;            // append to worker prompt
  maxSteps?: number;
  /** Coordinator: restrict which workers may be spawned */
  allowedWorkerIds?: string[];
  timeoutMs?: number;
}
```

레거시 `harnessId` → migrate 시 `workerId`로 rename.

---

## 5. 제품 설계 — 워크플로우 개선

### 5.1 schemaVersion 2 문서 모델

```ts
interface Workflow {
  id: string;
  name: string;
  description?: string;
  schemaVersion: 2;
  /** Primary pack for palette defaults / templates */
  primaryDomain: string;
  /** Extra packs whose workers/blocks appear in this workflow's editor */
  domainPackIds?: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  webhookSecret?: string;
  designSystemId?: string;
  createdAt: string;
  updatedAt: string;
}
```

**잠금(Q2)**: 공유 타입·API 응답은 `primaryDomain`을 사용한다. v1 JSON의 `domain`은 migrate 시에만 읽고 `primaryDomain`으로 승격한다. 서버 DB 컬럼 `domain`에는 primary pack id를 저장한다 (컬럼 rename 없음).

### 5.2 마이그레이션 알고리즘 (`migrateWorkflowV1ToV2`)

입력: v1 workflow JSON (schemaVersion 없거나 1)

1. `schemaVersion = 2`
2. `primaryDomain = workflow.domain ?? 'general'`
3. `domainPackIds = [primaryDomain]` (general만 있으면 생략 가능)
4. 각 node:
   - `agent_finance` → `type: 'agent'`, `config.workerId ??= 'finance_analyst'`, domain pack ensure `finance`
   - `agent_coding` → `type: 'agent'`, `config.workerId ??= 'coding_reviewer'`, pack ensure `coding`
   - `config.harnessId` → `config.workerId` (후자 우선)
   - `config.provider` → `config.llmProvider` (후자 우선)
5. edges / 기타 노드 타입 유지
6. 반환 + optional `MigrationReport { renamedNodes, warnings[] }`

적용 지점:

- `apps/server` workflow load (GET/list/run/revision restore/import)
- export ZIP re-pack 시 저장 전 v2 고정
- desktop이 캐시하는 경우는 서버 응답만 신뢰

### 5.3 Typed ports MVP

**잠금(Q5)**: v0.4.0 **필수 범위**에 MVP로 포함 (Task 9). 0.4.1로 분리하지 않는다. 완전 스키마 엔진이 아니라 **MVP 계약**:

```ts
interface PortDef {
  key: string;
  label?: string;
  /** JSON-schema-ish subset or 'any' */
  schema?: Record<string, unknown>;
  required?: boolean;
}

// WorkflowNode.config optional:
//   inputPorts?: PortDef[]
//   outputPorts?: PortDef[]
```

- Worker.outputSchema → agent 노드 기본 `outputPorts` 힌트
- Block.paramDefs / outputDescription → block 노드 포트 힌트
- Executor: `settings.strictPorts === '1'` 일 때만 hard-fail, 기본은 warning 이벤트 `node.warning`
- Editor: 연결 시 타입 불일치 yellow badge (best-effort)

v0.4 비목표(후속): 제네릭 타입 추론, 유니온 포트, 컴파일 에러 차단 기본 ON.

### 5.4 에디터 UX

1. **Palette**: Domain Pack 탭 (Finance / Coding / Research / General / Control / Delivery)
2. **Agent 노드**: Worker select (pack 필터) + mode toggle (solo/coordinator)
3. **Coordinator 배지**: 캔버스 노드에 아이콘, Run Log에 worker child tree
4. **Migration toast**: 오래된 로컬 draft 열 때 "v2로 변환됨" 1회 표시 (desktop)
5. **Templates**: 전부 v2 + 신규 코디네이터 템플릿 2종
   - `coding: coordinator implement` — research_web ∥ coding_implementer → synthesizer 패턴을 **그래프**로 보여 주는 예시 + **단일 coordinator 노드** 예시
   - `finance: analyst → risk → slack`

### 5.5 Run Log / SSE UI

```
Run started
  node agent-1 started (worker: general_coordinator)
    worker w1 started (research_web)
    worker w1 progress …
    worker w1 completed
    worker w2 started (coding_implementer)
    worker w2 completed
  node agent-1 completed
Run completed
```

중첩 표시를 위해 desktop `RunDetailPanel` / log virtualizer가 `worker.*` 이벤트를 parent `nodeId` 아래 그룹링.

---

## 6. API 설계

### 6.1 Domain Packs & Workers

```
GET  /api/domain-packs                 # list packs (+ worker/block counts)
GET  /api/domain-packs/:id             # pack detail

GET  /api/workers                      # ?domain=coding
GET  /api/workers/:id
POST /api/workers                      # custom worker
PUT  /api/workers/:id
DELETE /api/workers/:id                # built-in 삭제 거부
```

Custom worker DB: 기존 `harnesses` 테이블.

**잠금(Q1)**: 뷰가 아니라 **테이블 rename + 앱 마이그레이션** (코드 단순).

```sql
-- migration (required)
ALTER TABLE harnesses RENAME TO workers;
-- columns remain; add:
-- permission_profile TEXT DEFAULT 'full'
-- workspace_json TEXT
-- default_mode TEXT DEFAULT 'solo'
```

호환:

```
GET /api/harnesses → 동일 핸들러, Deprecation: true, Link: </api/workers>
```

### 6.2 Workflow API

- 요청/응답 워크플로우는 항상 v2
- `POST /api/workflows` body에 v1이 오면 서버 migrate 후 저장
- `POST /api/workflows/migrate` (optional dry-run) — report only

### 6.3 Run API

- 기존 SSE 스트림에 `worker.*` 추가
- cancel 시 child worker AbortSignal 전파

---

## 7. 패키지별 변경 요약

| 패키지/앱 | 변경 |
|---|---|
| `packages/shared` | `DomainWorker`, `DomainPack`, `schemaVersion`, `NodeType` 정리, SSE 유니온, deprecated aliases |
| `packages/core` | `WorkerRuntime`, permission→tools 매핑, spawn tools, orchestrator 이벤트 확장 |
| `packages/workflow-engine` | packs/, `resolveWorker`, AgentNode v2, executor worker 이벤트, migrate helper, harness→worker |
| `apps/server` | routes workers/domain-packs, DB migration, workflow load migrate, SSE bridge, harness alias routes |
| `apps/desktop` | palette, NodeConfig worker selector, Run Log tree, templates, engine client types, harness-filter → worker-filter |
| docs | 본 계획, implementation 노트, migration guide, README breaking section |

---

## 8. 구현 태스크 분해

### Task 1 — Shared 타입 & schemaVersion (Breaking foundation)

- `NodeType`에서 agent_* 제거, `agent` 추가
- `Workflow.schemaVersion`, `primaryDomain`, `domainPackIds`
- `DomainWorker` / `DomainPack` / SSE worker events
- `AgentHarness` type alias + `@deprecated` JSDoc
- 단위 테스트: 타입 export 스모크

**검증**: `pnpm typecheck` (후속 패키지 수정 전 red 허용 구간을 Task 2와 한 커밋 스트림으로)

### Task 2 — migrateWorkflowV1ToV2

- pure function in `packages/shared` or `workflow-engine`
- golden fixtures: finance agent graph, coding agent graph, harnessId only, provider key, mixed
- server GET/POST/import/revision restore 경로 연결

**검증**: fixture → deep equal v2; round-trip stable

### Task 3 — Worker registry & Domain Packs

- `packs/*` 이동/작성, built-in workers 표 구현
- `resolveWorker` / `listWorkers` / `listPacks`
- 기존 harness register 경로를 worker로 통합
- research pack 신규 workers

**검증**: list by domain; unknown id undefined; built-in immutable

### Task 4 — WorkerRuntime + permission profiles

- ToolRegistry 프로필 매핑
- workspace isolation (mkdir, filesystem tools root)
- memory/design injection 이전 (AgentNode 중복 제거)
- timeout / maxSteps 준수

**검증**: unit tests with mock adapter; path escape rejected

### Task 5 — AgentNode v2 + executor 이벤트

- `AgentNode` type `'agent'` only
- config.workerId 경로
- worker.* SSE emit
- CLI solo path 회귀
- block.ts 내부 `new AgentNode('agent_finance')` 제거

**검증**: engine tests green; progress + worker events ordering

### Task 6 — Coordinator mode + spawn tools

- `spawn_worker` / `await_workers` / `list_workers`
- nested coordinator 금지
- concurrency cap
- cancellation cascade

**검증**: mock multi-worker run; cap exceeded error; abort kills children

### Task 7 — Server API & DB migration

- workers table migration
- routes domain-packs + workers
- harness alias routes
- custom worker CRUD parity with old harness routes
- auth/validation hygiene (v0.3.x sanitize 패턴 유지)

**검증**: route tests; deprecation headers; built-in delete 403

### Task 8 — Desktop UX

- palette by pack
- worker selector + mode
- harness-filter → worker-filter
- Run Log worker tree
- templates v2 + 2 new templates
- i18n 문자열 (ko/en)

**검증**: component tests; template load; migration toast once

### Task 9 — Typed ports MVP (Q5 locked — v0.4.0 필수)

- PortDef on nodes / from worker.outputSchema
- optional strict runtime (`strictPorts`, default off)
- editor warning badge
- 성공 정의·검증 기준에 포함; 일정 사유로 0.4.1 분리 금지

**검증**: mismatch warning event; strict fail test

### Task 10 — Docs, version bump, changelog

- `docs/implementation/v0.4.0.md` (구현 후)
- README breaking notes + migration guide `docs/migration/v0.4.0.md`
- monorepo version `0.4.0`
- health / banner / MCP UA / web_search UA

**검증**: `pnpm typecheck && pnpm test && pnpm build`

---

## 9. 구현 권장 순서

```
Task 1 (shared types)
  → Task 2 (migrate pure + server load)
  → Task 3 (packs/registry)
  → Task 4 (WorkerRuntime)
  → Task 5 (AgentNode + executor)     // 그래프 경로 복구 완료
  → Task 6 (coordinator)              // 멀티 워커
  → Task 7 (API/DB)                   // Task 3과 부분 병렬 가능하나 runtime 이후가 안전
  → Task 8 (desktop)
  → Task 9 (ports MVP)                // Q5: v0.4.0 필수 (desktop 이후, docs 전)
  → Task 10 (docs/version)
```

**병렬 가능 그룹**:

| 라운드 | Tasks |
|---|---|
| 1 | Task 1 + Task 2 |
| 2 | Task 3 + Task 4 |
| 3 | Task 5 |
| 4 | Task 6 + Task 7 |
| 5 | Task 8 + Task 9 |
| 6 | Task 10 |

---

## 10. 검증 기준

| 항목 | 검증 방법 |
|---|---|
| v1 로드 | v0.3 export fixture import → nodes 모두 `agent`, workerId 설정, schemaVersion 2 |
| 저장 형식 | PUT 후 DB/JSON에 `agent_finance` 잔존 0건 |
| solo worker | finance_analyst 노드 실행 → 기존과 동등 output 스키마 |
| coding implementer | isolated workspace에 파일 생성, 워크스페이스 밖 write 실패 |
| coordinator | general_coordinator가 research_web + coding_reviewer 스폰 → 합성 완료 |
| spawn cap | maxSpawnedWorkers 초과 시 tool error, run 전체 crash 없음 |
| cancel | run cancel → child workers aborted |
| CLI solo | cli-claude provider 회귀 |
| harness alias | `GET /api/harnesses` 200 + deprecation |
| packs API | 4 built-in packs 반환 |
| typed ports | strict off: warning only / strict on: fail |
| typecheck/test/build | 전부 green |
| desktop palette | pack 탭에서 research workers 노출 |

---

## 11. 리스크와 완화

| 리스크 | 완화 |
|---|---|
| 사용자 워크플로우 대량 깨짐 | 서버 자동 migrate, revision 복원 시에도 migrate, export 재저장 |
| harness id 변경 사고 | **id 문자열 안정** (finance_analyst 등 유지) |
| coordinator 비용 폭증 | maxSpawnedWorkers, timeout, 중첩 금지, semaphore |
| 보안 (워커 파일/쉘) | permission profile 기본 least-privilege, workspace root jail (v0.3 coding blocks 패턴 재사용) |
| 타입 변경으로 monorepo 일시 red | Task 1–5를 짧은 브랜치/PR 스택으로 연속 머지 |
| gate_or / or_gate 혼동 지속 | 이름 유지 + UI 라벨 명확화 (추가 break 회피) |
| 범위 팽창 | research pack·typed ports는 **확정된 MVP 범위**로 한정; pack SDK·marketplace·strict-ports 기본 ON은 v0.5+ |

---

## 12. 성공 정의

v0.4.0은 다음이 모두 참일 때 완료된다.

1. **저장 포맷**에 `agent_finance` / `agent_coding` / `harnessId`(미변환)가 더 이상 남지 않는다. API/JSON은 `primaryDomain`을 쓴다.
2. 사용자는 **Domain Pack 단위**로 워커·블록을 고르고, 동일 워커를 그래프 노드 또는 코디네이터 자식으로 돌릴 수 있다. Coordinator는 `agent` + `mode`이다.
3. **built-in workers** (기존 harness 승격 + implementer/portfolio/research pack/coordinator 신규)가 문서화된 표와 일치한다. research pack 포함.
4. v0.3.x 워크플로우는 **수동 편집 없이** import/open/run 가능하다. DB `harnesses` → `workers` rename 적용.
5. Typed ports MVP: default warning, optional strict fail.
6. `pnpm typecheck` / `pnpm test` / `pnpm build` 통과, 버전 문자열 0.4.0.

---

## 13. 후속 (v0.5+ 후보, 본 버전 비목표)

- Domain Pack SDK (외부 pack 로딩)
- Worker marketplace / 서명 배포
- 그래프 서브워크플로우 노드 (`subworkflow`)
- 완전 strict port 검증 기본 ON
- Coordinator ↔ CLI agent 하이브리드
- harness 호환 라우트 제거
- 원격 worker pool

---

## 14. 확정 결정 (Locked — 2026-07-26)

아래 항목은 구현 중 재논의하지 않는다. 본 문서 전역의 “권장/optional 분리” 문구는 이 표에 종속된다.

| # | 결정 | 확정 내용 | 구현 함의 |
|---|---|---|---|
| **Q1** | DB 테이블 전략 | **`harnesses` → `workers` rename** + 앱 마이그레이션. 뷰-only 아님. | Task 7: `ALTER TABLE … RENAME`; 코드·테스트 테이블명 `workers` |
| **Q2** | 도메인 필드 이름 | **API/JSON: `primaryDomain`**. **DB 컬럼: `domain` 유지** (값은 primary pack id). | Task 1–2: 타입·migrate·응답 직렬화; 컬럼 rename 없음. `domain_pack_ids_json` optional |
| **Q3** | Coordinator 표현 | **별도 NodeType 없음.** `type: 'agent'` + `config.mode: 'solo' \| 'coordinator'`. | Task 5–6, 8: palette/config/mode only; `coordinator` 타입 추가 금지 |
| **Q4** | Research pack | **v0.4.0에 포함** — MVP 2 workers (`research_web`, `research_synthesizer`). | Task 3, 8: pack 등록·palette·검증 “4 built-in packs” |
| **Q5** | Typed ports | **v0.4.0 필수, MVP만.** 기본 warning / optional strict. **0.4.1 분리 금지.** | Task 9: 성공 정의·검증 기준 포함; 완전 타입 엔진은 v0.5+ |

### 파생 고정 사항 (위 결정에서 직접 유도)

- Built-in pack 수(v0.4): **4** — `finance`, `coding`, `research`, `general`
- NodeType 에이전트 관련: **`agent` 하나만** (finance/coding/coordinator 세분 타입 없음)
- `/api/harnesses`는 v0.4.x deprecation alias; 저장 진실은 `workers` 테이블
- v1 워크플로우의 `domain` / `harnessId` / `agent_*` 는 로드 시 변환 후 v2만 저장

---

## 15. 참고

- 기존 계획 형식: `docs/plans/PLAN_FOR_V0_3_0.md`, `PLAN_FOR_V0_2_0.md` (하네스/블록 도입)
- 현재 타입: `packages/shared/src/types/workflow.ts`
- 현재 에이전트 노드: `packages/workflow-engine/src/nodes/agent.ts`
- 현재 오케스트레이터: `packages/core/src/agent/orchestrator.ts`
- Coordinator 패턴 참고: `docs/claude_code_spec.md` § Coordinator Architecture
- 기준 구현 스냅샷: `docs/implementation/v0.3.186.md`
