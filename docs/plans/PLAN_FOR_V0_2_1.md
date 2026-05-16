# NEOS Work v0.2.1 — 워크플로우 빌더 사용성 완성 구현 계획

> **기준 버전**: v0.2.0 (워크플로우 빌더 구현 완료)
> **작성일**: 2026-05-16
> **목표**: v0.2.0에서 구현된 워크플로우 엔진과 기본 에디터를 실제 사용 가능한 수준으로 다듬는다. 핵심은 노드 설정 패널, 하네스/블록 선택 UI, 블록 파라미터 편집, 템플릿 기반 시작 흐름, 실행 이력 정합성, 최소 회귀 테스트 기반이다.

---

## 1. 배경 및 현재 상태

v0.2.0은 워크플로우 레이어의 기반을 만들었다.

- `packages/workflow-engine` 패키지와 DAG 순차 실행기
- Trigger/Output/Gate/Agent/Block/Web Search/Slack/Discord 실행 노드
- 하네스 레지스트리와 커스텀 하네스 API
- 블록 레지스트리와 금융 내장 블록 6종
- 워크플로우 CRUD, 실행 SSE, 실행 이력 DB
- React Flow 기반 워크플로우 에디터
- 하네스/블록/템플릿 관리 페이지

하지만 `docs/implementation/v0.2.0.md` 기준으로 다음 사용성 공백이 남아 있다.

| 영역 | 현재 상태 | 문제 |
|------|-----------|------|
| 노드 설정 | `WorkflowEditor.tsx`의 우측 패널이 실행 로그만 표시 | 노드의 `config`를 GUI에서 수정할 수 없음 |
| 하네스 선택 | 하네스 관리 페이지는 있으나 에이전트 노드와 연결되지 않음 | `harnessId`를 사용자가 캔버스에서 설정할 수 없음 |
| 블록 선택 | block 노드는 추가 가능하지만 `blockId` 선택 UI가 없음 | 블록 노드는 생성 직후 실행 불가 |
| 블록 파라미터 | `WorkflowBlock.paramDefs`는 있으나 입력 폼이 없음 | `symbol`, `period` 같은 값을 코드/DB 없이 설정할 수 없음 |
| 실행 이력 | 서버 route와 executor가 각각 runId를 생성 | SSE runId와 DB runId가 달라 추적이 어려움 |
| 그래프 검증 | 저장/실행 전 클라이언트 검증 없음 | 연결 누락, blockId 누락, 사이클 등을 실행 시점에야 발견 |
| 테스트 | 테스트 파일 없음 | v0.2.x 워크플로우 회귀를 자동으로 잡기 어려움 |

v0.2.1은 새 노드 타입이나 병렬 실행을 추가하지 않는다. 현재 엔진을 사용자가 제대로 조립하고 실행할 수 있게 만드는 릴리스다.

---

## 2. 목표와 비목표

### 목표

1. 워크플로우 에디터에서 선택한 노드의 공통 설정과 타입별 설정을 편집할 수 있다.
2. 에이전트 노드에서 도메인에 맞는 하네스를 선택하고 추가 system prompt를 입력할 수 있다.
3. 블록 노드에서 블록을 선택하고 `paramDefs` 기반 파라미터를 입력할 수 있다.
4. Web Search, Slack, Discord 노드의 최소 실행 설정을 UI에서 입력할 수 있다.
5. 저장/실행 전에 클라이언트가 기본 그래프 오류를 알려준다.
6. 서버 실행 이력의 runId와 SSE runId를 동일하게 만든다.
7. 워크플로우 엔진의 핵심 동작에 최소 테스트를 추가한다.
8. v0.2.1 구현 결과를 `docs/implementation/v0.2.1.md`에 기록할 수 있는 기준을 만든다.

### 비목표

- 병렬 실행 또는 진짜 "first completed wins" OR 게이트
- 스케줄 트리거
- 코딩 도메인 내장 블록 구현
- KIS API 없는 오프라인 금융 데이터 모킹 UI
- 고급 secret manager 또는 per-workflow secret scope
- 전체 E2E 테스트 인프라

---

## 3. 제품 설계

### 3.1 에디터 레이아웃

