# NEOS Work v0.2.2 — 워크플로우 개발 경험 개선 구현 계획

> **기준 버전**: v0.2.1 (워크플로우 빌더 사용성 완성)
> **작성일**: 2026-05-29
> **목표**: v0.2.1에서 명시적으로 미룬 항목(dev auth token, 컴포넌트 테스트)을 완료하고, 워크플로우를 실제로 파라미터화·디버깅할 수 있도록 두 가지 기능을 추가한다.

---

## 1. 배경 및 현재 상태

v0.2.1은 워크플로우 빌더를 설정하고 실행할 수 있는 수준으로 다듬었다.

하지만 `docs/implementation/v0.2.1.md` §7 "남은 과제"에 다음 항목이 명시되어 있다.

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| Dev/Client 모드 auth token | `getAuthToken()`이 Tauri 밖에서 `null` 반환 | 브라우저 dev 서버에서 API를 직접 테스트할 수 없음 |
| 프론트엔드 컴포넌트 테스트 | 없음 | 워크플로우 UI 컴포넌트 회귀를 자동으로 잡을 수 없음 |

추가로 v0.2.1 이후 실사용에서 드러난 두 가지 공백이 있다.

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| Trigger 노드 런타임 입력 | Trigger 노드가 `ctx.inputs`를 그대로 통과 (`{}`) | 워크플로우 실행 시 매번 `symbol`, `period` 같은 파라미터를 바꿀 수 없음 |
| 실행 이력 상세 보기 | History 탭이 run 상태(completed/failed)만 표시 | 노드별 출력·오류·소요 시간을 UI에서 확인할 수 없어 디버깅이 어려움 |

v0.2.2는 이 네 항목을 해결한다.

---

## 2. 목표와 비목표

### 목표

1. Dev/Client 모드에서 auth token을 UI로 입력하고, 세션 간 유지할 수 있다.
2. 워크플로우 핵심 UI 컴포넌트에 대한 자동 테스트가 존재한다.
3. 워크플로우 실행 시 Trigger 노드에 런타임 입력값을 주입할 수 있다.
4. 실행 이력에서 노드별 출력·오류·소요 시간을 펼쳐볼 수 있다.

### 비목표

- Webhook/스케줄 트리거 (v0.3.0 예정)
- 병렬 실행·진짜 OR 게이트 semantics (v0.3.0 예정)
- 코딩 도메인 블록 구현 (v0.3.0 예정)
- 전체 E2E 테스트 인프라

---

## 3. 제품 설계

### 3.1 Dev/Client 모드 Auth Token

#### 문제
`useEngine.tsx`의 `connect()` 함수는 Tauri 환경에서만 `getAuthToken()`을 통해 토큰을 얻는다. 브라우저 dev 서버(`pnpm dev`)에서는 `isTauri()`가 `false`를 반환해 토큰이 설정되지 않고, 서버의 Bearer 미들웨어가 모든 요청을 401로 거부한다.

#### 해결

두 경로로 토큰을 받을 수 있게 한다.

1. **Host Mode (Tauri)**: 기존 `getAuthToken()` Tauri invoke — 변경 없음.
2. **Client Mode / Dev Mode**: `ModeSelection`의 Client 모드 폼에 optional `Auth Token` 필드를 추가한다. 입력된 토큰은 `sessionStorage`에 `devAuthToken` 키로 저장하고, `connect()` 호출 시 주입한다.

> **설계 원칙**: `localStorage`는 사용하지 않는다. dev 토큰은 앱 재시작 시 만료된 것을 사용하는 실수를 방지하기 위해 탭/세션 단위로만 유지한다.

Host Mode(Tauri)에서도 `getAuthToken()`이 `null`을 반환하는 경우(사이드카 아직 미기동)를 위한 fallback으로, Settings 페이지에 "Override Auth Token" 입력란을 추가한다. 이 값은 `sessionStorage`에 저장해 `connect()`가 Tauri 토큰보다 이 값을 우선한다.

#### 변경 범위

```
ModeSelection.tsx       — Client 모드 폼에 token 입력 필드 추가
useEngine.tsx           — connect()에서 sessionStorage devAuthToken 읽기
Settings.tsx            — "Override Auth Token" 입력란 추가 (Dev Tools 섹션)
```