`WorkflowEditor.tsx`의 우측 패널을 탭 구조로 바꾼다.

| 탭 | 역할 |
|----|------|
| `Config` | 선택한 노드의 label, 타입별 config, validation 메시지 표시 |
| `Run` | 기존 SSE 실행 로그 표시 |
| `History` | 최근 실행 이력 요약 표시 |

노드를 선택하지 않았을 때 Config 탭은 워크플로우 전체 검증 결과와 "노드를 선택하세요" 상태를 보여준다.

### 3.2 노드 설정 모델

기존 `WorkflowNode.config: Record<string, unknown>` 구조는 유지한다. v0.2.1은 타입 안정성을 프론트엔드 헬퍼로 보강한다.

```typescript
type EditableNodeConfig =
  | { nodeType: 'agent_finance' | 'agent_coding'; harnessId?: string; systemPrompt?: string; maxSteps?: number }
  | { nodeType: 'block'; blockId?: string; params?: Record<string, unknown> }
  | { nodeType: 'web_search'; query?: string; maxResults?: number }
  | { nodeType: 'slack_message'; channel?: string; textTemplate?: string }
  | { nodeType: 'discord_message'; textTemplate?: string }
  | { nodeType: 'trigger'; initialInputs?: Record<string, unknown> }
  | { nodeType: 'output' | 'gate_and' | 'gate_or' };
```

실제 저장 형식은 변하지 않는다.

### 3.3 하네스 선택

에이전트 노드 설정 패널은 `client.listHarnesses()`로 하네스를 로드하고, 노드 타입의 도메인과 맞는 하네스를 먼저 보여준다.

- `agent_finance`: `finance`, `general` 하네스 표시
- `agent_coding`: `coding`, `general` 하네스 표시
- 직접 만든 하네스도 같은 목록에 표시
- 선택된 하네스의 설명, allowedTools, constraints를 읽기 전용으로 요약 표시

### 3.4 블록 선택과 파라미터 편집

블록 노드 설정 패널은 `client.listBlocks()`로 블록 목록을 로드한다.

- 도메인/카테고리별 그룹 표시
- 선택한 블록의 `inputDescription`, `outputDescription`, `requiredSettings` 표시
- `paramDefs`를 기반으로 동적 폼 렌더링
- `number`, `string`, `boolean`, `select` 타입 지원
- 기본값은 블록 선택 시 `config.params`에 채운다
- 기존 값은 블록 재선택 전까지 보존한다

### 3.5 그래프 검증

프론트엔드 저장/실행 전 다음 항목을 검증한다.

| 코드 | 조건 | 심각도 |
|------|------|--------|
| `missing_node_label` | label이 비어 있음 | error |
| `missing_block_id` | block 노드에 blockId 없음 | error |
| `missing_required_block_param` | 필수 paramDef 값 없음 | error |
| `missing_harness_id` | agent 노드에 harnessId 없음 | warning |
| `missing_search_query` | web_search 노드에 query도 upstream input도 없음 | warning |
| `missing_slack_channel` | slack_message 노드에 channel 없음 | error |
| `dangling_edge` | edge source/target이 존재하지 않음 | error |
| `cycle` | 그래프에 사이클 있음 | error |
| `no_trigger` | trigger 노드 없음 | warning |
| `no_output` | output 노드 없음 | warning |

error가 있으면 실행을 막고, 저장은 허용하되 경고 배너를 표시한다. draft 상태의 워크플로우를 저장할 수 있어야 하기 때문이다.

### 3.6 실행 이력 정합성

현재 `apps/server/src/routes/workflow.ts`는 DB 저장용 runId를 만들고, `executeWorkflow()`도 내부에서 별도 runId를 만든다. v0.2.1에서는 executor가 외부 runId를 받을 수 있게 한다.

```typescript
export interface ExecutorOptions {
  workflow: Workflow;
  settings: Record<string, string>;
  onEvent: (event: WorkflowSSEEvent) => void;
  signal?: AbortSignal;
  runId?: string;
}
```

`executeWorkflow()`는 `options.runId ?? crypto.randomUUID()`를 사용한다. 서버 route는 DB에 저장한 runId를 executor에 전달한다.

### 3.7 테스트 전략