---

### 3.2 프론트엔드 컴포넌트 테스트

v0.2.1에서 `vitest`를 workflow-engine에 추가했다. v0.2.2에서는 `@testing-library/react`와 `jsdom`을 `apps/desktop`에 추가하고 워크플로우 UI 컴포넌트를 테스트한다.

#### 테스트 범위

| 파일 | 테스트 항목 |
|------|-------------|
| `WorkflowValidation.test.ts` | 이미 순수 함수 — 누락 label, 누락 blockId, cycle, dangling edge, 중첩 케이스 |
| `BlockParamForm.test.tsx` | string/number/boolean/select 필드 렌더링, onChange 호출 |
| `HarnessSelector.test.tsx` | 빈 목록, 항목 선택 시 onSelect 호출 |
| `BlockSelector.test.tsx` | 빈 목록, 항목 선택 시 onSelect 호출 |

`NodeConfigPanel`과 `WorkflowEditor` 전체는 React Flow 의존으로 모킹 비용이 크므로 v0.2.2에서는 제외한다.

#### 설정 파일 추가

- `apps/desktop/vite.config.ts`: `test` 블록 추가 (`environment: 'jsdom'`)
- `apps/desktop/package.json`: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` devDependency 추가

---

### 3.3 Trigger 노드 런타임 입력 주입

#### 현재 동작
`TriggerNode.execute(ctx)` 는 `ctx.inputs`를 그대로 반환한다. 서버 `POST /api/workflow/:id/run`은 body에서 `inputs`를 읽지 않으므로 항상 `{}`가 Trigger 출력이 된다.

#### 목표 동작
실행 버튼 클릭 시 다이얼로그가 열리고, 사용자가 key-value 쌍을 입력하면 해당 값이 Trigger 출력으로 시작부터 흘러간다.

#### 설계

**서버 변경:**

```
POST /api/workflow/:id/run
body: { inputs?: Record<string, string> }
```

서버가 `inputs`를 읽어 Trigger 노드의 `config.initialInputs`를 덮어쓰는 대신, `ExecutorOptions`에 `triggerInputs` 필드를 추가하고 executor가 Trigger 노드 컨텍스트에 직접 주입한다.

```typescript
// ExecutorOptions 추가
triggerInputs?: Record<string, unknown>;
```

Executor에서 Trigger 노드 실행 시:
```typescript
// trigger 노드에만 triggerInputs를 inputs로 주입
const nodeInputs = node.type === 'trigger'
  ? (options.triggerInputs ?? {})
  : inputs;