테스트 러너는 `vitest`를 추가한다. v0.2.1의 테스트 범위는 워크플로우 엔진 중심으로 제한한다.

- `topologicalSort` 정상 정렬/사이클 감지
- executor runId 주입
- AND/OR 실패 전파
- output truncate
- BlockNode의 `blockId` 누락 실패

프론트엔드 컴포넌트 테스트는 v0.2.2로 미룬다. 대신 타입체크와 수동 브라우저 확인을 v0.2.1 검증 기준에 포함한다.

---

## 4. 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| `apps/desktop/src/components/workflow/WorkflowValidation.ts` | 클라이언트 그래프/노드 config 검증 함수 |
| `apps/desktop/src/components/workflow/NodeConfigPanel.tsx` | 선택 노드 설정 탭의 컨테이너 |
| `apps/desktop/src/components/workflow/fields.tsx` | 공통 입력 필드 컴포넌트 |
| `apps/desktop/src/components/workflow/HarnessSelector.tsx` | 에이전트 하네스 선택 UI |
| `apps/desktop/src/components/workflow/BlockSelector.tsx` | 블록 선택 UI |
| `apps/desktop/src/components/workflow/BlockParamForm.tsx` | `paramDefs` 기반 동적 파라미터 폼 |
| `apps/desktop/src/components/workflow/RunHistoryPanel.tsx` | 최근 실행 이력 표시 |
| `packages/workflow-engine/src/executor.test.ts` | executor 회귀 테스트 |
| `packages/workflow-engine/src/graph.test.ts` | graph 회귀 테스트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/desktop/src/pages/WorkflowEditor.tsx` | 우측 패널 탭화, selected node config 업데이트, 저장/실행 검증 연동 |
| `apps/desktop/src/lib/engine.ts` | `WorkflowNode.type`을 로컬 union으로 구체화, run history 타입 보강 |
| `packages/ui/src/i18n/locales/en/common.json` | workflow editor 설정/검증 문구 추가 |
| `packages/ui/src/i18n/locales/ko/common.json` | workflow editor 설정/검증 문구 추가 |
| `packages/workflow-engine/src/executor.ts` | 외부 runId 수용, 실행 취소 시 루프 중단 정책 정리 |
| `apps/server/src/routes/workflow.ts` | DB runId를 executor에 전달, abort 시 status=`cancelled` 저장 |
| `packages/workflow-engine/package.json` | `vitest` 및 test script 추가 |
| `package.json` | root test script 추가 |
| `docs/implementation/v0.2.1.md` | 구현 완료 후 실제 변경 사항 기록 |

---

## 5. Task 별 구현 계획

### Task 1: 워크플로우 엔진 회귀 테스트 기반 추가

**Files:**
- Modify: `package.json`
- Modify: `packages/workflow-engine/package.json`
- Create: `packages/workflow-engine/src/graph.test.ts`
- Create: `packages/workflow-engine/src/executor.test.ts`

- [ ] **Step 1: 테스트 의존성 추가**

  `packages/workflow-engine/package.json`에 다음 script와 devDependency를 추가한다.

  ```json
  {
    "scripts": {
      "test": "vitest run"
    },
    "devDependencies": {
      "vitest": "^3.2.0"
    }
  }
  ```

  root `package.json`에는 다음 script를 추가한다.

  ```json
  {
    "scripts": {
      "test": "turbo test"
    }
  }
  ```

- [ ] **Step 2: graph 테스트 작성**

  `packages/workflow-engine/src/graph.test.ts`:

  ```typescript
  import { describe, expect, it } from 'vitest';
  import type { WorkflowEdge, WorkflowNode } from '@neos-work/shared';
  import { topologicalSort } from './graph.js';

  const nodes: WorkflowNode[] = [
    { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
    { id: 'block', type: 'block', label: 'Block', position: { x: 1, y: 0 }, config: { blockId: 'price_lookup' } },
    { id: 'output', type: 'output', label: 'Output', position: { x: 2, y: 0 }, config: {} },
  ];

  describe('topologicalSort', () => {
    it('orders nodes before their downstream targets', () => {
      const edges: WorkflowEdge[] = [
        { id: 'e1', source: 'trigger', target: 'block' },
        { id: 'e2', source: 'block', target: 'output' },
      ];

      expect(topologicalSort(nodes, edges).map((node) => node.id)).toEqual(['trigger', 'block', 'output']);
    });

    it('throws when the workflow contains a cycle', () => {
      const edges: WorkflowEdge[] = [
        { id: 'e1', source: 'trigger', target: 'block' },
        { id: 'e2', source: 'block', target: 'trigger' },
      ];

      expect(() => topologicalSort(nodes, edges)).toThrow('Workflow contains a cycle');
    });
  });
  ```

- [ ] **Step 3: executor 테스트 작성**

  `packages/workflow-engine/src/executor.test.ts`는 실제 외부 API 노드를 쓰지 않고 trigger/output/gate/blockId 누락만 검증한다.

  ```typescript
  import { describe, expect, it } from 'vitest';
  import type { Workflow, WorkflowSSEEvent } from '@neos-work/shared';
  import { executeWorkflow } from './executor.js';

  function baseWorkflow(overrides: Partial<Workflow>): Workflow {
    return {
      id: 'wf-test',
      name: 'Test Workflow',
      domain: 'general',
      nodes: [],
      edges: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      ...overrides,
    };
  }

  describe('executeWorkflow', () => {
    it('uses the provided runId for SSE events', async () => {
      const events: WorkflowSSEEvent[] = [];
      await executeWorkflow({
        runId: 'run-fixed',
        workflow: baseWorkflow({
          nodes: [
            { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
            { id: 'output', type: 'output', label: 'Output', position: { x: 1, y: 0 }, config: {} },
          ],
          edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
        }),
        settings: {},
        onEvent: (event) => events.push(event),
      });

      expect(events[0]).toEqual({ type: 'run.started', runId: 'run-fixed' });
      expect(events.at(-1)).toMatchObject({ type: 'run.completed', runId: 'run-fixed' });
    });

    it('fails a block node without blockId', async () => {
      const events: WorkflowSSEEvent[] = [];
      await executeWorkflow({
        runId: 'run-block-missing',
        workflow: baseWorkflow({
          nodes: [
            { id: 'trigger', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} },
            { id: 'block', type: 'block', label: 'Block', position: { x: 1, y: 0 }, config: {} },
          ],
          edges: [{ id: 'e1', source: 'trigger', target: 'block' }],
        }),
        settings: {},
        onEvent: (event) => events.push(event),
      });

      expect(events).toContainEqual({
        type: 'node.failed',
        nodeId: 'block',
        error: 'blockId is required for block nodes',
      });
    });
  });
  ```

- [ ] **Step 4: 실패 확인**

  Run: `pnpm --filter @neos-work/workflow-engine test`

  Expected: `runId` 옵션이 아직 없으므로 첫 번째 executor 테스트가 실패한다.

- [ ] **Step 5: Task 2 이후 재실행**

  Task 2 구현 후 같은 명령이 통과해야 한다.

---

### Task 2: executor runId 정합성 및 취소 저장 정책 정리

**Files:**
- Modify: `packages/workflow-engine/src/executor.ts`
- Modify: `apps/server/src/routes/workflow.ts`

- [ ] **Step 1: ExecutorOptions에 runId 추가**

  ```typescript
  export interface ExecutorOptions {
    workflow: Workflow;
    settings: Record<string, string>;
    onEvent: (event: WorkflowSSEEvent) => void;
    signal?: AbortSignal;
    runId?: string;
  }
  ```

- [ ] **Step 2: executeWorkflow에서 외부 runId 사용**

  ```typescript
  const runId = options.runId ?? crypto.randomUUID();
  ```

- [ ] **Step 3: 서버 route에서 runId 전달**

  `apps/server/src/routes/workflow.ts`:

  ```typescript
  await executeWorkflow({
    runId,
    workflow: wf,
    settings,
    onEvent: (event) => {
      sendEvent(event).catch(() => controller.abort());
      // existing nodeResults tracking
    },
    signal: controller.signal,
  });
  ```

- [ ] **Step 4: abort 저장 정책 명시**

  실행 후 `controller.signal.aborted`이면 `status: 'cancelled'`로 저장한다.

  ```typescript
  const finalStatus = controller.signal.aborted ? 'cancelled' : 'completed';
  db.saveRun({
    id: runId,
    workflowId: wf.id,
    status: finalStatus,
    nodeResults: nodeResults as never,
    startedAt: now,
    completedAt: new Date().toISOString(),
  });
  ```

- [ ] **Step 5: 테스트 실행**

  Run: `pnpm --filter @neos-work/workflow-engine test`

  Expected: PASS

---

### Task 3: 클라이언트 그래프 검증 함수 추가

**Files:**
- Create: `apps/desktop/src/components/workflow/WorkflowValidation.ts`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: 검증 타입 정의**

  ```typescript
  export type WorkflowValidationSeverity = 'error' | 'warning';

  export interface WorkflowValidationIssue {
    code: string;
    severity: WorkflowValidationSeverity;
    nodeId?: string;
    edgeId?: string;
    message: string;
  }
  ```

- [ ] **Step 2: cycle 감지 유틸 작성**

  클라이언트 번들에서 `workflow-engine`을 직접 import하지 않고, 작은 DFS 검증을 프론트엔드에 둔다.

  ```typescript
  function hasCycle(nodes: Array<{ id: string }>, edges: Array<{ source: string; target: string }>): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const outgoing = new Map<string, string[]>();

    for (const node of nodes) outgoing.set(node.id, []);
    for (const edge of edges) outgoing.get(edge.source)?.push(edge.target);

    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const next of outgoing.get(nodeId) ?? []) {
        if (visit(next)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    return nodes.some((node) => visit(node.id));
  }
  ```

- [ ] **Step 3: `validateWorkflowDraft()` 작성**

  입력은 저장 직전 payload와 block metadata 목록을 받는다.

  ```typescript
  export function validateWorkflowDraft(input: {
    nodes: Array<{ id: string; type: string; label: string; config: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string }>;
    blocks: Array<{ id: string; paramDefs: Array<{ key: string; default?: unknown }> }>;
  }): WorkflowValidationIssue[] {
    const issues: WorkflowValidationIssue[] = [];
    const nodeIds = new Set(input.nodes.map((node) => node.id));
    const blockMap = new Map(input.blocks.map((block) => [block.id, block]));

    for (const node of input.nodes) {
      if (!node.label.trim()) {
        issues.push({ code: 'missing_node_label', severity: 'error', nodeId: node.id, message: 'Node label is required.' });
      }
      if (node.type === 'block') {
        const blockId = node.config.blockId;
        if (typeof blockId !== 'string' || blockId.length === 0) {
          issues.push({ code: 'missing_block_id', severity: 'error', nodeId: node.id, message: 'Block node requires a block selection.' });
        } else {
          const block = blockMap.get(blockId);
          const params = (node.config.params ?? {}) as Record<string, unknown>;
          for (const param of block?.paramDefs ?? []) {
            if (param.default === undefined && (params[param.key] === undefined || params[param.key] === '')) {
              issues.push({ code: 'missing_required_block_param', severity: 'error', nodeId: node.id, message: `Block parameter "${param.key}" is required.` });
            }
          }
        }
      }
      if ((node.type === 'agent_finance' || node.type === 'agent_coding') && typeof node.config.harnessId !== 'string') {
        issues.push({ code: 'missing_harness_id', severity: 'warning', nodeId: node.id, message: 'Agent node has no harness selected.' });
      }
      if (node.type === 'slack_message' && typeof node.config.channel !== 'string') {
        issues.push({ code: 'missing_slack_channel', severity: 'error', nodeId: node.id, message: 'Slack node requires a channel.' });
      }
    }

    for (const edge of input.edges) {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        issues.push({ code: 'dangling_edge', severity: 'error', edgeId: edge.id, message: 'Edge points to a missing node.' });
      }
    }

    if (hasCycle(input.nodes, input.edges)) {
      issues.push({ code: 'cycle', severity: 'error', message: 'Workflow graph contains a cycle.' });
    }
    if (!input.nodes.some((node) => node.type === 'trigger')) {
      issues.push({ code: 'no_trigger', severity: 'warning', message: 'Workflow has no trigger node.' });
    }
    if (!input.nodes.some((node) => node.type === 'output')) {
      issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
    }

    return issues;
  }
  ```

- [ ] **Step 4: 저장/실행 전 payload 생성 함수 분리**

  `WorkflowEditor.tsx`에서 저장 payload 생성 로직을 `buildWorkflowDraft()`로 분리해 save/run/validation이 같은 데이터를 보게 한다.

- [ ] **Step 5: 실행 차단**

  `handleRun()` 시작 시 error가 있으면 실행하지 않고 Config 탭으로 이동한다.

---

### Task 4: 노드 설정 패널 추가

**Files:**
- Create: `apps/desktop/src/components/workflow/fields.tsx`
- Create: `apps/desktop/src/components/workflow/NodeConfigPanel.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: 공통 필드 컴포넌트 작성**

  `TextField`, `TextAreaField`, `NumberField`, `SelectField`, `CheckboxField`를 만든다. 모든 필드는 `label`, `value`, `onChange`, `disabled?`, `description?`을 받는다.

- [ ] **Step 2: NodeConfigPanel props 정의**

  ```typescript
  interface NodeConfigPanelProps {
    selectedNode: Node | null;
    validationIssues: WorkflowValidationIssue[];
    onPatchNodeData: (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => void;
  }
  ```

- [ ] **Step 3: 공통 label 편집 구현**

  선택한 노드의 `data.label`을 수정하면 React Flow node state도 즉시 갱신한다.

  ```typescript
  onPatchNodeData(selectedNode.id, { label: nextLabel });
  ```

- [ ] **Step 4: 타입별 최소 설정 구현**

  | node type | 필드 |
  |-----------|------|
  | `trigger` | `initialInputs` JSON textarea |
  | `web_search` | `query`, `maxResults` |
  | `slack_message` | `channel`, `textTemplate` |
  | `discord_message` | `textTemplate` |
  | `gate_and`, `gate_or`, `output` | 읽기 전용 설명 |

- [ ] **Step 5: WorkflowEditor에 patch 함수 연결**

  ```typescript
  const patchNodeData = useCallback((nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            label: patch.label ?? node.data.label,
            config: patch.config ?? node.data.config,
          },
        };
      }),
    );
  }, [setNodes]);
  ```

---

### Task 5: HarnessSelector 연결

**Files:**
- Create: `apps/desktop/src/components/workflow/HarnessSelector.tsx`
- Modify: `apps/desktop/src/components/workflow/NodeConfigPanel.tsx`