```

**클라이언트 변경:**

`WorkflowEditor`의 실행 버튼이 `RunInputsDialog`를 열고, 사용자가 `+` 버튼으로 key-value를 추가할 수 있다. 다이얼로그 확인 시 `inputs`를 포함해 실행 API를 호출한다.

> 노드 config의 `initialInputs`(정적 기본값)와 런타임 입력의 관계: 런타임 입력이 있으면 런타임 입력을 우선한다. 런타임 입력이 없으면 `config.initialInputs`를 사용한다.

---

### 3.4 실행 이력 노드 출력 상세 보기

#### 현재 동작
`RunHistoryPanel`은 run 목록(`GET /api/workflow/:id/runs`)을 보여준다. 각 run은 `status`, `startedAt`, `completedAt`, `error`를 표시한다. 노드별 결과는 `node_results_json`에 저장되어 있지만 UI에서 열람 불가능하다.

#### 목표 동작
run 항목을 클릭하면 해당 run의 노드별 결과 패널이 아래로 펼쳐진다. 각 노드는 아이콘(✓/✗)과 소요 시간을 헤더로 표시하고, 클릭하면 출력값 JSON preview와 오류 메시지가 나온다.

#### API 추가

```
GET /api/workflow/:workflowId/runs/:runId
→ { id, status, startedAt, completedAt, error, nodeResults: Record<string, { status, output, error, durationMs? }> }
```

`node_results_json`의 현재 포맷은 `{ nodeId: { status, output, error } }`이므로, `durationMs`를 추가 저장하도록 executor의 `onEvent` 처리를 보강한다.

#### UI

`RunHistoryPanel`에서 run 항목을 클릭하면 `RunDetailPanel`이 슬라이드 다운으로 열린다. 노드 결과는 `status`별로 아이콘으로 구분하며, `output`은 최대 2000자로 잘라 `<pre>` 태그로 표시한다.

---

## 4. 파일 맵

### 신규 파일

| 파일 | 책임 |
|------|------|
| `apps/desktop/src/components/workflow/RunInputsDialog.tsx` | 실행 시 Trigger 입력 주입 다이얼로그 |
| `apps/desktop/src/components/workflow/RunDetailPanel.tsx` | run 선택 시 노드별 출력 상세 패널 |
| `apps/desktop/src/components/workflow/WorkflowValidation.test.ts` | `validateWorkflowDraft` 유닛 테스트 |
| `apps/desktop/src/components/workflow/BlockParamForm.test.tsx` | BlockParamForm 렌더 테스트 |
| `apps/desktop/src/components/workflow/HarnessSelector.test.tsx` | HarnessSelector 렌더 테스트 |
| `apps/desktop/src/components/workflow/BlockSelector.test.tsx` | BlockSelector 렌더 테스트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/desktop/src/pages/ModeSelection.tsx` | Client 모드 폼에 optional auth token 입력 필드 추가 |
| `apps/desktop/src/pages/Settings.tsx` | Dev Tools 섹션 — "Override Auth Token" 입력란 추가 |
| `apps/desktop/src/hooks/useEngine.tsx` | `connect()`에서 `sessionStorage` devAuthToken 읽기·주입 |
| `apps/desktop/src/lib/engine.ts` | `runWorkflow()` — `inputs?: Record<string, unknown>` 파라미터 추가; `getWorkflowRun(runId)` 메서드 추가 |
| `apps/desktop/src/pages/WorkflowEditor.tsx` | 실행 버튼 클릭 시 `RunInputsDialog` 열기 |
| `apps/desktop/src/components/workflow/RunHistoryPanel.tsx` | run 클릭 시 `RunDetailPanel` 토글 |
| `apps/desktop/vite.config.ts` | `test` 블록 추가 (`environment: 'jsdom'`) |
| `apps/desktop/package.json` | `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` devDependency 추가 |
| `packages/workflow-engine/src/executor.ts` | `ExecutorOptions.triggerInputs` 추가; Trigger 노드에 주입; `node.completed` 이벤트에 `durationMs` 포함 |
| `packages/workflow-engine/src/executor.test.ts` | triggerInputs 주입 테스트 케이스 추가 |
| `apps/server/src/routes/workflow.ts` | `POST /:id/run` — body에서 `inputs` 읽어 `triggerInputs`로 전달; `GET /:id/runs/:runId` 엔드포인트 추가 |
| `apps/server/src/db/workflows.ts` | `getRun(runId)` 헬퍼 추가 |
| `packages/ui/src/i18n/locales/en/common.json` | run detail, trigger inputs 관련 문구 추가 |
| `packages/ui/src/i18n/locales/ko/common.json` | run detail, trigger inputs 관련 문구 추가 |
| `docs/implementation/v0.2.2.md` | 구현 완료 후 실제 변경 사항 기록 |

---

## 5. Task별 구현 계획

### Task 1: Dev/Client 모드 Auth Token UI

**Files:**
- Modify: `apps/desktop/src/pages/ModeSelection.tsx`
- Modify: `apps/desktop/src/pages/Settings.tsx`
- Modify: `apps/desktop/src/hooks/useEngine.tsx`

- [ ] **Step 1: `ModeSelection.tsx` — Client 폼에 token 입력 필드 추가**

  기존 `remoteUrl` 입력 아래에 optional token 입력 필드를 추가한다.

  ```tsx
  const [devToken, setDevToken] = useState('');

  // Client 폼 내부
  <input
    type="password"
    placeholder="Bearer token (optional)"
    value={devToken}
    onChange={(e) => setDevToken(e.target.value)}
    className="mt-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
    style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
  />
  ```

  Connect 시 토큰 전달:
  ```tsx
  const handleSelect = (mode: AppMode) => {
    if (mode === 'client' && !remoteUrl) return;
    if (devToken) sessionStorage.setItem('devAuthToken', devToken);
    connect(mode, mode === 'client' ? remoteUrl : undefined);
  };
  ```