- [ ] **Step 1: 하네스 목록 로드**

  `HarnessSelector` 내부에서 `useEngine().client?.listHarnesses()`를 호출한다.

- [ ] **Step 2: 도메인 필터링**

  ```typescript
  const allowedDomains = nodeType === 'agent_finance'
    ? new Set(['finance', 'general'])
    : new Set(['coding', 'general']);
  ```

- [ ] **Step 3: 선택 UI 구현**

  selected value는 `config.harnessId`다. 변경 시 `onChange(nextHarnessId)` 호출.

- [ ] **Step 4: 하네스 요약 표시**

  선택된 하네스의 `description`, `allowedTools`, `constraints.maxSteps`, `constraints.timeoutMs`를 표시한다.

- [ ] **Step 5: Agent 설정에 systemPrompt/maxSteps 추가**

  NodeConfigPanel의 agent branch에서 `HarnessSelector`, `systemPrompt`, `maxSteps`를 렌더링한다.

---

### Task 6: BlockSelector와 BlockParamForm 연결

**Files:**
- Create: `apps/desktop/src/components/workflow/BlockSelector.tsx`
- Create: `apps/desktop/src/components/workflow/BlockParamForm.tsx`
- Modify: `apps/desktop/src/components/workflow/NodeConfigPanel.tsx`