- [ ] **Step 2: `Settings.tsx` — Dev Tools 섹션 추가**

  페이지 최하단에 "Dev Tools" 섹션을 추가한다(항상 표시, 별도 `collapsible` 처리는 불필요).

  ```tsx
  <section className="rounded-xl border p-5" style={{ ... }}>
    <h2 className="mb-1 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
      Dev Tools
    </h2>
    <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
      브라우저 dev 모드 또는 원격 연결에서 auth token을 수동으로 설정합니다.
      세션 종료 시 삭제됩니다.
    </p>
    <OverrideTokenInput />
  </section>
  ```

  `OverrideTokenInput` 컴포넌트:
  - 현재 `sessionStorage.getItem('devAuthToken')` 값을 초기값으로 표시
  - 저장 버튼 클릭 시 `sessionStorage.setItem('devAuthToken', value)` 및 `client?.setAuthToken(value)` 즉시 적용
  - 지우기 버튼 클릭 시 `sessionStorage.removeItem('devAuthToken')` 및 `client?.setAuthToken('')`

- [ ] **Step 3: `useEngine.tsx` — connect()에서 sessionStorage 토큰 읽기**

  Host/Client 공통으로, Tauri 토큰 획득 이후(또는 null인 경우) sessionStorage를 확인하고 우선 적용한다.

  ```typescript
  // 기존: Tauri token만 사용
  const token = await getAuthToken();
  if (token) client.setAuthToken(token);

  // 변경: sessionStorage override 우선
  const overrideToken = sessionStorage.getItem('devAuthToken');
  const tauriToken = await getAuthToken();
  const token = overrideToken ?? tauriToken;
  if (token) client.setAuthToken(token);
  ```

- [ ] **Step 4: 검증**

  1. `pnpm --filter @neos-work/server dev` 로 서버 기동 (토큰 로그 확인)
  2. `pnpm --filter @neos-work/desktop dev --host 127.0.0.1` 로 UI 기동
  3. Client 모드 선택, URL `http://127.0.0.1:57286`, 토큰 입력 후 연결
  4. Sessions 페이지 로드 확인 (401 없음)
  5. Settings → Dev Tools에서 토큰 변경 후 API 요청 재확인

---

### Task 2: 프론트엔드 컴포넌트 테스트 기반 추가

**Files:**
- Modify: `apps/desktop/vite.config.ts`
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/components/workflow/WorkflowValidation.test.ts`
- Create: `apps/desktop/src/components/workflow/BlockParamForm.test.tsx`
- Create: `apps/desktop/src/components/workflow/HarnessSelector.test.tsx`
- Create: `apps/desktop/src/components/workflow/BlockSelector.test.tsx`

- [ ] **Step 1: vite.config.ts에 test 블록 추가**

  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';

  export default defineConfig({
    plugins: [react()],
    // ... 기존 설정 ...
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  });
  ```

- [ ] **Step 2: test-setup.ts 생성**

  ```typescript
  // apps/desktop/src/test-setup.ts
  import '@testing-library/jest-dom';
  ```

- [ ] **Step 3: devDependency 추가**

  ```bash
  pnpm --filter @neos-work/desktop add -D \
    @testing-library/react \
    @testing-library/jest-dom \
    @testing-library/user-event \
    jsdom
  ```