- [ ] **Step 1: BlockSelector 작성**

  `client.listBlocks()`를 호출하고 `domain/category/name` 순으로 정렬한다.

- [ ] **Step 2: blockId 변경 처리**

  blockId를 변경할 때 선택한 block의 기본 param 값을 채운다.

  ```typescript
  function defaultsForBlock(block: WorkflowBlock): Record<string, unknown> {
    return Object.fromEntries(
      block.paramDefs
        .filter((param) => param.default !== undefined)
        .map((param) => [param.key, param.default]),
    );
  }
  ```

- [ ] **Step 3: BlockParamForm 작성**

  `paramDefs` 타입별 입력을 렌더링한다.

  | param type | UI |
  |------------|----|
  | `string` | text input |
  | `number` | number input, min/max 반영 |
  | `boolean` | checkbox |
  | `select` | select, options 반영 |

- [ ] **Step 4: 값 변환**

  number 필드는 빈 문자열이면 `undefined`, 값이 있으면 `Number(value)`로 저장한다. boolean은 실제 boolean으로 저장한다.

- [ ] **Step 5: 블록 설명 표시**

  선택된 block의 `inputDescription`, `outputDescription`, `requiredSettings`를 읽기 전용으로 보여준다.

---

### Task 7: 우측 패널 탭 및 실행 이력 표시