- [ ] **Step 4: WorkflowValidation.test.ts 작성**

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { validateWorkflowDraft } from './WorkflowValidation.js';

  const triggerNode = { id: 't1', type: 'trigger', label: 'Trigger', config: {} };
  const outputNode  = { id: 'o1', type: 'output',  label: 'Output',  config: {} };
  const baseEdge    = { id: 'e1', source: 't1', target: 'o1' };

  describe('validateWorkflowDraft', () => {
    it('통과: trigger → output 최소 그래프', () => {
      const issues = validateWorkflowDraft({ nodes: [triggerNode, outputNode], edges: [baseEdge], blocks: [] });
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('error: label이 빈 노드', () => {
      const blank = { id: 'n1', type: 'block', label: '', config: {} };
      const issues = validateWorkflowDraft({ nodes: [triggerNode, blank, outputNode], edges: [baseEdge], blocks: [] });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'missing_node_label', severity: 'error', nodeId: 'n1' }));
    });

    it('error: block 노드에 blockId 없음', () => {
      const block = { id: 'b1', type: 'block', label: 'Block', config: {} };
      const issues = validateWorkflowDraft({ nodes: [triggerNode, block, outputNode], edges: [baseEdge], blocks: [] });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'missing_block_id', nodeId: 'b1' }));
    });

    it('error: dangling edge', () => {
      const dangling = { id: 'e-bad', source: 't1', target: 'ghost' };
      const issues = validateWorkflowDraft({ nodes: [triggerNode, outputNode], edges: [baseEdge, dangling], blocks: [] });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'dangling_edge', edgeId: 'e-bad' }));
    });

    it('error: cycle 감지', () => {
      const n1 = { id: 'n1', type: 'block', label: 'A', config: { blockId: 'x' } };
      const n2 = { id: 'n2', type: 'block', label: 'B', config: { blockId: 'y' } };
      const cyclicEdges = [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n1' },
      ];
      const issues = validateWorkflowDraft({ nodes: [n1, n2], edges: cyclicEdges, blocks: [] });
      expect(issues).toContainEqual(expect.objectContaining({ code: 'cycle' }));
    });
  });
  ```

- [ ] **Step 5: BlockParamForm.test.tsx 작성 (최소)**

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { BlockParamForm } from './BlockParamForm.js';

  const paramDefs = [
    { key: 'symbol', type: 'string' as const, label: 'Symbol', required: true },
    { key: 'period', type: 'select' as const, label: 'Period', options: ['1D', '1W', '1M'], required: false },
  ];

  describe('BlockParamForm', () => {
    it('paramDefs에 따라 필드를 렌더링한다', () => {
      render(<BlockParamForm paramDefs={paramDefs} values={{}} onChange={vi.fn()} />);
      expect(screen.getByLabelText(/Symbol/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Period/i)).toBeInTheDocument();
    });

    it('텍스트 입력 시 onChange를 호출한다', async () => {
      const onChange = vi.fn();
      render(<BlockParamForm paramDefs={paramDefs} values={{}} onChange={onChange} />);
      await userEvent.type(screen.getByLabelText(/Symbol/i), 'AAPL');
      expect(onChange).toHaveBeenCalledWith('symbol', 'A');
    });
  });
  ```

- [ ] **Step 6: 테스트 실행 확인**

  ```bash
  pnpm --filter @neos-work/desktop test
  ```

  Expected: 모든 케이스 PASS.

---

### Task 3: Trigger 노드 런타임 입력 주입

**Files:**
- Modify: `packages/workflow-engine/src/executor.ts`
- Modify: `packages/workflow-engine/src/executor.test.ts`
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/desktop/src/lib/engine.ts`
- Create: `apps/desktop/src/components/workflow/RunInputsDialog.tsx`
- Modify: `apps/desktop/src/pages/WorkflowEditor.tsx`

- [ ] **Step 1: ExecutorOptions에 triggerInputs 추가**

  `packages/workflow-engine/src/executor.ts`:

  ```typescript
  export interface ExecutorOptions {
    workflow: Workflow;
    settings: Record<string, string>;
    onEvent: (event: WorkflowSSEEvent) => void;
    signal?: AbortSignal;
    runId?: string;
    triggerInputs?: Record<string, unknown>; // 추가
  }
  ```

- [ ] **Step 2: Trigger 노드 컨텍스트에 triggerInputs 주입**

  executor의 노드별 실행 컨텍스트 생성 부분에서:

  ```typescript
  const nodeCtx: NodeContext = {
    workflowId: workflow.id,
    runId,
    nodeId: node.id,
    inputs: node.type === 'trigger'
      ? (options.triggerInputs ?? nodeInputs)
      : nodeInputs,
    settings,
    config: node.config,
    signal,
  };
  ```

  > `triggerInputs`가 제공되면 Trigger 노드의 `ctx.inputs`를 완전히 대체한다.
  > `triggerInputs`가 없으면 기존 동작(`config.initialInputs ?? {}`)을 유지한다.
  > `TriggerNode.execute(ctx)`는 `ctx.inputs`를 그대로 반환하므로 executor 수준에서만 변경하면 된다.

- [ ] **Step 3: 서버 route에서 inputs 읽기**

  `apps/server/src/routes/workflow.ts`:

  ```typescript
  workflow.post('/:id/run', async (c) => {
    const wf = db.getWorkflow(c.req.param('id'));
    if (!wf) return c.json({ ok: false, error: 'Not found' }, 404);

    const body = await c.req.json<{ inputs?: Record<string, unknown> }>().catch(() => ({}));
    // ...
    await executeWorkflow({
      runId,
      workflow: wf,
      settings,
      triggerInputs: body.inputs,  // 추가
      onEvent: (event) => { ... },
      signal: controller.signal,
    });
  });
  ```

- [ ] **Step 4: engine.ts에 inputs 파라미터 추가**

  `apps/desktop/src/lib/engine.ts`의 `runWorkflow()`:

  ```typescript
  async runWorkflow(
    workflowId: string,
    inputs?: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<WorkflowSSEEvent> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/run`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(inputs ? { inputs } : {}),
      signal,
    });
    // ...
  }
  ```

- [ ] **Step 5: RunInputsDialog 컴포넌트 작성**

  ```tsx
  // apps/desktop/src/components/workflow/RunInputsDialog.tsx
  interface RunInputsDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (inputs: Record<string, string>) => void;
  }
  ```

  다이얼로그 내부:
  - `{ key: string; value: string }[]` 상태로 행 관리
  - `+` 버튼으로 행 추가, `-` 버튼으로 행 삭제
  - `Run` 버튼 클릭 시 `Object.fromEntries(rows.map(r => [r.key, r.value]))`를 `onConfirm`에 전달
  - `Cancel` 버튼 클릭 시 `onClose` 호출

- [ ] **Step 6: WorkflowEditor.tsx — 실행 버튼에 다이얼로그 연결**

  ```tsx
  const [runInputsOpen, setRunInputsOpen] = useState(false);

  const handleRunClick = () => {
    const errors = validationIssues.filter((i) => i.severity === 'error');
    if (errors.length > 0) { setActiveTab('config'); return; }
    setRunInputsOpen(true);
  };

  const handleRunConfirm = (inputs: Record<string, string>) => {
    setRunInputsOpen(false);
    handleRun(inputs);
  };
  ```

  기존 `handleRun()`의 시그니처를 `handleRun(inputs?: Record<string, unknown>)`으로 변경하고 `runWorkflow(id, inputs)` 호출에 전달한다.

- [ ] **Step 7: executor 테스트 추가**

  `packages/workflow-engine/src/executor.test.ts`에 케이스 추가:

  ```typescript
  it('triggerInputs를 Trigger 노드 출력으로 사용한다', async () => {
    const events: WorkflowSSEEvent[] = [];
    await executeWorkflow({
      runId: 'run-inputs',
      triggerInputs: { symbol: 'AAPL', period: '1D' },
      workflow: baseWorkflow({
        nodes: [
          { id: 'trigger', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
          { id: 'output',  type: 'output',  label: 'O', position: { x: 1, y: 0 }, config: {} },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'output' }],
      }),
      settings: {},
      onEvent: (event) => events.push(event),
    });

    const completed = events.find(
      (e) => e.type === 'node.completed' && e.nodeId === 'trigger',
    ) as { output: unknown } | undefined;
    expect(completed?.output).toEqual({ symbol: 'AAPL', period: '1D' });
  });
  ```

- [ ] **Step 8: TDD RED 확인 후 구현**

  Step 7 테스트를 먼저 추가하고, 실패를 확인한 뒤 Step 1-2를 구현해 PASS를 확인한다.

---

### Task 4: 실행 이력 노드 출력 상세 보기

**Files:**
- Modify: `apps/server/src/routes/workflow.ts`
- Modify: `apps/server/src/db/workflows.ts`
- Modify: `packages/workflow-engine/src/executor.ts`
- Modify: `apps/desktop/src/lib/engine.ts`
- Create: `apps/desktop/src/components/workflow/RunDetailPanel.tsx`
- Modify: `apps/desktop/src/components/workflow/RunHistoryPanel.tsx`

- [ ] **Step 1: executor — node.completed 이벤트에 durationMs 추가**

  `WorkflowSSEEvent`의 `node.completed` 이벤트 타입에 `durationMs`가 없다면 `@neos-work/shared`의 `WorkflowSSEEvent` 타입에 추가한다.

  ```typescript
  // packages/shared/src/types/workflow.ts (또는 해당 위치)
  | { type: 'node.completed'; nodeId: string; output: unknown; durationMs: number }
  ```

  executor의 `onEvent` 호출:

  ```typescript
  onEvent({ type: 'node.completed', nodeId: node.id, output: safeOutput, durationMs: result.durationMs });
  ```

  서버 `onEvent` 핸들러에서 `durationMs`도 함께 저장:

  ```typescript
  if (event.type === 'node.completed') {
    nodeResults[event.nodeId] = {
      status: 'completed',
      output: event.output,
      durationMs: event.durationMs,
    };
  }
  ```

- [ ] **Step 2: DB — getRun 헬퍼 추가**

  `apps/server/src/db/workflows.ts`:

  ```typescript
  export function getRun(runId: string): WorkflowRun | null {
    const row = db.prepare('SELECT * FROM workflow_run WHERE id = ?').get(runId) as RawRun | undefined;
    return row ? parseRun(row) : null;
  }
  ```

- [ ] **Step 3: 서버 — GET /:workflowId/runs/:runId 엔드포인트 추가**

  ```typescript
  workflow.get('/:id/runs/:runId', (c) => {
    const run = db.getRun(c.req.param('runId'));
    if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
    // run이 요청한 workflowId에 속하는지 확인
    if (run.workflowId !== c.req.param('id')) {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
    return c.json({ ok: true, data: run });
  });
  ```

- [ ] **Step 4: engine.ts — getWorkflowRun 메서드 추가**

  ```typescript
  async getWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<WorkflowRun>> {
    const res = await fetch(
      `${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`,
      { headers: this.getHeaders() },
    );
    return res.json();
  }
  ```

- [ ] **Step 5: RunDetailPanel 컴포넌트 작성**

  ```tsx
  // apps/desktop/src/components/workflow/RunDetailPanel.tsx
  interface NodeResult {
    status: 'completed' | 'failed';
    output?: unknown;
    error?: string;
    durationMs?: number;
  }

  interface RunDetailPanelProps {
    runId: string;
    workflowId: string;
    nodeResults: Record<string, NodeResult>;
  }
  ```

  렌더링 규칙:
  - 노드 ID별로 정렬된 행 목록 표시
  - 각 행: `status` 아이콘 (✓ 녹색 / ✗ 빨간색) + nodeId + `durationMs`ms
  - 행 클릭 시 `output` JSON (최대 2000자 잘림) 또는 `error` 텍스트를 `<pre>` 로 펼침

- [ ] **Step 6: RunHistoryPanel — run 클릭 시 상세 패널 표시**

  ```tsx
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<...>(null);

  const handleRunClick = async (run: WorkflowRun) => {
    if (expandedRunId === run.id) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(run.id);
    const res = await client.getWorkflowRun(workflowId, run.id);
    if (res.ok) setRunDetail(res.data);
  };
  ```

---

## 6. 검증 기준

| 항목 | 검증 방법 |
|------|-----------|
| Dev auth token | 브라우저 dev 서버에서 Client 모드 + 토큰 입력 → 401 없이 Sessions 페이지 로드 |
| Dev auth token override | Settings → Dev Tools에서 토큰 변경 → 새 토큰으로 API 요청 성공 |
| 컴포넌트 테스트 | `pnpm --filter @neos-work/desktop test` — 모든 케이스 PASS |
| executor triggerInputs | `pnpm --filter @neos-work/workflow-engine test` — 3 tests PASS (기존 2 + 신규 1) |
| trigger inputs UI | 에디터에서 실행 버튼 → 다이얼로그에서 `symbol=AAPL` 입력 → 실행 → Run Log에서 Trigger 노드 출력 확인 |
| run detail | History 탭에서 completed run 클릭 → 노드별 status·output·durationMs 표시 |
| 타입체크 | `pnpm typecheck` — 14 tasks successful |
| 빌드 | `pnpm build` — successful |