**Files:**
- Create: `apps/desktop/src/components/workflow/RunHistoryPanel.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: 패널 탭 상태 추가**

  ```typescript
  const [rightPanelTab, setRightPanelTab] = useState<'config' | 'run' | 'history'>('config');
  ```

- [ ] **Step 2: 기존 run log를 Run 탭으로 이동**

  현재 우측 패널의 `runEvents.map()` UI를 그대로 Run 탭에 둔다.

- [ ] **Step 3: node click 시 Config 탭 자동 전환**

  ```typescript
  onNodeClick={(_, node) => {
    setSelectedNodeId(node.id);
    setRightPanelTab('config');
  }}
  ```

- [ ] **Step 4: RunHistoryPanel 구현**

  `client.listWorkflowRuns(workflow.id)`를 호출하고 최근 20개를 보여준다.

  표시 필드:
  - status
  - startedAt
  - completedAt
  - failed node count
  - error preview

- [ ] **Step 5: 실행 완료 후 history refresh**

  `run.completed` 또는 `run.failed` 이벤트 수신 후 history reload trigger를 증가시킨다.

---

### Task 8: 템플릿에서 시작하는 흐름 개선

**Files:**
- Modify: `apps/desktop/src/pages/Workflows.tsx`
- Modify: `apps/desktop/src/pages/Templates.tsx`
- Modify: `apps/desktop/src/lib/engine.ts`

- [ ] **Step 1: Workflows 빈 상태에 Templates CTA 추가**

  워크플로우가 없을 때 "Create Workflow"와 함께 "Start from Template" 버튼을 보여준다.

- [ ] **Step 2: Templates 카드에 required settings 힌트 추가**

  템플릿의 노드 config를 훑어 필요한 설정을 추론한다.

  ```typescript
  function inferRequiredSettings(template: { nodes: Array<{ type: string; config: Record<string, unknown> }> }): string[] {
    const keys = new Set<string>();
    for (const node of template.nodes) {
      if (node.type === 'web_search') keys.add('TAVILY_API_KEY');
      if (node.type === 'slack_message') keys.add('SLACK_BOT_TOKEN');
      if (node.type === 'discord_message') keys.add('DISCORD_WEBHOOK_URL');
      if (node.type === 'block') {
        keys.add('KIS_APP_KEY');
        keys.add('KIS_APP_SECRET');
      }
    }
    return [...keys];
  }
  ```

- [ ] **Step 3: 템플릿 생성 후 에디터로 이동 유지**

  현재 `Templates.tsx`의 생성 후 `navigate(/workflows/:id)` 흐름은 유지한다.

- [ ] **Step 4: 새 워크플로우 생성 시 기본 trigger/output 제공**

  Workflows 페이지에서 빈 워크플로우를 만들 때 최소 nodes/edges를 넣는다.

  ```typescript
  nodes: [
    { id: crypto.randomUUID(), type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
    { id: crypto.randomUUID(), type: 'output', label: 'Output', position: { x: 520, y: 200 }, config: {} },
  ]
  ```

  두 노드 사이 edge는 생성한 id를 사용해 연결한다.

---

### Task 9: i18n 문구 정리

**Files:**
- Modify: `packages/ui/src/i18n/locales/en/common.json`
- Modify: `packages/ui/src/i18n/locales/ko/common.json`

- [ ] **Step 1: workflow editor 탭 문구 추가**

  ```json
  {
    "workflow": {
      "config": "Config",
      "runLog": "Run Log",
      "history": "History",
      "validation": "Validation",
      "noNodeSelected": "Select a node to edit its settings."
    }
  }
  ```

- [ ] **Step 2: 검증 메시지 문구 추가**

  영어/한국어 모두 `missingBlockId`, `missingSlackChannel`, `cycle`, `danglingEdge` 등 Task 3의 issue code에 대응하는 문구를 추가한다.

- [ ] **Step 3: 하드코딩 문자열 감소**

  `WorkflowEditor.tsx`, 신규 workflow 컴포넌트에서 사용자에게 보이는 주요 문구는 `t()`를 사용한다.

---

### Task 10: 검증 및 구현 문서 작성

**Files:**
- Create: `docs/implementation/v0.2.1.md`

- [ ] **Step 1: 타입체크**

  Run: `pnpm typecheck`

  Expected: all packages pass TypeScript checks.

- [ ] **Step 2: 워크플로우 엔진 테스트**

  Run: `pnpm --filter @neos-work/workflow-engine test`

  Expected: graph/executor tests pass.

- [ ] **Step 3: 빌드**

  Run: `pnpm build`

  Expected: server, desktop, shared, workflow-engine build successfully.

- [ ] **Step 4: 수동 확인**

  Run: `pnpm --filter @neos-work/desktop dev`

  확인 항목:
  - 새 워크플로우 생성 시 Trigger/Output 기본 노드가 보인다.
  - block 노드를 추가하고 `price_lookup` + `symbol=005930`을 설정할 수 있다.
  - agent_finance 노드에서 `finance_analyst` 하네스를 선택할 수 있다.
  - Slack 노드에서 channel을 입력할 수 있다.
  - blockId 없는 block 노드는 실행 전 validation error로 막힌다.
  - 실행 로그와 실행 이력의 runId가 같은 실행을 가리킨다.

- [ ] **Step 5: 구현 문서 작성**

  `docs/implementation/v0.2.1.md`에 다음 섹션을 작성한다.

  ```markdown
  # v0.2.1 구현 문서 — 워크플로우 빌더 사용성 완성

  ## 구현 요약
  ## 1. 에디터 설정 패널
  ## 2. 하네스/블록 선택 UI
  ## 3. 그래프 검증
  ## 4. 실행 이력 정합성
  ## 5. 테스트
  ## 6. v0.2.0 대비 변경 사항
  ## 7. 남은 과제
  ```

---

## 6. 완료 기준

v0.2.1은 다음 조건을 모두 만족하면 완료로 본다.

- 사용자가 코드 수정 없이 캔버스에서 block 노드의 blockId와 params를 설정할 수 있다.
- 사용자가 코드 수정 없이 agent 노드의 harnessId와 추가 system prompt를 설정할 수 있다.
- Slack/Web Search/Discord 노드의 최소 실행 config를 UI에서 설정할 수 있다.
- 실행 전 error-level validation이 동작한다.
- workflow run DB id와 SSE runId가 일치한다.
- `pnpm --filter @neos-work/workflow-engine test`가 통과한다.
- `pnpm typecheck`와 `pnpm build`가 통과한다.
- `docs/implementation/v0.2.1.md`가 실제 구현 기준으로 작성된다.

---

## 7. v0.2.2 이후 후보

v0.2.1에서 제외한 다음 항목은 후속 버전 후보로 남긴다.

| 후보 | 이유 |
|------|------|
| 병렬 executor | OR 게이트의 본래 의미를 구현하려면 실행 모델 변경이 필요 |
| 스케줄 트리거 | 워크플로우 자동화의 다음 단계 |
| 코딩 도메인 블록 | v0.2.1은 현재 워크플로우 사용성 마감에 집중 |
| 프론트엔드 컴포넌트 테스트 | 설정 패널 안정화 후 추가하는 편이 효율적 |
| per-node 실행 재시도 | 노드별 실패 복구 정책이 필요 |
| workflow import/export | 템플릿 공유와 백업 흐름에 필요 |
